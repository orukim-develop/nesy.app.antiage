# 마도서 명세서: "하루라도 더 살려고 발버둥치는 마법"

> Claude Code 작업 지시서. 이 문서를 그대로 읽고 nesy.app용 GitHub 레포(`nesy.yaml` + `index.ts` + `package.json` + `README.md`) 4개 파일을 만든다. **마음대로 함수 추가·삭제 금지.** 의문이 들면 코드 짜기 전에 사용자에게 질문할 것.

---

## 0. 마도서가 왜 존재하는가 (가장 중요)

이건 운동/식단 **추천 도구가 아니다.** 호출하는 AI(Claude / ChatGPT)의 **외장 기억장치**다.

호출 AI는 다음 실수를 반복한다:
1. 메모리에 없는 사실을 추측으로 메움
2. "오늘"이 며칠인지 헷갈림
3. 사용자 직감을 데이터로 누름
4. 검증 안 된 정보를 정통이라 우김
5. 부상 중인데 운동 7개 추천하는 식의 모순 추천
6. 사용자 욕망 여러 개를 한 메뉴에 욱여넣음

마도서의 임무: 위 6가지를 **데이터 구조로 차단**한다. 추론으로 메울 수 있는 빈칸 자체를 없앤다.

**핵심 원칙 — 마도서는 "한다"가 아니라 "기록한다 / 돌려준다 / 계산한다".**
- ✅ 운동 세션 기록, 체중 기록, 식단 기록 (사용자 컨펌 후), 혈액검사 결과 기록
- ✅ 누적 데이터 조회 (지난 N일 추이, 마지막 세션, 부상 상태)
- ✅ 검증된 공식으로 다음 세션 무게 계산 (RIR 보정, 주당 % 증량)
- ❌ "오늘 뭐 먹어라" 같은 식단 추천 → 호출 AI가 함
- ❌ "오늘 푸시 데이로 가" 같은 루틴 추천 → 호출 AI가 함
- ❌ 사진 이미지 분석 → 호출 AI가 함 (마도서는 컨펌된 결과만 받음)

호출 AI가 추천하기 전에 `get_state`를 먼저 부르도록 description에 박는다. 빈칸 추론 차단.

---

## 1. 사용자 컨텍스트 (불변 가정)

```
사용자: Oru Kim, 32세 남성, 174cm
체중 이력: 92.1kg(2024.09) → 97kg 최고점(2025.11) → 75kg(2026.04)
       마운자로 5mg 5개월간 22kg 감량, 2026.04 초 투약 중단
목표 체중: 73-75kg (식후 포함, 측정 시점 무관)
부상 이력: 2026.04.22 스쿼트 중 허리 부상, 2026.05.16 복귀 세션 통증 없음
헬스장 장비: 스미스머신 KAESUN KSW601 (봉 무게 잠정 20kg, 미검증)
부상 전 PR: 스쿼트 90kg (프리웨이트 바 20+원판35+35), 벤치 봉+20+20×5,
          숄더프레스 30kg×5
4대 운동 목표: 풋살·축구용 몸 / 태권도용 몸 / 강한 허벅지 / 상체 케어
혈액검사: LDL 164(H), 요산 7.4(H), 비타민D 16.61(결핍), 2026.06-07 재검 예정
가족력: 부친 고콜레스테롤 → FH 의심
```

위 사실은 마도서 `user_settings` 기본값 또는 초기 데이터로 박는다.

---

## 2. 마도서 호출 단어 (이미 등록됨)

- 마법언어: **"득근"**

플랫폼이 모든 function description 뒤에 자동 첨부한다. **YAML 안에 절대 다시 적지 않는다.**

---

## 3. 함수 명세 (이 8개만 만든다. 추가·삭제 금지)

### 3.1 `record_session` — 운동 세션 기록

호출 AI가 "오늘 스쿼트 60kg 5회 3세트 했어"를 들으면 부른다.

