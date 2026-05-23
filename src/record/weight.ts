// record_weight — 체중 한 건 저장.

import type { RunCtx, WeightEntry } from '../types.ts';
import { nowHHMM, nowIso } from '../utils.ts';
import { getSettings } from '../settings.ts';
import { loadAllWeights } from '../store.ts';

export async function recordWeight(ctx: RunCtx) {
  const a = ctx.input.args || {};
  if (!a.date) throw new Error('date 필수 (YYYY-MM-DD).');
  if (typeof a.weight_kg !== 'number') throw new Error('weight_kg 필수 (number).');
  if (!a.measurement_context) throw new Error('measurement_context 필수.');

  const settings = await getSettings(ctx);

  const timeKey = a.time ? String(a.time).replace(':', '') : nowHHMM();
  const entry: WeightEntry = {
    date: a.date,
    time: a.time,
    weight_kg: a.weight_kg,
    measurement_context: a.measurement_context,
    note: a.note,
    created_at: nowIso(),
  };

  const key = `weight:${a.date}:${timeKey}`;
  await ctx.data.set(key, entry);

  // ───── 7일 평균 + in_range 판정 ─────
  const all = await loadAllWeights(ctx);
  const last7 = recentDaysAvg(all, a.date, 7);
  const inRange =
    a.weight_kg >= settings.target_weight_min && a.weight_kg <= settings.target_weight_max;

  return {
    saved: true,
    target_range: {
      min: settings.target_weight_min,
      max: settings.target_weight_max,
      rule: settings.target_weight_rule,
    },
    in_range: inRange,
    delta_vs_7day_avg:
      last7 !== null ? Number((a.weight_kg - last7).toFixed(2)) : null,
  };
}

function recentDaysAvg(all: WeightEntry[], untilDate: string, days: number): number | null {
  const cutoff = subtractDays(untilDate, days);
  const inWindow = all.filter((w) => w.date >= cutoff && w.date <= untilDate);
  if (inWindow.length === 0) return null;
  const sum = inWindow.reduce((s, w) => s + w.weight_kg, 0);
  return sum / inWindow.length;
}

function subtractDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
