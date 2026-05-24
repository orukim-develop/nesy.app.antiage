import type { RunCtx, Settings } from './types.ts';

// 상품용 클린 디폴트.
// 사용자별로 다를 수 있는 PII 성격 키 (목표 체중·PR·4대 목표·다음 채혈일 등) 는
// 0 / 빈 배열 / 빈 문자열로 시작. 호출 AI 는 get_state.missing_settings 또는 init_user_profile 로
// 채움. 헬스장 표준값/일반 활동계수/한국 timezone 만 통계적 일반 디폴트.
const DEFAULTS: Settings = {
  target_weight_min: 0,
  target_weight_max: 0,
  target_weight_rule: 'always_in_range',
  bar_weight_kg_smith: 20,
  bar_weight_verified: false,
  bar_weight_kg_barbell: 20,
  activity_factor: 1.4,
  pr_squat_kg: 0,
  pr_bench_press_kg: 0,
  pr_shoulder_press_kg: 0,
  pr_deadlift_kg: 0,
  four_goals: [],
  next_blood_panel_target: '',
  timezone: 'Asia/Seoul',
  supplement_window_minutes: 30,
};

// 플랫폼이 manifest user_settings 와 사용자 수정값을 __settings 키로 합쳐 둠.
// 못 가져오면 DEFAULTS 로 폴백 (개발/테스트 환경).
export async function getSettings(ctx: RunCtx): Promise<Settings> {
  const raw = (await ctx.data.get('__settings')) || {};
  return { ...DEFAULTS, ...raw };
}
