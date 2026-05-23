// delete_supplement — 정의 제거. 과거 intake 기록은 보존 (순응도 통계 유지).
// 일시 중단이면 end_date 추가하는 게 더 안전 — 삭제는 영구.

import type { RunCtx } from '../types.ts';
import { validateSlug } from './common.ts';

export async function deleteSupplement(ctx: RunCtx) {
  const a = ctx.input.args || {};
  const slug = validateSlug(a.slug);

  const key = `supplement:${slug}`;
  const existed = !!(await ctx.data.get(key));
  await ctx.data.delete(key);

  return {
    deleted: existed,
    supplement_id: key,
    note: existed
      ? '정의 제거됨. 과거 복용 기록(intake:*)은 보존됨 — 순응도 통계엔 그대로 잡힘.'
      : '해당 slug 정의 없음. 삭제할 게 없었음.',
  };
}
