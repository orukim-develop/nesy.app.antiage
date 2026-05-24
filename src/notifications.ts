// check_notifications — 플랫폼 워커가 5분마다 호출.
//
// 동작:
//   1. 활성 reminders 전체 로드 (start_date / end_date / every_n_days 필터)
//   2. 현재 시각 기준 각 슬롯 × 윈도우 검사
//   3. 윈도우 안 + 아직 notif_sent 마킹 없음 + 해당 슬롯 윈도우 안 ack 없음 → Web Push 1회
//   4. notif_sent 마킹 (한 번만 정책)
//
// 윈도우 종료 후 미 ack → 영구 포기 (잔소리 방지).

import type { RunCtx, ReminderDef } from './types.ts';
import { loadAllReminders, loadAllReminderAcks, notifSentKey } from './store.ts';
import { getSettings } from './settings.ts';
import {
  todayIso, nowMinutesInTz, hhmmToMinutes, parseDate, daysBetween,
} from './utils.ts';

interface PushPayload {
  title: string;
  body: string;
  id: string; // 같은 id 재발송 차단
}

// 플랫폼 contract 추정: 외부 push 발송은 secrets / 별도 API. 여기선 payload 만 반환.
// 실제 호출 시 플랫폼이 web push 보냄.
export async function checkNotificationsTool(ctx: RunCtx) {
  const settings = await getSettings(ctx);
  const tz = settings.timezone;
  const today = todayIso(tz);
  const nowMin = nowMinutesInTz(tz);

  const reminders = await loadAllReminders(ctx);
  const acks = await loadAllReminderAcks(ctx);
  // 오늘 ack 만 사용 (어제 ack 가 오늘 슬롯에 영향 X)
  const todayAcks = acks.filter((a) => a.slot_iso.startsWith(today));

  const toSend: PushPayload[] = [];
  const skipped: { slug: string; slot: string; reason: string }[] = [];

  for (const r of reminders) {
    // 활성 윈도우 (start/end date) 검사
    if (!isActiveOnDate(r, today)) {
      continue;
    }
    // every_n_days 검사
    if (!isDueOnDate(r, today)) {
      continue;
    }

    for (const slot of r.schedule_times) {
      const slotIso = `${today}T${slot}:00`;
      const slotMin = hhmmToMinutes(slot);
      const diff = nowMin - slotMin;

      // 윈도우 안 검사: [slot, slot + window_minutes]
      // (이전 시각엔 알림 안 보냄 — 알림은 슬롯 시각부터 윈도우 분 뒤까지)
      if (diff < 0 || diff > r.window_minutes) {
        continue;
      }

      // 이미 발송됐나
      const sentMarker = await ctx.data.get(notifSentKey(r.slug, slotIso));
      if (sentMarker) {
        skipped.push({ slug: r.slug, slot, reason: 'already_sent' });
        continue;
      }

      // 이 슬롯에 ack 있나
      const ackedForSlot = todayAcks.some((a) => a.slug === r.slug && a.slot_iso === slotIso);
      if (ackedForSlot) {
        skipped.push({ slug: r.slug, slot, reason: 'already_acked' });
        continue;
      }

      // 알림 발송 + 마킹
      const payload = buildPayload(r, slot);
      toSend.push(payload);
      await ctx.data.set(notifSentKey(r.slug, slotIso), { sent_at: new Date().toISOString() });
    }
  }

  return {
    notifications_sent: toSend.length,
    payloads: toSend,
    skipped,
    timezone: tz,
    today,
    now_minutes: nowMin,
  };
}

function isActiveOnDate(r: ReminderDef, today: string): boolean {
  if (r.start_date && today < r.start_date) return false;
  if (r.end_date && today > r.end_date) return false;
  return true;
}

function isDueOnDate(r: ReminderDef, today: string): boolean {
  if (r.every_n_days <= 1) return true;
  const base = r.start_date ?? r.created_at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return true;
  const d = daysBetween(base, today);
  return d >= 0 && d % r.every_n_days === 0;
}

function buildPayload(r: ReminderDef, slot: string): PushPayload {
  const typeLabel = r.type === 'supplement' ? '복용' : r.type === 'measurement' ? '측정' : '실행';
  const noteSuffix = r.notes ? ` — ${r.notes}` : '';
  return {
    title: `${r.display_name} (${slot})`,
    body: `${typeLabel} 시간${noteSuffix}`,
    id: `${r.slug}:${slot}`,
  };
}