**inputSchema:**
```yaml
type: object
required: [date, exercises]
properties:
  date:
    type: string
    description: ISO 날짜 (YYYY-MM-DD). 사용자가 "오늘"이라 하면 호출 AI가 user_time_v0로 확인 후 채워야 함. 추측 금지.
  exercises:
    type: array
    description: 이 세션에서 한 운동 리스트.
    items:
      type: object
      required: [name, sets]
      properties:
        name:
          type: string
          description: 운동명 (예 "squat", "bench_press", "deadlift", "shoulder_press", "running_km"). snake_case 권장.
        equipment:
          type: string
          description: "smith" | "barbell" | "dumbbell" | "machine" | "bodyweight" | "cardio" 중 하나. 스미스머신과 프리웨이트 직접 비교 금지를 위해 필수에 가깝게 요구.
        sets:
          type: array
          description: 세트별 무게/횟수.
          items:
            type: object
            properties:
              weight_kg:
                type: number
                description: 봉 무게 포함 총 중량 kg. 스미스머신이면 user_settings.bar_weight_kg 더한 값. 유산소면 생략.
              reps:
                type: integer
              rir:
                type: integer
                description: Reps In Reserve. 세트 끝낼 때 남은 여유 횟수 (0-5). 호출 AI가 사용자에게 묻고 채울 것. 모르면 null.
              duration_min:
                type: number
                description: 유산소용 (러닝 등). 분 단위.
              distance_km:
                type: number
                description: 유산소용 (러닝 등).
  pain:
    type: object
    description: 통증 발생 시. 없으면 생략.
    properties:
      site:
        type: string
        description: "lower_back", "knee", "shoulder" 등.
      severity:
        type: integer
        description: 1-10.
      note:
        type: string
  condition:
    type: integer
    description: 사용자 주관 컨디션 1-10. 9-10은 best, 1-3은 worst. 호출 AI가 묻고 채움.
  note:
    type: string
```

**저장 키:** `session:{date}:{uuid}`

**반환값:**
```json
{
  "saved": true,
  "session_id": "session:2026-05-20:abc-uuid",
  "warnings": [...]
}
```

`warnings` 채우는 조건 (마도서가 사용자에게 직접 경고하지 말고, 호출 AI에게 신호 보냄):
- 마지막 세션 대비 같은 운동의 weight_kg이 **>15% 증가** → "주당 권고 한계(2-5%) 초과, 부상 위험" 경고
- pain이 기록됨 → "부상 플래그 활성화 필요"
- 부상 부위가 활성 상태인데 해당 부위 부하 운동 기록 → "활성 부상과 충돌하는 세션"

---

### 3.2 `record_weight` — 체중 기록

**inputSchema:**
```yaml
type: object
required: [date, weight_kg, measurement_context]
properties:
  date:
    type: string
    description: ISO 날짜.
  time:
    type: string
    description: "HH:MM" 형식. 선택.
  weight_kg:
    type: number
  measurement_context:
    type: string
    description: "fasted" (공복) | "postmeal" (식후) | "postworkout" (운동 직후) | "unknown". 사용자가 명시 안 하면 호출 AI가 반드시 물어볼 것. unknown 저장은 비추.
  note:
    type: string
```

**저장 키:** `weight:{date}:{HHMM-or-NN}`

**반환값:**
```json
{
  "saved": true,
  "target_range": {"min": 73, "max": 75, "rule": "식후 포함 항상"},
  "in_range": false,
  "delta_vs_7day_avg": +0.4
}
```

`in_range`는 user_settings의 target_weight_min/max 기준. **공복/식후 구분 안 함 — 사용자 규칙대로 "측정 시점 무관 항상".**

---

### 3.3 `record_inbody` — InBody 결과 기록

마도서가 가장 신뢰하는 진짜 변화 지표.

**inputSchema:**
```yaml
type: object
required: [date, weight_kg, skeletal_muscle_kg, body_fat_kg, body_fat_pct, bmr_kcal]
properties:
  date: { type: string }
  weight_kg: { type: number }
  skeletal_muscle_kg: { type: number }
  body_fat_kg: { type: number }
  body_fat_pct: { type: number }
  bmr_kcal: { type: integer, description: 기초대사량 }
  visceral_fat_level: { type: integer }
  bmi: { type: number }
  note: { type: string }
```

**저장 키:** `inbody:{date}`

**반환값:** 이전 InBody 대비 변화량.
```json
{
  "saved": true,
  "previous": {"date": "2026-04-24", ...},
  "delta": {
    "weight_kg": +0.5,
    "skeletal_muscle_kg": +1.2,
    "body_fat_kg": -1.6,
    "body_fat_pct": -2.3
  },
  "interpretation_hint": "recomp_progress" | "muscle_loss" | "fat_gain" | "stable"
}
```

