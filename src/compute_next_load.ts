// compute_next_load — 다음 세션 권장 무게 계산
//
// 검증된 공식만 사용. 마음대로 변형 금지. SPEC §3.8 + §12 참고.
//
// 참고문헌
//   Plotkin DL et al. (2022). Progressive overload without progressing load? PMC9528903.
//     https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9528903/
//     → load progression 과 rep progression 의 비대 성장 유사. 무게 증량 강박 거부 근거.
//   Refalo MC et al. (2024). Proximity-to-failure and hypertrophy.
//     → 비대 성장 대부분 RIR 0-3 구간에서 발생. target_rir 기본값 2 의 근거.
//   True Sports Physical Therapy. Evidence-based load progression.
//     → 주당 >15% 증량은 부상 위험 21-49% 증가. 주당 한계 5% / 1회 한계 15% 기준.
//   Ripped Body / Barbell Rehab. RIR/RPE guide.
//     → RIR off-target 1당 약 4% 무게 보정. (delta_rir × 0.04)
//   Barbell Rehab / Game Plan PT. Return to lifting after back injury.
//     → 부상 후 초기 RPE 4-6 → 7-8 점진. return_from_injury phase 의 target_rir 4-6 근거.

import type { RunCtx, Equipment } from './types.ts';
import { getSettings } from './settings.ts';
import {
  loadAllSessions,
  findLastSession,
  getActiveInjury,
  loadInjuryHistory,
  exerciseConflictsWithInjurySite,
} from './store.ts';
import { daysBetween, roundTo, todayIso } from './utils.ts';

export type Phase = 'return_from_injury' | 'deload' | 'normal_progression' | 'plateau_break';

interface ComputeArgs {
  exercise_name: string;
  target_reps?: number;
  target_rir?: number;
  override_phase?: Phase;
}

interface ComputeResult {
  exercise: string;
  phase: Phase;
  recommended_weight_kg: number | null;
  target_reps: number;
  target_rir: number;
  vs_last_session: {
    date: string;
    weight_kg: number | null;
    rir: number | null;
    reps: number | null;
    equipment: Equipment | null;
  } | null;
  vs_pr: { pr_weight_kg: number; percent_of_pr: number } | null;
  rationale_for_ai: string;
  warnings: string[];
}

