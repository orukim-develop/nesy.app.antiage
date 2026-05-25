# 늙는 속도를 늦추는 마법 (nesy.app.antiage)

호출 AI(Claude / ChatGPT / Gemini)의 외장 기억과 사실 계산기 역할의 nesy.app 마도서. 호출어 `네시, 저속노화` / `네시, 안티에이지` / `네시, Antiage` (호출어는 nesy.app 마켓플레이스 UI에서 관리 — 본 레포 코드와 무관).

운동 · 건강지표 · 식단+알람 · 사용자 사실(4축) 으로 사용자 상태를 저장하고, AI 가 `get_state` 결과(빈 추론 방지 메타 + 사실)에 근거해서만 응답·추천하도록 강제한다. 마도서 본체는 추천하지 않고 데이터 통로와 검증된 공식(progressive overload, target 범위 평가, Mifflin-St Jeor BMR)만 제공.

## 4축 구조

| 축 | 등록 도구 | 용도 |
|---|---|---|
| exercise | `define_routine_exercise` (progressive overload 대상) + `define_split_plan` (분할 계획) + `log_activity` (자유 활동) + `define_user_fact(axis=exercise)` (장비/제약) | 운동 |
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

특수 slug `fact:exercise:min_plate_increment_kg` (value `{ v: 2.5 }`) 가 등록되면 `next_target` 계산 시 compound 무게 운동의 증분 단위로 자동 사용 — 헬스장에 1.25kg 원판이 없을 때 `v: 5` 등으로 등록.

## 운동 진척 축 (progression)

`define_routine_exercise` 는 어떤 축으로 성장할지 `progression` 으로 명시:

| progression | 진척 방향 | 예시 | 기본 증분 | 기본 target_sets |
|---|---|---|---|---|
| `weight` | 무게 ↑ | 스쿼트 100kg → 102.5kg | compound 2.5 / isolation 1.25 (kg) | 3 |
| `time` | 시간 ↓ (낮을수록 좋음) | 4km 기어가기 10분 → 3분 | 30 (초 가정) | 1 |
| `distance` | 거리 ↑ (시간 고정) | 1시간 RowErg 12500m → 13000m | 100 (m 가정) | 1 |
| `reps` | 횟수 ↑ (자체중) | 푸시업 max 20회 → 22회 | 1 | 3 |
| `hold` | 유지 시간 ↑ | 플랭크 60초 → 70초 | 5 (초 가정) | 3 |

**표준 인체 가정 금지** — 다리/팔이 없거나 의수·의족 사용자도 본인이 할 수 있는 형태(예 "기어가기", "한팔 푸시업")를 progression 에 맞게 등록 가능.

## 운동 4단계 사이클

```
① 등록 (define_routine_exercise)
       — 진척축·단위·계획·능력치·메모
       ↓
② 묶음 (define_split_plan, 선택)
       — 요일별 / 순환 / 그룹만
       ↓
③ 실행 (log_routine_session)
       — 세트·RPE·워밍업·디로드·슈퍼셋
       ↓ 코드가 자동
④ 다음 목표 stash (routine.next_session_goal)
       — 자동 source="auto", 디로드 직후엔 갱신 X
       ↓
다음 세션 시 get_state.routines[].next_session_goal 그대로 사용
(memo 변경·새 정보·null 시만 next_target 재호출)
```

사용자가 직접 다음 목표를 지정하고 싶으면 `update_routine_state(slug, next_session_goal={value, note?})` — source="manual" 로 마크. 이후 자동 stash 가 덮어씀.

## working_value — "공식" 현재 능력치

각 루틴은 사용자가 정상적으로 다루는 운동값(`working_value`) 을 저장한다. `next_target` 계산의 **base** — 다음 추천값은 `working_value + (RPE 기반 delta)`. 없으면 직전 본세트 평균이 fallback.

**코드는 자동 갱신 X.** 매 세션 후 `next_target.working_value_recommendation` 이 다음을 알려줌:

```
{
  current_working_value: 100,
  last_session_avg: 95,
  diff: -5,
  suggested_new_value: 95,
  recommend_update: true,
  reason: "직전 본세트 평균이 working_value 보다 낮음 — 능력치 하향 조정 검토 권장."
}
```

`recommend_update=true` 면 AI 가 사용자 발화 언어로 권유 → 합의 시 `update_routine_state(slug, working_value=…)` 호출. 임계값은 `|diff| ≥ default_increment × 0.5`.

