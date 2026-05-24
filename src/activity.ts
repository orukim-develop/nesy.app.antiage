// record_activity — 비루틴 활동 (축구·산책·자전거·등산 등) 기록.
//
// 루틴 운동과 별개 트랙. compute_next_load 같은 검증 공식 없음, 그냥 기록.
// name 은 자유 텍스트 (slug 강제 X) — 사용자 어휘 그대로.

import type { RunCtx, ActivityRecord, ActivityIntensity } from './types.ts';
import { loadAllActivities } from './store.ts';
import { nowIso, newId, assertPositiveNumber, assertEnum } from './utils.ts';

const INTENSITIES = ['low', 'moderate', 'high'] as const;

export async function recordActivityTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { name, duration_min, intensity, distance_km, note, performed_at } = args;

  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('name 비어 있지 않은 문자열 필요 (사용자 자연어, 예: 풋살, 산책, 자전거).');
  }
  if (name.length > 100) throw new Error('name 너무 김 (최대 100자).');

  if (duration_min !== undefined && duration_min !== null) {
    assertPositiveNumber(duration_min, 'duration_min', 1440);
  }
  if (distance_km !== undefined && distance_km !== null) {
    assertPositiveNumber(distance_km, 'distance_km', 1000);
  }
  if (intensity !== undefined && intensity !== null) {
    assertEnum<ActivityIntensity>(intensity, INTENSITIES, 'intensity');
  }

  const now = nowIso();
  const performedAt = typeof performed_at === 'string' ? performed_at : now;

  const activity: ActivityRecord = {
    id: newId(),
    name: name.trim(),
    duration_min,
    intensity,
    distance_km,
    note: typeof note === 'string' ? note : undefined,
    performed_at: performedAt,
    created_at: now,
  };

  await ctx.data.set(`activity:${performedAt}:${activity.id}`, activity);

  // 오늘·이번주 통계
  const all = await loadAllActivities(ctx);
  const today = performedAt.slice(0, 10);
  const todayCount = all.filter((a) => a.performed_at.slice(0, 10) === today).length;

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const weekCount = all.filter((a) => a.performed_at >= weekAgo).length;

  return {
    saved: true,
    activity_id: activity.id,
    today_activities_count: todayCount,
    this_week_activities_count: weekCount,
  };
}
