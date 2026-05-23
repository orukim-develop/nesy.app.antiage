// record_supplement_intake — 실제 복용 한 건 기록.
//
// 사용자가 "비타민D 방금 먹었어" 보고하면 호출 AI 가 부름.
// slot 인자가 없으면 현재 시간에 가장 가까운 정의된 슬롯에 자동 매칭 (±60분 안).
// 그 슬롯에 이미 기록이 있으면 idempotent 하게 덮어씀.

import type { RunCtx, SupplementIntake, SupplementSchedule } from '../types.ts';
import { nowIso } from '../utils.ts';
import { validateSlug, validateTime, timeToKey, timeToMinutes, nowInTz } from './common.ts';
import { getSettings } from '../settings.ts';

export async function recordSupplementIntake(ctx: RunCtx) {
  const a = ctx.input.args || {};
  const slug = validateSlug(a.slug);

  const supp = (await ctx.data.get(`supplement:${slug}`)) as SupplementSchedule | null;
  if (!supp) {
    throw new Error(
      `supplement:${slug} 정의 없음. 먼저 set_supplement 로 등록할 것.`,
    );
  }

  const settings = await getSettings(ctx);
  const { date: todayLocal, time: nowHHMM } = nowInTz(settings.timezone);
  const date = a.date || todayLocal;

  // 슬롯 결정: 명시 > 가장 가까운 정의된 슬롯 (현재 시간 기준, ±60분) > 첫 슬롯
  let slot: string;
  if (a.slot) {
    slot = validateTime(a.slot, 'slot');
    if (!supp.schedule_times.includes(slot)) {
      throw new Error(
        `slot ${slot} 는 ${slug} 정의된 슬롯이 아님. 정의: ${supp.schedule_times.join(', ')}`,
      );
    }
  } else {
    slot = pickNearestSlot(supp.schedule_times, nowHHMM);
  }

  const key = `intake:${date}:${slug}:${timeToKey(slot)}`;
  const entry: SupplementIntake = {
    slug,
    date,
    slot,
    taken_at: a.taken_at || nowIso(),
    note: a.note,
    created_at: nowIso(),
  };
  await ctx.data.set(key, entry);

  return {
    saved: true,
    intake_id: key,
    matched_slot: slot,
    note:
      a.slot
        ? '명시된 슬롯에 저장.'
        : '슬롯 자동 매칭 (현재 시간에 가장 가까운 정의된 슬롯). 정확한 슬롯 지정하려면 slot 인자 사용.',
  };
}

function pickNearestSlot(slots: string[], nowHHMM: string): string {
  const nowMin = timeToMinutes(nowHHMM);
  let best = slots[0];
  let bestDelta = Math.abs(timeToMinutes(slots[0]) - nowMin);
  for (const s of slots.slice(1)) {
    const d = Math.abs(timeToMinutes(s) - nowMin);
    if (d < bestDelta) {
      bestDelta = d;
      best = s;
    }
  }
  return best;
}
