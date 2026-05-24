# 늙는 속도를 늦추는 마법 (nesy.app.antiage)

호출 AI(Claude / ChatGPT / Gemini)의 외장 기억과 사실 계산기 역할의 nesy.app 마도서. 호출어 `젊음의샘` / `antiage`.

운동 · 건강지표 · 식단+알람 · 사용자 사실(4축) 으로 사용자 상태를 저장하고, AI 가 `get_state` 결과(빈 추론 방지 메타 + 사실)에 근거해서만 응답·추천하도록 강제한다. 마도서 본체는 추천하지 않고 데이터 통로와 검증된 공식(progressive overload, target 범위 평가, Mifflin-St Jeor BMR)만 제공.

## 4축 구조

| 축 | 등록 도구 | 용도 |
|---|---|---|
| exercise | `define_routine_exercise` (progressive overload 대상) + `log_activity` (자유 활동) + `define_user_fact(axis=exercise)` (장비/제약) | 운동 |
| health_metric | `define_metric` + `define_user_fact(axis=health_metric)` (알레르기·복용약 등) | 건강 지표 |
| diet_reminder | `log_meal` + `define_reminder` + `define_user_fact(axis=diet_reminder)` (식단 제약) | 식단 + 알람 |
| baseline | `define_user_fact(axis=baseline)` (직업·수면 등 천천히 변하는 본인 정보) | 베이스라인 |

`define_user_fact` 는 코드가 사전 정의할 수 없는 정보(헬스장 바 무게, 의수·의족, 알레르기, 식단 제약, 직업 등) 를 AI 가 분류해서 적재하는 자유 슬롯. AI 는 등록 전 반드시 사용자에게 **"이거 [축이름] 카테고리에 [라벨]로 넣을게요"** 라고 명시하고 합의 받아야 한다. 모호하면 사용자에게 직접 묻는다.

특수 slug `fact:exercise:min_plate_increment_kg` (value `{ v: 2.5 }`) 가 등록되면 `next_weight` 계산 시 compound 운동의 증분 단위로 자동 사용 — 헬스장에 1.25kg 원판이 없을 때 `v: 5` 등으로 등록.

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

## 도구 14개

`set_goal` · `define_routine_exercise` · `log_routine_session` · `log_activity` · `define_metric` · `record_metric` · `log_meal` · `define_reminder` · `ack_reminder` · `define_user_fact` · `delete_entity` (routine/metric/reminder/fact 통합) · `get_state` · `next_weight` · `suggest_setup`

알람 푸시(`check_reminders`)와 위젯(`render_dashboard`)은 도구 매니페스트 외 자동 호출.
