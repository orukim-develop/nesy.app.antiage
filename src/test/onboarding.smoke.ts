// onboarding.smoke — goal → propose_setup_from_goal 흐름 3 케이스.
//
// 검증:
//   1. goal 없으면 propose 가 goal_present: false 반환
//   2. 당뇨·근비대·다이어트 goal 각각이 다른 추천 케이스 매칭
//   3. 매칭 안 된 goal 도 generic 추천 반환 (빈 응답 X)

import { setGoalTool } from '../goal.ts';
import { proposeSetupFromGoalTool } from '../propose_setup_from_goal.ts';
import { getStateTool } from '../get_state.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── onboarding smoke');

// 1. goal 없을 때 propose
{
  const ctx = makeCtx();
  const r: any = await proposeSetupFromGoalTool(ctx);
  assert(r.goal_present === false, 'goal_present=false 일 때');
  assert(Array.isArray(r.suggested_metrics) && r.suggested_metrics.length === 0, '제안 비어있음');
  ok('1. goal 없으면 propose 가 빈 결과 + 안내 반환');
}

// 2-a. 당뇨 케이스
{
  const ctx = makeCtx();
  await setGoalTool(withArgs(ctx, 'set_goal', { description: '당뇨 관리 — 식후 혈당 180 안 넘기기' }));
  const r: any = await proposeSetupFromGoalTool(ctx);
  assert(r.goal_present === true, 'goal 있음');
  assert(r.matched_cases.includes('diabetes'), 'diabetes 매칭');
  const slugs = r.suggested_metrics.map((m: any) => m.slug);
  assert(slugs.includes('fasting_glucose'), 'fasting_glucose 제안');
  assert(slugs.includes('post_meal_glucose'), 'post_meal_glucose 제안');
  const rSlugs = r.suggested_reminders.map((x: any) => x.slug);
  assert(rSlugs.includes('morning_glucose_check'), 'morning_glucose_check reminder 제안');
  ok('2-a. 당뇨 goal → diabetes 케이스 (혈당 metrics + 측정 reminders)');
}

// 2-b. 근비대 케이스
{
  const ctx = makeCtx();
  await setGoalTool(withArgs(ctx, 'set_goal', { description: '근비대 추구. 1년에 골격근 +3kg, 스쿼트 PR 100kg 달성' }));
  const r: any = await proposeSetupFromGoalTool(ctx);
  assert(r.matched_cases.includes('bodybuilding'), 'bodybuilding 매칭');
  const exSlugs = r.suggested_exercises.map((e: any) => e.slug);
  assert(exSlugs.includes('squat'), 'squat 제안');
  assert(exSlugs.includes('bench_press'), 'bench_press 제안');
  assert(exSlugs.includes('deadlift'), 'deadlift 제안');
  ok('2-b. 근비대 goal → bodybuilding 케이스 (compound 운동 4개 + 체성분 metrics)');
}

// 2-c. 다이어트 + 콜레스테롤 복합 (여러 케이스 매칭)
{
  const ctx = makeCtx();
  await setGoalTool(withArgs(ctx, 'set_goal', {
    description: '체중 감량 + 콜레스테롤 (LDL) 낮추기',
  }));
  const r: any = await proposeSetupFromGoalTool(ctx);
  assert(r.matched_cases.includes('diet'), 'diet 매칭');
  assert(r.matched_cases.includes('blood_lipid'), 'blood_lipid 매칭');
  const slugs = r.suggested_metrics.map((m: any) => m.slug);
  assert(slugs.includes('body_weight'), 'body_weight 제안');
  assert(slugs.includes('ldl_mg_dl'), 'ldl_mg_dl 제안');
  // 중복 제거: body_weight 가 두 케이스에서 나와도 1번만
  const bw = slugs.filter((s: string) => s === 'body_weight');
  assert(bw.length === 1, 'body_weight 중복 제거');
  ok('2-c. 다이어트+콜레스테롤 복합 → diet+blood_lipid 동시 매칭, slug 중복 제거');
}

// 3. 매칭 안 되는 goal → generic
{
  const ctx = makeCtx();
  await setGoalTool(withArgs(ctx, 'set_goal', { description: '그냥 건강하게 살고 싶음' }));
  const r: any = await proposeSetupFromGoalTool(ctx);
  assert(r.matched_cases.length === 0, '매칭 케이스 없음');
  const slugs = r.suggested_metrics.map((m: any) => m.slug);
  assert(slugs.includes('body_weight'), 'generic body_weight 폴백');
  ok('3. 매칭 안 되는 goal → generic 폴백 (빈 응답 X)');
}

// 4. get_state.meta.protocol_step 흐름
{
  const ctx = makeCtx();
  let s: any = await getStateTool(ctx);
  assert(s.meta.protocol_step === 'awaiting_goal', 'goal 없을 때 awaiting_goal');
  assert(s.meta.ai_must_call_set_goal_if_goal_null === true, 'must_call_set_goal=true');

  await setGoalTool(withArgs(ctx, 'set_goal', { description: '아무 거나' }));
  s = await getStateTool(ctx);
  assert(s.meta.protocol_step === 'awaiting_initial_setup', 'goal 만 있고 metrics/exercises 없을 때');
  ok('4. get_state.meta.protocol_step: awaiting_goal → awaiting_initial_setup');
}

console.log('✓ onboarding smoke passed\n');
