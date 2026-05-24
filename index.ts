// nesy.app.health — 건강 마도서.
//
// 호출 AI (Claude / ChatGPT / Gemini) 의 외장 기억.
// 사용자의 자연어 목표를 받아 AI 가 유동적으로 metric / exercise / reminder 를 등록·운영.
// 마도서 자체는 추천 안 함. 사실만 기록하고, 검증된 공식으로 계산만 한다.

import type { RunCtx } from './src/types.ts';

// Goal — 자연어 목표
import { setGoalTool } from './src/goal.ts';

// Exercise — 루틴 운동 정의 + 세션 기록
import { setExerciseTool, listExercisesTool, deleteExerciseTool } from './src/exercise.ts';
import { recordSessionTool } from './src/session.ts';

// 비루틴 활동 (축구·산책·자전거 등)
import { recordActivityTool } from './src/activity.ts';

// 건강지표 — 정의 + 측정
import { setMetricTool, listMetricsTool, deleteMetricTool } from './src/metric.ts';
import { recordMetricTool } from './src/metric_record.ts';

// 식단
import { recordMealTool } from './src/meal.ts';

// 알람 (영양제·약·측정·행동 통합)
import {
  setReminderTool, listRemindersTool, deleteReminderTool, recordReminderAckTool,
} from './src/reminder.ts';

// 조회·계산
import { getStateTool } from './src/get_state.ts';
import { computeNextLoadTool } from './src/compute_next_load.ts';
import { proposeSetupFromGoalTool } from './src/propose_setup_from_goal.ts';

// 플랫폼 내부 (AI 비노출)
import { renderDashboardTool } from './src/dashboard.ts';
import { checkNotificationsTool } from './src/notifications.ts';

export async function run({ input, secrets, data }: RunCtx): Promise<unknown> {
  const ctx: RunCtx = { input, secrets, data };
  const tool = input.tool;

  switch (tool) {
    // ── Goal ─────────────────────────────────────
    case 'set_goal':                  return await setGoalTool(ctx);

    // ── Exercise (루틴) ──────────────────────────
    case 'set_exercise':              return await setExerciseTool(ctx);
    case 'list_exercises':            return await listExercisesTool(ctx);
    case 'delete_exercise':           return await deleteExerciseTool(ctx);
    case 'record_session':            return await recordSessionTool(ctx);

    // ── 비루틴 활동 ───────────────────────────────
    case 'record_activity':           return await recordActivityTool(ctx);

    // ── 건강지표 ──────────────────────────────────
    case 'set_metric':                return await setMetricTool(ctx);
    case 'list_metrics':              return await listMetricsTool(ctx);
    case 'delete_metric':             return await deleteMetricTool(ctx);
    case 'record_metric':             return await recordMetricTool(ctx);

    // ── 식단 ──────────────────────────────────────
    case 'record_meal':               return await recordMealTool(ctx);

    // ── 알람 ──────────────────────────────────────
    case 'set_reminder':              return await setReminderTool(ctx);
    case 'list_reminders':            return await listRemindersTool(ctx);
    case 'delete_reminder':           return await deleteReminderTool(ctx);
    case 'record_reminder_ack':       return await recordReminderAckTool(ctx);

    // ── 조회 / 계산 ───────────────────────────────
    case 'get_state':                 return await getStateTool(ctx);
    case 'compute_next_load':         return await computeNextLoadTool(ctx);
    case 'propose_setup_from_goal':   return await proposeSetupFromGoalTool(ctx);

    // ── 플랫폼 내부 (AI 비노출) ───────────────────
    case 'render_dashboard':          return await renderDashboardTool(ctx);
    case 'check_notifications':       return await checkNotificationsTool(ctx);

    default:
      throw new Error(`알 수 없는 도구: ${tool}`);
  }
}
