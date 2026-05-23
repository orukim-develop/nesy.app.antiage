// record_inbody — InBody 결과 한 건 저장 + 직전 대비 delta + 해석 힌트.

import type { RunCtx, InBodyEntry } from '../types.ts';
import { nowIso } from '../utils.ts';
import { loadAllInBody } from '../store.ts';

type Hint = 'recomp_progress' | 'muscle_loss' | 'fat_gain' | 'stable';

export async function recordInBody(ctx: RunCtx) {
  const a = ctx.input.args || {};
  const required = ['date', 'weight_kg', 'skeletal_muscle_kg', 'body_fat_kg', 'body_fat_pct', 'bmr_kcal'];
  for (const k of required) {
    if (a[k] === undefined || a[k] === null) throw new Error(`${k} 필수.`);
  }

  const entry: InBodyEntry = {
    date: a.date,
    weight_kg: a.weight_kg,
    skeletal_muscle_kg: a.skeletal_muscle_kg,
    body_fat_kg: a.body_fat_kg,
    body_fat_pct: a.body_fat_pct,
    bmr_kcal: a.bmr_kcal,
    visceral_fat_level: a.visceral_fat_level,
    bmi: a.bmi,
    note: a.note,
    created_at: nowIso(),
  };

  const key = `inbody:${a.date}`;
  await ctx.data.set(key, entry);

  // ───── 직전 InBody (현재 입력보다 이전 날짜) 찾기 ─────
  const all = await loadAllInBody(ctx);
  const previous = all
    .filter((e) => e.date < a.date)
    .sort((a1, b1) => b1.date.localeCompare(a1.date))[0];

  if (!previous) {
    return { saved: true, previous: null, delta: null, interpretation_hint: 'stable' as Hint };
  }

  const delta = {
    weight_kg: round2(entry.weight_kg - previous.weight_kg),
    skeletal_muscle_kg: round2(entry.skeletal_muscle_kg - previous.skeletal_muscle_kg),
    body_fat_kg: round2(entry.body_fat_kg - previous.body_fat_kg),
    body_fat_pct: round2(entry.body_fat_pct - previous.body_fat_pct),
  };

  // 해석 힌트 — 단순 룰. 호출 AI 가 사용자에게 설명하는 재료.
  // 임계 0.3kg / 0.5%p — InBody 측정 잡음 흡수.
  const muscleUp = delta.skeletal_muscle_kg >= 0.3;
  const muscleDown = delta.skeletal_muscle_kg <= -0.3;
  const fatDown = delta.body_fat_kg <= -0.3;
  const fatUp = delta.body_fat_kg >= 0.3;

  let hint: Hint = 'stable';
  if (muscleUp && fatDown) hint = 'recomp_progress';
  else if (muscleDown) hint = 'muscle_loss';
  else if (fatUp) hint = 'fat_gain';
  else hint = 'stable';

  return {
    saved: true,
    previous: { date: previous.date, weight_kg: previous.weight_kg },
    delta,
    interpretation_hint: hint,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
