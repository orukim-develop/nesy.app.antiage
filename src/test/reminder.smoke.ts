// reminder.smoke — set_reminder → list_reminders → record_reminder_ack.

import { setReminderTool, listRemindersTool, recordReminderAckTool, deleteReminderTool } from '../reminder.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';

console.log('── reminder smoke');

// 1. 정상 등록
{
  const ctx = makeCtx();
  const r: any = await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'vitamin_d', display_name: '비타민D', schedule_times: ['09:00'], type: 'supplement',
  }));
  assert(r.saved === true, '저장');
  assert(r.reminder.every_n_days === 1, 'every_n_days 디폴트 1');
  assert(r.reminder.window_minutes === 30, 'window_minutes 디폴트 30');
  ok('1. vitamin_d 09:00 supplement → 디폴트 every_n_days=1, window=30');
}

// 2. 여러 슬롯 — 정렬됨
{
  const ctx = makeCtx();
  await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'omega3', display_name: '오메가3',
    schedule_times: ['21:00', '09:00'], type: 'supplement',
  }));
  const list: any = await listRemindersTool(ctx);
  assert(list.reminders[0].schedule_times[0] === '09:00', 'sorted 09:00 first');
  assert(list.reminders[0].schedule_times[1] === '21:00', 'then 21:00');
  ok('2. 여러 슬롯 등록 시 시간순 정렬');
}

// 3. HH:MM 형식 검증 (25:99 거부)
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await setReminderTool(withArgs(ctx, 'set_reminder', {
      slug: 'x', display_name: 'X', schedule_times: ['25:99'], type: 'supplement',
    }));
  } catch (e: any) { threw = e.message.includes('HH:MM'); }
  assert(threw, 'HH:MM 거부');
  ok('3. schedule_times=[25:99] 거부');
}

// 4. type enum 외 거부
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await setReminderTool(withArgs(ctx, 'set_reminder', {
      slug: 'x', display_name: 'X', schedule_times: ['09:00'], type: 'random',
    }));
  } catch (e: any) { threw = e.message.includes('type'); }
  assert(threw, 'type 거부');
  ok('4. type=random 거부 (supplement/measurement/action 만)');
}

// 5. record_reminder_ack — 미등록 slug 거부
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await recordReminderAckTool(withArgs(ctx, 'record_reminder_ack', { slug: 'unknown' }));
  } catch (e: any) { threw = e.message.includes('reminder_not_registered'); }
  assert(threw, '미등록 거부');
  ok('5. 미등록 reminder slug 로 ack → reminder_not_registered');
}

// 6. record_reminder_ack — 자동 슬롯 매칭 (현재 시각과 무관, off_schedule 일 수도)
{
  const ctx = makeCtx();
  await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'vitamin_d', display_name: '비타민D', schedule_times: ['09:00'], type: 'supplement',
  }));
  const r: any = await recordReminderAckTool(withArgs(ctx, 'record_reminder_ack', { slug: 'vitamin_d' }));
  assert(r.saved === true, 'ack 저장');
  assert(typeof r.slot_matched === 'string', 'slot 매칭됨 (off_schedule 또는 슬롯 ISO)');
  assert(typeof r.within_window === 'boolean', 'within_window boolean');
  ok('6. ack 자동 매칭 — slot_matched + within_window');
}

// 7. start_date / end_date 검증 (start > end 거부)
{
  const ctx = makeCtx();
  let threw = false;
  try {
    await setReminderTool(withArgs(ctx, 'set_reminder', {
      slug: 'x', display_name: 'X', schedule_times: ['09:00'], type: 'supplement',
      start_date: '2026-06-01', end_date: '2026-05-01',
    }));
  } catch (e: any) { threw = e.message.includes('start_date'); }
  assert(threw, 'start > end 거부');
  ok('7. start_date > end_date 거부');
}

// 8. delete_reminder
{
  const ctx = makeCtx();
  await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'x', display_name: 'X', schedule_times: ['09:00'], type: 'supplement',
  }));
  const r: any = await deleteReminderTool(withArgs(ctx, 'delete_reminder', { slug: 'x' }));
  assert(r.deleted === true, '삭제');
  const r2: any = await deleteReminderTool(withArgs(ctx, 'delete_reminder', { slug: 'x' }));
  assert(r2.deleted === false, '두번째는 false');
  ok('8. delete_reminder idempotent');
}

// 9. list_reminders — end_date 지난 건 제외
{
  const ctx = makeCtx();
  await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'active', display_name: 'Active', schedule_times: ['09:00'], type: 'supplement',
    end_date: '2099-12-31',
  }));
  await setReminderTool(withArgs(ctx, 'set_reminder', {
    slug: 'expired', display_name: 'Expired', schedule_times: ['09:00'], type: 'supplement',
    end_date: '2020-01-01',
  }));
  const list: any = await listRemindersTool(ctx);
  const slugs = list.reminders.map((r: any) => r.slug);
  assert(slugs.includes('active'), 'active 포함');
  assert(!slugs.includes('expired'), 'expired 제외');
  ok('9. list_reminders 가 end_date 지난 reminder 제외');
}

console.log('✓ reminder smoke passed\n');
