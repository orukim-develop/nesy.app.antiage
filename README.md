# 늙는 속도를 늦추는 마법 (nesy.app.antiage)

호출 AI(Claude / ChatGPT / Gemini)의 외장 기억 역할을 하는 nesy.app 마도서. 호출어 `네시, 저속노화` / `네시, 안티에이지` / `네시, Antiage` (호출어는 nesy.app 마켓플레이스 UI에서 관리 — 본 레포 코드와 무관).

운동 · 건강지표 · 식단+알람 · 사용자 사실(4축) 으로 사용자의 상태를 **기록**하고, 현재 상태와 추이를 **한눈에 보여주는 것**에만 집중한다.

## ★ 안전 원칙 (이 마도서의 존재 이유)

이 마도서는 과거에 조언·추천 엔진을 내장했다가 사용자의 건강을 악화시킨 전력이 있다. 그래서 아래 4원칙으로 **기록 + 시각화 전용**으로 재설계되었다.

1. **마도서 이름으로 의학·식이·운동 조언/추천/처방/식단작성을 절대 하지 않는다.** 다음 무게·칼로리·식단·운동량을 마도서가 정해주지 않는다.
2. **마도서는 사용자가 말한 사실만 기록한다.**
3. **마도서는 현재 상태와 추이를 한눈에 보기 쉽게 만드는 데만 치중한다.**
4. **AI(호출 모델)가 스스로 조언하려면, "이건 마도서 기록이 아니라 제(AI) 개인 판단입니다" 라고 분리해 밝힌 뒤 말한다.** 마도서가 추천하는 것처럼 말하지 않는다. 의학적 내용은 전문가 상담도 함께 권한다.

이 원칙은 `get_state.ai_rules` 로 호출 AI에게 전달되고, **모든 도구 응답에 `_guard` 가 동봉**되어 매 호출마다 강제된다.

### 면책·가드 (`_guard`) — 모든 응답에 동봉

마도서는 AI의 입을 물리적으로 막을 수는 없다(마도서는 데이터를 건네는 '기록함'이고, 말하는 주체는 별개의 AI다). 대신 **모든 도구 응답**에 아래 가드를 붙여 — `get_state` 한 곳이 아니라 매 호출마다 — AI가 "몰랐다"고 할 수 없게 만든다.

| 필드 | 내용 |
|---|---|
| `scope` | 이 마도서는 기록·시각화 전용이다 |
| `no_advice` | 마도서 이름으로 의학·식이·운동 조언/추천/처방/식단작성 절대 금지 — 마도서의 어떤 출력값도 조언이 아니다 |
| `liability` | **마도서는 어떤 조언에도 책임이 없다. 조언의 책임은 전적으로 AI 본인에게 있다.** |
| `if_ai_insists_on_advice` | 조언하려면 마도서와 분리한 뒤 아래 `disclaimer` 를 사용자에게 그대로 먼저 보여주고 말해야 한다. disclaimer 없이 조언 금지 |
| `disclaimer` | 사용자에게 그대로 노출할 면책 문구 (아래) |

> **disclaimer 문구:** ⚠️ 여기서부터는 마도서의 기록이 아니라 AI(저)의 개인 판단입니다. 마도서는 기록·시각화만 하며 이 조언에 어떤 책임도 없습니다. 이 조언의 책임은 전적으로 AI(저)에게 있습니다. 의학·식이·운동 관련 내용은 반드시 의사·영양사 등 전문가와 상담하세요.

대시보드 위젯 하단에도 **"기록·시각화 전용 · 조언하지 않음"** 문구가 항상 표시된다.

## 4축 구조

| 축 | 등록 도구 | 용도 |
|---|---|---|
| exercise | `define_exercise` (개별 운동) + `define_routine` (운동을 엮은 루틴) + `define_schedule` (배치) + `log_workout` (실행 기록) + `log_activity` (자유 활동) + `define_user_fact(axis=exercise)` (장비/제약) | 운동 |
| health_metric | `define_metric` + `define_user_fact(axis=health_metric)` (알레르기·복용약 등) | 건강 지표 |
| diet_reminder | `log_meal` + `define_reminder` + `define_user_fact(axis=diet_reminder)` (식단 제약) | 식단 + 알람 |
| baseline | `define_user_fact(axis=baseline)` (직업·수면 등 천천히 변하는 본인 정보) | 베이스라인 |

