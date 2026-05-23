// get_state — 사용자 현재 상태 종합 스냅샷. SPEC §3.7.
// 호출 AI 가 운동·식단·체중 추천 전에 반드시 부르도록 description 에 박혀 있음.

import type { RunCtx, Session, WeightEntry, InBodyEntry, BloodPanel, Meal } from './types.ts';
import { getSettings } from './settings.ts';
import {
  loadAllSessions, loadAllWeights, loadAllInBody, loadAllBlood, loadAllMeals,
  loadInjuryHistory, getActiveInjury, findLastSession,
} from './store.ts';
import { daysBetween, todayIso } from './utils.ts';

const TRACKED_EXERCISES = ['squat', 'deadlift', 'bench_press', 'shoulder_press'];

export async function getState(ctx: RunCtx) {
  const today = todayIso();
  const settings = await getSettings(ctx);

  const [sessions, weights, inbodyAll, bloodAll, meals, injuryHistory, activeInjury] =
    await Promise.all([
      loadAllSessions(ctx),
      loadAllWeights(ctx),
      loadAllInBody(ctx),
      loadAllBlood(ctx),
      loadAllMeals(ctx),
      loadInjuryHistory(ctx),
      getActiveInjury(ctx),
    ]);

  // ───── weight 섹션 ─────
  const weightSorted = [...weights].sort((a, b) => sortByDateTime(b, a));
  const lastWeight = weightSorted[0] || null;
  const last7 = recentDays(weights, today, 7);
  const last7Avg = avg(last7.map((w) => w.weight_kg));
  const inRange = lastWeight
    ? lastWeight.weight_kg >= settings.target_weight_min &&
      lastWeight.weight_kg <= settings.target_weight_max
    : null;
  const trend30 = trendOver(weights, today, 30);

  // ───── InBody 섹션 ─────
  const inbodySorted = [...inbodyAll].sort((a, b) => b.date.localeCompare(a.date));
  const lastInBody = inbodySorted[0] || null;
  const prevInBody = inbodySorted[1] || null;
  const inbodySection = lastInBody
    ? {
        date: lastInBody.date,
        weight_kg: lastInBody.weight_kg,
        skeletal_muscle_kg: lastInBody.skeletal_muscle_kg,
        body_fat_kg: lastInBody.body_fat_kg,
        body_fat_pct: lastInBody.body_fat_pct,
        bmr_kcal: lastInBody.bmr_kcal,
        vs_previous: prevInBody
          ? {
              date: prevInBody.date,
              skeletal_muscle_kg_delta: round2(lastInBody.skeletal_muscle_kg - prevInBody.skeletal_muscle_kg),
              body_fat_kg_delta: round2(lastInBody.body_fat_kg - prevInBody.body_fat_kg),
              body_fat_pct_delta: round2(lastInBody.body_fat_pct - prevInBody.body_fat_pct),
            }
          : null,
      }
    : null;

  // ───── 혈액 섹션 ─────
  const bloodSorted = [...bloodAll].sort((a, b) => b.date.localeCompare(a.date));
  const lastBlood = bloodSorted[0] || null;
  let bloodSection: any = null;
  if (lastBlood) {
    const flags = computeFlagsFromBlood(lastBlood);
    bloodSection = {
      date: lastBlood.date,
      ldl_mg_dl: lastBlood.ldl_mg_dl,
      hdl_mg_dl: lastBlood.hdl_mg_dl,
      uric_acid_mg_dl: lastBlood.uric_acid_mg_dl,
      vitamin_d_ng_ml: lastBlood.vitamin_d_ng_ml,
      fasting_glucose_mg_dl: lastBlood.fasting_glucose_mg_dl,
      hba1c_pct: lastBlood.hba1c_pct,
      flags,
      next_panel_due: settings.next_blood_panel_target,
    };
  } else {
    bloodSection = {
      date: null,
      flags: [],
      next_panel_due: settings.next_blood_panel_target,
      note: '혈액검사 기록 없음.',
    };
  }

  // ───── 부상 섹션 ─────
  const injurySection = {
    active: !!activeInjury,
    current: activeInjury
      ? { site: activeInjury.site, started: activeInjury.started, notes: activeInjury.notes }
      : null,
    history: injuryHistory.map((h) => ({
      site: h.site,
      started: h.started,
      recovered: h.recovered ?? null,
    })),
  };

  // ───── 운동 last_sessions (4 운동 + 추가 발견된 운동) ─────
  const seen = new Set<string>(TRACKED_EXERCISES);
  for (const s of sessions) for (const e of s.exercises) seen.add(e.name);
  const lastSessions: Record<string, any> = {};
  for (const name of seen) {
    const last = findLastSession(sessions, name);
    if (last) {
      const top = topSet(last.exercise);
      lastSessions[name] = {
        date: last.session.date,
        equipment: last.exercise.equipment ?? null,
        top_set: top,
        condition: last.session.condition ?? null,
        pain: last.session.pain ?? null,
      };
    }
  }

  // ───── 식단 7일 평균 ─────
  const recentMeals = meals.filter((m) => {
    return daysBetween(m.date, today) <= 7 && daysBetween(m.date, today) >= 0;
  });
  const dailyTotals = aggregateByDay(recentMeals);
  const daysCovered = Object.keys(dailyTotals).length;
  const avgKcal = daysCovered ? Math.round(sumValues(dailyTotals, 'kcal') / daysCovered) : null;
  const avgProtein = daysCovered ? Number((sumValues(dailyTotals, 'protein') / daysCovered).toFixed(1)) : null;
  const af = settings.activity_factor;
  const maintenanceEstimate = lastInBody
    ? {
        min: Math.round(lastInBody.bmr_kcal * (af - 0.05)),
        max: Math.round(lastInBody.bmr_kcal * (af + 0.05)),
      }
    : null;
  let status7day: 'deficit' | 'maintenance' | 'surplus' | 'slight_deficit' | 'slight_surplus' | 'unknown' = 'unknown';
  if (avgKcal !== null && maintenanceEstimate) {
    const mid = (maintenanceEstimate.min + maintenanceEstimate.max) / 2;
    if (avgKcal < maintenanceEstimate.min - 150) status7day = 'deficit';
    else if (avgKcal < maintenanceEstimate.min) status7day = 'slight_deficit';
    else if (avgKcal > maintenanceEstimate.max + 150) status7day = 'surplus';
    else if (avgKcal > maintenanceEstimate.max) status7day = 'slight_surplus';
    else status7day = 'maintenance';
  }

  return {
    today,
    user_constants: {
      target_weight_range: [settings.target_weight_min, settings.target_weight_max],
      target_weight_rule: settings.target_weight_rule,
      four_goals: settings.four_goals,
      bar_weight_kg_smith: settings.bar_weight_kg_smith,
      bar_weight_verified: settings.bar_weight_verified,
      pr: {
        squat: settings.pr_squat_kg,
        bench_press: settings.pr_bench_press_kg,
        shoulder_press: settings.pr_shoulder_press_kg,
        deadlift: settings.pr_deadlift_kg,
      },
    },
    weight: {
      last_measurement: lastWeight
        ? {
            date: lastWeight.date,
            time: lastWeight.time ?? null,
            weight_kg: lastWeight.weight_kg,
            context: lastWeight.measurement_context,
          }
        : null,
      last_7day_avg: last7Avg !== null ? round2(last7Avg) : null,
      in_target_range: inRange,
      trend_30day: trend30,
    },
    last_inbody: inbodySection,
    last_blood: bloodSection,
    injury: injurySection,
    last_sessions: lastSessions,
    diet_recent: {
      days_covered: daysCovered,
      '7day_avg_kcal': avgKcal,
      '7day_avg_protein_g': avgProtein,
      maintenance_estimate: maintenanceEstimate,
      status_7day: status7day,
    },
    meta: {
      ai_must_call_get_state_before_recommendation: true,
      ai_must_confirm_dates_before_recording: true,
      ai_must_get_user_confirmation_before_record_meal: true,
      ai_must_not_invent_loads_outside_compute_next_load: true,
      ai_must_not_diagnose_from_blood_flags: true,
    },
  };
}

