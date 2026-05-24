// record_metric — 등록된 metric 의 측정값 한 건 기록.
//
// 검증: metric 이 metrics 에 등록되어 있어야 함 (없으면 거부).
// 자동: target_range 평가, 직전 측정값/7일 평균 대비 변화 계산.

import type { RunCtx, MetricRecord } from './types.ts';
import { getMetric, loadMetricRecordsFor, metricRecordPrefix } from './store.ts';
import { nowIso, newId, assertSlug } from './utils.ts';

export async function recordMetricTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug, value, measured_at, context, note } = args;

  assertSlug(slug, 'slug');

  const metric = await getMetric(ctx, slug);
  if (!metric) {
    throw new Error(
      `metric_not_registered: '${slug}' 가 metrics 에 없음. ` +
      `사용자에게 slug / display_name / unit / target_min,max 확인 후 set_metric 먼저 호출.`,
    );
  }

  if (typeof value !== 'number' || !isFinite(value)) {
    throw new Error(`value 는 유한한 숫자 필요 (받음: ${JSON.stringify(value)}).`);
  }

  const now = nowIso();
  const measuredAt = typeof measured_at === 'string' ? measured_at : now;

  const record: MetricRecord = {
    value,
    measured_at: measuredAt,
    context: typeof context === 'string' ? context : undefined,
    note: typeof note === 'string' ? note : undefined,
    created_at: now,
  };

  // 같은 ms 에 두 건 들어와도 충돌 안 나도록 uuid 접미사.
  await ctx.data.set(`${metricRecordPrefix(slug)}${measuredAt}:${newId()}`, record);

  // 이전 기록 + 7일 평균
  const all = await loadMetricRecordsFor(ctx, slug);
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const previous = all.find((r) => r.created_at !== now);
  const deltaFromPrevious = previous ? Number((value - previous.value).toFixed(4)) : null;

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const last7d = all.filter((r) => r.measured_at >= weekAgo);
  const sum = last7d.reduce((s, r) => s + r.value, 0);
  const avg7d = last7d.length > 0 ? sum / last7d.length : null;
  const deltaFrom7dAvg = avg7d !== null ? Number((value - avg7d).toFixed(4)) : null;

  // target 평가
  const tmin = metric.target_min;
  const tmax = metric.target_max;
  const hasRange = tmin !== undefined || tmax !== undefined;
  let inTargetRange: boolean | null = null;
  if (hasRange) {
    inTargetRange = (tmin === undefined || value >= tmin) && (tmax === undefined || value <= tmax);
  }

  return {
    saved: true,
    slug,
    value,
    unit: metric.unit,
    measured_at: measuredAt,
    in_target_range: inTargetRange,
    target_min: tmin ?? null,
    target_max: tmax ?? null,
    delta_from_previous: deltaFromPrevious,
    delta_from_7d_avg: deltaFrom7dAvg,
    records_count_total: all.length,
    records_count_7d: last7d.length,
    note: inTargetRange === false
      ? 'target 범위 벗어남. AI 는 사용자 목표 컨텍스트로 해석 후 안내.'
      : undefined,
  };
}
