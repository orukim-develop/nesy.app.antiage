// 키 네임스페이스 (단일 통로 위주):
//   __goal                              — 사용자 자연어 목표 단일 객체
//   __settings                          — timezone 등 단일 객체
//   exercise:{slug}                     — 루틴 운동 정의
//   session:{ISO}                       — 루틴 세션 기록
//   activity:{ISO}                      — 비루틴 활동 (축구·산책·자전거 등)
//   metric:{slug}                       — 건강지표 정의
//   metric_record:{slug}:{ISO}          — 건강지표 측정 기록
//   meal:{ISO}                          — 식단 한 끼
//   reminder:{slug}                     — 알람 정의 (영양제·약·측정·행동 통합)
//   reminder_ack:{ISO}                  — 알람 응답 기록
//   notif_sent:{slug}:{slot_iso}        — Push 발송 마킹 (워커 내부 한 번만 정책)

import type {
  RunCtx, Goal, ExerciseDef, SessionRecord, ActivityRecord,
  MetricDef, MetricRecord, MealRecord, ReminderDef, ReminderAck,
} from './types.ts';
import { listAllRows } from './utils.ts';

// list 결과 그대로 사용. value 누락된 row 만 fallback get.
export async function loadAll<T>(ctx: RunCtx, prefix: string): Promise<T[]> {
  const rows = await listAllRows(ctx.data, prefix);
  const out: T[] = [];
  const missing: string[] = [];
  for (const r of rows) {
    if (r.value !== undefined && r.value !== null) out.push(r.value as T);
    else missing.push(r.key);
  }
  if (missing.length > 0) {
    const filled = await Promise.all(missing.map((k) => ctx.data.get(k)));
    for (const v of filled) if (v !== null && v !== undefined) out.push(v as T);
  }
  return out;
}

// ───── Goal (단일) ─────
export const KEY_GOAL = '__goal';
export const getGoal = (ctx: RunCtx) => ctx.data.get(KEY_GOAL) as Promise<Goal | null>;
export const setGoal = (ctx: RunCtx, g: Goal) => ctx.data.set(KEY_GOAL, g);

// ───── Exercise 정의 ─────
export const exerciseKey = (slug: string) => `exercise:${slug}`;
export const getExercise = (ctx: RunCtx, slug: string) => ctx.data.get(exerciseKey(slug)) as Promise<ExerciseDef | null>;
export const setExercise = (ctx: RunCtx, def: ExerciseDef) => ctx.data.set(exerciseKey(def.slug), def);
export const deleteExercise = (ctx: RunCtx, slug: string) => ctx.data.delete(exerciseKey(slug));
export const loadAllExercises = (ctx: RunCtx) => loadAll<ExerciseDef>(ctx, 'exercise:');

// ───── Session ─────
export const loadAllSessions = (ctx: RunCtx) => loadAll<SessionRecord>(ctx, 'session:');

// 같은 운동 직전 세션 — created_at 내림차순 정렬 후 최상위.
export function findLastSessionFor(sessions: SessionRecord[], slug: string): SessionRecord | null {
  const matched = sessions.filter((s) => s.exercise_slug === slug);
  if (matched.length === 0) return null;
  matched.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return matched[0];
}

// best set = max(weight_kg). 동률이면 reps 큰 거.
export function bestSet(sets: { weight_kg: number; reps: number; rir?: number }[]) {
  if (sets.length === 0) return null;
  return [...sets].sort((a, b) => {
    if (b.weight_kg !== a.weight_kg) return b.weight_kg - a.weight_kg;
    return b.reps - a.reps;
  })[0];
}

// ───── Activity ─────
export const loadAllActivities = (ctx: RunCtx) => loadAll<ActivityRecord>(ctx, 'activity:');

// ───── Metric ─────
export const metricKey = (slug: string) => `metric:${slug}`;
export const getMetric = (ctx: RunCtx, slug: string) => ctx.data.get(metricKey(slug)) as Promise<MetricDef | null>;
export const setMetric = (ctx: RunCtx, def: MetricDef) => ctx.data.set(metricKey(def.slug), def);
export const deleteMetric = (ctx: RunCtx, slug: string) => ctx.data.delete(metricKey(slug));
export const loadAllMetrics = (ctx: RunCtx) => loadAll<MetricDef>(ctx, 'metric:');

// metric 기록 prefix: `metric_record:${slug}:`
export const metricRecordPrefix = (slug: string) => `metric_record:${slug}:`;
export const loadMetricRecordsFor = (ctx: RunCtx, slug: string) =>
  loadAll<MetricRecord>(ctx, metricRecordPrefix(slug));

// ───── Meal ─────
export const loadAllMeals = (ctx: RunCtx) => loadAll<MealRecord>(ctx, 'meal:');

// ───── Reminder ─────
export const reminderKey = (slug: string) => `reminder:${slug}`;
export const getReminder = (ctx: RunCtx, slug: string) => ctx.data.get(reminderKey(slug)) as Promise<ReminderDef | null>;
export const setReminder = (ctx: RunCtx, def: ReminderDef) => ctx.data.set(reminderKey(def.slug), def);
export const deleteReminder = (ctx: RunCtx, slug: string) => ctx.data.delete(reminderKey(slug));
export const loadAllReminders = (ctx: RunCtx) => loadAll<ReminderDef>(ctx, 'reminder:');

export const loadAllReminderAcks = (ctx: RunCtx) => loadAll<ReminderAck>(ctx, 'reminder_ack:');

// ───── Notif 마킹 (워커 내부) ─────
export const notifSentKey = (slug: string, slotIso: string) => `notif_sent:${slug}:${slotIso}`;
