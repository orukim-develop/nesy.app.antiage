// notifications.smoke — check_notifications 한 번만 정책 + 윈도우 검사.
//
// 시간 의존적이라 직접 ctx.data 에 reminder 와 notif_sent 마킹을 주입해서 검증.

import type { ReminderDef } from '../types.ts';
import { checkNotificationsTool } from '../notifications.ts';
import { recordReminderAckTool } from '../reminder.ts';
import { makeCtx, withArgs, assert, ok } from './_mock.ts';
import { todayIso, nowMinutesInTz } from '../utils.ts';

console.log('── notifications smoke');

function mkReminder(overrides: Partial<ReminderDef>): ReminderDef {
  return {
    slug: 'x',
    display_name: 'X',
    schedule_times: ['09:00'],
    every_n_days: 1,
    window_minutes: 30,
    type: 'supplement',
    notes: undefined,
    start_date: undefined,
    end_date: undefined,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// 1. 현재 시각에 윈도우 있는 슬롯 → 발송
{
  const tz = 'Asia/Seoul';
  const today = todayIso(tz);
  const nowMin = nowMinutesInTz(tz);
  // 현재 시각 -10분 슬롯 (윈도우 안). window=30 → diff=10, valid.
  const slotMin = Math.max(0, nowMin - 10);
  const slot = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`;
  const reminder = mkReminder({ slug: 'vit_d', display_name: '비타민D', schedule_times: [slot] });

  const ctx = makeCtx({ 'reminder:vit_d': reminder });
  const r: any = await checkNotificationsTool(ctx);
  assert(r.notifications_sent === 1, `1건 발송 (받음 ${r.notifications_sent})`);
  assert(r.payloads[0].id === `vit_d:${slot}`, 'payload id');

  // 같은 시각 재호출 → 한 번만 정책
  const r2: any = await checkNotificationsTool(ctx);
  assert(r2.notifications_sent === 0, '재호출은 0');
  assert(r2.skipped.some((s: any) => s.reason === 'already_sent'), 'already_sent skip');
  ok('1. 윈도우 안 슬롯 → 발송 1회. 재호출 시 already_sent 스킵');
}

// 2. 슬롯 시간 안 됐음 → 안 보냄
{
  const tz = 'Asia/Seoul';
  const nowMin = nowMinutesInTz(tz);
  // 현재보다 +60분 (미래 슬롯)
  const slotMin = Math.min(1439, nowMin + 60);
  const slot = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`;
  const reminder = mkReminder({ slug: 'future', display_name: '미래', schedule_times: [slot] });

  const ctx = makeCtx({ 'reminder:future': reminder });
  const r: any = await checkNotificationsTool(ctx);
  assert(r.notifications_sent === 0, '미래 슬롯 → 발송 X');
  ok('2. 슬롯 시각 미래 (diff < 0) → 안 보냄');
}

// 3. 윈도우 밖 (이미 지나감) → 안 보냄
{
  const tz = 'Asia/Seoul';
  const nowMin = nowMinutesInTz(tz);
  // 60분 전 슬롯, window=30 → 윈도우 밖
  const slotMin = Math.max(0, nowMin - 60);
  const slot = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`;
  const reminder = mkReminder({ slug: 'past', display_name: '과거', schedule_times: [slot], window_minutes: 30 });

  const ctx = makeCtx({ 'reminder:past': reminder });
  const r: any = await checkNotificationsTool(ctx);
  assert(r.notifications_sent === 0, '윈도우 밖 → 발송 X');
  ok('3. 슬롯 -60분 (window=30) → 윈도우 밖 → 발송 X');
}

// 4. ack 있으면 안 보냄
{
  const tz = 'Asia/Seoul';
  const today = todayIso(tz);
  const nowMin = nowMinutesInTz(tz);
  const slotMin = Math.max(0, nowMin - 5);
  const slot = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`;
  const reminder = mkReminder({ slug: 'acked', display_name: 'Acked', schedule_times: [slot] });

  const ctx = makeCtx({ 'reminder:acked': reminder });
  // ack 먼저
  const ackRes: any = await recordReminderAckTool(withArgs(ctx, 'record_reminder_ack', {
    slug: 'acked', slot_iso: `${today}T${slot}:00`,
  }));
  assert(ackRes.within_window === true, 'ack within_window');

  const r: any = await checkNotificationsTool(ctx);
  assert(r.notifications_sent === 0, 'ack 있으면 발송 X');
  assert(r.skipped.some((s: any) => s.reason === 'already_acked'), 'already_acked skip');
  ok('4. 윈도우 안에 ack 있으면 알림 발송 X (already_acked)');
}

// 5. end_date 지난 reminder → 안 보냄
{
  const tz = 'Asia/Seoul';
  const nowMin = nowMinutesInTz(tz);
  const slotMin = Math.max(0, nowMin - 5);
  const slot = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`;
  const reminder = mkReminder({
    slug: 'expired', display_name: 'Expired',
    schedule_times: [slot], end_date: '2020-01-01',
  });

  const ctx = makeCtx({ 'reminder:expired': reminder });
  const r: any = await checkNotificationsTool(ctx);
  assert(r.notifications_sent === 0, 'end_date 지난 reminder 발송 X');
  ok('5. end_date 지난 reminder → 알림 안 보냄');
}

console.log('✓ notifications smoke passed\n');
