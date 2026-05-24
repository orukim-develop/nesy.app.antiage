// init_user_profile 스모크.
// `node --experimental-strip-types src/test/init_user_profile.smoke.ts` 로 실행.
//
// 검증:
//   1. 빈 store → get_state.missing_settings = REQUIRED_PROFILE_KEYS 전부
//   2. init_user_profile 부분 입력 → still_missing 줄어듬
//   3. init_user_profile 전체 입력 → still_missing = []
//   4. 두 번째 호출은 기존 값 보존 + 새 값만 머지 (idempotent upsert)
//   5. 검증 실패 (음수, 범위 초과, 잘못된 enum, 잘못된 slug 형식) → throw
//   6. target_min > target_max → throw
//   7. update_user_settings (개별 키) 와도 호환

import { run } from '../../index.ts';

const store = new Map<string, any>();
const data = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: any) => { store.set(k, v); },
  delete: async (k: string) => store.delete(k),
  list: async (prefix?: string) => {
    const out: { key: string; value: any; updated_at: string }[] = [];
    for (const k of store.keys()) {
      if (!prefix || k.startsWith(prefix)) out.push({ key: k, value: store.get(k), updated_at: '' });
    }
    return out;
  },
};
const call = (tool: string, args: any = {}) => run({ input: { tool, args }, secrets: {}, data });

console.log('1) 빈 store → get_state.missing_settings 에 8개 키 모두');
const st0 = await call('get_state', {}) as any;
console.log('   missing_settings:', st0.missing_settings);
console.log('   meta flag:', st0.meta.ai_must_call_init_user_profile_if_missing_settings_nonempty);
const expectedMissing = [
  'target_weight_min', 'target_weight_max',
  'pr_squat_kg', 'pr_bench_press_kg', 'pr_shoulder_press_kg', 'pr_deadlift_kg',
  'four_goals', 'next_blood_panel_target',
];
for (const k of expectedMissing) {
  assert(st0.missing_settings.includes(k), `missing 에 ${k} 있어야`);
}
assert(st0.meta.ai_must_call_init_user_profile_if_missing_settings_nonempty === true, 'meta flag true');

console.log('2) init_user_profile — target 만 부분 입력');
const r1 = await call('init_user_profile', {
  target_weight_min: 73,
  target_weight_max: 75,
}) as any;
console.log('   →', r1);
assert(r1.saved === true, 'saved');
assert(r1.applied.length === 2, 'applied 2');
assert(r1.applied.includes('target_weight_min'), 'applied target_min');
assert(r1.still_missing.length === 6, 'still_missing 6 (8 - 2)');
assert(!r1.still_missing.includes('target_weight_min'), 'target_min 더 이상 missing 아님');

console.log('3) get_state — target 들어가니 user_constants 반영');
// 아직 weight 기록 없으니 last_measurement null
const st1 = await call('get_state', {}) as any;
console.log('   missing_settings:', st1.missing_settings);
console.log('   target_weight_range:', st1.user_constants.target_weight_range);
assert(st1.missing_settings.length === 6, 'missing 6 으로 줄어듬');
assert(st1.user_constants.target_weight_range[0] === 73, 'target min 73');
assert(st1.user_constants.target_weight_range[1] === 75, 'target max 75');
assert(st1.weight.in_target_range === null, '체중 기록 없으니 in_target_range null');

console.log('4) init_user_profile — PR 4개 + four_goals + next_blood_panel_target 전체 채움');
const r2 = await call('init_user_profile', {
  pr_squat_kg: 90,
  pr_bench_press_kg: 60,
  pr_shoulder_press_kg: 30,
  pr_deadlift_kg: 100,
  four_goals: ['futsal_soccer', 'taekwondo', 'thigh_power', 'upper_body_maintenance'],
  next_blood_panel_target: '2026-06 ~ 2026-07',
}) as any;
console.log('   →', r2);
assert(r2.applied.length === 6, 'applied 6');
assert(r2.still_missing.length === 0, 'still_missing 비어야');
assert(r2.note.includes('정상 추천 가능'), '정상 추천 가능 안내');

