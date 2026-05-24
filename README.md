# nesy.app.health — 건강 마도서

> 호출 AI(Claude / ChatGPT / Gemini)의 **외장 기억장치**. 마도서는 추천 안 하고 **기록 / 조회 / 검증된 공식으로 계산**만 한다.

## 설계 원칙

1. **사용자 목표는 자연어로 저장.** 어떤 사람은 체중, 어떤 사람은 혈당, 어떤 사람은 마라톤 — 목표 형태를 강제하지 않음.
2. **무엇을 추적할지 (metric / exercise / reminder) 는 AI 가 목표 보고 판단 → 사용자 합의 → 등록.** 마도서는 통로만 제공.
3. **AI 빈 추론 차단.** 응답·추천·계산 전에 반드시 `get_state` 호출 — 사실 기반 응답 강제.
4. **자체 추천·진단 없음.** 칼로리 유지 공식은 BMR×activity_factor 외 없음. 운동 무게 공식은 Helms RIR·Plotkin 2022·Refalo 2024 외 없음.
5. **잔소리 안 함.** 알림은 윈도우 안 1회만 — 놓치면 다음 슬롯에서 새로 시작.

## 노출 함수

### Goal
| 함수 | 역할 |
| --- | --- |
| `set_goal` | 자연어 건강 목표 저장. "체중 70kg 까지" / "당뇨 관리" / "마라톤 준비" 등 사용자 발화 그대로. |

### Exercise (루틴) + 활동
| 함수 | 역할 |
| --- | --- |
| `set_exercise` | 루틴 운동 정의 (slug, display_name, category=compound/isolation). compute_next_load 대상. |
| `list_exercises` | 등록 운동 목록 + 마지막 세션 |
| `delete_exercise` | 정의 삭제 (세션 기록 보존) |
| `record_session` | 루틴 운동 세션 한 건. 15% 급증량이면 warning, PR 자동 update |
| `record_activity` | 비루틴 활동 (축구·산책·자전거 등). name 자유 텍스트 |

### 건강지표
| 함수 | 역할 |
| --- | --- |
| `set_metric` | 지표 정의 (slug, unit, target_min/max, priority). 당뇨인은 glucose, 근비대 추구자는 body_fat_pct 등 |
| `list_metrics` | 등록 지표 + 최근값 + target 평가 |
| `delete_metric` | 정의 삭제 (측정 기록 보존) |
| `record_metric` | 측정 한 건. in_target_range, delta_from_previous, delta_from_7d_avg 반환 |

### 식단
| 함수 | 역할 |
| --- | --- |
| `record_meal` | 식단 한 끼. kcal/protein/carbs/fat/name 전부 선택 — 사용자가 추적하는 것만 |

### Reminder (영양제·약·측정·행동 통합)
| 함수 | 역할 |
| --- | --- |
| `set_reminder` | 알람 정의. type=supplement/measurement/action. 비타민D 매일 9시·인슐린 1일 3회·아침 혈당 측정 등 모두 한 통로 |
| `list_reminders` | 활성 알람 + 오늘 ack 카운트 |
| `delete_reminder` | 정의 삭제 |
| `record_reminder_ack` | "방금 했어" 기록. 윈도우 안이면 해당 슬롯 알림 끝 |

### 조회 / 계산
| 함수 | 역할 |
| --- | --- |
| `get_state` | ⭐ 모든 응답·추천 전 필호출. goal + 3축 + meta (protocol_step / next_recommended_action / ai_should_not / goal_coherence_hint) |
| `compute_next_load` | 다음 세션 무게. Helms RIR 4% + Plotkin 2022 5%/wk cap + Refalo 2024 isolation ×0.7 |
| `propose_setup_from_goal` | goal description 기반 키워드 매칭 추천 (당뇨·근비대·다이어트·러닝·콜레스테롤·고혈압 + generic) |

### 플랫폼 내부 (AI 비노출)
- `render_dashboard` — `/board` 위젯. goal 헤더 + 3축 카드 (운동·건강지표·식단·알람)
- `check_notifications` — 5분마다 워커. 활성 reminder 윈도우 안 미 ack 슬롯 Web Push (1회)

## 호출 AI 행동 규약

`get_state.meta` 가 매 호출마다 재공지 — AI 가 마음대로 행동하지 못하도록 데이터 통로로 강제:

