// 건강지표 정의 CRUD — set_metric / list_metrics / delete_metric.
//
// 마도서는 임상 기준 모름. target_min/target_max 는 사용자/AI 합의 후 설정.
// 해석은 AI 책임 (사용자 목표 + 의학적 컨텍스트).

import type { RunCtx, MetricDef, MetricPriority } from './types.ts';
import {
  getMetric, setMetric as storeMetric, deleteMetric as removeMetric,
  loadAllMetrics, loadMetricRecordsFor,
} from './store.ts';
import { nowIso, assertSlug, assertEnum, assertPositiveNumber } from './utils.ts';

const PRIORITIES = ['critical', 'high', 'normal'] as const;

export async function setMetricTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug, display_name, unit, target_min, target_max, priority, frequency_hint } = args;

  assertSlug(slug, 'slug');
  if (typeof display_name !== 'string' || display_name.trim() === '') {
    throw new Error('display_name 비어 있지 않은 문자열 필요.');
  }
  if (typeof unit !== 'string' || unit.trim() === '') {
    throw new Error('unit 비어 있지 않은 문자열 필요 (예: mg/dL, kg, %, bpm).');
  }
  assertEnum<MetricPriority>(priority, PRIORITIES, 'priority');

  if (target_min !== undefined && target_min !== null) {
    if (typeof target_min !== 'number' || !isFinite(target_min)) {
      throw new Error('target_min 숫자 필요.');
    }
  }
  if (target_max !== undefined && target_max !== null) {
    if (typeof target_max !== 'number' || !isFinite(target_max)) {
      throw new Error('target_max 숫자 필요.');
    }
  }
  if (
    typeof target_min === 'number' && typeof target_max === 'number' &&
    target_min > target_max
  ) {
    throw new Error(`target_min (${target_min}) > target_max (${target_max}) — min ≤ max 필요.`);
  }
  if (frequency_hint !== undefined && frequency_hint !== null && typeof frequency_hint !== 'string') {
    throw new Error('frequency_hint 문자열 필요 (자유 텍스트).');
  }

  const now = nowIso();
  const existing = await getMetric(ctx, slug);
  const next: MetricDef = {
    slug,
    display_name: display_name.trim(),
    unit: unit.trim(),
    target_min: typeof target_min === 'number' ? target_min : undefined,
    target_max: typeof target_max === 'number' ? target_max : undefined,
    priority,
    frequency_hint: typeof frequency_hint === 'string' ? frequency_hint : undefined,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await storeMetric(ctx, next);

  const totalMetrics = (await loadAllMetrics(ctx)).length;
  return {
    saved: true,
    metric: next,
    is_update: !!existing,
    total_metrics: totalMetrics,
    note: existing
      ? '기존 metric 정의 update.'
      : '새 지표 등록. record_metric 으로 값 기록 가능.',
  };
}

export async function listMetricsTool(ctx: RunCtx) {
  const all = await loadAllMetrics(ctx);
  all.sort((a, b) => {
    const pa = priorityWeight(a.priority);
    const pb = priorityWeight(b.priority);
    if (pa !== pb) return pa - pb;
    return a.slug.localeCompare(b.slug);
  });

  // 각 metric 의 직전 기록 시각도 같이 (stale 판단용)
  const enriched = await Promise.all(all.map(async (m) => {
    const records = await loadMetricRecordsFor(ctx, m.slug);
    records.sort((a, b) => b.measured_at.localeCompare(a.measured_at));
    const latest = records[0];
    return {
      ...m,
      latest_value: latest?.value ?? null,
      latest_measured_at: latest?.measured_at ?? null,
      records_count: records.length,
    };
  }));

  return { metrics: enriched, count: enriched.length };
}

export async function deleteMetricTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug } = args;
  assertSlug(slug, 'slug');

  const existing = await getMetric(ctx, slug);
  if (!existing) return { deleted: false, slug, note: '해당 slug metric 없음.' };

  await removeMetric(ctx, slug);
  return {
    deleted: true,
    slug,
    note: '정의 삭제. 과거 metric_record 는 보존 (이력 유지).',
  };
}

function priorityWeight(p: MetricPriority): number {
  return p === 'critical' ? 0 : p === 'high' ? 1 : 2;
}