// ───── 헬퍼 ─────

function sortByDateTime(a: WeightEntry, b: WeightEntry): number {
  const d = a.date.localeCompare(b.date);
  if (d !== 0) return d;
  return (a.time || '').localeCompare(b.time || '');
}

function recentDays(weights: WeightEntry[], untilIso: string, days: number): WeightEntry[] {
  const cutoff = subtractDays(untilIso, days);
  return weights.filter((w) => w.date >= cutoff && w.date <= untilIso);
}

function trendOver(weights: WeightEntry[], untilIso: string, days: number): 'up' | 'down' | 'stable' | 'unknown' {
  const win = recentDays(weights, untilIso, days);
  if (win.length < 2) return 'unknown';
  const sorted = [...win].sort((a, b) => sortByDateTime(a, b));
  const first = sorted[0].weight_kg;
  const last = sorted[sorted.length - 1].weight_kg;
  const diff = last - first;
  if (Math.abs(diff) < 0.5) return 'stable';
  return diff > 0 ? 'up' : 'down';
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function topSet(ex: import('./types.ts').Exercise) {
  let top: any = null;
  for (const s of ex.sets) {
    if (s.weight_kg === undefined) continue;
    if (!top || s.weight_kg > top.weight_kg) {
      top = { weight_kg: s.weight_kg, reps: s.reps ?? null, rir: s.rir ?? null };
    }
  }
  // 유산소 (weight_kg 없음) — duration/distance 우선.
  if (!top && ex.sets[0]) {
    const s = ex.sets[0];
    if (s.duration_min !== undefined || s.distance_km !== undefined) {
      top = { duration_min: s.duration_min ?? null, distance_km: s.distance_km ?? null };
    }
  }
  return top;
}

function aggregateByDay(meals: Meal[]): Record<string, { kcal: number; protein: number }> {
  const out: Record<string, { kcal: number; protein: number }> = {};
  for (const m of meals) {
    if (!out[m.date]) out[m.date] = { kcal: 0, protein: 0 };
    out[m.date].kcal += mealKcal(m);
    out[m.date].protein += mealProtein(m);
  }
  return out;
}

function mealKcal(m: Meal): number {
  if (typeof m.total_kcal_estimated === 'number') return m.total_kcal_estimated;
  return m.items.reduce((s, it) => s + (it.estimated_kcal || 0), 0);
}

function mealProtein(m: Meal): number {
  return m.items.reduce((s, it) => s + (it.protein_g || 0), 0);
}

function sumValues(d: Record<string, { kcal: number; protein: number }>, k: 'kcal' | 'protein'): number {
  return Object.values(d).reduce((s, v) => s + v[k], 0);
}

function subtractDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return (
    dt.getUTCFullYear() + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0')
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeFlagsFromBlood(b: BloodPanel): string[] {
  const f: string[] = [];
  if (b.ldl_mg_dl !== undefined) {
    if (b.ldl_mg_dl >= 160) f.push('ldl_high');
    else if (b.ldl_mg_dl >= 130) f.push('ldl_borderline');
  }
  if (b.hdl_mg_dl !== undefined && b.hdl_mg_dl < 40) f.push('hdl_low');
  if (b.total_cholesterol_mg_dl !== undefined && b.total_cholesterol_mg_dl >= 240) f.push('total_cholesterol_high');
  if (b.triglycerides_mg_dl !== undefined && b.triglycerides_mg_dl >= 200) f.push('triglycerides_high');
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