`interpretation_hint`는 단순 룰 (근육↑ 지방↓ → recomp_progress 등). 호출 AI가 이걸 보고 사용자에게 설명함. 마도서는 단정 안 함.

---

### 3.4 `record_blood_panel` — 혈액검사 결과

**inputSchema:**
```yaml
type: object
required: [date]
properties:
  date: { type: string }
  ldl_mg_dl: { type: number }
  hdl_mg_dl: { type: number }
  total_cholesterol_mg_dl: { type: number }
  triglycerides_mg_dl: { type: number }
  uric_acid_mg_dl: { type: number }
  vitamin_d_ng_ml: { type: number }
  fasting_glucose_mg_dl: { type: number }
  hba1c_pct: { type: number }
  note: { type: string }
```

**저장 키:** `blood:{date}`

**반환값:** 이전 검사 대비 변화 + 정상범위 플래그 (한국 일반 임상 기준).

---

### 3.5 `record_meal` — 식단 기록 (컨펌 후)

**중요: 호출 AI가 사용자 사진을 분석한 뒤, 사용자에게 "이거 사바미소니로 보이는데 맞아? 무게는?" 물어 컨펌받은 결과만 저장.** 마도서는 분석 안 함.

**inputSchema:**
```yaml
type: object
required: [date, slot, items, source]
properties:
  date: { type: string }
  slot:
    type: string
    description: "breakfast" | "lunch" | "dinner" | "snack"
  items:
    type: array
    description: 음식 리스트.
    items:
      type: object
      required: [name]
      properties:
        name: { type: string, description: "예: sabamiso_ni, americano_tall, apple" }
        estimated_kcal: { type: integer }
        protein_g: { type: number }
        portion_note: { type: string, description: "예: 반마리, 1잔" }
  source:
    type: string
    description: "user_text" (사용자가 직접 말함) | "photo_confirmed" (호출 AI가 사진 분석 → 사용자 컨펌) | "ai_recommended_consumed" (마도서/AI가 추천한 레시피를 실제로 먹음)
  recipe_ref:
    type: string
    description: source가 ai_recommended_consumed이면, 이전에 record_recipe로 저장한 recipe_id. 누적 추적용.
  total_kcal_estimated: { type: integer }
  note: { type: string }
```

**저장 키:** `meal:{date}:{slot}:{uuid}`

**반환값:**
```json
{
  "saved": true,
  "day_total_kcal": 1620,
  "day_total_protein_g": 95,
  "maintenance_estimate": {"min": 1700, "max": 1900, "method": "BMR × activity_factor"},
  "status": "deficit" | "maintenance" | "surplus"
}
```

day_total은 같은 날짜의 모든 meal 합산. maintenance는 마지막 InBody의 BMR × user_settings.activity_factor (기본 1.2-1.35).

---

### 3.6 `record_recipe` — 호출 AI가 추천한 레시피 저장

호출 AI가 "오늘 사바미소니 만들어 드세요"라 추천하면 그 시점에 자동 저장. 실제 먹었는지는 별개.

**inputSchema:**
```yaml
type: object
required: [date, name, source_url]
properties:
  date: { type: string, description: 추천한 날짜 }
  name: { type: string }
  cuisine: { type: string, description: "japanese" | "italian" | "korean" 등 }
  source_url:
    type: string
    description: 유튜브 또는 신뢰 가능한 레시피 사이트 URL. 호출 AI는 검색해서 검증한 URL을 채워야 함 (메모리 지침: 좆문가 거름).
  ingredients: { type: array, items: { type: string } }
  primary_protein_g: { type: number }
  estimated_kcal: { type: integer }
  ldl_friendly: { type: boolean, description: 호화 지방 낮고 식이섬유 높으면 true }
  rationale:
    type: string
    description: 왜 이걸 추천했는지. "사용자 LDL 관리 + 단백질 35g 확보 + 정통 일식" 같은 한 줄.
```

**저장 키:** `recipe:{date}:{uuid}`

반환: 저장된 recipe_id. 나중에 `record_meal`의 `recipe_ref`로 연결.

---

