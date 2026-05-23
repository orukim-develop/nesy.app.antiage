// check_notifications — 워커가 cadence(5분)마다 호출. AI 비노출 (tools[] 에 안 들어감).
//
// 알림 정책 (사용자 결정):
//   "한 번만 보냄" — 슬롯 시간 ±supplement_window_minutes (기본 30) 안의 첫 워커 호출에만 발송.
//   같은 id 알림은 플랫폼이 dedupe 하므로 후속 워커 호출에선 자동으로 한 번만 발송됨.
//   사용자가 윈도우 안에 record_supplement_intake 부르면 intake row 가 생겨 이후 호출에서 알림 후보에서 빠짐.
//   윈도우 놓치면 그 슬롯은 영원히 알림 안 옴 — 다음 슬롯에서 새로 시작.
//
// 반환 contract (플랫폼 nesy.app):
//   { notifications: [{id, title, body?, url?}, ...] }

import type { RunCtx, SupplementSchedule } from '../types.ts';
import { loadAllSupplements, loadIntakesForDate } from '../store.ts';
import { getSettings } from '../settings.ts';
import { nowInTz, timeToMinutes, timeToKey, daysSinceIso } from './common.ts';

interface NotifPayload {
  id: string;
  title: string;
  body?: string;
  url?: string;
}

export async function checkNotifications(ctx: RunCtx): Promise<{ notifications: NotifPayload[] }> {
  const settings = await getSettings(ctx);
  const tz = settings.timezone || 'Asia/Seoul';
  const windowMin = settings.supplement_window_minutes || 30;

  const { date: today, time: nowHHMM } = nowInTz(tz);
  const nowMin = timeToMinutes(nowHHMM);

  const [supps, todayIntakes] = await Promise.all([
    loadAllSupplements(ctx),
    loadIntakesForDate(ctx, today),
  ]);

  // 빠른 lookup 용 (slug + slotKey).
  const intakeSet = new Set<string>();
  for (const it of todayIntakes) intakeSet.add(`${it.slug}:${timeToKey(it.slot)}`);

  const out: NotifPayload[] = [];
  for (const supp of supps) {
    if (!isDueOnDate(supp, today)) continue;

    for (const slot of supp.schedule_times) {
      const slotMin = timeToMinutes(slot);
      // 윈도우: 슬롯 시간 - 5분 (살짝 일찍 깨워도 OK) ~ 슬롯 시간 + windowMin
      const lo = slotMin - 5;
      const hi = slotMin + windowMin;
      if (nowMin < lo || nowMin > hi) continue;

      const slotKey = timeToKey(slot);
      if (intakeSet.has(`${supp.slug}:${slotKey}`)) continue; // 이미 먹었음

      out.push({
        id: `supp:${supp.slug}:${today}:${slotKey}`,
        title: `${supp.display_name} 시간`,
        body: buildBody(supp, slot),
      });
    }
  }

  return { notifications: out };
}

function buildBody(supp: SupplementSchedule, slot: string): string {
  const parts: string[] = [slot];
  if (supp.dose_note) parts.push(supp.dose_note);
  if (supp.with_meal) parts.push('식사 후');
  if (supp.notes) parts.push(supp.notes);
  return parts.join(' · ');
}

function isDueOnDate(supp: SupplementSchedule, today: string): boolean {
  if (supp.start_date && today < supp.start_date) return false;
  if (supp.end_date && today > supp.end_date) return false;
  const every = supp.every_n_days ?? 1;
  if (every === 1) return true;
  // start_date 없으면 created_at 의 날짜 부분 사용.
  const start = supp.start_date || (supp.created_at || today).slice(0, 10);
  const diff = daysSinceIso(start, today);
  if (diff < 0) return false;
  return diff % every === 0;
}
