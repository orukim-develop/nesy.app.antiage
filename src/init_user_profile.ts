// init_user_profile — 마도서 첫 사용 시 사용자 영구 프로필 일괄 저장.
//
// 호출 AI 는 마도서 등록 직후 또는 get_state.missing_settings 가 비어 있지 않을 때
// 사용자에게 PR / 목표 체중 / 4대 목표 / 활동계수 등을 묻고 이 함수로 한 번에 저장.
//
// 모든 인자 optional — 사용자가 아는 것만 채움. 나머지는 still_missing 으로 반환.
// 이미 채워진 키도 새 값 주면 덮어씀 (idempotent upsert).
//
// 시간별 측정값 (체중·InBody·혈액검사·운동) 은 record_* 별도 호출. 이 함수는 user_settings 만.

import type { RunCtx, Settings } from './types.ts';
import { getSettings } from './settings.ts';

// 검사 대상 키 — 이 키들 중 0/빈 인 것이 missing_settings 에 들어가고
// init_user_profile 의 still_missing 에도 같은 기준 적용.
export const PROFILE_KEYS = [
  'target_weight_min',
  'target_weight_max',
  'target_weight_rule',
  'bar_weight_kg_smith',
  'bar_weight_kg_barbell',
  'bar_weight_verified',
  'activity_factor',
  'pr_squat_kg',
  'pr_bench_press_kg',
  'pr_shoulder_press_kg',
  'pr_deadlift_kg',
  'four_goals',
  'next_blood_panel_target',
  'timezone',
  'supplement_window_minutes',
] as const;

// "비어있다" 판정 — 이 키가 missing_settings 에 들어갈 조건.
// 일부 키 (target_weight_rule, bar_weight_kg_*, bar_weight_verified, activity_factor,
//          timezone, supplement_window_minutes) 는 합리적 디폴트가 있으므로 missing 으로 보지 않음.
export const REQUIRED_PROFILE_KEYS = [
  'target_weight_min',
  'target_weight_max',
  'pr_squat_kg',
  'pr_bench_press_kg',
  'pr_shoulder_press_kg',
  'pr_deadlift_kg',
  'four_goals',
  'next_blood_panel_target',
] as const;

export function isMissingValue(key: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value === 'number' && value === 0) {
    // pr_deadlift_kg 같은 게 진짜 0 일 수 있지만, 그래도 "측정 안 함" 으로 분류
    // (호출 AI 가 사용자에게 확인하면 됨)
    return true;
  }
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export async function initUserProfile(ctx: RunCtx) {
  const args = (ctx.input.args || {}) as Partial<Settings>;

  // 기존 settings 불러옴 (DEFAULTS + 사용자 수정값 머지된 상태).
  const current = await getSettings(ctx);

  // 인자로 들어온 값만 추출 (undefined 는 무시 — 부분 update).
  const applied: string[] = [];
  const next: Record<string, any> = { ...current };
  const errors: string[] = [];

  for (const k of PROFILE_KEYS) {
    const v = (args as any)[k];
    if (v === undefined) continue;

    // 가벼운 검증
    const validationError = validateValue(k, v);
    if (validationError) {
      errors.push(`${k}: ${validationError}`);
      continue;
    }

    next[k] = v;
    applied.push(k);
  }

  if (errors.length > 0) {
    throw new Error(`init_user_profile 검증 실패:\n  - ${errors.join('\n  - ')}`);
  }

  // target_weight 일관성 검사 (둘 다 채워졌고 min > max 면 에러)
  if (
    typeof next.target_weight_min === 'number' && next.target_weight_min > 0 &&
    typeof next.target_weight_max === 'number' && next.target_weight_max > 0 &&
    next.target_weight_min > next.target_weight_max
  ) {
    throw new Error(
      `target_weight_min (${next.target_weight_min}) > target_weight_max (${next.target_weight_max}) — min 이 max 보다 클 수 없음.`,
    );
  }

  // __settings 키에 머지 저장. 플랫폼이 update_user_settings 와 동일 슬롯 사용.
  await ctx.data.set('__settings', next);

  // 아직 비어 있는 필수 키 계산
  const stillMissing: string[] = [];
  for (const k of REQUIRED_PROFILE_KEYS) {
    if (isMissingValue(k, (next as any)[k])) stillMissing.push(k);
  }

  return {
    saved: true,
    applied,
    still_missing: stillMissing,
    note:
      stillMissing.length === 0
        ? '필수 프로필 키 모두 채움 — 호출 AI 는 정상 추천 가능.'
        : `still_missing 의 키들이 비어있음. 호출 AI 는 사용자에게 묻고 init_user_profile 다시 호출하거나 update_user_settings 로 개별 저장.`,
  };
}

function validateValue(key: string, value: unknown): string | null {
  // 숫자 키
  const numberKeys = new Set([
    'target_weight_min', 'target_weight_max',
    'bar_weight_kg_smith', 'bar_weight_kg_barbell',
    'activity_factor',
    'pr_squat_kg', 'pr_bench_press_kg', 'pr_shoulder_press_kg', 'pr_deadlift_kg',
    'supplement_window_minutes',
  ]);
  if (numberKeys.has(key)) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return `숫자가 와야 함 (받음: ${JSON.stringify(value)})`;
    }
    if (value < 0) return `음수 불가`;
    // 합리성 한계
    if (key === 'activity_factor' && (value < 1.0 || value > 2.5)) {
      return `activity_factor 는 1.0~2.5 범위 (받음: ${value})`;
    }
    if (key.startsWith('pr_') && value > 1000) {
      return `PR 1000kg 초과는 비현실적 (받음: ${value})`;
    }
    if ((key === 'target_weight_min' || key === 'target_weight_max') && value > 500) {
      return `target_weight 500kg 초과는 비현실적`;
    }
    if (key === 'supplement_window_minutes' && (value < 5 || value > 240)) {
      return `supplement_window_minutes 는 5~240 범위`;
    }
    return null;
  }

  // boolean
  if (key === 'bar_weight_verified') {
    if (typeof value !== 'boolean') return `boolean 필요`;
    return null;
  }

  // enum
  if (key === 'target_weight_rule') {
    if (!['always_in_range', 'fasted_only', 'daily_average'].includes(value as string)) {
      return `target_weight_rule 은 always_in_range | fasted_only | daily_average 중 하나`;
    }
    return null;
  }

  // 문자열
  if (key === 'next_blood_panel_target' || key === 'timezone') {
    if (typeof value !== 'string') return `문자열 필요`;
    return null;
  }

  // 배열 (four_goals)
  if (key === 'four_goals') {
    if (!Array.isArray(value)) return `배열 필요`;
    for (const g of value) {
      if (typeof g !== 'string') return `four_goals 원소는 문자열`;
      if (!/^[a-z][a-z0-9_]*$/.test(g)) {
        return `four_goals 원소는 snake_case 영문 (받음: '${g}')`;
      }
    }
    if (value.length > 8) return `four_goals 는 최대 8개`;
    return null;
  }

  return null;
}
