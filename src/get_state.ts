// get_state — 마도서의 심장.
//
// 호출 AI 가 추천 / 응답 / 알림 해석 전에 무조건 먼저 부른다.
// 빈 추론 → 사실 기반 응답 으로 강제하는 통로.
//
// 반환 구조 (요약):
//   - goal              : 사용자 자연어 목표 (없으면 null)
//   - exercises         : 등록 루틴 운동 + last_session
//   - recent_sessions   : 최근 7개 세션
//   - recent_activities : 최근 7개 비루틴 활동
//   - metrics           : 등록 지표 + latest_value + in_target_range
//   - meals_today       : 오늘 식단 + 누적 + (조건부) maintenance 추정
//   - reminders         : 활성 알람 + 오늘 ack 카운트 + next_slot_due
//   - settings          : timezone / activity_factor
//   - missing_setup     : goal/metrics/exercises/reminders 비어있음 진단
//   - stale_records     : 14일 이상 측정 없는 지표
//   - meta              : AI 행동 규약 (must/should_not/next_action)

import type { RunCtx, ExerciseDef, MetricDef, ReminderDef } from './types.ts';
import {
  getGoal,
  loadAllExercises, loadAllSessions, loadAllActivities,
  loadAllMetrics, loadMetricRecordsFor,
  loadAllMeals,
  loadAllReminders, loadAllReminderAcks,
  findLastSessionFor, bestSet,
} from './store.ts';
import { getSettings } from './settings.ts';
import { todayIso, nowMinutesInTz, hhmmToMinutes, daysBetween } from './utils.ts';

const STALE_DAYS = 14;