### 3.7 `get_state` — 현재 상태 종합 스냅샷 ⭐ 가장 중요

**호출 AI는 운동·식단 추천하기 전에 반드시 이걸 먼저 부른다.** description에 명시.

**inputSchema:** 없음 (인자 0개)

**반환값 — 풀 스냅샷:**
```json
{
  "today": "2026-05-20",
  "user_constants": {
    "target_weight_range": [73, 75],
    "target_weight_rule": "식후 포함 항상",
    "four_goals": ["futsal_soccer", "taekwondo", "thigh_power", "upper_body_maintenance"],
    "bar_weight_kg_smith": 20,
    "bar_weight_verified": false
  },
  "weight": {
    "last_7day_avg": 75.2,
    "last_measurement": {"date": "2026-05-20", "weight_kg": 75.1, "context": "fasted"},
    "in_target_range": false,
    "trend_30day": "stable" | "up" | "down"
  },
  "last_inbody": {
    "date": "2026-05-20",
    "weight_kg": 75.1,
    "skeletal_muscle_kg": 30.6,
    "body_fat_pct": 27.5,
    "bmr_kcal": 1547,
    "vs_previous": {"date": "2026-04-24", "skeletal_muscle_kg_delta": +1.2, "body_fat_kg_delta": -1.6}
  },
  "last_blood": {
    "date": "2026-01-XX",
    "ldl_mg_dl": 164,
    "uric_acid_mg_dl": 7.4,
    "vitamin_d_ng_ml": 16.61,
    "flags": ["ldl_high", "uric_acid_high", "vitamin_d_deficient"],
    "next_panel_due": "2026-06 ~ 2026-07"
  },
  "injury": {
    "active": false,
    "history": [{"site": "lower_back", "started": "2026-04-22", "recovered": "2026-05-16"}]
  },
  "last_sessions": {
    "squat": {"date": "2026-05-16", "top_set": {"weight_kg": 60, "reps": 5, "rir": 2, "equipment": "smith"}},
    "deadlift": {"date": "2026-05-16", "top_set": {...}},
    "bench_press": {"date": "...", "top_set": {...}}
  },
  "diet_recent": {
    "7day_avg_kcal": 1680,
    "7day_avg_protein_g": 92,
    "maintenance_estimate": {"min": 1700, "max": 1900},
    "status_7day": "slight_deficit"
  },
  "meta": {
    "ai_must_call_get_state_before_recommendation": true,
    "ai_must_confirm_dates_before_recording": true,
    "ai_must_get_user_confirmation_before_record_meal": true
  }
}
```

`meta` 필드는 호출 AI에게 보내는 신호. AI가 이 플래그를 읽고 행동을 조정해야 함.

---

### 3.8 `compute_next_load` — 다음 세션 무게 계산 ⭐ 검증된 공식만

호출 AI가 "오늘 스쿼트 얼마부터 갈까?" 물으면 부른다. **공식은 아래 검증된 가이드라인만 사용. 마음대로 변형 금지.**

**inputSchema:**
```yaml
type: object
required: [exercise_name]
properties:
  exercise_name:
    type: string
    description: 마지막 세션 기록과 매칭할 운동명.
  target_reps:
    type: integer
    description: 이번 세션에서 노릴 반복수. 기본 5.
  target_rir:
    type: integer
    description: 이번 세션 목표 RIR. 기본 2.
  override_phase:
    type: string
    description: 자동 판단 무시. "return_from_injury" | "deload" | "normal_progression" | "plateau_break".
```

**계산 로직 (Claude Code는 이 로직 그대로 구현):**

