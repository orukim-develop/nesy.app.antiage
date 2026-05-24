// set_goal — 사용자의 자연어 목표 저장. 마도서는 해석 안 함.
//
// 호출 AI 는 사용자 첫 진입 시 (get_state.missing_setup 에 'goal') 자연어로 받아 호출.
// 기존 목표 있을 때 새로 호출하면 덮어씀. 변경 이력은 별도 저장 안 함 (단순성 우선).

import type { RunCtx, Goal } from './types.ts';
import { getGoal, setGoal as storeGoal } from './store.ts';
import { nowIso } from './utils.ts';

export async function setGoalTool(ctx: RunCtx) {
  const args = ctx.input.args || {};
  const description = args.description;

  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('description 은 비어 있지 않은 문자열 필요 — 사용자 자연어 목표 그대로 저장.');
  }
  if (description.length > 1000) {
    throw new Error(`description 너무 김 (최대 1000자, 받음 ${description.length}자) — 핵심만 요약.`);
  }

  const now = nowIso();
  const existing = await getGoal(ctx);

  const next: Goal = {
    description: description.trim(),
    set_at: existing?.set_at ?? now,
    updated_at: now,
  };

  await storeGoal(ctx, next);

  return {
    saved: true,
    goal: next,
    is_update: !!existing,
    note: existing
      ? '기존 목표 덮어씀. AI 는 새 목표에 맞게 metric / exercise / reminder 재검토 권장 — propose_setup_from_goal 호출 가능.'
      : '목표 첫 저장. AI 는 propose_setup_from_goal 호출해서 사용자에게 metric / exercise / reminder 등록 제안.',
  };
}
