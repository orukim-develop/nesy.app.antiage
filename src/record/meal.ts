// record_meal — 식단 한 끼 저장. 컨펌된 결과만 받음.
// 반환: 그 날의 누적 kcal/protein + 유지 추정 + 상태.

import type { RunCtx, Meal } from '../types.ts';
import { newId, nowIso } from '../utils.ts';
import { getSettings } from '../settings.ts';
import { loadAllMeals, loadAllInBody } from '../store.ts';

type Status = 'deficit' | 'maintenance' | 'surplus';

export async function recordMeal(ctx: RunCtx) {
  const a = ctx.input.args || {};
  if (!a.date) throw new Error('date 필수.');
  if (!a.slot) throw new Error('slot 필수.');
  if (!Array.isArray(a.items)) throw new Error('items 배열 필수.');
  if (!a.source) throw new Error('source 필수 (user_text | photo_confirmed | ai_recommended_consumed).');

  const id = newId();
  const meal: Meal = {
    id,
    date: a.date,
    slot: a.slot,
    items: a.items,
    source: a.source,
    recipe_ref: a.recipe_ref,
    total_kcal_estimated: a.total_kcal_estimated,
    note: a.note,
    created_at: nowIso(),
  };

  const key = `meal:${a.date}:${a.slot}:${id}`;
  await ctx.data.set(key, meal);

  // ───── 하루 누적 ─────
  const all = await loadAllMeals(ctx);
  const todays = all.filter((m) => m.date === a.date);
  let kcal = 0;
  let protein = 0;
  for (const m of todays) {
    kcal += sumKcal(m);
    protein += sumProtein(m);
  }

  // ───── 유지 추정 (마지막 InBody 의 BMR × activity_factor) ─────
  const settings = await getSettings(ctx);
  const inbody = (await loadAllInBody(ctx)).sort((a1, b1) => b1.date.localeCompare(a1.date))[0];
  let estimate: { min: number; max: number; method: string } | null = null;
  let status: Status | 'unknown' = 'unknown';
  if (inbody) {
    const af = settings.activity_factor;
    const baseMin = Math.round(inbody.bmr_kcal * (af - 0.05));
    const baseMax = Math.round(inbody.bmr_kcal * (af + 0.05));
    estimate = {
      min: baseMin,
      max: baseMax,
      method: `BMR ${inbody.bmr_kcal} × activity_factor ${af} ± 0.05`,
    };
    if (kcal < baseMin) status = 'deficit';
    else if (kcal > baseMax) status = 'surplus';
    else status = 'maintenance';
  }

  return {
    saved: true,
    day_total_kcal: kcal,
    day_total_protein_g: Number(protein.toFixed(1)),
    maintenance_estimate: estimate,
    status,
  };
}

function sumKcal(m: Meal): number {
  if (typeof m.total_kcal_estimated === 'number') return m.total_kcal_estimated;
  return m.items.reduce((s, it) => s + (it.estimated_kcal || 0), 0);
}

function sumProtein(m: Meal): number {
  return m.items.reduce((s, it) => s + (it.protein_g || 0), 0);
}