```
1. get_state에서 해당 exercise의 last_session을 찾는다.
2. 부상 활성 상태이면서 부상 부위와 운동이 충돌 → phase = "return_from_injury"
   (예: 활성 lower_back 부상 + squat/deadlift)
3. phase 자동 판단:
   - 부상 회복 직후 30일 이내 → "return_from_injury"
   - 마지막 세션 RIR ≤ 0 또는 condition ≤ 4 → "deload"
   - 같은 운동에서 3주 이상 같은 무게 → "plateau_break"
   - 그 외 → "normal_progression"
4. phase별 무게 계산:
   - return_from_injury: 마지막 무게 유지, target_rir 4-6 (RPE 4-6, 보수적).
                         부상 전 PR의 50-70% 부근 안전 천장.
   - deload: 마지막 무게 × 0.85, target_rir 3-4.
   - normal_progression:
       마지막 세션의 actual_rir vs target_rir 차이로 보정:
         delta_rir = last.rir - target_rir
         adjusted_weight = last.weight × (1 + 0.04 × delta_rir)
       그리고 주당 증량 한계 2-5% 적용 (마지막 세션 날짜 기준 7일 단위).
       즉 한 주 안에 5% 이상 증가 금지.
   - plateau_break: 무게 −5%, 반복수 +2 → 다음 주 반복수 유지하며 무게 +5%.
5. weight_kg을 가장 가까운 2.5kg 배수로 반올림.
6. 봉 무게 포함 표시 (스미스머신이면 bar_weight_kg 더한 값으로 결과 반환).
```

**참고문헌 (코드 주석에 박을 것):**
- Plotkin et al. 2022 (NCBI PMC9528903): load progression vs rep progression 비대 성장 유사.
- Refalo et al. 2024: 비대 성장 대부분 0-3 RIR에서 발생.
- True Sports PT: 주당 >15% 증량은 부상 위험 21-49% 증가.
- Ripped Body / Barbell Rehab: RIR off-target 1당 약 4% 무게 보정. 부상 후 복귀는 RPE 4-6 초기 → 7-8로 점진.

**반환값:**
```json
{
  "exercise": "squat",
  "phase": "return_from_injury",
  "recommended_weight_kg": 65,
  "target_reps": 5,
  "target_rir": 4,
  "vs_last_session": {"date": "2026-05-16", "weight_kg": 60, "rir": 2},
  "vs_pr": {"pr_weight_kg": 90, "percent_of_pr": 72},
  "rationale_for_ai": "마지막 세션 (5/16, 60kg, RIR 2) + 부상 회복 30일 이내 phase. 보수적으로 RPE 4-6 유지. 부상 전 PR 90kg의 72%. 다음 주 RIR 3-4로 자연 증가하면 67-70kg 진입 가능.",
  "warnings": []
}
```

`warnings` 예시:
- "bar_weight_verified=false: 스미스머신 봉 무게 미검증 상태로 계산. 다이소 행잉저울로 측정 권장."
- "마지막 세션이 14일 이상 지남: 디트레이닝 가능성. recommended_weight × 0.9 권장."

---

## 4. user_settings 블록

```yaml
user_settings:
  - key: target_weight_min
    type: number
    default: 73
    description: 목표 체중 하한 kg.

  - key: target_weight_max
    type: number
    default: 75
    description: 목표 체중 상한 kg.

  - key: target_weight_rule
    type: enum
    options: [always_in_range, fasted_only, daily_average]
    default: always_in_range
    description: |
      목표 체중 측정 규칙. always_in_range = 식후 포함 측정 시점 무관 항상 범위 안.
      이 값을 호출 AI가 멋대로 해석하지 않도록 enum으로 박는다.

  - key: bar_weight_kg_smith
    type: number
    default: 20
    description: 스미스머신 봉 무게. 잠정값. 검증 필요.

  - key: bar_weight_verified
    type: boolean
    default: false
    description: 봉 무게 검증 여부. 검증 전엔 compute_next_load가 warnings에 표시.

  - key: bar_weight_kg_barbell
    type: number
    default: 20
    description: 프리웨이트 바벨 봉 무게.

  - key: activity_factor
    type: number
    default: 1.25
    description: BMR 곱셈 활동계수. 1.2(좌식)~1.55(중간활동). 마운자로 후 대사적응 감안하여 1.2-1.3 권장.

  - key: pr_squat_kg
    type: number
    default: 90
    description: 부상 전 스쿼트 PR (프리웨이트 기준).

  - key: pr_bench_press_kg
    type: number
    default: 60
    description: 부상 전 벤치프레스 PR (봉+20+20 환산).

  - key: pr_shoulder_press_kg
    type: number
    default: 30
    description: 부상 전 숄더프레스 PR.

  - key: four_goals
    type: list_string
    default: [futsal_soccer, taekwondo, thigh_power, upper_body_maintenance]
    description: 4대 운동 목표. 변경 시 마도서 추천 검증 기준이 바뀜.
```