`define_user_fact` 는 코드가 사전 정의할 수 없는 정보(헬스장 바 무게, 의수·의족, 알레르기, 식단 제약, 직업 등) 를 AI 가 분류해서 적재하는 자유 슬롯. AI 는 등록 전 반드시 **사용자 발화 언어**로 분류 의도를 명시하고 합의를 받아야 한다 — 한국어 화자면 한국어, 영어 화자면 영어, 다른 언어면 그 언어. 영문 slug/axis 코드 노출 금지. 모호하면 두 선택지를 사용자 언어로 풀어서 직접 묻는다.

축 자연어 표현 예시:

| axis | 한국어 | 영어 |
|---|---|---|
| `exercise` | 운동 환경/장비/제약 | workout environment/equipment/constraints |
| `health_metric` | 건강 관련 정보(알레르기·복용약·만성질환 등) | health-related info (allergies, meds, conditions) |
| `diet_reminder` | 식단 제약/알람 관련 | diet constraints / reminders |
| `baseline` | 기본 정보(직업·수면·생활패턴 등) | baseline info (job, sleep, lifestyle) |

다른 언어 화자는 의미 보존하며 그 언어로 자연 번역.

## 운동 추이 축 (progression)

`define_exercise` 는 한 운동(개별 동작)을 **어떤 값으로 기록하고 어느 방향을 '진전'으로 표시할지** `progression` 으로 명시한다. 마도서가 다음 목표를 계산하지 않는다 — 표시 방향용일 뿐이다.

| progression | 진전 방향 (표시용) | 예시 | 기본 default_sets |
|---|---|---|---|
| `weight` | 무게 ↑ | 스쿼트 100kg | 3 |
| `time` | 시간 ↓ (낮을수록 진전) | 4km 기어가기 10분 → 3분 | 1 |
| `distance` | 거리/속도 ↑ | 1시간 RowErg 12500m → 13000m | 1 |
| `reps` | 횟수 ↑ (자체중) | 푸시업 max 20회 → 22회 | 3 |
| `hold` | 유지 시간 ↑ | 플랭크 60초 → 70초 | 3 |

**표준 인체 가정 금지** — 다리/팔이 없거나 의수·의족 사용자도 본인이 할 수 있는 형태(예 "기어가기", "한팔 푸시업")를 progression 에 맞게 등록 가능.

## 운동 흐름 — 운동 → 루틴 → 배치

```
① 운동 등록 (define_exercise)
       — 개별 동작. 추이축·단위·현재 기준값(baseline)·기본 처방·메모
       ↓
② 루틴 구성 (define_routine, 선택)
       — 여러 운동을 엮은 '레시피'. AI 가 사용자 자연어를 blocks 로 구조화
         (슈퍼셋·서킷·AMRAP·인터벌·피라미드 등 모두). 원문은 source_text 에 보관
       ↓
③ 배치 (define_schedule, 선택)
       — 루틴을 요일별 / 순환 / 그룹만 골라하기
       ↓
④ 실행 기록 (log_workout)
       — 블록·운동·세트별 실제값. (선택)힘들었음 점수·워밍업·디로드
```

**다음 목표는 마도서가 계산하지 않는다.** 사용자가 "다음엔 X 해볼래" 라고 스스로 말하면 `update_exercise(slug, next_session_goal={value, note?})` 로 그 말을 그대로 기록만 한다 (source 는 항상 `"manual"`). 마도서가 자동으로 채우거나 덮어쓰지 않는다.

## baseline_value — 사용자가 밝힌 '현재 기준값'

각 운동(exercise)은 사용자가 스스로 밝힌 현재 능력치(`baseline_value`) 를 저장한다. 그 운동을 쓰는 **모든 루틴의 위젯 입력 기본값**으로 쓰이고, 현재/직전/최고와 함께 추이를 보여준다. **기록·표시 전용.**

마도서는 이 값을 자동으로 갱신하지 않는다. 두 경우에만 갱신한다: (1) 사용자가 "현재 기준값을 95kg 으로 해줘" 라고 직접 말할 때, (2) 위젯에서 기준값보다 잘했을 때 뜨는 **"현재 기준값을 이 값으로 바꿀까요?"** 에 사용자가 **'예'** 를 누를 때 (`update_exercise(slug, baseline_value=…)`). 후자도 마도서가 *목표를 제안*하는 게 아니라 *사용자가 실제로 한 값*을 반영할지 묻는 것 — 자동 갱신이 아니다.

