// record_session — 루틴 운동 세션 한 건 기록.
//
// 검증:
//   1. exercise_slug 가 exercises 에 등록되어 있어야 함 (없으면 거부)
//   2. sets 배열 비어 있지 않음, 각 set 의 weight_kg / reps 양수
// 자동:
//   - 직전 동일 운동 최대 무게 대비 +15% 초과면 warnings: ['heavy_jump_Xpct'] (progressive overload sanity)
//   - 신기록이면 exercise.current_pr_kg 자동 update

import type { RunCtx, SessionRecord, SetEntry, ExerciseDef } from './types.ts';
import {
  getExercise, setExercise, loadAllSessions, findLastSessionFor, bestSet,
} from './store.ts';
import { nowIso, newId, assertSlug, assertPositiveNumber } from './utils.ts';

const HEAVY_JUMP_PCT = 15;

export async function recordSessionTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { exercise_slug, sets, note } = args;

  assertSlug(exercise_slug, 'exercise_slug');

  const exercise = await getExercise(ctx, exercise_slug);
  if (!exercise) {
    throw new Error(
      `exercise_not_registered: '${exercise_slug}' 가 exercises 에 없음. ` +
      `사용자에게 운동 이름·종류(compound/isolation) 확인 후 set_exercise 먼저 호출.`,
    );
  }

  if (!Array.isArray(sets) || sets.length === 0) {
    throw new Error('sets 비어 있지 않은 배열 필요.');
  }

  const parsedSets: SetEntry[] = sets.map((s: any, i: number) => {
    if (!s || typeof s !== 'object') throw new Error(`sets[${i}] 객체 필요.`);
    assertPositiveNumber(s.weight_kg, `sets[${i}].weight_kg`, 1000);
    assertPositiveNumber(s.reps, `sets[${i}].reps`, 100);
    if (s.rir !== undefined && s.rir !== null) {
      assertPositiveNumber(s.rir, `sets[${i}].rir`, 10);
    }
    return {
      weight_kg: s.weight_kg,
      reps: Math.floor(s.reps),
      rir: s.rir,
    };
  });

  const thisBest = bestSet(parsedSets)!;
  const sessions = await loadAllSessions(ctx);
  const last = findLastSessionFor(sessions, exercise_slug);

  const warnings: string[] = [];
  if (last) {
    const lastBest = bestSet(last.sets);
    if (lastBest && lastBest.weight_kg > 0) {
      const pct = ((thisBest.weight_kg - lastBest.weight_kg) / lastBest.weight_kg) * 100;
      if (pct > HEAVY_JUMP_PCT) {
        warnings.push(`heavy_jump_${Math.round(pct)}pct`);
      }
    }
  }

  // PR update
  const previousPr = exercise.current_pr_kg ?? 0;
  let newPr = false;
  if (thisBest.weight_kg > previousPr) {
    const updated: ExerciseDef = { ...exercise, current_pr_kg: thisBest.weight_kg, updated_at: nowIso() };
    await setExercise(ctx, updated);
    newPr = true;
  }

  const now = nowIso();
  const session: SessionRecord = {
    id: newId(),
    exercise_slug,
    sets: parsedSets,
    note: typeof note === 'string' ? note : undefined,
    created_at: now,
  };

  await ctx.data.set(`session:${now}:${session.id}`, session);

  return {
    saved: true,
    session_id: session.id,
    exercise_slug,
    best_set_this_session: thisBest,
    new_pr: newPr,
    current_pr_kg: newPr ? thisBest.weight_kg : (exercise.current_pr_kg ?? null),
    warnings,
    note: warnings.length > 0
      ? '경고 발생 — 호출 AI 는 사용자에게 그대로 전달 (직전 대비 급증량 안전성 검토).'
      : undefined,
  };
}