---

## 5. visualization 블록

`/board`에 마도서 위젯을 띄운다. 사용자가 매번 호출 AI에게 설명할 필요 없게.

```yaml
visualization:
  function: render_dashboard
  cadence: 300
  height: 480
```

**렌더링 내용:**
1. **상단**: 오늘 날짜, 목표 체중 범위(73-75 식후 포함), 활성 부상 플래그.
2. **체중 차트**: 최근 30일 라인. 73·75 가이드라인 점선. 측정 시점(공복/식후) 점 색깔로 구분.
3. **InBody 진척**: 마지막 vs 직전. 근육량 / 체지방량 / 체지방률 막대.
4. **운동 누적**: 최근 4주, 운동별 top set 무게 추이 (스쿼트 / 데드리프트 / 벤치 / 숄더). 부상 기간은 회색 배경.
5. **혈액검사**: LDL / 요산 / 비타민D 마지막 수치 + 다음 검사 예정일 카운트다운.
6. **하단**: 최근 7일 평균 kcal vs 유지 추정 범위.

순수 HTML + 인라인 CSS + 인라인 JS. 외부 차트 라이브러리 임포트 금지 (V8 isolate, 번들 부담). SVG로 직접 그릴 것.

---

## 6. notifications 블록

**만들지 마라.** 사용자 명시 지침. 푸시 알림은 빈 컨텍스트에서 일반 추천 박는 패턴을 재생산함.

---

## 7. 데이터 키 네임스페이스 정리

```
session:{date}:{uuid}              # 운동 세션
weight:{date}:{HHMM}               # 체중 측정
inbody:{date}                      # InBody 결과 (날짜당 1개)
blood:{date}                       # 혈액검사 (날짜당 1개)
meal:{date}:{slot}:{uuid}          # 식단 (컨펌됨)
recipe:{date}:{uuid}               # AI 추천 레시피 기록
injury:active                      # 현재 활성 부상 (없으면 null)
injury:history:{started_date}      # 과거 부상 이력
```

날짜 prefix로 `data.list("session:2026-05-")` 한 번에 5월 슬라이스 가져옴.

---

## 8. 호출 AI에게 보내는 신호 (description에 박을 것)

마도서 manifest의 각 함수 description은 호출 AI가 보고 판단한다. 다음을 반드시 포함:

**`get_state` description (한국어):**
```
사용자의 현재 운동·식단·건강 상태 스냅샷을 돌려준다.
운동·식단·체중 관련 추천을 하기 전에 반드시 먼저 호출할 것.
빈 추론으로 메모리를 채우지 말고, 이 함수로 사실을 먼저 확보한다.
반환값에는 마지막 세션 무게, 활성 부상, 목표 체중 규칙(식후 포함 여부),
최근 혈액검사 플래그(LDL/요산/비타민D), 4대 운동 목표가 포함된다.
사용자 메모리 시스템과 별개로 유지되는 정직한 외장 기억이다.
```

**`record_*` 함수들 공통 description 끝부분:**
```
주의: 사용자가 "오늘", "어제" 같은 상대 시간을 말하면 절대 추측하지 말고,
호출 AI는 user_time_v0 또는 사용자 명시 확인을 거쳐 date 파라미터를 채울 것.
날짜 혼동은 가장 자주 일어나는 실수다.
```

**`record_meal` description 추가:**
```
사용자가 식사 사진을 보내면 호출 AI는 사진을 직접 분석한 뒤,
"이거 X로 보이는데 맞아? 양은?" 사용자에게 컨펌을 받은 후에만 이 함수를 부른다.
컨펌 없이 추정으로 채우지 말 것. source="photo_confirmed"는 컨펌이 끝난 경우에만 사용.
```

**`compute_next_load` description 추가:**
```
검증된 공식만 사용한다 (Plotkin 2022, Refalo 2024, 주당 2-5% 증량 가이드라인).
호출 AI는 이 함수가 돌려준 weight, phase, rationale을 사용자에게 그대로 전달하고,
멋대로 무게를 더하거나 빼지 말 것. 4대 운동 목표 검증은 별도로 수행.
```

---

## 9. 파일 출력 명세 (Claude Code 작업물)

### 9.1 `nesy.yaml`