- `protocol_step`:
  - `awaiting_goal` → `set_goal` 부터
  - `awaiting_initial_setup` → `propose_setup_from_goal` → 사용자 합의 → `set_*`
  - `operational` → 정상 운영
- `ai_must_call_get_state_before_recommendation: true` (항상)
- `ai_must_call_set_goal_if_goal_null` (조건부)
- `ai_should_not`:
  - 사용자 설명 없는 항목 마음대로 등록 금지
  - 빈 추론 추천 금지
  - 날짜/시각 추측 금지 (settings.timezone 기준 today/now_minutes 사용)
  - 의학적 진단·처방 흉내 금지
  - compute_next_load 결과 무게 자체 가감 금지
- `goal_coherence_hint` — 응답 전 goal.description 다시 읽고 사용자 발화와 정합성 검증

## 첫 사용 흐름

1. 사용자가 호출어 입력 → 호출 AI 가 `get_state` 호출
2. `meta.protocol_step === 'awaiting_goal'` → AI 가 사용자에게 "어떤 건강 목표를 갖고 있어?" 묻고 `set_goal` 호출
3. `meta.protocol_step === 'awaiting_initial_setup'` → AI 가 `propose_setup_from_goal` 호출 → 추천 목록을 사용자에게 보여주고 합의된 항목만 `set_metric` / `set_exercise` / `set_reminder` 호출
4. `meta.protocol_step === 'operational'` → 정상 처리. 기록 요청은 `record_*` / 추천 요청은 `metrics` 와 `last_session` 으로 근거 있는 답

## 사례별 마도서 사용

### 당뇨 환자
- `set_goal("당뇨 관리 — 식후 혈당 180 안 넘기기")`
- `set_metric(fasting_glucose, unit=mg/dL, target_max=100, priority=critical)`
- `set_metric(post_meal_glucose, unit=mg/dL, target_max=180, priority=critical)`
- `set_reminder(insulin_basal, type=supplement, schedule_times=[22:00], notes="장기형 인슐린 X 단위")`
- `set_reminder(morning_glucose_check, type=measurement, schedule_times=[07:00])`

### 근비대
- `set_goal("근비대. 1년 안에 체지방 유지하고 골격근 +3kg")`
- `set_metric(body_weight, body_fat_pct, skeletal_muscle_kg)` — InBody 후 record_metric 3건
- `set_exercise(squat/bench_press/deadlift/shoulder_press, category=compound)`
- `record_session` → `compute_next_load` 로 다음 무게

### 다이어트
- `set_goal("체중 70kg 까지 감량")`
- `set_metric(body_weight, unit=kg, target_max=70, priority=critical)`
- `set_metric(body_fat_pct, priority=high)`
- BMR metric + `activity_factor` 합의 → `record_meal` 누적시 maintenance 비교

## 사용자 설정

`timezone` (기본 Asia/Seoul) + `activity_factor` (기본 null — 합의 후 update).

사용자별 다른 모든 값 (목표·지표 target·운동 PR 등) 은 settings 가 아닌 별도 도메인 (`goal` / `metric` / `exercise`) — settings 에 박지 않음.

## 호출 마법언어

`헬스` / `health`

## 비밀 (secrets)

없음. 외부 API 호출 없음.

## 배포

1. 이 폴더를 GitHub repo (`orukim-develop/nesy.app.health`) 에 push (`push.bat`)
2. nesy.app `/account/tools/new` → repo URL → "지금 가져오기"
3. 매니페스트 검증 → 등록 → 호출어 `헬스` 확인
4. 첫 실행: 호출 AI 에게 "내 건강 목표는 ..." → `get_state` → `set_goal` → `propose_setup_from_goal` → 합의된 `set_*`

## 의도적으로 만들지 않는 것

- 운동·식단·복용 **추천** 함수 (`suggest_*`, `recommend_*`) — 호출 AI 가 함
- 사진 분석 함수 — 호출 AI 가 분석 → 사용자 컨펌 → `record_meal`
- 자체 칼로리 공식 (BMR × activity_factor 외)
- 자체 운동 무게 공식 (compute_next_load 의 3개 출처 외)
- 자체 의학 진단 / target 권고 — target_min/max 는 사용자 목표 기준만, 의학 가이드라인 X
- 사용자별 값 하드코딩 — 모든 개인값은 `set_*` / `record_*` 로 주입

## 라이선스

비공개 (개인 마도서).
