// set_supplement — 영양제/약 정기 복용 정의 (upsert).
//
// 같은 slug 가 있으면 덮어씀. 사용자가 "비타민D 9시" 라 했다 "9시·21시 2번" 으로 바꾸면
// 단순히 같은 slug 로 set_supplement 다시 부르면 됨. 과거 intake 기록은 그대로 남음.

import type { RunCtx, SupplementSchedule } from '../types.ts';
import { nowIso } from '../utils.ts';
import { validateSlug, validateTime } from './common.ts';

export async function setSupplement(ctx: RunCtx) {
  const a = ctx.input.args || {};
  const slug = validateSlug(a.slug);

  if (typeof a.display_name !== 'string' || !a.display_name.trim()) {
    throw new Error('display_name 필수.');
  }
  if (!Array.isArray(a.schedule_times) || a.schedule_times.length === 0) {
    throw new Error('schedule_times 필수 (1개 이상의 HH:MM 배열).');
  }
  if (a.schedule_times.length > 12) {
    throw new Error('하루 12번 초과 복용은 차단. 합리적 스케줄만.');
  }

  const times = a.schedule_times.map((t: unknown, i: number) =>
    validateTime(t, `schedule_times[${i}]`),
  );
  // 정렬 + 중복 제거
  const uniqueSorted = Array.from(new Set(times)).sort();

  const timesPerDay = typeof a.times_per_day === 'number' ? a.times_per_day : uniqueSorted.length;
  if (timesPerDay !== uniqueSorted.length) {
    throw new Error(
      `times_per_day(${timesPerDay}) 와 schedule_times 길이(${uniqueSorted.length}) 불일치.`,
    );
  }

  const every = a.every_n_days;
  if (every !== undefined && (typeof every !== 'number' || !Number.isInteger(every) || every < 1)) {
    throw new Error('every_n_days 는 1 이상 정수.');
  }

  const existing = (await ctx.data.get(`supplement:${slug}`)) as SupplementSchedule | null;
  const now = nowIso();

  const entry: SupplementSchedule = {
    slug,
    display_name: a.display_name.trim(),
    times_per_day: timesPerDay,
    schedule_times: uniqueSorted,
    every_n_days: every ?? 1,
    with_meal: a.with_meal ?? undefined,
    start_date: a.start_date ?? undefined,
    end_date: a.end_date ?? undefined,
    dose_note: a.dose_note ?? undefined,
    notes: a.notes ?? undefined,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await ctx.data.set(`supplement:${slug}`, entry);

  return {
    saved: true,
    supplement_id: `supplement:${slug}`,
    upserted: !!existing,
    schedule: {
      times_per_day: entry.times_per_day,
      schedule_times: entry.schedule_times,
      every_n_days: entry.every_n_days,
    },
  };
}
