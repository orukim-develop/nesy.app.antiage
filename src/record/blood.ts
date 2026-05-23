// record_blood_panel — 혈액검사 결과 + 정상범위 플래그.
// 한국 일반 임상 기준 (성인 남성).

import type { RunCtx, BloodPanel } from '../types.ts';
import { nowIso } from '../utils.ts';
import { loadAllBlood } from '../store.ts';

export async function recordBloodPanel(ctx: RunCtx) {
  const a = ctx.input.args || {};
  if (!a.date) throw new Error('date 필수.');

  const entry: BloodPanel = {
    date: a.date,
    ldl_mg_dl: a.ldl_mg_dl,
    hdl_mg_dl: a.hdl_mg_dl,
    total_cholesterol_mg_dl: a.total_cholesterol_mg_dl,
    triglycerides_mg_dl: a.triglycerides_mg_dl,
    uric_acid_mg_dl: a.uric_acid_mg_dl,
    vitamin_d_ng_ml: a.vitamin_d_ng_ml,
    fasting_glucose_mg_dl: a.fasting_glucose_mg_dl,
    hba1c_pct: a.hba1c_pct,
    note: a.note,
    created_at: nowIso(),
  };

  const key = `blood:${a.date}`;
  await ctx.data.set(key, entry);

  // ───── 플래그 계산 ─────
  const flags = computeFlags(entry);

  // ───── 직전 검사 대비 변화 ─────
  const all = await loadAllBlood(ctx);
  const previous = all
    .filter((e) => e.date < a.date)
    .sort((a1, b1) => b1.date.localeCompare(a1.date))[0];

  const delta: Record<string, number> = {};
  if (previous) {
    for (const k of [
      'ldl_mg_dl', 'hdl_mg_dl', 'total_cholesterol_mg_dl', 'triglycerides_mg_dl',
      'uric_acid_mg_dl', 'vitamin_d_ng_ml', 'fasting_glucose_mg_dl', 'hba1c_pct',
    ] as const) {
      const cur = entry[k];
      const prev = previous[k];
      if (typeof cur === 'number' && typeof prev === 'number') {
        delta[k] = Number((cur - prev).toFixed(2));
      }
    }
  }

  return {
    saved: true,
    flags,
    previous: previous ? { date: previous.date } : null,
    delta: previous ? delta : null,
  };
}

// 한국 일반 임상 기준 (성인 남성). 단정 안 함 — 호출 AI 가 사용자에게 설명만.
function computeFlags(b: BloodPanel): string[] {
  const f: string[] = [];
  if (b.ldl_mg_dl !== undefined) {
    if (b.ldl_mg_dl >= 160) f.push('ldl_high');           // 160 ≥ 위험
    else if (b.ldl_mg_dl >= 130) f.push('ldl_borderline');
  }
  if (b.hdl_mg_dl !== undefined && b.hdl_mg_dl < 40) f.push('hdl_low');
  if (b.total_cholesterol_mg_dl !== undefined && b.total_cholesterol_mg_dl >= 240) {
    f.push('total_cholesterol_high');
  }
  if (b.triglycerides_mg_dl !== undefined && b.triglycerides_mg_dl >= 200) {
    f.push('triglycerides_high');
  }
  if (b.uric_acid_mg_dl !== undefined && b.uric_acid_mg_dl >= 7.0) f.push('uric_acid_high');
  if (b.vitamin_d_ng_ml !== undefined) {
    if (b.vitamin_d_ng_ml < 20) f.push('vitamin_d_deficient');
    else if (b.vitamin_d_ng_ml < 30) f.push('vitamin_d_insufficient');
  }
  if (b.fasting_glucose_mg_dl !== undefined) {
    if (b.fasting_glucose_mg_dl >= 126) f.push('fasting_glucose_diabetic_range');
    else if (b.fasting_glucose_mg_dl >= 100) f.push('fasting_glucose_prediabetic_range');
  }
  if (b.hba1c_pct !== undefined) {
    if (b.hba1c_pct >= 6.5) f.push('hba1c_diabetic_range');
    else if (b.hba1c_pct >= 5.7) f.push('hba1c_prediabetic_range');
  }
  return f;
}
