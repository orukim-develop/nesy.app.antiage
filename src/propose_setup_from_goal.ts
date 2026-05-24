// propose_setup_from_goal — 사용자 goal description 기반 추천 setup 반환.
//
// 키워드 매칭 (LLM 호출 X, 마도서 내부 사전).
// AI 가 이걸 사용자에게 그대로 제안 → 합의 후 set_metric / set_exercise / set_reminder 호출.
//
// 매칭 안 되는 케이스도 OK — generic 추천만 반환.

import type { RunCtx } from './types.ts';
import { getGoal } from './store.ts';

interface MetricSuggestion {
  slug: string;
  display_name: string;
  unit: string;
  target_min?: number;
  target_max?: number;
  priority: 'critical' | 'high' | 'normal';
  rationale: string;
}

interface ExerciseSuggestion {
  slug: string;
  display_name: string;
  category: 'compound' | 'isolation';
  rationale: string;
}

interface ReminderSuggestion {
  slug: string;
  display_name: string;
  schedule_times: string[];
  type: 'supplement' | 'measurement' | 'action';
  window_minutes: number;
  rationale: string;
}

// 키워드 → 케이스 매칭. 첫 매치 + generic.
const CASES: {
  name: string;
  keywords: RegExp;
  metrics: MetricSuggestion[];
  exercises: ExerciseSuggestion[];
  reminders: ReminderSuggestion[];
}[] = [
  {
    name: 'diabetes',
    keywords: /당뇨|혈당|인슐린|diabetes|glucose|insulin|hba1c/i,
    metrics: [
      { slug: 'fasting_glucose', display_name: '아침 공복 혈당', unit: 'mg/dL', target_min: 80, target_max: 100, priority: 'critical', rationale: '당뇨 관리 핵심 지표' },
      { slug: 'post_meal_glucose', display_name: '식후 2시간 혈당', unit: 'mg/dL', target_max: 180, priority: 'critical', rationale: '식후 안정성 핵심' },
      { slug: 'hba1c', display_name: 'HbA1c', unit: '%', target_max: 6.5, priority: 'high', rationale: '3개월 평균 혈당. 분기별 추적' },
    ],
    exercises: [],
    reminders: [
      { slug: 'morning_glucose_check', display_name: '아침 혈당 측정', schedule_times: ['07:00'], type: 'measurement', window_minutes: 60, rationale: '공복 상태 측정' },
      { slug: 'evening_glucose_check', display_name: '저녁 식후 혈당', schedule_times: ['21:30'], type: 'measurement', window_minutes: 60, rationale: '식후 2시간 시점' },
    ],
  },
  {
    name: 'bodybuilding',
    keywords: /근비대|근육|근성장|벤치|스쿼트|데드|벌크|bulk|hypertrophy|pr |\bpr$|powerlifting/i,
    metrics: [
      { slug: 'body_weight', display_name: '체중', unit: 'kg', priority: 'high', rationale: '벌크/컷 추세 추적' },
      { slug: 'body_fat_pct', display_name: '체지방률', unit: '%', priority: 'high', rationale: '근비대 vs 지방 증가 판단' },
      { slug: 'skeletal_muscle_kg', display_name: '골격근량', unit: 'kg', priority: 'high', rationale: 'InBody 핵심 수치' },
    ],
    exercises: [
      { slug: 'squat', display_name: '스쿼트', category: 'compound', rationale: '하체 베이스' },
      { slug: 'bench_press', display_name: '벤치 프레스', category: 'compound', rationale: '가슴 베이스' },
      { slug: 'deadlift', display_name: '데드리프트', category: 'compound', rationale: '후면 사슬 베이스' },
      { slug: 'shoulder_press', display_name: '오버헤드 프레스', category: 'compound', rationale: '어깨 베이스' },
    ],
    reminders: [],
  },
  {
    name: 'diet',
    keywords: /다이어트|체중\s*감량|체지방|감량|cut|fat\s*loss|weight\s*loss/i,
    metrics: [
      { slug: 'body_weight', display_name: '체중', unit: 'kg', priority: 'critical', rationale: '감량 핵심 지표 — target_max 사용자 합의 후 설정' },
      { slug: 'body_fat_pct', display_name: '체지방률', unit: '%', priority: 'high', rationale: '체중과 별개 트랙' },
    ],
    exercises: [],
    reminders: [],
  },
  {
    name: 'cardio_endurance',
    keywords: /마라톤|러닝|달리기|자전거|싸이클|cardio|marathon|cycling/i,
    metrics: [
      { slug: 'body_weight', display_name: '체중', unit: 'kg', priority: 'normal', rationale: '추세 모니터' },
      { slug: 'resting_heart_rate', display_name: '안정시 심박수', unit: 'bpm', target_max: 70, priority: 'high', rationale: '심폐 적응 지표' },
    ],
    exercises: [],
    reminders: [],
  },
  {
    name: 'blood_lipid',
    keywords: /콜레스테롤|ldl|hdl|중성지방|지질|cholesterol|lipid/i,
    metrics: [
      { slug: 'ldl_mg_dl', display_name: 'LDL', unit: 'mg/dL', target_max: 130, priority: 'high', rationale: '심혈관 위험 지표' },
      { slug: 'hdl_mg_dl', display_name: 'HDL', unit: 'mg/dL', target_min: 40, priority: 'high', rationale: '좋은 콜레스테롤' },
      { slug: 'triglycerides_mg_dl', display_name: '중성지방', unit: 'mg/dL', target_max: 150, priority: 'normal', rationale: '대사 건강' },
    ],
    exercises: [],
    reminders: [],
  },
  {
    name: 'blood_pressure',
    keywords: /혈압|고혈압|hypertension|blood\s*pressure/i,
    metrics: [
      { slug: 'systolic_bp', display_name: '수축기 혈압', unit: 'mmHg', target_max: 130, priority: 'critical', rationale: '고혈압 관리 핵심' },
      { slug: 'diastolic_bp', display_name: '이완기 혈압', unit: 'mmHg', target_max: 85, priority: 'critical', rationale: '고혈압 관리 핵심' },
    ],
    exercises: [],
    reminders: [
      { slug: 'morning_bp_check', display_name: '아침 혈압 측정', schedule_times: ['07:30'], type: 'measurement', window_minutes: 60, rationale: '공복·기상 후 측정 권장' },
    ],
  },
];

