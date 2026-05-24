// compute_next_load — 다음 세션 권장 무게 (검증 공식만).
//
// 사용 공식 (검증 출처):
//   1. Helms RIR off-target 4% 룰
//      delta_rir = target_rir - actual_rir
//      delta_rir < 0 (더 힘들게)  → +(|delta| × 4%)
//      delta_rir > 0 (더 쉽게)    → -(delta × 4%)
//      delta_rir = 0              → ±0%
//   2. Plotkin 2022 주간 누적 증량 cap
//      최근 4주 best avg vs 그 전 4주 best avg.
//      증량률이 주당 5% 초과면 cap.
//   3. Refalo 2024 운동별 차등
//      category='compound' → 표준 적용
//      category='isolation' → 권장 증량분 × 0.7 (보수적)
//
// 데이터 부족 (직전 세션 없음) → 거부.

import type { RunCtx, SessionRecord } from './types.ts';
import { getExercise, loadAllSessions, findLastSessionFor, bestSet } from './store.ts';
import { assertSlug, assertPositiveNumber, roundTo } from './utils.ts';

const ROUND_STEP_KG = 2.5;
const WEEKLY_CAP_PCT = 5; // Plotkin 2022

export async function computeNextLoadTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { exercise_slug } = args;
  const target_rir = args.target_rir ?? 1;

  assertSlug(exercise_slug, 'exercise_slug');
  assertPositiveNumber(target_rir, 'target_rir', 10);

  const exercise = await getExercise(ctx, exercise_slug);
  if (!exercise) {
    throw new Error(
      `exercise_not_registered: '${exercise_slug}' 가 exercises 에 없음. set_exercise 먼저.`,
    );
  }

  const sessions = await loadAllSessions(ctx);
  const last = findLastSessionFor(sessions, exercise_slug);
  if (!last) {
    throw new Error(
      `no_prior_session: '${exercise_slug}' 의 직전 세션 없음. record_session 먼저 호출 후 다시 시도.`,
    );
  }

  const lastBest = bestSet(last.sets);
  if (!lastBest || lastBest.weight_kg <= 0) {
    throw new Error(`invalid_last_session: 직전 세션의 best set 무게 0 이하.`);
  }

  const actualRir = lastBest.rir ?? 2;
  const deltaRir = target_rir - actualRir;

  // Helms 4% 룰
  let pctChange = -(deltaRir * 4); // delta_rir = -1 → +4%
  const appliedRules: string[] = [`Helms RIR off-target 4% (delta_rir=${deltaRir}, pct=${pctChange.toFixed(1)}%)`];

  // Refalo: isolation 은 0.7x 보수
  if (exercise.category === 'isolation') {
    pctChange = pctChange * 0.7;
    appliedRules.push(`Refalo 2024 isolation 보수 (×0.7)`);
  }

  // Plotkin: 최근 4주 vs 그 전 4주
  const weeklyProgressionPct = computeWeeklyProgression(sessions, exercise_slug);
  if (weeklyProgressionPct !== null && weeklyProgressionPct > WEEKLY_CAP_PCT && pctChange > 0) {
    const remaining = Math.max(0, WEEKLY_CAP_PCT - weeklyProgressionPct);
    if (pctChange > remaining) {
      appliedRules.push(
        `Plotkin 2022 weekly cap — 최근 4주 누적 +${weeklyProgressionPct.toFixed(1)}%/wk 초과 추세, ` +
        `이번 증량 ${pctChange.toFixed(1)}% → ${remaining.toFixed(1)}% 로 cap`,
      );
      pctChange = remaining;
    }
  }

  const rawNext = lastBest.weight_kg * (1 + pctChange / 100);
  const recommended = Math.max(ROUND_STEP_KG, roundTo(rawNext, ROUND_STEP_KG));

  return {
    exercise_slug,
    recommended_weight_kg: recommended,
    recommended_reps: lastBest.reps,
    recommended_rir: target_rir,
    last_session: {
      best_set: lastBest,
      created_at: last.created_at,
    },
    pct_change: Number(pctChange.toFixed(2)),
    applied_rules: appliedRules,
    weekly_progression_pct: weeklyProgressionPct !== null ? Number(weeklyProgressionPct.toFixed(2)) : null,
    category: exercise.category,
    sources: [
      'Helms RIR off-target 4% rule',
      'Plotkin 2022 weekly cap (5%/wk)',
      'Refalo 2024 compound/isolation 차등',
    ],
    reasoning:
      `직전 ${lastBest.weight_kg}kg × ${lastBest.reps} RIR ${actualRir} → 목표 RIR ${target_rir} ` +
      `(delta ${deltaRir}). ${appliedRules.join(' / ')}. ` +
      `${lastBest.weight_kg} × (1 + ${pctChange.toFixed(1)}%) ≈ ${rawNext.toFixed(2)} → ${ROUND_STEP_KG}kg 단위 ${recommended}kg.`,
    note:
      '이 결과의 reasoning / sources 사용자에게 그대로 인용. 자체 변형 금지. ' +
      '응답 무게가 사용자 직관과 다르면 사용자에게 confirm 받고 record_session 호출.',
  };
}

// 최근 4주 vs 그 전 4주 best set 평균 무게 → 주당 증량률 (%)
function computeWeeklyProgression(sessions: SessionRecord[], slug: string): number | null {
  const matched = sessions
    .filter((s) => s.exercise_slug === slug)
    .map((s) => ({ ts: Date.parse(s.created_at), best: bestSet(s.sets)?.weight_kg ?? 0 }))
    .filter((x) => x.best > 0)
    .sort((a, b) => a.ts - b.ts);

  if (matched.length < 4) return null;

  const now = Date.now();
  const fourWeeksMs = 28 * 24 * 3600 * 1000;
  const recent = matched.filter((x) => x.ts >= now - fourWeeksMs);
  const older = matched.filter((x) => x.ts < now - fourWeeksMs && x.ts >= now - 2 * fourWeeksMs);

  if (recent.length === 0 || older.length === 0) return null;

  const recentAvg = recent.reduce((s, x) => s + x.best, 0) / recent.length;
  const olderAvg = older.reduce((s, x) => s + x.best, 0) / older.length;
  if (olderAvg === 0) return null;

  const monthlyPct = ((recentAvg - olderAvg) / olderAvg) * 100;
  return monthlyPct / 4;
}
