// index.ts — 심장이 득근득근해지는 마법 (nesy.app.getmuscle)
// 엔트리 포인트. 실제 구현은 src/ 모듈에 분리. 빌드 서버(Bun) 가 번들링.

import type { RunCtx } from './src/types.ts';
import { recordSession } from './src/record/session.ts';
import { recordWeight } from './src/record/weight.ts';
import { recordInBody } from './src/record/inbody.ts';
import { recordBloodPanel } from './src/record/blood.ts';
import { recordMeal } from './src/record/meal.ts';
import { recordRecipe } from './src/record/recipe.ts';
import { getState } from './src/get_state.ts';
import { computeNextLoad } from './src/compute_next_load.ts';
import { renderDashboard } from './src/dashboard.ts';
import { setSupplement } from './src/supplements/set.ts';
import { listSupplements } from './src/supplements/list.ts';
import { deleteSupplement } from './src/supplements/delete.ts';
import { recordSupplementIntake } from './src/supplements/intake.ts';
import { checkNotifications } from './src/supplements/notify.ts';

export async function run({ input, secrets, data }: RunCtx): Promise<unknown> {
  const ctx: RunCtx = { input, secrets, data };
  const tool = input.tool;

  switch (tool) {
    // ── 기록 ─────────────────────────────
    case 'record_session':            return await recordSession(ctx);
    case 'record_weight':             return await recordWeight(ctx);
    case 'record_inbody':             return await recordInBody(ctx);
    case 'record_blood_panel':        return await recordBloodPanel(ctx);
    case 'record_meal':               return await recordMeal(ctx);
    case 'record_recipe':             return await recordRecipe(ctx);
    // ── 영양제 / 약 ──────────────────────
    case 'set_supplement':            return await setSupplement(ctx);
    case 'list_supplements':          return await listSupplements(ctx);
    case 'delete_supplement':         return await deleteSupplement(ctx);
    case 'record_supplement_intake':  return await recordSupplementIntake(ctx);
    // ── 조회 / 계산 ───────────────────────
    case 'get_state':                 return await getState(ctx);
    case 'compute_next_load':         return await computeNextLoad(ctx);
    // ── 플랫폼 내부 호출 (AI 비노출) ──────
    case 'render_dashboard':          return await renderDashboard(ctx);
    case 'check_notifications':       return await checkNotifications(ctx);
    default:
      throw new Error(`알 수 없는 도구: ${tool}`);
  }
}
