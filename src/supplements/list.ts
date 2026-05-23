// list_supplements — 현재 등록된 모든 영양제·약 정기 복용 정의 목록.
// 호출 AI 가 "지금 뭐 챙겨먹고 있어?" 답변 또는 "오늘 남은 복용은?" 계산 전 호출.

import type { RunCtx } from '../types.ts';
import { loadAllSupplements } from '../store.ts';
import { nowInTz } from './common.ts';
import { getSettings } from '../settings.ts';

export async function listSupplements(ctx: RunCtx) {
  const settings = await getSettings(ctx);
  const { date: today } = nowInTz(settings.timezone);
  const supps = await loadAllSupplements(ctx);

  const active = supps.filter((s) => {
    if (s.end_date && today > s.end_date) return false;
    if (s.start_date && today < s.start_date) return false;
    return true;
  });

  return {
    today,
    timezone: settings.timezone,
    count: active.length,
    supplements: active
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((s) => ({
        slug: s.slug,
        display_name: s.display_name,
        times_per_day: s.times_per_day,
        schedule_times: s.schedule_times,
        every_n_days: s.every_n_days ?? 1,
        with_meal: s.with_meal ?? null,
        dose_note: s.dose_note ?? null,
        start_date: s.start_date ?? null,
        end_date: s.end_date ?? null,
        notes: s.notes ?? null,
      })),
    note: 'AI 는 이 목록을 본 다음에만 영양제 관련 질문/추천 답변. 추측 금지.',
  };
}
