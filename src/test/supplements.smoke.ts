// 영양제 알람 도메인 스모크.
// `node --experimental-strip-types src/test/supplements.smoke.ts` 로 실행.
//
// 검증 흐름:
//   1. set_supplement 등록 + upsert
//   2. list_supplements 활성/비활성 필터
//   3. record_supplement_intake (명시 / 자동 슬롯 매칭)
//   4. check_notifications — 윈도우 안 미복용 시 알림 / 복용 후 안 나감 / 윈도우 밖 무시
//   5. delete_supplement — 정의 제거되고 intake 는 남음
//   6. get_state.supplements 섹션

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

console.log('1) set_supplement — 비타민D 매일 9시');
const s1 = await call('set_supplement', {
  slug: 'vitamin_d',
  display_name: '비타민D 3000IU',
  schedule_times: ['09:00'],
  with_meal: true,
  dose_note: '1캡슐',
});
console.log('   →', s1);
assert((s1 as any).saved && !(s1 as any).upserted, '최초 등록은 upserted=false');

console.log('2) set_supplement — 오메가3 9시·21시 (upsert 검증용 첫 등록)');
const s2 = await call('set_supplement', {
  slug: 'omega3',
  display_name: '오메가3',
  schedule_times: ['09:00', '21:00'],
  with_meal: true,
});
console.log('   →', s2);
assert((s2 as any).schedule.times_per_day === 2, 'times_per_day 자동 2');

console.log('3) set_supplement — 비타민D 9시·21시로 수정 (upsert)');
const s3 = await call('set_supplement', {
  slug: 'vitamin_d',
  display_name: '비타민D 3000IU',
  schedule_times: ['09:00', '21:00'],
  with_meal: true,
  dose_note: '1캡슐',
});
console.log('   →', s3);
assert((s3 as any).upserted === true, 'upserted=true 표시');
assert((s3 as any).schedule.schedule_times.length === 2, '슬롯 2개로 갱신');

console.log('4) set_supplement — 잘못된 slug → 에러');
let err: any = null;
try { await call('set_supplement', { slug: 'Vitamin-D', display_name: 'x', schedule_times: ['09:00'] }); }
catch (e) { err = e; }
assert(err && /형식 위반/.test(String(err.message)), '대문자/하이픈 slug 거부');

console.log('5) set_supplement — 잘못된 시간 형식 → 에러');
err = null;
try { await call('set_supplement', { slug: 'magnesium', display_name: 'Mg', schedule_times: ['25:00'] }); }
catch (e) { err = e; }
assert(err && /HH:MM/.test(String(err.message)), '잘못된 HH:MM 거부');

console.log('6) list_supplements — 활성 2개');
const ls = await call('list_supplements', {}) as any;
console.log('   →', { count: ls.count, slugs: ls.supplements.map((s: any) => s.slug) });
assert(ls.count === 2, '활성 supplement 2개');
assert(ls.supplements[0].slug === 'omega3', 'sort: omega3 첫째');

console.log('7) set_supplement — end_date 어제 — 비활성');
const yesterday = shiftIso(today(), -1);
await call('set_supplement', {
  slug: 'old_med',
  display_name: '복용 끝난 약',
  schedule_times: ['09:00'],
  end_date: yesterday,
});
const ls2 = await call('list_supplements', {}) as any;
console.log('   → active count:', ls2.count, '(2 기대)');
assert(ls2.count === 2, 'end_date 지난 건 list 에서 제외');

console.log('8) record_supplement_intake — 비타민D 9시 명시');
const todayLocal = ls2.today;
const i1 = await call('record_supplement_intake', {
  slug: 'vitamin_d', date: todayLocal, slot: '09:00',
}) as any;
console.log('   →', i1);
assert(i1.saved && i1.matched_slot === '09:00', 'slot 09:00 매칭');

console.log('9) record_supplement_intake — 슬롯 미지정 → 가장 가까운 슬롯');
const i2 = await call('record_supplement_intake', {
  slug: 'omega3', date: todayLocal,
}) as any;
console.log('   →', i2);
assert(['09:00', '21:00'].includes(i2.matched_slot), '슬롯 자동 매칭');

