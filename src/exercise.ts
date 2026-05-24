// 루틴 운동 정의 CRUD — set_exercise / list_exercises / delete_exercise.
//
// 루틴 운동만 등록 (compute_next_load 검증 공식 적용 대상).
// 축구·산책·자전거 같은 비루틴 활동은 record_activity 사용 — 등록 불필요.

import type { RunCtx, ExerciseDef, ExerciseCategory } from './types.ts';
import {
  getExercise, setExercise as storeExercise, deleteExercise as removeExercise,
  loadAllExercises,
} from './store.ts';
import { nowIso, assertSlug, assertEnum } from './utils.ts';

const CATEGORIES = ['compound', 'isolation'] as const;

export async function setExerciseTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug, display_name, category } = args;

  assertSlug(slug, 'slug');
  if (typeof display_name !== 'string' || display_name.trim() === '') {
    throw new Error('display_name 비어 있지 않은 문자열 필요.');
  }
  assertEnum<ExerciseCategory>(category, CATEGORIES, 'category');

  const now = nowIso();
  const existing = await getExercise(ctx, slug);
  const next: ExerciseDef = {
    slug,
    display_name: display_name.trim(),
    category,
    current_pr_kg: existing?.current_pr_kg ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await storeExercise(ctx, next);

  const total = (await loadAllExercises(ctx)).length;
  return {
    saved: true,
    exercise: next,
    is_update: !!existing,
    total_exercises: total,
    note: existing
      ? '기존 운동 정의 update.'
      : '새 운동 등록. record_session / compute_next_load 에서 이 slug 사용 가능.',
  };
}

export async function listExercisesTool(ctx: RunCtx) {
  const list = await loadAllExercises(ctx);
  list.sort((a, b) => a.slug.localeCompare(b.slug));
  return { exercises: list, count: list.length };
}

export async function deleteExerciseTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug } = args;
  assertSlug(slug, 'slug');

  const existing = await getExercise(ctx, slug);
  if (!existing) return { deleted: false, slug, note: '해당 slug 운동 정의 없음.' };

  await removeExercise(ctx, slug);
  return {
    deleted: true,
    slug,
    note: '정의 삭제. 과거 session 기록은 보존 (이력 유지).',
  };
}
