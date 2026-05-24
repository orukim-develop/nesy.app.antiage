# 심장이 득근득근해지는 마법 (nesy.app.getmuscle)

> 호출 AI(Claude / ChatGPT / Gemini)의 **외장 기억장치**. 추천은 호출 AI 가 하고, 마도서는 **기록 / 조회 / 검증된 공식으로 계산**만 한다.

설계 원칙:
- 메모리에 없는 사실을 추측으로 메우는 호출 AI 패턴을 데이터 구조로 차단
- 운동·식단·체중 추천 전 `get_state` 강제 호출
- 운동 무게 증량은 `compute_next_load` 의 검증된 공식만 사용 (Plotkin 2022 / Refalo 2024 / 주당 2-5% 가이드라인)
- 사용자별 값 (목표 체중·PR·4대 목표 등) 은 코드에 하드코딩 금지 — 빈 디폴트로 시작, `init_user_profile` 로 채움

## 노출 함수

### 첫 사용 / 사용자 프로필
| 함수 | 역할 |
| --- | --- |
| `init_user_profile` | ⭐ 첫 사용 시 사용자 PR·목표 체중·4대 목표·다음 채혈일 등 일괄 저장. `get_state.missing_settings` 가 비어있지 않으면 호출 AI 가 사용자에게 묻고 이 함수 호출. 부분 update 허용 (모든 인자 optional), `still_missing` 반환. |

### 기록·조회·계산
| 함수 | 역할 |
| --- | --- |
| `record_session` | 운동 세션 한 건 기록 + 15% 증량 / 통증 / 충돌 부위 warnings 자동 |
| `record_weight` | 체중 한 건 + measurement_context 강제, 7일 평균 대비 delta 반환 |
| `record_inbody` | InBody 결과 + 직전 대비 delta + interpretation_hint |
| `record_blood_panel` | 혈액검사 + 한국 임상 기준 flags + 직전 대비 변화 |
| `record_meal` | 식단 (컨펌된 결과만) + 누적 kcal/protein + 유지 추정 + 상태 |
| `record_recipe` | AI 가 추천한 레시피 기록 (실제 섭취는 별개) |
| `get_state` | 모든 영역 현재 상태 종합 스냅샷 + `missing_settings` 배열 ⭐ AI 가 추천 전 필호출 |
| `compute_next_load` | 다음 세션 권장 무게 — 검증된 공식만 사용 ⭐ |

### 영양제 / 약 정기 복용 + 푸시 알림
| 함수 | 역할 |
| --- | --- |
| `set_supplement` | 영양제·약 스케줄 정의 (upsert). slug + display_name + schedule_times (HH:MM 배열) + every_n_days + with_meal + start/end_date |
| `list_supplements` | 활성 정의 목록 |
| `delete_supplement` | 정의 영구 삭제 (intake 기록은 보존) |
| `record_supplement_intake` | "방금 먹었어" 기록. 슬롯 자동 매칭 |

자동 노출: `get_user_settings` / `update_user_settings` (개별 키 단위 read/write — 일괄 저장은 `init_user_profile` 권장).

### 플랫폼 내부 호출 (AI 비노출)
- 위젯 `render_dashboard` — `/board` 에서 5분마다 새 SVG 카드 렌더 (체중/운동/식단/혈액검사 요약)
- 알림 `check_notifications` — 5분마다 워커가 호출. 영양제 슬롯 시간 ±`supplement_window_minutes` (기본 30분) 안의 미복용 슬롯에 Web Push 알림. "한 번만" 정책 — 윈도우 놓치면 다음 슬롯에서 새로 시작.

## 첫 사용 흐름 (호출 AI 가 따를 절차)

1. 사용자가 호출어로 마도서 진입 → 호출 AI 가 `get_state` 부르고 `missing_settings` 배열 검사
2. `missing_settings` 가 비어있지 않으면: 사용자에게 친근하게 물어봄 (예: "목표 체중 범위는요? 스쿼트 PR 은요? 4대 목표는요?")
3. 사용자 답변 모이면 `init_user_profile` 한 번에 호출 — `still_missing` 이 줄어드는지 확인
4. 체중·운동 기록은 `record_weight` / `record_session` 으로 시간별 별개 저장 — `init_user_profile` 은 영구 프로필만

`missing_settings` 가 보고하는 필수 키: `target_weight_min`, `target_weight_max`, `pr_squat_kg`, `pr_bench_press_kg`, `pr_shoulder_press_kg`, `pr_deadlift_kg`, `four_goals`, `next_blood_panel_target` (8개).

합리적 디폴트가 있는 키 (`activity_factor` 1.4, `timezone` Asia/Seoul, `supplement_window_minutes` 30, `target_weight_rule` always_in_range) 는 미설정이어도 missing 으로 보고하지 않음. 사용자가 다르면 `update_user_settings` 로 개별 수정.

## 호출 마법언어

- `득근득근`
- `getmuscle`

## 비밀 (secrets)

없음. 외부 API 호출 없음.

## 배포

1. 이 폴더를 GitHub repo (`orukim-develop/nesy.app.getmuscle`) 에 push (`push.bat` 한 번)
2. nesy.app `/account/tools/new` → repo URL 붙여넣기 → "지금 가져오기"
3. 매니페스트 검증 → 등록 → 호출어 `득근득근` 확인
4. 첫 실행: 호출 AI 에게 "내 프로필 설정해줘" → AI 가 묻는 항목 답하면 `init_user_profile` 자동 호출

## 의도적으로 만들지 않는 것

- 운동·식단 **추천** 함수 (`suggest_workout`, `recommend_meal` 등) — 호출 AI 가 함
- 사진 분석 함수 — 호출 AI 가 분석 → 사용자 컨펌 후 `record_meal`
- 자체 칼로리 공식 (BMR × activity_factor 외)
- 자체 운동 무게 공식 (compute_next_load 의 5개 출처 외)
- 사용자별 값의 코드 하드코딩 — 모든 개인값은 `init_user_profile` / `update_user_settings` / `record_*` 로 주입

## 라이선스

비공개 (개인 마도서).