const GENERIC: { metrics: MetricSuggestion[] } = {
  metrics: [
    { slug: 'body_weight', display_name: '체중', unit: 'kg', priority: 'normal', rationale: '가장 기본 — target 없이 추세만 추적 가능' },
  ],
};

export async function proposeSetupFromGoalTool(ctx: RunCtx) {
  const goal = await getGoal(ctx);
  if (!goal) {
    return {
      goal_present: false,
      note: 'goal 미설정. set_goal 먼저 호출 후 다시 시도.',
      matched_cases: [],
      suggested_metrics: [],
      suggested_exercises: [],
      suggested_reminders: [],
    };
  }

  const desc = goal.description;
  const matched: string[] = [];
  const metrics: MetricSuggestion[] = [];
  const exercises: ExerciseSuggestion[] = [];
  const reminders: ReminderSuggestion[] = [];

  for (const c of CASES) {
    if (c.keywords.test(desc)) {
      matched.push(c.name);
      metrics.push(...c.metrics);
      exercises.push(...c.exercises);
      reminders.push(...c.reminders);
    }
  }

  // 매치 안 됐으면 generic
  if (matched.length === 0) {
    metrics.push(...GENERIC.metrics);
  }

  // 중복 제거 (slug 기준)
  const dedupe = <T extends { slug: string }>(arr: T[]) => {
    const seen = new Set<string>();
    return arr.filter((x) => (seen.has(x.slug) ? false : (seen.add(x.slug), true)));
  };

  return {
    goal_present: true,
    goal_description: desc,
    matched_cases: matched,
    suggested_metrics: dedupe(metrics),
    suggested_exercises: dedupe(exercises),
    suggested_reminders: dedupe(reminders),
    note:
      '이 목록은 키워드 기반 추천. AI 는 사용자에게 그대로 제시 → 사용자가 골라낸 것만 set_* 호출. ' +
      '사용자가 "이거 말고 X 도" 같이 추가 요청하면 그것도 set_metric / set_reminder.',
  };
}
