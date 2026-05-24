// __settings 단일 객체. 진짜 필수는 timezone 만.
// 사용자별 값 (목표·지표 target·운동 PR 등) 은 settings 가 아닌 별도 도메인.

import type { RunCtx, Settings } from './types.ts';

export const DEFAULTS: Settings = {
  timezone: 'Asia/Seoul',
  activity_factor: null,
};

export async function getSettings(ctx: RunCtx): Promise<Settings> {
  const stored = (await ctx.data.get('__settings')) as Partial<Settings> | null;
  if (!stored) return { ...DEFAULTS };
  return { ...DEFAULTS, ...stored };
}

export async function patchSettings(ctx: RunCtx, patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings(ctx);
  const next = { ...cur, ...patch };
  await ctx.data.set('__settings', next);
  return next;
}