console.log('10) record_supplement_intake — 정의 없는 slug → 에러');
err = null;
try { await call('record_supplement_intake', { slug: 'ghost_pill' }); }
catch (e) { err = e; }
assert(err && /정의 없음/.test(String(err.message)), '미등록 slug 거부');

console.log('11) record_supplement_intake — 정의된 슬롯 아닌 시간 → 에러');
err = null;
try { await call('record_supplement_intake', { slug: 'vitamin_d', slot: '15:00' }); }
catch (e) { err = e; }
assert(err && /정의된 슬롯이 아님/.test(String(err.message)), '미정의 슬롯 거부');

console.log('12) check_notifications — 현재 시간 슬롯 윈도우 안의 미복용 supps 만 발송');
// 직접 fake "현재 시간" 잡기 어려우니, supps 가 다양한 슬롯을 가지면 시간대 따라 다른 알림 나옴.
// 핵심: 이미 record 한 (vitamin_d, 09:00) 슬롯은 절대 다시 안 나옴.
const n1 = await call('check_notifications', {}) as any;
console.log('   →', { count: n1.notifications.length, ids: n1.notifications.map((x: any) => x.id) });
for (const notif of n1.notifications) {
  assert(
    !(notif.id.includes('vitamin_d:' + todayLocal + ':0900')),
    `vitamin_d 09:00 (이미 복용) 알림 없어야: ${notif.id}`,
  );
}

console.log('13) get_state.supplements — 섹션 존재 + 카운트');
const state = await call('get_state', {}) as any;
console.log('   → supplements:', {
  active_count: state.supplements.active_count,
  today_due_slots: state.supplements.today_due_slots,
  today_taken_slots: state.supplements.today_taken_slots,
  adherence_7day_pct: state.supplements.adherence_7day_pct,
});
assert(state.supplements.active_count === 2, '활성 2개');
assert(state.supplements.today_due_slots >= 2, 'due slot 최소 2 (오메가3·비타민D 합)');
assert(state.supplements.today_taken_slots >= 2, '오늘 복용 2 (vd 09:00 + omega3 자동)');

console.log('14) delete_supplement — 정의 삭제, intake 보존');
const d1 = await call('delete_supplement', { slug: 'vitamin_d' }) as any;
console.log('   →', d1);
assert(d1.deleted === true, '삭제 성공');
// intake 키는 살아있어야
const intakeRows = await data.list('intake:');
const vdIntakes = intakeRows.filter((r) => r.key.includes(':vitamin_d:'));
assert(vdIntakes.length > 0, '과거 intake 보존');
console.log('   → vitamin_d intake 보존:', vdIntakes.length, '건');

console.log('15) delete_supplement — 없는 slug 멱등');
const d2 = await call('delete_supplement', { slug: 'vitamin_d' }) as any;
assert(d2.deleted === false, '두 번째 삭제는 deleted=false');

console.log('16) check_notifications — 현재 시간 슬롯에 알림이 실제로 발송');
// 현재 시간을 기준으로 동적 슬롯 생성 — 알림이 반드시 떠야.
const now = nowHHMM();
await call('set_supplement', {
  slug: 'dynamic_test',
  display_name: '동적 테스트',
  schedule_times: [now],
});
const n2 = await call('check_notifications', {}) as any;
console.log('   → 현재 시간', now, '슬롯 알림:', n2.notifications.length, '건');
const dyn = n2.notifications.find((x: any) => x.id.includes('dynamic_test'));
assert(dyn, '현재 시간 슬롯의 미복용 알림 발송돼야');
assert(dyn.title === '동적 테스트 시간', 'title 포맷');
console.log('   →', dyn);

console.log('17) check_notifications — 복용 기록 후 알림 사라짐');
await call('record_supplement_intake', { slug: 'dynamic_test', slot: now });
const n3 = await call('check_notifications', {}) as any;
const dyn2 = n3.notifications.find((x: any) => x.id.includes('dynamic_test'));
assert(!dyn2, '복용 기록 후 알림 없어야');
console.log('   → 알림 사라짐 ✓');

console.log('\n전체 supplements 스모크 통과 ✓');

function assert(cond: any, msg: string) {
  if (!cond) { console.error(`✗ FAIL: ${msg}`); process.exit(1); }
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nowHHMM(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.getUTCFullYear() + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0');
}