워크플로우:

```
log_routine_session → next_target 호출 → working_value_recommendation 확인
                                      ↓ recommend_update=true
                                      AI 가 "현재 능력치를 95kg 으로 갱신할까요?" 권유
                                      ↓ 사용자 합의
                                      update_routine_state(slug, working_value=95)
```

## memo — AI 가 읽는 자유 메모

각 루틴에 1000자 이내 메모. **코드는 파싱 안 함 — AI 가 해석하고 행동에 반영.** 예:

| 메모 | AI 의 반응 |
|---|---|
| "이 머신 무게 단위 7kg (5kg 단위 아님)" | `next_target` 그대로 쓰지 않고 7 배수로 라운드 + `default_increment=7` 도 같이 `update_routine_state` |
| "어깨 부상 회복 중 — 더 증량 X" | RPE 낮아도 증량 추천 보류, 유지 권장 |
| "8월까지 디로드 위주" | `is_deload=true` 로 기록 권장 |

메모와 `next_target` 추천이 충돌하면 **메모 우선**.

## progression_state — get_state 에서 자동 노출

`get_state.routines[]` 각 항목에 다음이 포함됨:

```
progression_state: {
  working_value,        // 등록된 능력치 (없으면 null)
  current_value,        // 직전 비-디로드 세션 본세트 평균
  current_at,
  pr_value,             // 모든 본세트 단일값 중 최댓값 (time 은 최솟값)
  pr_at,
  baseline_value,       // 첫 비-디로드 세션 본세트 평균
  baseline_at,
  direction,            // "increase" | "decrease"
}

next_session_goal: {    // null 또는
  value,                // 다음 세션 추천 숫자
  computed_at,
  source,               // "auto" (log_routine_session 자동 stash) | "manual" (사용자 지정)
  note,                 // manual 일 때만 사용자 메모 (200자)
}
```

디로드 세션·워밍업 세트는 모두 제외. AI 가 진행 상황·정체·후퇴를 한눈에 판단 가능.

## 기록 수정·삭제

마도서는 두 가지 식별자 체계:

| 부류 | id 형식 | 예 |
|---|---|---|
| **정의(definition)** | slug (snake_case) | `squat` / `body_weight_kg` / `morning_glucose` |
| **기록(record)** | 전체 storage key (prefix 포함) | `meal:2026-05-25T08:30:00.000Z:k4j2a9x1` / `session:squat:2026-05-25T18:00:00.000Z:p3l9m2q5` |

기록 id 는 `get_state` 에서 자동 surface:

| 항목 | id 위치 |
|---|---|
| 끼니 | `meals_today.items[].id` |
| 최근 측정 | `metrics[].latest_id` |
| 최근 세션 | `routines[].last_session.id` |
| 최근 활동 | `recent_activities[].id` |

### 끼니 수정 — `log_meal` upsert

```
log_meal({ id: "meal:...", name: "점심 (수정)", kcal: 700, ... })
```

`id` 를 함께 넘기면 같은 key 덮어쓰기 (값만 변경). 신규는 `id` 생략.

### 기타 기록 수정·삭제 — `delete_entity`

`measure` / `session` / `activity` 는 별도 update 도구 없음 — `delete_entity({kind, id})` 후 다시 `log_*` 호출.

```
delete_entity({ kind: "session", id: "session:squat:..." })
```

**세션 삭제의 부수 효과**: 해당 routine 의 `next_session_goal` 이 자동 재계산(또는 신호 부족 시 클리어)되어 stale stash 방지. 응답에 `side_effect: { recomputed_next_session_goal_for | cleared_next_session_goal_for }` 포함.

**AI 가 사용자에게 id 노출 금지** — 자연어로만. 예 "아까 등록한 점심(450kcal) 을 600kcal 로 수정할게요" / "오늘 운동 세션 한 건 지울게요".

## 마이그레이션

새 필드(`next_session_goal`) 추가는 **마이그레이션 불필요** — 기존 routine 은 `null` 로 유지되고, 다음 `log_routine_session` 호출 순간 자동 stash 됨. AI 룰이 "null 이면 `next_target` 재호출" 명시하니 호환됨.

기록 id 노출(`meals_today.items[].id` 등) 도 마이그레이션 불필요 — `get_state` 가 storage key 를 그대로 surface, 추가 저장 없음.