export async function getStateTool(ctx: RunCtx) {
  const settings = await getSettings(ctx);
  const tz = settings.timezone;
  const today = todayIso(tz);
  const nowMin = nowMinutesInTz(tz);

  const [goal, exercises, sessions, activities, metrics, meals, reminders, reminderAcks] =
    await Promise.all([
      getGoal(ctx),
      loadAllExercises(ctx),
      loadAllSessions(ctx),
      loadAllActivities(ctx),
      loadAllMetrics(ctx),
      loadAllMeals(ctx),
      loadAllReminders(ctx),
      loadAllReminderAcks(ctx),
    ]);

  // ───── exercises + last_session ─────
  const exerciseSummaries = exercises.map((e) => {
    const last = findLastSessionFor(sessions, e.slug);
    const top = last ? bestSet(last.sets) : null;
    return {
      ...e,
      last_session: last
        ? {
            id: last.id,
            performed_at: last.created_at,
            top_set: top
              ? { weight_kg: top.weight_kg, reps: top.reps, rir: top.rir ?? null }
              : null,
            set_count: last.sets.length,
          }
        : null,
    };
  });

  // ───── recent sessions / activities (각 7개) ─────
  const recentSessions = [...sessions]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 7)
    .map((s) => ({
      id: s.id,
      exercise_slug: s.exercise_slug,
      performed_at: s.created_at,
      top_set: bestSet(s.sets),
      set_count: s.sets.length,
    }));

  const recentActivities = [...activities]
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))
    .slice(0, 7)
    .map((a) => ({
      id: a.id,
      name: a.name,
      performed_at: a.performed_at,
      duration_min: a.duration_min ?? null,
      intensity: a.intensity ?? null,
      distance_km: a.distance_km ?? null,
    }));

  // ───── metrics + latest_value (per-slug 병렬 fetch) ─────
  const metricEnriched = await Promise.all(metrics.map(async (m) => {
    const records = await loadMetricRecordsFor(ctx, m.slug);
    records.sort((a, b) => b.measured_at.localeCompare(a.measured_at));
    const latest = records[0] ?? null;
    let inTarget: boolean | null = null;
    if (latest && (m.target_min !== undefined || m.target_max !== undefined)) {
      inTarget =
        (m.target_min === undefined || latest.value >= m.target_min) &&
        (m.target_max === undefined || latest.value <= m.target_max);
    }
    return {
      ...m,
      latest_value: latest?.value ?? null,
      latest_measured_at: latest?.measured_at ?? null,
      latest_context: latest?.context ?? null,
      in_target_range: inTarget,
      records_count: records.length,
    };
  }));

  // ───── meals today ─────
  const todayMeals = meals
    .filter((m) => m.eaten_at.slice(0, 10) === today)
    .sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
  const todayTotal = {
    kcal: sumOpt(todayMeals.map((m) => m.kcal)),
    protein_g: sumOpt(todayMeals.map((m) => m.protein_g)),
    carbs_g: sumOpt(todayMeals.map((m) => m.carbs_g)),
    fat_g: sumOpt(todayMeals.map((m) => m.fat_g)),
  };
  // BMR metric (slug 에 'bmr' 또는 'basal_metabolic' 포함) + activity_factor 있으면 유지 추정.
  const bmrMetric = metricEnriched.find(
    (m) => /bmr|basal_metabolic/i.test(m.slug) && typeof m.latest_value === 'number',
  );
  let maintenanceEstimate: { min: number; max: number; basis: string } | null = null;
  if (bmrMetric && typeof settings.activity_factor === 'number' && bmrMetric.latest_value !== null) {
    const af = settings.activity_factor;
    const bmr = bmrMetric.latest_value as number;
    maintenanceEstimate = {
      min: Math.round(bmr * Math.max(1.0, af - 0.05)),
      max: Math.round(bmr * (af + 0.05)),
      basis: `BMR ${bmr} (${bmrMetric.slug}) × activity_factor ${af}`,
    };
  }
  let calorieStatus: 'deficit' | 'slight_deficit' | 'maintenance' | 'slight_surplus' | 'surplus' | 'unknown' = 'unknown';
  if (maintenanceEstimate && typeof todayTotal.kcal === 'number') {
    const k = todayTotal.kcal;
    if (k < maintenanceEstimate.min - 200) calorieStatus = 'deficit';
    else if (k < maintenanceEstimate.min) calorieStatus = 'slight_deficit';
    else if (k > maintenanceEstimate.max + 200) calorieStatus = 'surplus';
    else if (k > maintenanceEstimate.max) calorieStatus = 'slight_surplus';
    else calorieStatus = 'maintenance';
  }

  // ───── reminders + today ack count + next slot due ─────
  const activeReminders = reminders.filter((r) => !r.end_date || r.end_date >= today);
  const todayAcks = reminderAcks.filter((a) => a.acked_at.slice(0, 10) === today);
  const ackCountBySlug = new Map<string, number>();
  for (const a of todayAcks) ackCountBySlug.set(a.slug, (ackCountBySlug.get(a.slug) ?? 0) + 1);

  const reminderSummaries = activeReminders
    .map((r) => ({
      ...r,
      today_ack_count: ackCountBySlug.get(r.slug) ?? 0,
      today_slot_count: r.schedule_times.length,
    }))
    .sort((a, b) => a.schedule_times[0].localeCompare(b.schedule_times[0]));

  // 가장 가까운 다음 슬롯 (오늘 안에서, 현재 시각 이후 첫 미 ack).
  const nextSlot = findNextSlot(activeReminders, todayAcks, today, nowMin);

  // ───── 진단: missing_setup ─────
  const missingSetup: string[] = [];
  if (!goal) missingSetup.push('goal');
  if (metrics.length === 0) missingSetup.push('metrics');
  if (exercises.length === 0 && activities.length === 0) missingSetup.push('exercises_or_activities');
  // reminders 는 선택 — 없어도 missing 아님.

  // ───── 진단: stale metrics (14일+ 측정 없음) ─────
  const staleRecords: { slug: string; days_since: number | null; priority: string }[] = [];
  for (const m of metricEnriched) {
    if (m.latest_measured_at === null) {
      staleRecords.push({ slug: m.slug, days_since: null, priority: m.priority });
      continue;
    }
    const daysSince = daysBetween(m.latest_measured_at.slice(0, 10), today);
    if (daysSince >= STALE_DAYS) {
      staleRecords.push({ slug: m.slug, days_since: daysSince, priority: m.priority });
    }
  }

  // ───── meta block (AI 행동 규약) ─────
  const meta = buildMetaBlock({
    goal_present: !!goal,
    missing_setup: missingSetup,
    stale_records: staleRecords,
    has_metrics: metrics.length > 0,
    has_exercises: exercises.length > 0,
    activity_factor_set: typeof settings.activity_factor === 'number',
    has_bmr_metric: !!bmrMetric,
  });

  return {
    today,
    timezone: tz,
    now_minutes: nowMin,

    goal: goal ?? null,

    exercises: exerciseSummaries,
    recent_sessions: recentSessions,
    recent_activities: recentActivities,

    metrics: metricEnriched,

    meals_today: {
      records: todayMeals,
      total: todayTotal,
      maintenance_estimate: maintenanceEstimate,
      calorie_status: calorieStatus,
    },

    reminders: reminderSummaries,
    next_reminder_slot: nextSlot,

    settings: {
      timezone: settings.timezone,
      activity_factor: settings.activity_factor,
    },

    missing_setup: missingSetup,
    stale_records: staleRecords,

    meta,
  };
}