console.log('5) get_state — missing_settings 비고 meta flag false');
const st2 = await call('get_state', {}) as any;
assert(st2.missing_settings.length === 0, 'missing 0');
assert(st2.meta.ai_must_call_init_user_profile_if_missing_settings_nonempty === false, 'meta flag false');

console.log('6) init_user_profile — 부분 update (기존값 보존)');
const r3 = await call('init_user_profile', {
  pr_squat_kg: 95,  // 90 → 95
  activity_factor: 1.5,
}) as any;
console.log('   →', r3);
assert(r3.applied.length === 2, 'applied 2');
const settingsRaw = await data.get('__settings');
assert(settingsRaw.pr_squat_kg === 95, 'pr_squat 95 로 update');
assert(settingsRaw.pr_bench_press_kg === 60, 'pr_bench 60 유지');
assert(settingsRaw.four_goals.length === 4, 'four_goals 유지');
assert(settingsRaw.target_weight_min === 73, 'target_weight_min 유지');

console.log('7) 검증 실패 — 음수 PR');
let err: any = null;
try { await call('init_user_profile', { pr_squat_kg: -10 }); } catch (e) { err = e; }
assert(err && /음수 불가/.test(String(err.message)), '음수 PR 거부');

console.log('8) 검증 실패 — activity_factor 범위 밖');
err = null;
try { await call('init_user_profile', { activity_factor: 3.0 }); } catch (e) { err = e; }
assert(err && /1\.0~2\.5/.test(String(err.message)), 'activity_factor 범위');

console.log('9) 검증 실패 — pr 1000kg 초과');
err = null;
try { await call('init_user_profile', { pr_deadlift_kg: 1500 }); } catch (e) { err = e; }
assert(err && /비현실적/.test(String(err.message)), '1000kg 초과');

console.log('10) 검증 실패 — target_weight_rule 잘못된 enum');
err = null;
try { await call('init_user_profile', { target_weight_rule: 'something_else' }); } catch (e) { err = e; }
assert(err && /always_in_range \| fasted_only \| daily_average/.test(String(err.message)), 'enum 거부');

console.log('11) 검증 실패 — four_goals snake_case 위반');
err = null;
try { await call('init_user_profile', { four_goals: ['FutsalSoccer'] }); } catch (e) { err = e; }
assert(err && /snake_case/.test(String(err.message)), 'snake_case 거부');

console.log('12) 검증 실패 — four_goals 너무 많음');
err = null;
try {
  await call('init_user_profile', {
    four_goals: ['a','b','c','d','e','f','g','h','i'],
  });
} catch (e) { err = e; }
assert(err && /최대 8개/.test(String(err.message)), '8개 제한');

console.log('13) 검증 실패 — target_min > target_max');
err = null;
try { await call('init_user_profile', { target_weight_min: 80, target_weight_max: 70 }); } catch (e) { err = e; }
assert(err && /min 이 max 보다/.test(String(err.message)), 'min>max 거부');
// 위 호출이 실패해도 store 는 안 바뀌어야
const settingsAfterFail = await data.get('__settings');
assert(settingsAfterFail.target_weight_min === 73, 'store 보존');

console.log('14) update_user_settings 와 호환 — 개별 key update 가능');
// 플랫폼 시뮬: update_user_settings 도 결국 __settings 키에 머지.
// 여기서는 데이터 레이어에 직접 set 해서 호환성 확인.
const cur = await data.get('__settings');
await data.set('__settings', { ...cur, supplement_window_minutes: 45 });
const st3 = await call('get_state', {}) as any;
assert(st3.missing_settings.length === 0, '미설정 0 유지');
// settings 새로 부르면 반영돼야 (get_state 가 settings 를 다시 부르므로)
const settingsAfterDirect = await data.get('__settings');
assert(settingsAfterDirect.supplement_window_minutes === 45, 'direct set 반영');

console.log('15) init_user_profile — 모든 인자 omit → no-op 처럼 동작');
const r4 = await call('init_user_profile', {}) as any;
console.log('   →', r4);
assert(r4.applied.length === 0, 'applied 0');
assert(r4.still_missing.length === 0, '여전히 다 채워져 있음');

console.log('\n전체 init_user_profile 스모크 통과 ✓');

function assert(cond: any, msg: string) {
  if (!cond) { console.error(`✗ FAIL: ${msg}`); process.exit(1); }
}
