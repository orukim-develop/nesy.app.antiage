// 키 네임스페이스 (SPEC §7)
//   session:{date}:{uuid}          — 운동 세션
//   weight:{date}:{HHMM}           — 체중 측정
//   inbody:{date}                  — InBody (날짜당 1개)
//   blood:{date}                   — 혈액검사 (날짜당 1개)
//   meal:{date}:{slot}:{uuid}      — 식단
//   recipe:{date}:{uuid}           — AI 추천 레시피
//   injury:active                  — 현재 활성 부상 (없으면 null)
//   injury:history:{started_date}  — 과거 부상 이력

import type {
  RunCtx, Session, WeightEntry, InBodyEntry, BloodPanel, Meal, Recipe, InjuryRecord,
} from './types.ts';
import { listAllRows } from './utils.ts';

export const KEY_INJURY_ACTIVE = 'injury:active';

// list 결과의 value 를 그대로 사용 — N+1 금지 (플랫폼 contract).
// 백엔드가 value 를 안 채워 보낸 row 가 있으면 그 row 만 fallback get.
export async function loadAll<T>(ctx: RunCtx, prefix: string): Promise<T[]> {
  const rows = await listAllRows(ctx.data, prefix);
  const out: T[] = [];
  const missing: string[] = [];
  for (const r of rows) {
    if (r.value !== undefined && r.value !== null) out.push(r.value as T);
    else missing.push(r.key);
  }
  if (missing.length > 0) {
    const filled = await Promise.all(missing.map((k) => ctx.data.get(k)));
    for (const v of filled) if (v !== null && v !== undefined) out.push(v as T);
  }
  return out;
}

export const loadAllSessions = (ctx: RunCtx) => loadAll<Session>(ctx, 'session:');
export const loadAllWeights = (ctx: RunCtx) => loadAll<WeightEntry>(ctx, 'weight:');
export const loadAllInBody = (ctx: RunCtx) => loadAll<InBodyEntry>(ctx, 'inbody:');
export const loadAllBlood = (ctx: RunCtx) => loadAll<BloodPanel>(ctx, 'blood:');
export const loadAllMeals = (ctx: RunCtx) => loadAll<Meal>(ctx, 'meal:');
export const loadAllRecipes = (ctx: RunCtx) => loadAll<Recipe>(ctx, 'recipe:');
export const loadInjuryHistory = (ctx: RunCtx) => loadAll<InjuryRecord>(ctx, 'injury:history:');

export async function getActiveInjury(ctx: RunCtx): Promise<InjuryRecord | null> {
  return ((await ctx.data.get(KEY_INJURY_ACTIVE)) as InjuryRecord | null) ?? null;
}

export async function setActiveInjury(ctx: RunCtx, injury: InjuryRecord | null): Promise<void> {
  if (injury) await ctx.data.set(KEY_INJURY_ACTIVE, injury);
  else await ctx.data.delete(KEY_INJURY_ACTIVE);
}

// 같은 운동의 직전 세션을 찾는다 (date 내림차순). 같은 날짜 여러 세션이면 가장 마지막 created_at.
export function findLastSession(
  sessions: Session[],
  exerciseName: string,
): { session: Session; exercise: import('./types.ts').Exercise } | null {
  const matches = sessions
    .map((s) => {
      const ex = s.exercises.find((e) => e.name === exerciseName);
      return ex ? { session: s, exercise: ex } : null;
    })
    .filter((x): x is { session: Session; exercise: import('./types.ts').Exercise } => x !== null)
    .sort((a, b) => {
      const d = b.session.date.localeCompare(a.session.date);
      if (d !== 0) return d;
      return (b.session.created_at || '').localeCompare(a.session.created_at || '');
    });
  return matches[0] || null;
}

// 부상 부위와 운동 충돌 매핑. SPEC §3.1 의 warnings 조건과 compute_next_load 의 phase 판정에 공통 사용.
const INJURY_CONFLICT_MAP: Record<string, string[]> = {
  lower_back: ['squat', 'deadlift', 'good_morning', 'bent_over_row', 'romanian_deadlift'],
  knee: ['squat', 'lunge', 'leg_press', 'leg_extension', 'running_km', 'bulgarian_split_squat'],
  shoulder: ['bench_press', 'shoulder_press', 'overhead_press', 'incline_press', 'lateral_raise'],
  elbow: ['bench_press', 'shoulder_press', 'pullup', 'chinup', 'curl', 'tricep_extension'],
  wrist: ['bench_press', 'shoulder_press', 'pushup'],
};

export function exerciseConflictsWithInjurySite(exerciseName: string, site: string): boolean {
  const list = INJURY_CONFLICT_MAP[site];
  if (!list) return false;
  return list.includes(exerciseName);
}
