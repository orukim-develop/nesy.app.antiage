// record_recipe — AI 가 추천한 레시피 한 건 저장.
// record_meal 의 recipe_ref 로 나중에 연결.

import type { RunCtx, Recipe } from '../types.ts';
import { newId, nowIso } from '../utils.ts';

export async function recordRecipe(ctx: RunCtx) {
  const a = ctx.input.args || {};
  if (!a.date) throw new Error('date 필수.');
  if (!a.name) throw new Error('name 필수.');
  if (!a.source_url) throw new Error('source_url 필수 (호출 AI 가 검증한 URL).');

  const id = newId();
  const recipe: Recipe = {
    id,
    date: a.date,
    name: a.name,
    cuisine: a.cuisine,
    source_url: a.source_url,
    ingredients: a.ingredients,
    primary_protein_g: a.primary_protein_g,
    estimated_kcal: a.estimated_kcal,
    ldl_friendly: a.ldl_friendly,
    rationale: a.rationale,
    created_at: nowIso(),
  };

  const key = `recipe:${a.date}:${id}`;
  await ctx.data.set(key, recipe);

  return {
    saved: true,
    recipe_id: key,
  };
}
