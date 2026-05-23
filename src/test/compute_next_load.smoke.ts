// 빠른 스모크 — compute_next_load 의 4 phase 가 합리적인 무게를 돌려주는지.
// `node --experimental-strip-types src/test/compute_next_load.smoke.ts` 로 실행.

import { computeNextLoad } from '../compute_next_load.ts';
import type { RunCtx } from '../types.ts';

function mockCtx(overrides: {
  sessions?: any[];
  activeInjury?: any;
  injuryHistory?: any[];
  settings?: any;
  args: any;
}): RunCtx {
  const sessions = overrides.sessions || [];
  const history = overrides.injuryHistory || [];
  const store = new Map<string, any>();
  for (const s of sessions) store.set(`session:${s.date}:${s.id}`, s);
  for (const h of history) store.set(`injury:history:${h.started}`, h);
  if (overrides.activeInjury) store.set('injury:active', overrides.activeInjury);
  if (overrides.settings) store.set('__settings', overrides.settings);

  return {
    input: { tool: 'compute_next_load', args: overrides.args },
    secrets: {},
    data: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k, v) => { store.set(k, v); },
      delete: async (k) => store.delete(k),
      list: async (prefix?: string) => {
        // 플랫폼 contract: list 는 value 까지 반환. mock 도 동일하게.
        const out: { key: string; value: any; updated_at: string }[] = [];
        for (const k of store.keys()) {
          if (!prefix || k.startsWith(prefix)) out.push({ key: k, value: store.get(k), updated_at: '' });
        }
        return out;
      },
    },
  };
}

const session1 = {
  id: 'aaa',
  date: '2026-05-16',
  exercises: [{
    name: 'squat',
    equipment: 'smith',
    sets: [
      { weight_kg: 60, reps: 5, rir: 2 },
      { weight_kg: 60, reps: 5, rir: 2 },
      { weight_kg: 60, reps: 5, rir: 2 },
    ],
  }],
  condition: 7,
  created_at: '2026-05-16T10:00:00Z',
};

console.log('── 1. return_from_injury (활성 부상)');
let r: any = await computeNextLoad(mockCtx({
  sessions: [session1],
  activeInjury: { site: 'lower_back', started: '2026-05-20' },
  args: { exercise_name: 'squat' },
}));
console.log(`   phase=${r.phase} weight=${r.recommended_weight_kg}kg target_rir=${r.target_rir} (기대: return_from_injury, 60kg 유지, RIR≥4)`);
assert(r.phase === 'return_from_injury', 'phase');
assert(r.recommended_weight_kg === 60, 'weight');
assert(r.target_rir >= 4, 'rir');

console.log('── 2. deload (직전 RIR 0)');
const sFail = { ...session1, exercises: [{ ...session1.exercises[0], sets: [{ weight_kg: 70, reps: 5, rir: 0 }] }] };
r = await computeNextLoad(mockCtx({ sessions: [sFail], args: { exercise_name: 'squat' } }));
console.log(`   phase=${r.phase} weight=${r.recommended_weight_kg}kg (기대: deload, 70×0.85=59.5 → 60)`);
assert(r.phase === 'deload', 'phase');
assert(Math.abs(r.recommended_weight_kg - 60) <= 2.5, 'weight near 60');

console.log('── 3. normal_progression (직전 RIR 4 → 목표 2, 여유 있었음)');
const sEasy = { ...session1, exercises: [{ ...session1.exercises[0], sets: [{ weight_kg: 60, reps: 5, rir: 4 }] }] };
r = await computeNextLoad(mockCtx({ sessions: [sEasy], args: { exercise_name: 'squat', target_rir: 2 } }));
console.log(`   phase=${r.phase} weight=${r.recommended_weight_kg}kg (기대: normal_progression, 60×1.08=64.8 그러나 5% 주당 한계로 캡)`);
assert(r.phase === 'normal_progression', 'phase');
// 60 × (1+0.04×2) = 64.8. 그러나 주당 5% 캡 — 시간 차에 따라.
// 마지막 세션 2026-05-16, 오늘 가정에 따라 cap 정확하진 않지만 60~65 사이여야.
assert(r.recommended_weight_kg >= 60 && r.recommended_weight_kg <= 65, `weight in [60, 65] but got ${r.recommended_weight_kg}`);

console.log('── 4. override_phase=plateau_break (60kg 3주 정체 가정)');
r = await computeNextLoad(mockCtx({
  sessions: [session1],
  args: { exercise_name: 'squat', override_phase: 'plateau_break' },
}));
console.log(`   phase=${r.phase} weight=${r.recommended_weight_kg}kg (기대: 60×0.95=57)`);
assert(r.phase === 'plateau_break', 'phase');
assert(Math.abs(r.recommended_weight_kg - 57.5) <= 2.5, 'weight near 57.5');

console.log('── 5. no history (운동 첫 기록)');
r = await computeNextLoad(mockCtx({ sessions: [], args: { exercise_name: 'bench_press' } }));
console.log(`   phase=${r.phase} weight=${r.recommended_weight_kg} (기대: weight=null, warnings 에 no_history)`);
assert(r.recommended_weight_kg === null, 'null weight');
assert(r.warnings.includes('no_history'), 'warning');

console.log('\n전체 스모크 통과 ✓');

function assert(cond: any, msg: string) {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`);
    process.exit(1);
  }
}
