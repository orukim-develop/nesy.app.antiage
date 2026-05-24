// session.smoke — set_exercise → record_session 흐름.
//
// 검증:
//   1. 미등록 slug 면 record_session 거부
//   2. 정상 기록 + best_set 산출
//   3. 15% 급증량 warning
//   4. 신기록 PR 자동 update
//   5. set 데이터 검증 (음수·문자열 거부)

import { setExerciseTool } from '../exercise.ts';
import { recordSessionTool } from '../session.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── session smoke');

// 1. 미등록 slug
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordSessionTool(withArgs(ctx, 'record_session', {
      exercise_slug: 'squat',
      sets: [{ weight_kg: 60, reps: 5 }],
    }));
  } catch (e: any) {
    threw = e.message.includes('exercise_not_registered');
  }
  assert(threw, '미등록 slug 거부');
  ok('1. 미등록 운동 slug 는 record_session 거부 (exercise_not_registered)');
}

// 2. 정상 등록 + 기록
const ctx = makeCtx();
{
  await setExerciseTool(withArgs(ctx, 'set_exercise', {
    slug: 'squat', display_name: '스쿼트', category: 'compound',
  }));
  const r: any = await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'squat',
    sets: [
      { weight_kg: 60, reps: 5, rir: 2 },
      { weight_kg: 60, reps: 5, rir: 2 },
      { weight_kg: 60, reps: 5, rir: 1 },
    ],
  }));
  assert(r.saved === true, '저장');
  assert(r.best_set_this_session.weight_kg === 60 && r.best_set_this_session.reps === 5, 'best set');
  assert(r.new_pr === true, '첫 기록이 PR');
  assert(r.current_pr_kg === 60, 'PR 60kg');
  assert(r.warnings.length === 0, 'warnings 없음');
  ok('2. set_exercise → 정상 record_session → best_set + 첫 PR');
}

// 3. 15% 급증량 warning (60 → 80 = +33%)
{
  const r: any = await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'squat',
    sets: [{ weight_kg: 80, reps: 3 }],
  }));
  assert(r.warnings.some((w: string) => w.startsWith('heavy_jump_')), '급증량 warning');
  assert(r.new_pr === true, '새 PR');
  assert(r.current_pr_kg === 80, 'PR 80kg 갱신');
  ok('3. 60→80kg 급증량 → heavy_jump warning + PR 갱신');
}

// 4. PR 안 깨지면 new_pr=false
{
  const r: any = await recordSessionTool(withArgs(ctx, 'record_session', {
    exercise_slug: 'squat',
    sets: [{ weight_kg: 70, reps: 5 }],
  }));
  assert(r.new_pr === false, 'PR 안 깸');
  assert(r.current_pr_kg === 80, 'PR 80 유지');
  ok('4. 더 가벼운 무게 기록 → PR 유지');
}

// 5. 음수/문자열 거부
{
  const ctx2 = makeCtx();
  await setExerciseTool(withArgs(ctx2, 'set_exercise', {
    slug: 'bench_press', display_name: '벤치', category: 'compound',
  }));
  let threw = false;
  try {
    await recordSessionTool(withArgs(ctx2, 'record_session', {
      exercise_slug: 'bench_press',
      sets: [{ weight_kg: -10, reps: 5 }],
    }));
  } catch (e: any) { threw = e.message.includes('음수') || e.message.includes('weight_kg'); }
  assert(threw, '음수 거부');
  ok('5. 음수 weight_kg 거부');
}

// 6. category enum 검증
{
  const ctx2 = makeCtx();
  let threw = false;
  try {
    await setExerciseTool(withArgs(ctx2, 'set_exercise', {
      slug: 'random', display_name: 'X', category: 'cardio',
    }));
  } catch (e: any) { threw = e.message.includes('compound') || e.message.includes('isolation'); }
  assert(threw, 'category enum 거부');
  ok('6. category enum 외 값 거부');
}

console.log('✓ session smoke passed\n');
