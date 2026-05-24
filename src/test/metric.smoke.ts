// metric.smoke — set_metric → record_metric → in_target_range / delta 확인.

import { setMetricTool, listMetricsTool, deleteMetricTool } from '../metric.ts';
import { recordMetricTool } from '../metric_record.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── metric smoke');

// 1. set_metric 검증 (target_min > target_max 거부)
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await setMetricTool(withArgs(ctx, 'set_metric', {
      slug: 'x', display_name: 'X', unit: 'kg', priority: 'normal',
      target_min: 100, target_max: 50,
    }));
  } catch (e: any) { threw = e.message.includes('target_min') && e.message.includes('target_max'); }
  assert(threw, 'min > max 거부');
  ok('1. target_min > target_max 거부');
}

// 2. 등록 + 측정 → in_target_range
const ctx = makeCtx();
{
  await setMetricTool(withArgs(ctx, 'set_metric', {
    slug: 'fasting_glucose', display_name: '공복혈당', unit: 'mg/dL',
    target_min: 80, target_max: 100, priority: 'critical',
  }));

  // target 안
  const r1: any = await recordMetricTool(withArgs(ctx, 'record_metric', {
    slug: 'fasting_glucose', value: 95, context: 'fasted_morning',
  }));
  assert(r1.in_target_range === true, '95 in [80,100]');
  assert(r1.delta_from_previous === null, '첫 기록 → delta null');
  ok('2. 95mg/dL → in_target_range=true, delta null (첫 기록)');
}

// 3. 두 번째 측정 → delta_from_previous 산출
{
  const r: any = await recordMetricTool(withArgs(ctx, 'record_metric', {
    slug: 'fasting_glucose', value: 110, context: 'fasted_morning',
  }));
  assert(r.in_target_range === false, '110 > 100');
  assert(r.delta_from_previous === 15, `95→110 = +15 (받음 ${r.delta_from_previous})`);
  ok('3. 110mg/dL → out of range + delta=+15');
}

// 4. 미등록 slug → record 거부
{
  const ctx2 = makeCtx();
  let threw = false;
  try {
    await recordMetricTool(withArgs(ctx2, 'record_metric', {
      slug: 'unknown_metric', value: 1,
    }));
  } catch (e: any) { threw = e.message.includes('metric_not_registered'); }
  assert(threw, '미등록 거부');
  ok('4. 미등록 metric slug → metric_not_registered');
}

// 5. target_max 만 있을 때 in_target_range
{
  const ctx2 = makeCtx();
  await setMetricTool(withArgs(ctx2, 'set_metric', {
    slug: 'ldl', display_name: 'LDL', unit: 'mg/dL',
    target_max: 130, priority: 'high',
  }));
  const r: any = await recordMetricTool(withArgs(ctx2, 'record_metric', { slug: 'ldl', value: 125 }));
  assert(r.in_target_range === true, '125 ≤ 130');
  const r2: any = await recordMetricTool(withArgs(ctx2, 'record_metric', { slug: 'ldl', value: 150 }));
  assert(r2.in_target_range === false, '150 > 130');
  ok('5. target_max 만 있을 때 ≤ 비교만 적용');
}

// 6. list_metrics priority 정렬
{
  const ctx2 = makeCtx();
  await setMetricTool(withArgs(ctx2, 'set_metric', { slug: 'a', display_name: 'A', unit: '%', priority: 'normal' }));
  await setMetricTool(withArgs(ctx2, 'set_metric', { slug: 'b', display_name: 'B', unit: '%', priority: 'critical' }));
  await setMetricTool(withArgs(ctx2, 'set_metric', { slug: 'c', display_name: 'C', unit: '%', priority: 'high' }));
  const list: any = await listMetricsTool(ctx2);
  assert(list.metrics[0].slug === 'b', 'critical 먼저');
  assert(list.metrics[1].slug === 'c', 'high 두번째');
  assert(list.metrics[2].slug === 'a', 'normal 마지막');
  ok('6. list_metrics priority 정렬 (critical → high → normal)');
}

// 7. delete_metric — 정의만 삭제, 기록 보존 안 됨 검증은 records 자체는 별도 key
{
  const r: any = await deleteMetricTool(withArgs(ctx, 'delete_metric', { slug: 'fasting_glucose' }));
  assert(r.deleted === true, 'deleted');
  const r2: any = await deleteMetricTool(withArgs(ctx, 'delete_metric', { slug: 'fasting_glucose' }));
  assert(r2.deleted === false, '두번째 삭제는 false');
  ok('7. delete_metric idempotent');
}

console.log('✓ metric smoke passed\n');