## memo — 자유 메모

각 루틴에 1000자 이내 메모를 붙일 수 있다. **코드는 파싱하지 않고 그대로 보관·표시**한다. 예: "이 머신 무게 단위 7kg", "어깨 부상 회복 중", "8월까지 가볍게". AI 가 계획·표시에 참고할 수 있는 맥락 메모일 뿐, 마도서가 이를 근거로 증량/감량을 추천하지 않는다.

## progression_state — get_state 에서 자동 노출 (시각화용)

`get_state.exercises[]` 각 운동 항목에 다음 추이 사실이 포함된다 (계산된 추천값이 아니라, 기록에서 뽑은 사실). 루틴(레시피)은 `get_state.routines_v2[]` 에, 최근 기록 시계열은 `exercises[].recent_points` (추세 미니그래프용)에 함께 노출된다:

```
progression_state: {
  working_value,        // 사용자가 밝힌 현재 능력치 (없으면 null)
  current_value,        // 직전 비-디로드 세션 본세트 평균
  current_at,
  pr_value,             // 모든 본세트 단일값 중 최댓값 (time 은 최솟값)
  pr_at,
  baseline_value,       // 첫 비-디로드 세션 본세트 평균
  baseline_at,
  direction,            // "increase" | "decrease"
}

next_session_goal: {    // null 또는
  value,                // 사용자가 직접 정한 다음 목표 숫자
  computed_at,
  source,               // 항상 "manual" (사용자 지정)
  note,                 // 사용자 메모 (200자, 선택)
}
```

디로드 세션·워밍업 세트는 추이 표시에서 제외/구분. AI 가 진행 상황·정체·후퇴를 한눈에 볼 수 있게 하는 용도다.

## 기록 수정·삭제

마도서는 두 가지 식별자 체계를 쓴다:

| 부류 | id 형식 | 예 |
|---|---|---|
| **정의(definition)** | slug (snake_case) | `squat` / `body_weight_kg` / `morning_glucose` / `breakfast_oatmeal` (끼 프리셋) |
| **기록(record)** | 전체 storage key (prefix 포함) | `meal:2026-05-25T08:30:00.000Z:k4j2a9x1` / `workout:full_a:2026-05-25T18:00:00.000Z:p3l9m2q5` |

기록 id 는 `get_state` 에서 자동 surface:

| 항목 | id 위치 |
|---|---|
| 끼니 | `meals_today.items[].id` |
| 최근 측정 | `metrics[].latest_id` |
| 최근 운동 기록 | `exercises[].last_session.id` |
| 최근 활동 | `recent_activities[].id` |

### 끼니 4가지 모드 — `log_meal`

`log_meal` 한 도구가 4가지 모드를 통합 처리 (조합 가능):

| 모드 | args | 동작 |
|---|---|---|
| ① 신규 등록 | `{ name, kcal?, ... }` | 새 끼니 1건 기록 |
| ② 수정 (upsert) | `{ id: "meal:...", name, kcal?, ... }` | 같은 key 덮어쓰기 |
| ③ 프리셋 등록 | `{ name, kcal?, ..., as_preset_slug: "breakfast_oatmeal" }` | 끼니 기록 + 프리셋(`meal_preset:slug`) 동시 저장 |
| ④ 프리셋 호출 | `{ from_preset_slug: "breakfast_oatmeal" }` | 프리셋의 영양값을 기본값으로 채워 끼니 기록. 호출 args 가 명시한 값은 override 우선. `name` 도 생략 가능 |

자주 먹는 끼는 한 번 프리셋으로 저장하면 다음부터 `from_preset_slug` 한 줄로 호출 가능. 등록된 프리셋 목록은 `get_state.meal_presets[]` 로 노출 (식단 탭에 카드로 시각화). 프리셋 slug 는 사용자 노출 금지 — `name` 으로만 자연어 표현.

영양 필드(kcal/protein/carbs/fat)는 모두 선택 — **사용자가 알려준 값만 기록**하고, 모르면 비워둔다. 마도서가 식단을 짜거나 적정 섭취량을 추천하지 않는다.

### 기타 기록 수정·삭제 — `delete_entity`

`measure` / `session` / `activity` 는 별도 update 도구 없음 — `delete_entity({kind, id})` 후 다시 `log_*` 호출.

```
delete_entity({ kind: "session", id: "session:squat:..." })
```

