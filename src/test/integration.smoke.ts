// 통합 스모크 — record_* → get_state → render_dashboard 경로가 깨지지 않는지.
// `node --experimental-strip-types src/test/integration.smoke.ts` 로 실행.

import { run } from '../../index.ts';

const store = new Map<string, any>();
const data = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: any) => { store.set(k, v); },
  delete: async (k: string) => store.delete(k),
  list: async (prefix?: string) => {
    // 플랫폼 contract: list 는 value 까지 반환. mock 도 동일하게.
    const out: { key: string; value: any; updated_at: string }[] = [];
    for (const k of store.keys()) {
      if (!prefix || k.startsWith(prefix)) out.push({ key: k, value: store.get(k), updated_at: '' });
    }
    return out;
  },
};
const call = (tool: string, args: any) => run({ input: { tool, args }, secrets: {}, data });

console.log('1) record_session — 정상 입력');
const s1 = await call('record_session', {
  date: '2026-05-16',
  exercises: [{
    name: 'squat', equipment: 'smith',
    sets: [{ weight_kg: 60, reps: 5, rir: 2 }, { weight_kg: 60, reps: 5, rir: 2 }],
  }],
  condition: 7,
});
console.log('   →', s1);
assert((s1 as any).saved && (s1 as any).warnings.length === 0, 'warnings 없어야');

console.log('2) record_session — 15% 초과 증량 → warning');
const s2 = await call('record_session', {
  date: '2026-05-23',
  exercises: [{
    name: 'squat', equipment: 'smith',
    sets: [{ weight_kg: 75, reps: 5, rir: 2 }],
  }],
});
console.log('   →', s2);
assert((s2 as any).warnings.some((w: string) => w.includes('주당 권고 한계')), '15% 경고');

console.log('3) record_session — 통증 발생 → injury:active 활성화');
const s3 = await call('record_session', {
  date: '2026-05-23',
  exercises: [{ name: 'squat', sets: [{ weight_kg: 60, reps: 3 }] }],
  pain: { site: 'lower_back', severity: 5, note: '복귀 후 첫 통증' },
});
console.log('   →', s3);
assert((s3 as any).warnings.some((w: string) => w.includes('부상 플래그')), '부상 활성화 warning');

console.log('4) record_session — 활성 부상 + 충돌 운동 (squat 또 함) → warning');
const s4 = await call('record_session', {
  date: '2026-05-24',
  exercises: [{ name: 'squat', sets: [{ weight_kg: 50, reps: 5 }] }],
});
console.log('   →', s4);
assert((s4 as any).warnings.some((w: string) => w.includes('활성 부상')), '활성 부상 충돌');

console.log('5) record_weight — 목표 미설정 → in_range null');
const w1 = await call('record_weight', {
  date: '2026-05-23', weight_kg: 75.2, measurement_context: 'fasted',
});
console.log('   →', w1);
assert((w1 as any).saved, 'saved');
assert((w1 as any).in_range === null, '목표 미설정 → in_range null');
assert((w1 as any).target_range.configured === false, 'target_range.configured false');

console.log('5b) init_user_profile — target 설정 후 record_weight 다시');
await call('init_user_profile', { target_weight_min: 73, target_weight_max: 75 });
const w1b = await call('record_weight', {
  date: '2026-05-23', time: '09:00', weight_kg: 74.0, measurement_context: 'fasted',
});
assert((w1b as any).in_range === true, '74.0 in [73,75]');

console.log('6) record_inbody (직전 없음)');
const ib1 = await call('record_inbody', {
  date: '2026-04-24', weight_kg: 76, skeletal_muscle_kg: 29.4,
  body_fat_kg: 22.8, body_fat_pct: 30, bmr_kcal: 1530,
});
console.log('   →', ib1);
assert((ib1 as any).previous === null, '직전 없어야');

console.log('7) record_inbody (recomp_progress 힌트)');
const ib2 = await call('record_inbody', {
  date: '2026-05-20', weight_kg: 75.1, skeletal_muscle_kg: 30.6,
  body_fat_kg: 21.2, body_fat_pct: 27.5, bmr_kcal: 1547,
});
console.log('   →', ib2);
assert((ib2 as any).interpretation_hint === 'recomp_progress', 'recomp 힌트');

