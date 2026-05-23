import type { RunCtx, Settings } from './types.ts';

const DEFAULTS: Settings = {
  target_weight_min: 73,
  target_weight_max: 75,
  target_weight_rule: 'always_in_range',
  bar_weight_kg_smith: 20,
  bar_weight_verified: false,
  bar_weight_kg_barbell: 20,
  activity_factor: 1.25,
  pr_squat_kg: 90,
  pr_bench_press_kg: 60,
  pr_shoulder_press_kg: 30,
  pr_deadlift_kg: 0,
  four_goals: ['futsal_soccer', 'taekwondo', 'thigh_power', 'upper_body_maintenance'],
  next_blood_panel_target: '2026-06 ~ 2026-07',
};

// 플랫폼이 manifest user_settings 와 사용자 수정값을 __settings 키로 합쳐 둠.
// 못 가져오면 DEFAULTS 로 폴백 (개발/테스트 환경).
export async function getSettings(ctx: RunCtx): Promise<Settings> {
  const raw = (await ctx.data.get('__settings')) || {};
  return { ...DEFAULTS, ...raw };
}
