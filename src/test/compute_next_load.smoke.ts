// compute_next_load.smoke — Helms RIR 4% + Refalo 2024 isolation + Plotkin 5%/wk cap.
//
// 검증:
//   1. 미등록 exercise_slug 거부
//   2. 직전 세션 없으면 거부
//   3. RIR off-target 4% 룰 (actual RIR=2 → target RIR=1 이면 +4%)
//   4. isolation 은 ×0.7 보수 (compound 의 70%)
//   5. RIR 동률이면 무게 그대로 + 2.5kg 단위 반올림

import { setExerciseTool } from '../exercise.ts';
import { recordSessionTool } from '../session.ts';
import { computeNextLoadTool } from '../compute_next_load.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── compute_next_load smoke');

// 1. 미등록 운동
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await computeNextLoadTool(withArgs(ctx, 'compute_next_load', { exercise_slug: 'squat' }));
  } catch (e: any) { threw = e.message.includes('exercise_not_registered'); }
  assert(threw, '미등록 거부');
  ok('1. 미등록 exercise_slug → exercise_not_registered');
}

// 2. 등록은 됐지만 세션 없음
{
  const ctx = makeCtx();
  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'squat', display_name: '스쿼트', category: 'compound',
  }));
  let threw = false;
  try {
    await computeNextLoadTool(withArgs(ctx, 'compute_next_load', { exercise_slug: 'squat' }));
  } catch (e: any) { threw = e.message.includes('no_prior_session'); }
  assert(threw, '세션 없음 거부');
  ok('2. 직전 세션 없음 → no_prior_session');
}

// 3. compound + RIR off-target = -1 → +4%
{
  const ctx = makeCtx();
  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'squat', display_name: '스쿼트', category: 'compound',
  }));
  await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'squat',
    sets: [{ weight_kg: 60, reps: 5, rir: 2 }],
  }));
  // target_rir=1, actual_rir=2 → delta_rir=-1 → +4% → 60×1.04=62.4 → 62.5
  const r: any = await computeNextLoadTool(withArgs(ctx, 'compute_next_load', {
    exercise_slug: 'squat', target_rir: 1,
  }));
  assert(r.pct_change === 4, `pct_change=4 (받음 ${r.pct_change})`);
  assert(r.recommended_weight_kg === 62.5, `60×1.04=62.4 → 62.5 (받음 ${r.recommended_weight_kg})`);
  assert(r.category === 'compound', 'category');
  assert(r.sources.length === 3, 'sources 3개');
  ok('3. compound + RIR -1 → +4% → 60kg → 62.5kg');
}

// 4. isolation 은 ×0.7
{
  const ctx = makeCtx();
  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'bicep_curl', display_name: '바이셉 컬', category: 'isolation',
  }));
  await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'bicep_curl',
    sets: [{ weight_kg: 20, reps: 10, rir: 3 }],
  }));
  // target_rir=1, actual=3 → delta=-2 → +8% (compound) → ×0.7 = +5.6% (isolation)
  // 20 × 1.056 = 21.12 → 2.5 step 반올림 → 20.0
  const r: any = await computeNextLoadTool(withArgs(ctx, 'compute_next_load', {
    exercise_slug: 'bicep_curl', target_rir: 1,
  }));
  assert(r.category === 'isolation', 'category');
  assert(Math.abs(r.pct_change - 5.6) < 0.01, `isolation pct_change=5.6 (받음 ${r.pct_change})`);
  assert(r.applied_rules.some((s: string) => s.includes('isolation')), 'isolation rule 적용');
  ok('4. isolation → +8% × 0.7 = +5.6% pct_change');
}

// 5. RIR 동률이면 변화 없음
{
  const ctx = makeCtx();
  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'bench', display_name: '벤치', category: 'compound',
  }));
  await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'bench',
    sets: [{ weight_kg: 70, reps: 5, rir: 2 }],
  }));
  const r: any = await computeNextLoadTool(withArgs(ctx, 'compute_next_load', {
    exercise_slug: 'bench', target_rir: 2,
  }));
  assert(r.pct_change === 0, `pct_change=0 (받음 ${r.pct_change})`);
  assert(r.recommended_weight_kg === 70, '같은 무게 유지');
  ok('5. RIR 동률 → pct_change=0, 무게 유지');
}

// 6. RIR 정보 없으면 actual_rir=2 디폴트
{
  const ctx = makeCtx();
  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'dead', display_name: '데드', category: 'compound',
  }));
  await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'dead',
    sets: [{ weight_kg: 100, reps: 3 }],  // rir 없음
  }));
  const r: any = await computeNextLoadTool(withArgs(ctx, 'compute_next_load', {
    exercise_slug: 'dead', target_rir: 1,
  }));
  // actual=2 (default), target=1 → delta=-1 → +4%
  assert(r.pct_change === 4, `RIR 디폴트 적용 (받음 ${r.pct_change})`);
  ok('6. set 에 RIR 없음 → actual_rir=2 디폴트 → delta=-1 → +4%');
}

console.log('✓ compute_next_load smoke passed\n');