// ───── 헬퍼 ─────

function sumOpt(arr: (number | undefined)[]): number | null {
  const f = arr.filter((x): x is number => typeof x === 'number');
  if (f.length === 0) return null;
  return Number(f.reduce((s, x) => s + x, 0).toFixed(2));
}

function findNextSlot(
  reminders: ReminderDef[],
  todayAcks: { slug: string; slot_iso: string }[],
  today: string,
  nowMin: number,
): { slug: string; display_name: string; slot: string; minutes_until: number } | null {
  const ackedSlots = new Set(todayAcks.map((a) => `${a.slug}@${a.slot_iso}`));
  let best: { slug: string; display_name: string; slot: string; minutes_until: number } | null = null;
  for (const r of reminders) {
    for (const slot of r.schedule_times) {
      const slotMin = hhmmToMinutes(slot);
      if (slotMin < nowMin) continue;
      const slotIso = `${today}T${slot}:00`;
      if (ackedSlots.has(`${r.slug}@${slotIso}`)) continue;
      const minutesUntil = slotMin - nowMin;
      if (best === null || minutesUntil < best.minutes_until) {
        best = { slug: r.slug, display_name: r.display_name, slot, minutes_until: minutesUntil };
      }
    }
  }
  return best;
}

interface MetaInput {
  goal_present: boolean;
  missing_setup: string[];
  stale_records: { slug: string; days_since: number | null; priority: string }[];
  has_metrics: boolean;
  has_exercises: boolean;
  activity_factor_set: boolean;
  has_bmr_metric: boolean;
}

function buildMetaBlock(x: MetaInput) {
  // 단계 판단: goal → metrics/exercises → routine 운영.
  let protocolStep: 'awaiting_goal' | 'awaiting_initial_setup' | 'operational' = 'operational';
  let nextRecommendedAction: string;
  if (!x.goal_present) {
    protocolStep = 'awaiting_goal';
    nextRecommendedAction =
      'set_goal 호출 — 사용자에게 "어떤 건강 목표를 갖고 있어?" 자연어로 묻고 description 그대로 저장.';
  } else if (!x.has_metrics && !x.has_exercises) {
    protocolStep = 'awaiting_initial_setup';
    nextRecommendedAction =
      'propose_setup_from_goal 호출 → 추천 목록을 사용자에게 보여주고 합의된 항목만 set_metric / set_exercise / set_reminder.';
  } else {
    nextRecommendedAction =
      '사용자 발화 처리. 기록 요청이면 record_* / 추천 요청이면 metrics 와 last_session 으로 근거 있는 답.';
  }

  const aiShouldNot: string[] = [
    '사용자 설명 없는 metric / exercise / reminder 를 마음대로 등록하지 말 것.',
    'get_state 안 부르고 무게·칼로리·복용량 추천 금지 (빈 추론 금지).',
    '날짜 / 시각을 추측하지 말 것 — settings.timezone 기준 today / now_minutes 사용.',
    '의학적 진단·처방 흉내 금지 — metric in_target_range=false 면 사용자에게 사실만 전달.',
    'compute_next_load 결과 무게에 자체적으로 더하거나 빼지 말 것.',
  ];
  if (!x.activity_factor_set) {
    aiShouldNot.push(
      'activity_factor 없이 칼로리 유지·결핍·잉여 단정 금지 (사용자에게 활동량 합의 후 update_user_settings).',
    );
  }

  const guidanceText =
    protocolStep === 'awaiting_goal'
      ? '아직 목표가 없음. 사용자에게 친근하게 묻고 set_goal 호출.'
      : protocolStep === 'awaiting_initial_setup'
        ? '목표는 있지만 metrics·exercises 비어있음. propose_setup_from_goal 로 추천 → 사용자 합의 → set_*.'
        : '운영 모드. 기록·조회·계산을 사실 기반으로 처리.';

  const goalCoherenceHint = x.goal_present
    ? '추천 / 응답 전에 goal.description 을 한번 다시 읽고, 사용자 발화와 목표 정합성 검증.'
    : null;

  return {
    protocol_step: protocolStep,
    ai_must_call_set_goal_if_goal_null: !x.goal_present,
    ai_must_call_get_state_before_recommendation: true,
    ai_must_confirm_dates_before_recording: true,
    ai_should_not: aiShouldNot,
    next_recommended_action: nextRecommendedAction,
    guidance_text: guidanceText,
    goal_coherence_hint: goalCoherenceHint,
    stale_metric_count: x.stale_records.length,
  };
}