export async function computeNextLoad(ctx: RunCtx): Promise<ComputeResult> {
  const args = (ctx.input.args || {}) as ComputeArgs;
  if (!args.exercise_name) throw new Error('exercise_name 필수.');

  const settings = await getSettings(ctx);
  const sessions = await loadAllSessions(ctx);
  const activeInjury = await getActiveInjury(ctx);
  const injuryHistory = await loadInjuryHistory(ctx);

  const target_reps = args.target_reps ?? 5;
  const target_rir = args.target_rir ?? 2;
  const today = todayIso();

  const last = findLastSession(sessions, args.exercise_name);

  // ───── PR 룩업 ─────
  const PR_MAP: Record<string, number> = {
    squat: settings.pr_squat_kg,
    bench_press: settings.pr_bench_press_kg,
    shoulder_press: settings.pr_shoulder_press_kg,
    deadlift: settings.pr_deadlift_kg,
  };
  const pr = PR_MAP[args.exercise_name] ?? 0;

  // ───── 마지막 세션의 top set (가장 무거운 세트) 추출 ─────
  let lastTopWeight: number | null = null;
  let lastTopReps: number | null = null;
  let lastTopRir: number | null = null;
  let lastEquipment: Equipment | null = null;
  let lastDate = '';
  if (last) {
    lastDate = last.session.date;
    lastEquipment = last.exercise.equipment ?? null;
    for (const s of last.exercise.sets) {
      if (s.weight_kg !== undefined && (lastTopWeight === null || s.weight_kg > lastTopWeight)) {
        lastTopWeight = s.weight_kg;
        lastTopReps = s.reps ?? null;
        lastTopRir = s.rir ?? null;
      }
    }
  }

  // ───── phase 판정 ─────
  let phase: Phase;
  if (args.override_phase) {
    phase = args.override_phase;
  } else {
    phase = decidePhase({
      exerciseName: args.exercise_name,
      today,
      activeInjurySite: activeInjury?.site,
      mostRecentRecoveredDate: latestRecoveredFor(injuryHistory, args.exercise_name),
      lastSessionRir: lastTopRir,
      lastSessionCondition: last?.session.condition ?? null,
      plateauDetected: detectPlateau(sessions, args.exercise_name),
    });
  }

  // ───── 무게 계산 ─────
  const warnings: string[] = [];
  let recommended: number | null = null;
  let rationale = '';
  let effectiveTargetRir = target_rir;

  if (lastTopWeight === null) {
    // 기록 없음 — 호출 AI 가 사용자에게 시작 무게 물어볼 수 있도록 null + 안내.
    rationale =
      `'${args.exercise_name}' 의 이전 세션 기록이 없습니다. 호출 AI 는 사용자에게 직접 시작 무게를 물어보거나, ` +
      `안전한 첫 세션 (PR 의 50-60% 또는 봉만)으로 시작 후 record_session 한 다음 다시 compute_next_load 호출.`;
    warnings.push('no_history');
  } else {
    const r = computeWeight({
      phase,
      lastWeight: lastTopWeight,
      lastRir: lastTopRir,
      lastDate,
      today,
      targetRir: target_rir,
      pr,
    });
    recommended = r.weight;
    effectiveTargetRir = r.targetRir;
    rationale = r.rationale;
    warnings.push(...r.warnings);
  }

  // ───── 디트레이닝 경고 ─────
  if (lastDate) {
    const gap = daysBetween(lastDate, today);
    if (gap >= 14 && phase === 'normal_progression') {
      warnings.push(
        `마지막 세션이 ${gap}일 지남. 디트레이닝 가능성. recommended_weight × 0.9 권장.`,
      );
    }
  }

  return {
    exercise: args.exercise_name,
    phase,
    recommended_weight_kg: recommended,
    target_reps,
    target_rir: effectiveTargetRir,
    vs_last_session: last
      ? {
          date: lastDate,
          weight_kg: lastTopWeight,
          rir: lastTopRir,
          reps: lastTopReps,
          equipment: lastEquipment,
        }
      : null,
    vs_pr: pr > 0 && recommended !== null
      ? { pr_weight_kg: pr, percent_of_pr: Math.round((recommended / pr) * 100) }
      : null,
    rationale_for_ai: rationale,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────
// phase 자동 판정
// ─────────────────────────────────────────────────────────────────────
function decidePhase(p: {
  exerciseName: string;
  today: string;
  activeInjurySite?: string;
  mostRecentRecoveredDate: string | null;
  lastSessionRir: number | null;
  lastSessionCondition: number | null;
  plateauDetected: boolean;
}): Phase {
  // 1. 활성 부상 + 충돌 운동 → return_from_injury
  if (p.activeInjurySite && exerciseConflictsWithInjurySite(p.exerciseName, p.activeInjurySite)) {
    return 'return_from_injury';
  }
  // 2. 회복 후 30일 이내 → return_from_injury (보수적 복귀 기간)
  if (p.mostRecentRecoveredDate) {
    const days = daysBetween(p.mostRecentRecoveredDate, p.today);
    if (days >= 0 && days <= 30) return 'return_from_injury';
  }
  // 3. RIR ≤ 0 (실패세트) 또는 condition ≤ 4 → deload
  if ((p.lastSessionRir !== null && p.lastSessionRir <= 0) ||
      (p.lastSessionCondition !== null && p.lastSessionCondition <= 4)) {
    return 'deload';
  }
  // 4. 3주 이상 같은 무게 정체 → plateau_break
  if (p.plateauDetected) return 'plateau_break';

  return 'normal_progression';
}

function latestRecoveredFor(
  history: import('./types.ts').InjuryRecord[],
  exerciseName: string,
): string | null {
  const conflicting = history
    .filter((h) => h.recovered && exerciseConflictsWithInjurySite(exerciseName, h.site))
    .sort((a, b) => (b.recovered || '').localeCompare(a.recovered || ''));
  return conflicting[0]?.recovered ?? null;
}

function detectPlateau(sessions: import('./types.ts').Session[], exerciseName: string): boolean {
  // 같은 운동의 top set weight 가 3주 이상 동일하면 plateau.
  const tops = sessions
    .map((s) => {
      const ex = s.exercises.find((e) => e.name === exerciseName);
      if (!ex) return null;
      let top = -Infinity;
      for (const set of ex.sets) {
        if (set.weight_kg !== undefined && set.weight_kg > top) top = set.weight_kg;
      }
      return top > -Infinity ? { date: s.date, top } : null;
    })
    .filter((x): x is { date: string; top: number } => x !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (tops.length < 2) return false;
  const newest = tops[0];
  const oldest = tops.find((t) => daysBetween(t.date, newest.date) >= 21);
  if (!oldest) return false;
  return Math.abs(newest.top - oldest.top) < 0.01;
}

// ─────────────────────────────────────────────────────────────────────
// 무게 계산 (phase 별 분기)
// ─────────────────────────────────────────────────────────────────────
function computeWeight(p: {
  phase: Phase;
  lastWeight: number;
  lastRir: number | null;
  lastDate: string;
  today: string;
  targetRir: number;
  pr: number;
}): { weight: number; targetRir: number; rationale: string; warnings: string[] } {
  const ROUND_STEP = 2.5;
  const warnings: string[] = [];

  if (p.phase === 'return_from_injury') {
    // 마지막 무게 유지. target_rir 4-6 (RPE 4-6).
    // 부상 전 PR 의 50-70% 안전 천장.
    const ceiling = p.pr > 0 ? p.pr * 0.7 : Infinity;
    let w = Math.min(p.lastWeight, ceiling);
    w = roundTo(w, ROUND_STEP);
    const rir = Math.max(p.targetRir, 4);
    let rationale =
      `복귀 30일 이내 phase. 마지막 무게 ${p.lastWeight}kg 유지, RPE 4-6 (target_rir ${rir}).`;
    if (p.pr > 0) {
      rationale += ` 부상 전 PR ${p.pr}kg 의 ${Math.round((w / p.pr) * 100)}% (천장 70%).`;
      if (w < p.lastWeight) {
        warnings.push(`마지막 무게 ${p.lastWeight}kg 가 PR 70% 천장을 넘어 ${w}kg 로 캡.`);
      }
    }
    return { weight: w, targetRir: rir, rationale, warnings };
  }

  if (p.phase === 'deload') {
    // 마지막 무게 × 0.85. target_rir 3-4.
    let w = roundTo(p.lastWeight * 0.85, ROUND_STEP);
    const rir = Math.max(p.targetRir, 3);
    const rationale =
      `Deload phase (직전 RIR ≤ 0 또는 컨디션 ≤ 4). 마지막 무게 ${p.lastWeight}kg × 0.85 = ${w}kg. ` +
      `target_rir ${rir} 로 부하 줄이고 회복.`;
    return { weight: w, targetRir: rir, rationale, warnings };
  }

  if (p.phase === 'plateau_break') {
    // 무게 -5%, 반복수 +2 (호출 AI 에게 메시지로 전달).
    let w = roundTo(p.lastWeight * 0.95, ROUND_STEP);
    const rationale =
      `Plateau 감지 (3주 이상 같은 무게). 무게 -5% (${p.lastWeight} → ${w}kg) + 반복수 +2 로 자극 전환. ` +
      `다음 주는 같은 반복수 유지하며 무게 +5% 복귀 추천.`;
    return { weight: w, targetRir: p.targetRir, rationale, warnings };
  }

  // ── normal_progression ──
  // RIR off-target 1당 약 4% 보정 (Ripped Body / Barbell Rehab):
  //   delta_rir = last.rir - target_rir   (양수면 여유 있었음 → 증량)
  //   adjusted = last.weight × (1 + 0.04 × delta_rir)
  const RIR_COEF = 0.04;
  let adjusted = p.lastWeight;
  let rirNote = '';
  if (p.lastRir !== null) {
    const deltaRir = p.lastRir - p.targetRir;
    adjusted = p.lastWeight * (1 + RIR_COEF * deltaRir);
    rirNote = ` RIR 보정: 직전 RIR ${p.lastRir} vs 목표 ${p.targetRir} → ${(deltaRir * 4).toFixed(0)}% 조정.`;
  } else {
    rirNote = ' 직전 세션 RIR 누락 — 무게 유지로 처리.';
  }

  // 주당 증량 한계 5% (True Sports PT: >15% 가 임계, 5% 가 안전 상한).
  // 마지막 세션 날짜 기준 7일 단위로 환산.
  const daysSinceLast = Math.max(1, daysBetween(p.lastDate, p.today));
  const weeksSince = daysSinceLast / 7;
  const maxIncreaseRatio = 1 + 0.05 * weeksSince;
  const cappedAtWeekly = Math.min(adjusted, p.lastWeight * maxIncreaseRatio);

  // 1회 한계 15% 절대 cap (True Sports PT 부상 위험 기준).
  const cappedAtAbsolute = Math.min(cappedAtWeekly, p.lastWeight * 1.15);

  if (adjusted > cappedAtAbsolute + 0.01) {
    warnings.push(
      `RIR 보정값 ${adjusted.toFixed(1)}kg 이 주당 5% 또는 1회 15% 한계를 초과 — ${cappedAtAbsolute.toFixed(1)}kg 로 캡.`,
    );
  }

  const w = roundTo(cappedAtAbsolute, ROUND_STEP);
  const rationale =
    `Normal progression. 마지막: ${p.lastWeight}kg (${daysSinceLast}일 전).` + rirNote +
    ` 주당 5% 한계 적용 (${weeksSince.toFixed(1)}주 환산 상한 ${(p.lastWeight * maxIncreaseRatio).toFixed(1)}kg).` +
    ` 권장 ${w}kg.`;

  return { weight: w, targetRir: p.targetRir, rationale, warnings };
}
