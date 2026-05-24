// Reminder — 영양제·약·측정·행동 통합 알람.
//
// 함수:
//   set_reminder       : 정의 upsert
//   list_reminders     : 활성 목록
//   delete_reminder    : 정의 삭제
//   record_reminder_ack: 알람 응답 기록 ("방금 했어")

import type { RunCtx, ReminderDef, ReminderAck, ReminderType } from './types.ts';
import {
  getReminder, setReminder as storeReminder, deleteReminder as removeReminder,
  loadAllReminders, loadAllReminderAcks,
} from './store.ts';
import { getSettings } from './settings.ts';
import {
  nowIso, newId, todayIso, nowMinutesInTz, hhmmToMinutes,
  assertSlug, assertHHMM, assertEnum, assertPositiveNumber, DATE_RE,
} from './utils.ts';

const TYPES = ['supplement', 'measurement', 'action'] as const;

// ───── set_reminder ─────
export async function setReminderTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const {
    slug, display_name, schedule_times, every_n_days, window_minutes,
    type, notes, start_date, end_date,
  } = args;

  assertSlug(slug, 'slug');
  if (typeof display_name !== 'string' || display_name.trim() === '') {
    throw new Error('display_name 비어 있지 않은 문자열 필요.');
  }
  if (!Array.isArray(schedule_times) || schedule_times.length === 0) {
    throw new Error('schedule_times 비어 있지 않은 배열 필요. 각 원소 "HH:MM" 24시간 형식.');
  }
  for (let i = 0; i < schedule_times.length; i++) {
    assertHHMM(schedule_times[i], `schedule_times[${i}]`);
  }
  const everyN = every_n_days ?? 1;
  assertPositiveNumber(everyN, 'every_n_days', 365);
  if (everyN < 1) throw new Error('every_n_days 최소 1.');

  const windowMin = window_minutes ?? 30;
  assertPositiveNumber(windowMin, 'window_minutes', 720);
  if (windowMin < 1) throw new Error('window_minutes 최소 1.');

  assertEnum<ReminderType>(type, TYPES, 'type');

  if (start_date !== undefined && start_date !== null) {
    if (typeof start_date !== 'string' || !DATE_RE.test(start_date)) {
      throw new Error('start_date 는 YYYY-MM-DD 형식.');
    }
  }
  if (end_date !== undefined && end_date !== null) {
    if (typeof end_date !== 'string' || !DATE_RE.test(end_date)) {
      throw new Error('end_date 는 YYYY-MM-DD 형식.');
    }
  }
  if (start_date && end_date && start_date > end_date) {
    throw new Error('start_date 가 end_date 보다 늦음.');
  }

  const now = nowIso();
  const existing = await getReminder(ctx, slug);
  const next: ReminderDef = {
    slug,
    display_name: display_name.trim(),
    schedule_times: [...schedule_times].sort(),
    every_n_days: Math.floor(everyN),
    window_minutes: Math.floor(windowMin),
    type,
    notes: typeof notes === 'string' ? notes : undefined,
    start_date: start_date || undefined,
    end_date: end_date || undefined,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await storeReminder(ctx, next);

  return {
    saved: true,
    reminder: next,
    is_update: !!existing,
    note: existing
      ? '기존 reminder 정의 update.'
      : '새 reminder 등록. check_notifications 워커가 schedule_times ± window_minutes 안에 미 ack 면 Web Push.',
  };
}

// ───── list_reminders ─────
export async function listRemindersTool(ctx: RunCtx) {
  const settings = await getSettings(ctx);
  const today = todayIso(settings.timezone);

  const all = await loadAllReminders(ctx);
  // end_date 지난 건 제외 (active 만)
  const active = all.filter((r) => !r.end_date || r.end_date >= today);
  active.sort((a, b) => a.schedule_times[0].localeCompare(b.schedule_times[0]));

  // 오늘 ack 카운트
  const acks = await loadAllReminderAcks(ctx);
  const todayAcks = acks.filter((a) => a.acked_at.slice(0, 10) === today);
  const ackBySlug = new Map<string, number>();
  for (const a of todayAcks) {
    ackBySlug.set(a.slug, (ackBySlug.get(a.slug) ?? 0) + 1);
  }

  const enriched = active.map((r) => ({
    ...r,
    today_ack_count: ackBySlug.get(r.slug) ?? 0,
    today_slot_count: r.schedule_times.length,
  }));

  return {
    reminders: enriched,
    count: enriched.length,
    timezone: settings.timezone,
    today,
  };
}

// ───── delete_reminder ─────
export async function deleteReminderTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug } = args;
  assertSlug(slug, 'slug');

  const existing = await getReminder(ctx, slug);
  if (!existing) return { deleted: false, slug, note: '해당 slug reminder 없음.' };

  await removeReminder(ctx, slug);
  return {
    deleted: true,
    slug,
    note: '정의 삭제. 과거 ack 기록은 보존. 일시 중단이면 end_date 추가가 더 안전.',
  };
}

// ───── record_reminder_ack ─────
export async function recordReminderAckTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const { slug, slot_iso, note } = args;
  assertSlug(slug, 'slug');

  const reminder = await getReminder(ctx, slug);
  if (!reminder) {
    throw new Error(
      `reminder_not_registered: '${slug}' 가 reminders 에 없음. set_reminder 먼저.`,
    );
  }

  const settings = await getSettings(ctx);
  const now = nowIso();
  const today = todayIso(settings.timezone);

  // slot 매칭 — slot_iso 주어지면 검증, 없으면 현재 시각 기준 가장 가까운 슬롯
  let matchedSlotIso: string;
  let withinWindow = false;

  if (typeof slot_iso === 'string' && slot_iso.length > 0) {
    matchedSlotIso = slot_iso;
    // 윈도우 안인지 판단 (slot_iso 가 오늘 슬롯이면)
    if (slot_iso.startsWith(today)) {
      const slotHHMM = slot_iso.slice(11, 16); // 'YYYY-MM-DDTHH:MM:...'
      if (/^\d{2}:\d{2}$/.test(slotHHMM) && reminder.schedule_times.includes(slotHHMM)) {
        const slotMin = hhmmToMinutes(slotHHMM);
        const nowMin = nowMinutesInTz(settings.timezone);
        if (Math.abs(nowMin - slotMin) <= reminder.window_minutes) {
          withinWindow = true;
        }
      }
    }
  } else {
    // 자동 매칭
    const nowMin = nowMinutesInTz(settings.timezone);
    let best: { slot: string; diff: number } | null = null;
    for (const slot of reminder.schedule_times) {
      const diff = Math.abs(hhmmToMinutes(slot) - nowMin);
      if (best === null || diff < best.diff) best = { slot, diff };
    }
    if (best && best.diff <= reminder.window_minutes) {
      matchedSlotIso = `${today}T${best.slot}:00`;
      withinWindow = true;
    } else {
      matchedSlotIso = 'off_schedule';
    }
  }

  const ack: ReminderAck = {
    id: newId(),
    slug,
    slot_iso: matchedSlotIso,
    note: typeof note === 'string' ? note : undefined,
    acked_at: now,
    created_at: now,
  };
  await ctx.data.set(`reminder_ack:${now}:${ack.id}`, ack);

  return {
    saved: true,
    slug,
    slot_matched: matchedSlotIso,
    within_window: withinWindow,
    acked_at: now,
    note: withinWindow
      ? '슬롯 윈도우 안 ack — 이 슬롯 알림 안 나감.'
      : 'off_schedule 또는 윈도우 밖 ack — 기록은 됨, 다음 슬롯은 정상 감시.',
  };
}