### 계획 세트·횟수 (target_sets / target_reps / 범위)

`define_routine_exercise` 는 계획된 구조도 같이 저장:

- `target_sets` — 계획 세트 수. 생략 시 위 표 기본값.
- `target_reps` — 계획 고정 횟수 (예 `5x5` 의 5). progression=weight/reps 에 자연스러움.
- `target_reps_min` / `target_reps_max` — 계획 횟수 범위 (예 8-12). `target_reps` 가 있으면 무시.
- 모두 선택값. 시간/거리/유지시간 진척에서는 보통 횟수 비움.

**축구·테니스·등산을 루틴으로 등록하고 싶을 때** — 가능. 단 progressive overload 가 핵심이라 `progression` 선택은 필수:
- 축구 진행 시간 늘리고 싶다 → `progression=time` (단, time 은 "낮을수록 좋음" 이라 적합 X. 차라리 → `progression=hold` 또는 `distance`)
- 등산 거리·고도 늘리고 싶다 → `progression=distance`
- 테니스 랠리 횟수 늘리고 싶다 → `progression=reps`
- 자유롭게 활동량만 기록하려면 `log_activity` 가 더 자연스러움. AI 가 사용자 의도 확인 후 결정.

위젯 표시 예 — `백 스쿼트 (weight) · 3×5` / `푸시업 (reps) · 3×8-12` / `5km 러닝 (time) · 1세트`.

## RPE — 힘들었음 점수

각 세트 마지막에 1~10 점수로 입력 (높을수록 힘듦). AI 는 사용자에게 RPE 용어 말고 **"힘들었음 점수"** 로 묻는다. `default_rpe_target` (기본 8) 과 비교해서 `next_target` 이 다음 추천값을 계산:

- target 보다 2 이상 낮음 (너무 쉬움) → 2배 증분
- target 이하 (적당) → 1배 증분
- target+1 이하 (살짝 힘듦) → 유지
- target+1 초과 (너무 힘듦) → 1단계 후퇴

`progression=time` 은 방향 반전 — 쉬웠다면 다음엔 더 빠른 시간을 목표로 한다.

## progression 추론과 분리되는 3가지 케이스

운동 메모리(progression weight) 오염을 막기 위해 `log_routine_session` 에는 3가지 분리 장치가 있다:

| 케이스 | 필드 | 효과 |
|---|---|---|
| 워밍업 세트 | `sets[].is_warmup=true` | 그 세트만 `next_target` 평균 계산에서 제외. 이력엔 남음 |
| 디로드 세션 (그날만 가볍게) | `is_deload=true` (세션 레벨) | 세션 통째로 `next_target` 추론 + `weekly_cap` 누계에서 제외 |
| 슈퍼셋/자이언트셋 (여러 운동 묶음) | `superset_group="ss-<rand>"` (세션 레벨, AI 가 키 생성) | 같은 키로 호출된 routine 세션들 묶임. 각 routine progression 은 독립 |

세 경우 모두 progression 메모리에 영향 없음. AI 는 사용자에게 코드값 노출하지 않고 사용자 발화 언어로 자연스럽게 확인 후 내부적으로 변환 — 예 "앞 2세트는 워밍업으로 기록할까요?" / "오늘은 디로드 데이로 기록할게요 — progression 추적엔 영향 없어요" / "벤치+푸시업 슈퍼셋으로 묶을게요".

위젯 표시 예 — `[디로드] 5세트 · 2026-05-25` / `3세트 +W2 · 2026-05-25` (본세트 3 + 워밍업 2) / `5세트 · 2026-05-25 [SS]` (슈퍼셋 묶음).

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

## 도구 16개

`set_goal` · `define_routine_exercise` · `log_routine_session` · `log_activity` · `define_metric` · `record_metric` · `log_meal` (신규 또는 `id` 로 upsert) · `define_reminder` · `ack_reminder` · `define_user_fact` · `define_split_plan` · `update_routine_state` (routine 비-구조 필드 patch — working_value · memo · default_increment · target_* 등) · `delete_entity` (정의 5종 + 기록 4종 통합 — routine/metric/reminder/fact/split_plan + meal/measure/session/activity) · `get_state` · `next_target` · `suggest_setup`

알람 푸시(`check_reminders`)와 위젯(`render_dashboard`)은 도구 매니페스트 외 자동 호출.