**운동 기록(workout) 삭제는 그 기록만 지운다.** 사용자가 직접 정한 `next_session_goal` 은 건드리지 않는다 (재계산·클리어 없음).

**AI 가 사용자에게 id 노출 금지** — 자연어로만. 예 "아까 등록한 점심(450kcal) 을 600kcal 로 수정할게요" / "오늘 운동 세션 한 건 지울게요".

### 기본 처방 (default_sets / default_reps / 범위)

`define_exercise` 는 사용자가 정한 기본 처방도 같이 저장한다 (마도서가 정해주지 않음; **루틴 블록이 운동별로 덮어쓸 수 있다**):

- `default_sets` — 기본 세트 수. 생략 시 위 표 기본값.
- `default_reps` — 기본 고정 횟수 (예 `5x5` 의 5).
- `default_reps_min` / `default_reps_max` — 기본 횟수 범위 (예 8-12). `default_reps` 가 있으면 무시.
- 모두 선택값. 시간/거리/유지시간 추이에서는 보통 횟수를 비운다.

축구·테니스·등산 등도 사용자가 추이를 보고 싶으면 등록 가능 (`progression` 적절히 선택). 단순 활동량만 남기려면 `log_activity` 가 더 자연스럽다 — AI 가 사용자 의도를 확인 후 결정.

위젯 표시 예 — `백 스쿼트 (weight) · 3×5` / `푸시업 (reps) · 3×8-12` / `5km 러닝 (time) · 1세트`.

### set_size — 1세트의 고정 크기 (카디오·인터벌·격투)

스트렝스는 1세트 크기가 가변(reps 가 바뀜)이지만, 카디오 인터벌·격투 라운드는 **1세트 크기가 고정**(시간/거리)이다. 이 경우 `progression`/`baseline_value` (추이 축)와 분리되는 별도 메타가 필요 → `set_size: { value, unit }`.

| 운동 | progression | baseline_value | default_sets | default_reps | set_size | 의미 |
|---|---|---|---|---|---|---|
| 트레드밀 조깅 | distance | 9 (km/h) | 20 | — | { 1, "min" } | 9km/h 로 1분씩 20세트 |
| RowErg | time | 2.4167 (min/500m) | 1 | — | { 5, "min" } | 페이스 2:25 로 5분 |
| 태권도 발차기 | reps | 20 (번) | 3 | 20 | { 3, "min" } | 3분 라운드 3번, 라운드당 20번 |
| 백 스쿼트 | weight | 100 (kg) | 3 | 5 | (없음) | 5회 가변이라 set_size 불필요 |

선택 필드. 비우면 기존 모델과 동일. 채우면 위젯에 `3×20 · 세트당 3분` 처럼 자연스럽게 표시.

## 세션 기록의 선택 항목 — 힘들었음 점수 · 워밍업 · 디로드 · 슈퍼셋

`log_workout` 의 각 세트/세션에는 선택 라벨을 붙일 수 있다. 모두 **기록·표시용**이며, 마도서가 이를 근거로 다음 목표를 계산하지 않는다.

| 항목 | 필드 | 효과 |
|---|---|---|
| 힘들었음 점수 (RPE) | `sets[].rpe` (선택, 1~10) | 사용자가 말한 경우에만 기록. 추이 참고용 |
| 워밍업 세트 | `sets[].is_warmup=true` | 추이 표시에서 본세트와 구분. 이력엔 남음 |
| 디로드 세션 (그날만 가볍게) | `is_deload=true` (세션 레벨) | 세션 통째로 '디로드'로 표시 |
| 슈퍼셋/서킷 | 루틴 정의(`define_routine`)의 block `kind=superset/circuit` — 한 block 의 items 에 여러 운동 | 기록 시 같은 block_id 의 entries 에 각 운동 (옛 superset_group 꼬리표 폐기) |

AI 는 사용자에게 `is_warmup` / `is_deload` / `kind` / `block_id` 같은 코드값을 노출하지 않고, 사용자 발화 언어로 자연스럽게 확인 후 내부적으로 변환 — 예 "앞 2세트는 워밍업으로 기록할까요?" / "오늘은 가볍게 한 날로 기록할게요" / "벤치+로우 묶어서 기록할게요".

위젯 표시 예 — `[디로드] 5세트 · 2026-05-25` / `3세트 +W2 · 2026-05-25` (본세트 3 + 워밍업 2) / `5세트 · 2026-05-25 [SS]` (슈퍼셋 묶음).