console.log('8) record_blood_panel + flags');
const b1 = await call('record_blood_panel', {
  date: '2026-01-15',
  ldl_mg_dl: 164, hdl_mg_dl: 45, uric_acid_mg_dl: 7.4, vitamin_d_ng_ml: 16.61,
});
console.log('   →', b1);
const flags = (b1 as any).flags as string[];
assert(flags.includes('ldl_high'), 'ldl_high');
assert(flags.includes('uric_acid_high'), 'uric_acid_high');
assert(flags.includes('vitamin_d_deficient'), 'vitamin_d_deficient');

console.log('9) record_meal + 누적');
await call('record_meal', {
  date: '2026-05-23', slot: 'breakfast',
  items: [{ name: 'oatmeal', estimated_kcal: 320, protein_g: 12 }],
  source: 'user_text',
});
const m1 = await call('record_meal', {
  date: '2026-05-23', slot: 'lunch',
  items: [{ name: 'sabamiso_ni', estimated_kcal: 480, protein_g: 32 }],
  source: 'photo_confirmed',
});
console.log('   →', m1);
assert((m1 as any).day_total_kcal === 800, `day total 800 expected, got ${(m1 as any).day_total_kcal}`);
assert(Math.abs((m1 as any).day_total_protein_g - 44) < 0.01, 'protein 44');

console.log('10) record_recipe');
const rc = await call('record_recipe', {
  date: '2026-05-23', name: 'sabamiso_ni', cuisine: 'japanese',
  source_url: 'https://youtu.be/example',
  primary_protein_g: 32, estimated_kcal: 480, ldl_friendly: true,
  rationale: 'LDL 관리 + 단백질 32g',
});
console.log('   →', rc);
assert((rc as any).recipe_id?.startsWith('recipe:'), 'recipe_id');

console.log('11) get_state — 스냅샷');
const state = await call('get_state', {}) as any;
console.log('   today=', state.today,
  '/ last_weight=', state.weight.last_measurement?.weight_kg,
  '/ in_range=', state.weight.in_target_range,
  '/ injury.active=', state.injury.active,
  '/ inbody hint date=', state.last_inbody?.date,
  '/ blood flags=', state.last_blood?.flags,
  '/ diet status=', state.diet_recent.status_7day,
);
assert(state.today.match(/^\d{4}-\d{2}-\d{2}$/), 'today iso');
assert(state.injury.active === true, 'injury active');
// last_measurement 는 가장 최근 시간 (09:00 의 74.0) 이므로 in_range = true
assert(state.weight.in_target_range === true, '74.0 in [73,75] → 범위 안');
assert(state.last_blood.flags.includes('ldl_high'), 'blood flag');
assert(state.meta.ai_must_call_get_state_before_recommendation === true, 'meta flag');
// 4대 목표·PR·next_blood_panel_target 아직 미설정 → missing_settings 남아있음
assert(state.missing_settings.length > 0, 'missing_settings 일부 남음 (PR·four_goals 등)');
assert(state.meta.ai_must_call_init_user_profile_if_missing_settings_nonempty === true, 'init_user_profile 권고 meta');

console.log('12) compute_next_load — 부상 활성 + squat → return_from_injury');
const cnl = await call('compute_next_load', { exercise_name: 'squat' }) as any;
console.log('   →', cnl);
assert(cnl.phase === 'return_from_injury', 'phase');

console.log('13) render_dashboard — HTML 출력');
const dash = await call('render_dashboard', {}) as any;
console.log('   html length:', dash.html.length, 'starts with:', dash.html.slice(0, 60), '...');
assert(typeof dash.html === 'string' && dash.html.includes('<svg'), 'has svg');
assert(dash.html.includes('체중 추이'), 'has weight section');
assert(dash.html.includes('운동 top set'), 'has exercise section');
assert(dash.html.includes('LDL'), 'has blood section');

console.log('\n전체 통합 스모크 통과 ✓');

function assert(cond: any, msg: string) {
  if (!cond) { console.error(`✗ FAIL: ${msg}`); process.exit(1); }
}
