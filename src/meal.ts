// record_meal — 식단 한 끼 기록.
//
// 모든 영양 필드 optional. 사용자가 추적하는 것만 채움.
// 최소 한 필드 (kcal/protein/carbs/fat/name) 는 있어야 함.

import type { RunCtx, MealRecord } from './types.ts';
import { loadAllMeals } from './store.ts';
import { getSettings } from './settings.ts';
import { nowIso, newId, todayIso, assertPositiveNumber } from './utils.ts';

export async function recordMealTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { kcal, protein_g, carbs_g, fat_g, name, note, eaten_at } = args;

  const hasAny =
    kcal !== undefined || protein_g !== undefined || carbs_g !== undefined ||
    fat_g !== undefined || (typeof name === 'string' && name.trim() !== '');
  if (!hasAny) {
    throw new Error('최소 한 필드 필요 (kcal / protein_g / carbs_g / fat_g / name 중 하나).');
  }

  if (kcal !== undefined && kcal !== null) assertPositiveNumber(kcal, 'kcal', 5000);
  if (protein_g !== undefined && protein_g !== null) assertPositiveNumber(protein_g, 'protein_g', 300);
  if (carbs_g !== undefined && carbs_g !== null) assertPositiveNumber(carbs_g, 'carbs_g', 1000);
  if (fat_g !== undefined && fat_g !== null) assertPositiveNumber(fat_g, 'fat_g', 500);

  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') throw new Error('name 문자열 필요.');
    if (name.length > 200) throw new Error('name 최대 200자.');
  }

  const now = nowIso();
  const eatenAt = typeof eaten_at === 'string' ? eaten_at : now;

  const meal: MealRecord = {
    id: newId(),
    kcal: typeof kcal === 'number' ? kcal : undefined,
    protein_g: typeof protein_g === 'number' ? protein_g : undefined,
    carbs_g: typeof carbs_g === 'number' ? carbs_g : undefined,
    fat_g: typeof fat_g === 'number' ? fat_g : undefined,
    name: typeof name === 'string' ? name.trim() : undefined,
    note: typeof note === 'string' ? note : undefined,
    eaten_at: eatenAt,
    created_at: now,
  };

  await ctx.data.set(`meal:${eatenAt}:${meal.id}`, meal);

  // 오늘 누적 (사용자 timezone)
  const settings = await getSettings(ctx);
  const today = todayIso(settings.timezone);
  const all = await loadAllMeals(ctx);
  const todayMeals = all.filter((m) => m.eaten_at.slice(0, 10) === today);

  const todayTotal = {
    kcal: sumDefined(todayMeals.map((m) => m.kcal)),
    protein_g: sumDefined(todayMeals.map((m) => m.protein_g)),
    carbs_g: sumDefined(todayMeals.map((m) => m.carbs_g)),
    fat_g: sumDefined(todayMeals.map((m) => m.fat_g)),
  };

  return {
    saved: true,
    meal_id: meal.id,
    today_total: todayTotal,
    records_today: todayMeals.length,
  };
}

function sumDefined(arr: (number | undefined)[]): number | null {
  const filtered = arr.filter((x): x is number => typeof x === 'number');
  if (filtered.length === 0) return null;
  return Number(filtered.reduce((s, x) => s + x, 0).toFixed(2));
}