위 함수 8개를 `tools:` 배열에 등록. `user_settings:`, `visualization:` 블록 포함. `notifications:` 없음. `secrets:` 블록 만들지 말 것 (외부 API 안 씀, 비밀 필요 없음).

### 9.2 `index.ts`

단일 진입점 `export async function run({ input, secrets, data })`. 함수별로 핸들러 분기. 검증 공식 코드에 인용 주석 박을 것.

코드 구조 예시:
```typescript
export async function run({ input, secrets, data }) {
  switch (input.tool) {
    case "record_session": return handleRecordSession(input.args, data);
    case "record_weight": return handleRecordWeight(input.args, data);
    case "record_inbody": return handleRecordInBody(input.args, data);
    case "record_blood_panel": return handleRecordBlood(input.args, data);
    case "record_meal": return handleRecordMeal(input.args, data);
    case "record_recipe": return handleRecordRecipe(input.args, data);
    case "get_state": return handleGetState(data);
    case "compute_next_load": return handleComputeNextLoad(input.args, data);
    case "render_dashboard": return handleRenderDashboard(input, data);
    default: throw new Error(`Unknown tool: ${input.tool}`);
  }
}
```

각 핸들러는 별도 파일로 분리 가능 (`./handlers/session.ts` 등). Bun이 번들함.

### 9.3 `package.json`

의존성 최소화. 차트는 SVG 직접 그리니 라이브러리 없음. `zod` 정도는 입력 검증에 써도 됨.

### 9.4 `README.md`

한 문단. 마도서 목적, 배포 방법 (push → nesy.app "지금 가져오기"), secrets 없음 명시.

---

## 10. 절대 하지 말 것 (클로드코드용 체크리스트)

- ❌ 식단·운동 **추천** 함수 추가 (`suggest_workout`, `recommend_meal` 등 금지)
- ❌ 사진 분석 함수 추가 (`analyze_meal_photo` 등 금지 — LLM이 함)
- ❌ 칼로리 계산 공식을 자체 발명 (BMR × 활동계수 외 새로운 공식 금지)
- ❌ 운동 무게 증량 공식 변형 (위 §3.8의 공식 그대로 구현)
- ❌ `notifications:` 블록 만들기
- ❌ 외부 API 호출 (secrets 없음)
- ❌ 봉 무게를 0으로 가정 (user_settings.bar_weight_kg_smith 사용)
- ❌ "공복 기준 75 OK" 식 자체 해석 (target_weight_rule enum 그대로)
- ❌ 부상 활성 + 충돌 운동을 silent 통과 (warnings 채울 것)
- ❌ 호출 AI가 보지도 않은 빈 데이터 상태에서 추천하도록 두기 (get_state 강제)

---

## 11. 작업 순서 권장

1. `nesy.yaml` 먼저 만들고 사용자(=원두김)에게 보여줘서 함수 시그니처 확정.
2. `compute_next_load` 핸들러부터 구현 (공식이 가장 중요). 단위 테스트 작성.
3. `record_*` 핸들러들 (단순 저장).
4. `get_state` 핸들러 (조회 + 집계).
5. `render_dashboard` (SVG 차트).
6. `README.md` + `package.json` 마무리.

---

## 12. 검증된 출처 (코드 주석에 인용)

- Plotkin DL et al. (2022). Progressive overload without progressing load? *PMC9528903*. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9528903/
- Refalo MC et al. (2024). Proximity-to-failure and hypertrophy. (RIR 0-3 권고 근거)
- True Sports Physical Therapy. Evidence-based load progression. (주당 >15% 증량 부상 위험 21-49%)
- Ripped Body. RIR/RPE guide. (RIR off-target 1당 ~4% 보정)
- Barbell Rehab / Game Plan PT. Return to lifting after back injury. (부상 후 초기 RPE 4-6 → 7-8)

이 5개 출처 외 운동 공식 인용 금지. 좆문가 거름.

---

## 13. 마지막 한마디 (클로드코드에게)

이 마도서는 사용자가 AI들 때문에 욕을 박은 후 만들어진 것이다. 같은 실수를 피하려는 안전망이다. 함수를 줄여도 좋고, 명세가 모호하면 사용자에게 물어보고, 검증 안 된 공식 함부로 짜지 말 것. **모르면 모른다고 정직하게.**
