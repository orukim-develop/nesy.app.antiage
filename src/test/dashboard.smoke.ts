// dashboard.smoke — render_dashboard HTML 출력.
//
// 검증:
//   1. goal 없을 때 "목표 미설정" 표시
//   2. goal + metric + exercise + reminder 다 등록 → 모든 카드 포함
//   3. SVG 스파크라인 (metric 2개 측정) 생성

import { renderDashboardTool } from '../dashboard.ts';
import { setGoalTool } from '../goal.ts';
import { setExerciseTool } from '../exercise.ts';
import { setMetricTool } from '../metric.ts';
import { recordMetricTool } from '../metric_record.ts';
import { setReminderTool } from '../reminder.ts';
import { recordMealTool } from '../meal.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── dashboard smoke');

// 1. 빈 상태 → goal 미설정 메시지
{
  const ctx = makeCtx();
  const r: any = await renderDashboardTool(ctx);
  assert(typeof r.html === 'string', 'html string');
  assert(r.html.includes('목표 미설정'), '목표 미설정 메시지');
  assert(r.html.includes('등록된 지표 없음'), '지표 없음');
  ok('1. 빈 상태 → "목표 미설정" + "등록된 지표 없음"');
}

// 2. 풀 셋업 시나리오
{
  const ctx = makeCtx();
  await setGoalTool(withArgs(ctx, 'set_goal', { description: '체중 70kg + 콜레스테롤 관리' }));
  await setMetricTool(withArgs(ctx, 'set_metric', {
    slug: 'body_weight', display_name: '체중', unit: 'kg', target_max: 70, priority: 'critical',
  }));
  await setMetricTool(withArgs(ctx, 'set_metric', {
    slug: 'ldl', display_name: 'LDL', unit: 'mg/dL', target_max: 130, priority: 'high',
  }));
  await recordMetricTool(withArgs(ctx, 'record_metric', { slug: 'body_weight', value: 72 }));
  await recordMetricTool(withArgs(ctx, 'record_metric', { slug: 'body_weight', value: 71.5 }));
  await recordMetricTool(withArgs(ctx, 'record_metric', { slug: 'body_weight', value: 71 }));

  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'squat', display_name: '스쿼트', category: 'compound',
  }));
  await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'vit_d', display_name: '비타민D', schedule_times: ['09:00'], type: 'supplement',
  }));
  await recordMealTool(withArgs(ctx, 'record_meal', { kcal: 600, protein_g: 30, name: '아침' }));

  const r: any = await renderDashboardTool(ctx);
  assert(r.html.includes('체중 70kg + 콜레스테롤 관리'), 'goal 본문');
  assert(r.html.includes('체중'), '체중 metric');
  assert(r.html.includes('LDL'), 'LDL metric');
  assert(r.html.includes('스쿼트'), '스쿼트 exercise');
  assert(r.html.includes('비타민D'), '비타민D reminder');
  assert(r.html.includes('600'), '오늘 kcal 표시');
  // body_weight 측정 3건 → 스파크라인 SVG 포함
  assert(r.html.includes('<svg'), 'SVG 포함 (스파크라인)');
  ok('2. 풀 셋업 → goal/metrics/exercise/reminder/meal 모두 카드 포함 + SVG');
}

// 3. priority 정렬 — critical 이 앞
{
  const ctx = makeCtx();
  await setMetricTool(withArgs(ctx, 'set_metric', { slug: 'norm', display_name: 'Normal', unit: '%', priority: 'normal' }));
  await setMetricTool(withArgs(ctx, 'set_metric', { slug: 'crit', display_name: 'Critical', unit: '%', priority: 'critical' }));
  const r: any = await renderDashboardTool(ctx);
  const critIdx = r.html.indexOf('Critical');
  const normIdx = r.html.indexOf('Normal');
  assert(critIdx > 0 && critIdx < normIdx, 'Critical 이 Normal 보다 먼저');
  ok('3. metric priority 정렬 — critical 이 normal 보다 위');
}

// 4. unit 에 HTML 특수문자 있을 때 escape
{
  const ctx = makeCtx();
  await setMetricTool(withArgs(ctx, 'set_metric', {
    slug: 'odd', display_name: '<script>alert(1)</script>', unit: 'kg', priority: 'normal',
  }));
  const r: any = await renderDashboardTool(ctx);
  assert(!r.html.includes('<script>alert(1)'), 'script 태그 escape됨');
  assert(r.html.includes('&lt;script&gt;'), '&lt; escape');
  ok('4. display_name 의 <script> → HTML escape');
}

console.log('✓ dashboard smoke passed\n');