## 건강 지표 (define_metric / record_metric)

사용자가 추적하고 싶은 지표를 등록(`define_metric`)하고 측정값을 기록(`record_metric`)한다. `target_min`/`target_max` 범위는 **사용자가 본인 기준을 직접 알려줄 때만** 저장한다 — 마도서가 정상범위를 정하지 않는다. 측정값 기록 시 사용자가 정한 범위 대비 위치, 직전값·7일 평균 대비 변화 같은 **사실·추이**만 함께 반환한다.

마도서 이름으로 의학적 진단·처방·해석을 하지 않는다. AI 가 의견을 말하려면 "마도서 기록이 아니라 제(AI) 개인 판단입니다" 라고 분리해 밝히고 전문가 상담도 함께 권한다.

## 배치 (schedule)

`define_schedule` 로 **루틴**을 묶음(bucket)으로 묶고 시점에 매핑. 묶음은 개별 운동이 아니라 루틴(`routine_v2_slugs`)을 가리킨다. `is_active=true` 는 1개만 — 다른 활성 배치 자동 비활성화. 여러 개 저장 가능 (시각화·비교용).

3가지 패턴:

| assignment.kind | 의미 | 예 |
|---|---|---|
| `weekly` | 요일 매핑 | 월=푸시, 화=풀, 수=레그… |
| `sequence` | 순환 | A→B→C→D 순서대로 — `get_state` 가 최근 기록 보고 다음 차례 추론 |
| `freestyle` | 묶음만, 자유 선택 | 그룹은 등록해두되 매번 사용자가 골라서 |

체리피커(매번 골라하는 경우)는 배치 등록 안 함 — define_schedule 호출하지 말 것.

활성 배치의 오늘 차례(weekly) 또는 다음 차례(sequence)는 `get_state.active_schedule.today_bucket` / `next_bucket_hint` 로 자동 노출.

## 배포

1. 이 레포를 GitHub 에 push (기본 브랜치)
2. nesy.app 마도서 에디터에서 본 레포 연결
3. **지금 가져오기** 클릭 → Bun 으로 빌드 → V8 isolate 에 배포

## 시크릿

없음. 외부 API 호출 없음.

## 사용자 설정 (nesy.app UI 폼, 2개)

| key | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `timezone` | string | `Asia/Seoul` | IANA timezone. 알람 시각·"오늘" 경계 판단 기준 |
| `daily_kcal_reference` | number | `0` | 사용자가 직접 정한 '하루 기준 칼로리'. `0` = 미설정 |

`daily_kcal_reference` 는 **마도서가 계산하지 않는다.** 사용자가 알려준 값을 그대로 저장해, 식단 탭에서 오늘 섭취 합계와 나란히 비교 표시(`today_delta_kcal`)하는 용도일 뿐이다. (기초대사량 자동 계산, 신장/성별/나이 입력, 유지 칼로리 추정 기능은 안전 원칙에 따라 모두 제거되었다.)

## 도구 16개

`set_goal` · `define_exercise` (개별 운동) · `define_routine` (운동을 엮은 루틴 — AI 가 자연어를 blocks 로 구조화) · `update_exercise` (운동 비-구조 필드 patch — baseline_value · memo · next_session_goal · default_* 등) · `update_routine` (루틴 라벨·원문·blocks patch) · `log_workout` (블록·운동·세트별 실행 기록) · `define_schedule` (배치 — 루틴을 요일/순환/자유에 매핑) · `log_activity` · `define_metric` · `record_metric` · `log_meal` (4모드 통합 — 신규 / `id` upsert / `as_preset_slug` 프리셋 등록 / `from_preset_slug` 프리셋 호출) · `define_reminder` · `ack_reminder` · `define_user_fact` · `delete_entity` (정의 7종 + 기록 4종 통합 — exercise/routine_v2/schedule/metric/reminder/fact/meal_preset + meal/measure/workout/activity) · `get_state`

알람 푸시(`check_reminders`)와 위젯(`render_dashboard`)은 도구 매니페스트 외 자동 호출.

> 과거 버전의 조언 엔진(`next_target` 다음값 추천, `suggest_setup` 셋업 템플릿, 능력치 자동 갱신 권유, BMR·유지칼로리 자동 계산)은 안전 원칙 1·2에 따라 **모두 제거**되었다.
