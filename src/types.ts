// 공통 타입. 모든 핸들러 import.
//
// 설계 원칙:
//   - 마도서는 호출 AI 의 외장 기억. 데이터 모양은 "사용자가 정의한 어휘" 로 유동.
//   - 고정 스키마 (체중/혈액/인바디 따로) X. metric 하나의 통로로 모든 건강지표 처리.
//   - 영양제·약·측정·행동 알람은 reminder 하나의 통로로 통합.

export interface RunCtx {
  input: { tool: string; args: Record<string, any> };
  secrets: Record<string, string>;
  data: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<boolean>;
    // 플랫폼 contract: list 결과는 value 포함. N+1 금지.
    list(prefix?: string, limit?: number): Promise<{ key: string; value: any; updated_at: string }[]>;
  };
}

// ───── Goal (자연어) ─────
export interface Goal {
  description: string;
  set_at: string;     // ISO
  updated_at: string; // ISO
}

// ───── 운동 — 루틴 정의 ─────
export type ExerciseCategory = 'compound' | 'isolation';

export interface ExerciseDef {
  slug: string;             // snake_case
  display_name: string;
  category: ExerciseCategory;
  current_pr_kg: number | null;
  created_at: string;
  updated_at: string;
}

// ───── 운동 — 세션 기록 ─────
export interface SetEntry {
  weight_kg: number;
  reps: number;
  rir?: number; // Reps In Reserve. 모르면 생략
}

export interface SessionRecord {
  id: string;
  exercise_slug: string;
  sets: SetEntry[];
  note?: string;
  created_at: string; // ISO
}

// ───── 비루틴 활동 (축구·산책·자전거 등) ─────
export type ActivityIntensity = 'low' | 'moderate' | 'high';

export interface ActivityRecord {
  id: string;
  name: string;          // 자유 텍스트
  duration_min?: number;
  intensity?: ActivityIntensity;
  distance_km?: number;
  note?: string;
  performed_at: string;  // ISO
  created_at: string;    // ISO
}

// ───── 건강지표 — 정의 ─────
export type MetricPriority = 'critical' | 'high' | 'normal';

export interface MetricDef {
  slug: string;
  display_name: string;
  unit: string;              // 자유 텍스트 (mg/dL, kg, %, bpm 등)
  target_min?: number;
  target_max?: number;
  priority: MetricPriority;
  frequency_hint?: string;   // 자유 텍스트 (예: 'daily_morning', 'quarterly')
  created_at: string;
  updated_at: string;
}

// ───── 건강지표 — 측정 기록 ─────
export interface MetricRecord {
  value: number;
  measured_at: string;       // ISO
  context?: string;          // 자유 텍스트 (예: 'fasted_morning', 'post_run')
  note?: string;
  created_at: string;
}

// ───── 식단 ─────
export interface MealRecord {
  id: string;
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  name?: string;
  note?: string;
  eaten_at: string;          // ISO
  created_at: string;
}

// ───── Reminder — 영양제·약·측정·행동 통합 알람 ─────
export type ReminderType = 'supplement' | 'measurement' | 'action';

export interface ReminderDef {
  slug: string;
  display_name: string;
  schedule_times: string[];  // ['HH:MM', ...]
  every_n_days: number;      // 1=매일, 2=격일, 7=주1회
  window_minutes: number;    // 슬롯 ± N분
  type: ReminderType;
  notes?: string;            // 자유 메모 — 알림 body 에 첨부
  start_date?: string;       // YYYY-MM-DD
  end_date?: string;
  created_at: string;
  updated_at: string;
}

// ───── Reminder — ack 기록 ─────
export interface ReminderAck {
  id: string;
  slug: string;
  slot_iso: string;          // 매칭된 슬롯의 ISO (윈도우 밖이면 'off_schedule')
  note?: string;
  acked_at: string;          // ISO
  created_at: string;
}

// ───── Settings ─────
// 진짜 필수는 timezone 만. activity_factor 는 식단 칼로리 해석 필요 시 AI 가 합의 후 update.
// sex / target_weight / PR 등 모두 사라짐 (목표·지표·운동은 사용자가 정의).
export interface Settings {
  timezone: string;
  activity_factor: number | null;
}
