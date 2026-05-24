# 늙는 속도를 늦추는 마법 (nesy.app.antiage)

호출 AI(Claude / ChatGPT / Gemini)의 외장 기억과 사실 계산기 역할의 nesy.app 마도서. 호출어 `젊음의샘` / `antiage`.

운동 · 건강지표 · 식단+알람 · 사용자 사실(4축) 으로 사용자 상태를 저장하고, AI 가 `get_state` 결과(빈 추론 방지 메타 + 사실)에 근거해서만 응답·추천하도록 강제한다. 마도서 본체는 추천하지 않고 데이터 통로와 검증된 공식(progressive overload, target 범위 평가, Mifflin-St Jeor BMR)만 제공.

## 4축 구조

| 축 | 등록 도구 | 용도 |
|---|---|---|
| exercise | `define_routine_exercise` (progressive overload 대상) + `define_split_plan` (분할 계획) + `log_activity` (자유 활동) + `define_user_fact(axis=exercise)` (장비/제약) | 운동 |
| health_metric | `define_metric` + `define_user_fact(axis=health_metric)` (알레르기·복용약 등) | 건강 지표 |
| diet_reminder | `log_meal` + `define_reminder` + `define_user_fact(axis=diet_reminder)` (식단 제약) | 식단 + 알람 |
| baseline | `define_user_fact(axis=baseline)` (직업·수면 등 천천히 변하는 본인 정보) | 베이스라인 |

`define_user_fact` 는 코드가 사전 정의할 수 없는 정보(헬스장 바 무게, 의수·의족, 알레르기, 식단 제약, 직업 등) 를 AI 가 분류해서 적재하는 자유 슬롯. AI 는 등록 전 반드시 사용자에게 **"이거 [축이름] 카테고리에 [라벨]로 넣을게요"** 라고 명시하고 합의 받아야 한다. 모호하면 사용자에게 직접 묻는다.

특수 slug `fact:exercise:min_plate_increment_kg` (value `{ v: 2.5 }`) 가 등록되면 `next_target` 계산 시 compound 무게 운동의 증분 단위로 자동 사용 — 헬스장에 1.25kg 원판이 없을 때 `v: 5` 등으로 등록.

## 운동 진척 축 (progression)

`define_routine_exercise` 는 어떤 축으로 성장할지 `progression` 으로 명시:

| progression | 진척 방향 | 예시 | 기본 증분 |
|---|---|---|---|
| `weight` | 무게 ↑ | 스쿼트 100kg → 102.5kg | compound 2.5 / isolation 1.25 (kg) |
| `time` | 시간 ↓ (낮을수록 좋음) | 4km 기어가기 10분 → 3분 | 30 (초 가정) |
| `distance` | 거리 ↑ (시간 고정) | 1시간 RowErg 12500m → 13000m | 100 (m 가정) |
| `reps` | 횟수 ↑ (자체중) | 푸시업 max 20회 → 22회 | 1 |
| `hold` | 유지 시간 ↑ | 플랭크 60초 → 70초 | 5 (초 가정) |

**표준 인체 가정 금지** — 다리/팔이 없거나 의수·의족 사용자도 본인이 할 수 있는 형태(예 "기어가기", "한팔 푸시업")를 progression 에 맞게 등록 가능.

## RPE — 힘들었음 점수

각 세트 마지막에 1~10 점수로 입력 (높을수록 힘듦). AI 는 사용자에게 RPE 용어 말고 **"힘들었음 점수"** 로 묻는다. `default_rpe_target` (기본 8) 과 비교해서 `next_target` 이 다음 추천값을 계산:

- target 보다 2 이상 낮음 (너무 쉬움) → 2배 증분
- target 이하 (적당) → 1배 증분
- target+1 이하 (살짝 힘듦) → 유지
- target+1 초과 (너무 힘듦) → 1단계 후퇴

`progression=time` 은 방향 반전 — 쉬웠다면 다음엔 더 빠른 시간을 목표로 한다.

## 분할 계획 (split_plan)

`define_split_plan` 으로 운동을 묶음(bucket)으로 묶고 시점에 매핑. `is_active=true` 는 1개만 — 다른 활성 plan 자동 비활성화. 여러 개 저장 가능 (시각화·비교용).

3가지 패턴:

| assignment.kind | 의미 | 예 |
|---|---|---|
| `weekly` | 요일 매핑 | 월=가슴, 화=등, 수=하체… |
| `sequence` | 순환 | 4분할 A→B→C→D 순서대로 — `get_state` 가 최근 세션 보고 다음 차례 추론 |
| `freestyle` | 묶음만, 자유 선택 | 그룹은 등록해두되 매번 사용자가 골라서 |

체리피커(어떤 묶음도 없이 등록된 routine 중에서 매번 골라하는 경우)는 split_plan 등록 안 함 — define_split_plan 호출하지 말 것.

활성 plan 의 오늘 차례(weekly) 또는 다음 차례(sequence)는 `get_state.active_split_plan.today_bucket` / `next_bucket_hint` 로 자동 노출.

## 배포

1. 이 레포를 GitHub 에 push (기본 브랜치)
2. nesy.app 마도서 에디터에서 본 레포 연결
3. **지금 가져오기** 클릭 → Bun 으로 빌드 → V8 isolate 에 배포

## 시크릿

없음. 외부 API 호출 없음.

## 사용자 설정 (nesy.app UI 폼, 5개)

| key | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `timezone` | string | `Asia/Seoul` | IANA timezone. 알람 시각·"오늘" 경계 판단 기준 |
| `activity_factor` | number | `0` | BMR 곱셈 계수(1.2~1.9). `0` = 합의 전(비활성) |
| `height_cm` | number | `0` | 신장 cm. `0` = 미설정 |
| `sex` | string | `unspecified` | `male` / `female` / `unspecified` |
| `birth_year` | integer | `0` | 출생년도(서기). `0` = 미설정 |

`height_cm > 0` + `sex ≠ unspecified` + `birth_year > 0` + `body_weight_kg` 측정 1건 이상이 모두 만족되면, Mifflin-St Jeor 공식으로 **기초대사량(BMR) 이 자동 계산**되어 `get_state.derived` 에 포함된다 (`bmr` metric 별도 등록 불필요). 여기에 `activity_factor > 0` 까지 더해지면 `log_meal` 응답에 maintenance 비교(today_delta_kcal)도 자동 활성.

## 도구 15개

`set_goal` · `define_routine_exercise` · `log_routine_session` · `log_activity` · `define_metric` · `record_metric` · `log_meal` · `define_reminder` · `ack_reminder` · `define_user_fact` · `define_split_plan` · `delete_entity` (routine/metric/reminder/fact/split_plan 통합) · `get_state` · `next_target` · `suggest_setup`

알람 푸시(`check_reminders`)와 위젯(`render_dashboard`)은 도구 매니페스트 외 자동 호출.
