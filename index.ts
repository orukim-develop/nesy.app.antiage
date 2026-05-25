type Data = {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  list: (prefix?: string, limit?: number) => Promise<Array<{ key: string; value: any; updated_at: string }>>;
};

const FACT_AXES = ["exercise", "health_metric", "diet_reminder", "baseline"] as const;
type FactAxis = typeof FACT_AXES[number];

const PROGRESSIONS = ["weight", "time", "distance", "reps", "hold"] as const;
type Progression = typeof PROGRESSIONS[number];

const SPLIT_KINDS = ["weekly", "sequence", "freestyle"] as const;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const AI_RULES = [
  "응답·추천 전 반드시 get_state 호출.",
  "goal 이 비어있으면 set_goal 부터.",
  "사용자가 명시한 항목만 등록 — 임의 등록 금지.",
  "빈 추론으로 추천 금지 — 사실(get_state 결과)에 근거.",
  "시각·날짜는 settings.timezone 기준 — 추측 금지.",
  "의학적 진단·처방 흉내 금지.",
  "응답 전 goal 문장을 다시 읽고 사용자 발화와 정합성 검증.",
  "★ 사용자 앞 발화는 사용자 발화 언어 그대로의 자연어로. 한국어 화자면 한국어, 영어 화자면 영어, 다른 언어면 그 언어. slug, snake_case 식별자, JSON 키, 도구 이름(define_*/log_* 등), axis/progression/kind 의 영어 코드값(exercise/health_metric/weight/time/weekly 등) 절대 노출 금지. 도구 호출은 내부에서만, 사용자에겐 자연어 라벨/display_name 으로 풀어쓴다. 위반 시 사용자가 '코드처럼 말한다' 며 신뢰 잃음.",
  "user_fact 등록 전 사용자 발화 언어로 분류 의도 명시 후 합의 (영문 axis 값 노출 금지). 축 자연어 표현 예시 — 한국어: exercise='운동 환경/장비/제약', health_metric='건강 관련 정보(알레르기·복용약·만성질환 등)', diet_reminder='식단 제약/알람 관련', baseline='기본 정보(직업·수면·생활패턴 등)'. 영어: exercise='workout environment/equipment/constraints', health_metric='health-related info (allergies, meds, conditions)', diet_reminder='diet constraints / reminders', baseline='baseline info (job, sleep, lifestyle)'. 다른 언어는 의미 보존하며 그 언어로 자연 번역. 좋은 예(한): '이거 운동 환경 정보로 저장할게요 — 헬스장 최소 증분 2.5kg' / 좋은 예(영): 'Logging this as workout environment — gym minimum plate increment 2.5kg' / 나쁜 예: 'exercise 카테고리에 min_plate_increment_kg 으로 넣을게요'.",
  "축이 모호하면 두 선택지를 사용자 발화 언어로 풀어서 직접 질문 — AI 단독 결정 금지.",
  "BMR 은 별도 metric 등록 불필요 — height_cm/sex/birth_year + body_weight_kg 측정으로 자동 계산되어 derived 에 들어옴.",
  "운동 등록 시 진척 축 사용자 발화 언어로 자연스럽게 합의 — 무게↑ / 시간↓ / 거리↑ / 횟수↑ / 유지시간↑ 중 어느 축인지 (한국어 예 '무게 늘리기 / 시간 줄이기 / 거리 늘리기 / 횟수 늘리기 / 유지 시간 늘리기', 영어 예 'add weight / cut time / extend distance / more reps / longer hold'). 'progression=weight' 같이 코드값 노출 금지. 표준 인체 가정 금지 — 다리/팔 없는 사용자도 본인이 가능한 형태(기어가기 등) 등록 가능.",
  "운동 등록 시 계획된 세트수·횟수(또는 범위) 사용자 발화 언어로 함께 합의 — 무게/횟수 진척이면 횟수도 같이(한국어 예 '3세트 5회' 또는 '3세트 8~12회 범위', 영어 예 '3 sets of 5 reps' 또는 '3 sets of 8-12 reps'), 시간/거리/유지시간 진척이면 세트수만 자연스럽게 (보통 1세트). 'target_sets=3' 같이 코드값 노출 금지. 사용자가 묻지 않으면 기본값 사용 OK.",
  "진척 추적 대상 vs 자유 활동 분류 모호하면 사용자 발화 언어로 직접 질문 (한국어 예 '이거 진척 추적할까요, 아니면 그냥 활동 기록만 할까요?', 영어 예 'Track this as progression, or just log it as an activity?'). 축구·테니스·등산 같은 스포츠는 보통 log_activity 가 자연스럽지만, 사용자가 '시간 늘리기' / '거리 늘리기' 같은 축으로 진척 추적 원하면 적절한 progression 으로 루틴 등록도 가능 — 사용자 의도 확인 후.",
  "RPE 는 1~10 (높을수록 힘듦) — 사용자에게는 RPE 용어 노출 금지, 사용자 언어로 풀어 묻기 (한국어 '힘들었음 점수', 영어 'how hard it felt (1-10)').",
  "세션 기록 시 progression 추론과 분리되는 3가지 케이스 자동 인지 — (a) 워밍업 세트는 sets[].is_warmup=true (b) 컨디션 안 좋아 그날만 가볍게 한 디로드 세션은 is_deload=true (c) 여러 운동을 한 묶음으로 한 슈퍼셋/자이언트셋은 같은 superset_group 키 ('ss-<짧은랜덤>' 형식, AI 가 생성) 로 묶을 routine 들 각각 log_routine_session. 모두 next_target 추론에서 자동 제외/분리되어 운동 메모리(progression weight) 오염 안 됨. 사용자에게는 코드값/필드명 노출 금지, 사용자 발화 언어로 자연스럽게 확인 — 한국어 예 '앞 2세트는 워밍업으로 기록할까요?' / '오늘은 디로드 데이로 기록할게요 — progression 추적엔 영향 없어요' / '벤치+푸시업 슈퍼셋으로 묶을게요'. 영어 예 'Mark the first 2 sets as warmup?' / 'Logging today as a deload — won\\'t affect progression' / 'Grouping bench+pushup as a superset'.",
  "★ 운동은 4단계 사이클 — ① 등록(define_routine_exercise) → ② 묶음(define_split_plan, 선택) → ③ 실행(log_routine_session) → ④ 비교+다음 목표(routine.next_session_goal). log_routine_session 직후 코드가 자동으로 next_target 계산해서 routine.next_session_goal 에 stash (디로드 세션 직후는 갱신 X, 기존 stash 유지). 다음 세션 계획 시 next_target 다시 호출 X — get_state.routines[].next_session_goal 그대로 사용. 단 (a) memo 가 바뀌었거나 (b) 사용자가 새 정보(부상·컨디션 등) 를 줬거나 (c) stash 가 null 이면 next_target 재호출. 사용자가 직접 '다음엔 무조건 X 도전' 같이 목표 지정하면 update_routine_state 의 next_session_goal patch (source=manual 로 자동 마크).",
  "★ working_value 는 사용자의 '공식 현재 능력치' — next_target 계산의 base. 코드는 자동 갱신 X. 세션 기록 직후 next_target 호출 시 working_value_recommendation.recommend_update=true 가 뜨면 (예 '직전 본세트 평균이 working_value 보다 큼') 반드시 사용자에게 사용자 발화 언어로 묻고 합의 받은 뒤 update_routine_state 호출 — 한국어 예 '오늘 100kg 3세트 무난히 했어요. 현재 능력치를 100kg 으로 갱신할까요?' / 영어 예 'You handled 100kg × 3 cleanly today. Update your working value to 100kg?'. 합의 없이 자동 갱신 금지. 'working_value' 같은 영어 코드값 노출 금지 — '현재 능력치' / 'working value' / 'standard weight' 처럼 자연어로.",
  "★ 운동 계획·다음 세트 추천 시 routine.memo 반드시 먼저 읽고 반영. 메모는 자유 텍스트 — AI 가 해석. 예 '이 머신은 7kg 단위로만 증량' 이면 next_target 그대로 쓰지 말고 7kg 배수로 라운드 + default_increment 도 7로 update_routine_state. '어깨 부상 회복 중 — 더 증량 X' 면 RPE 가 낮아도 증량 추천하지 말 것. '8월까지 디로드 위주' 면 is_deload 권장. 메모와 next_target 추천이 충돌하면 메모가 우선. 메모 등록/수정 시 코드값 노출 금지 — '루틴 메모' / 'routine memo' 처럼 자연어로 합의 후 update_routine_state 호출.",
  "분할 등록 시 종류 사용자 발화 언어로 자연스럽게 합의 — 요일별 / 순환 / 그룹만 정해두고 매번 골라하기 (한국어 예 '요일별(월=가슴/화=등) / 순환(A→B→C→D 순서대로 도는) / 그룹만 정해두고 매번 골라하기', 영어 예 'weekly schedule / rotation cycle / grouped pick-and-choose'). 'weekly/sequence/freestyle' 같이 영어 코드값 노출 금지. 매번 자유롭게 골라하는 체리피커는 분할 등록 안 함.",
];

export async function run({ input, data }: {
  input: { tool: string; args: Record<string, any> };
  secrets: Record<string, string>;
  data: Data;
}): Promise<any> {
  const { tool, args = {} } = input;
  switch (tool) {
    case "set_goal": return setGoal(args, data);
    case "define_routine_exercise": return defineRoutine(args, data);
    case "log_routine_session": return logSession(args, data);
    case "log_activity": return logActivity(args, data);
    case "define_metric": return defineMetric(args, data);
    case "record_metric": return recordMetric(args, data);
    case "log_meal": return logMeal(args, data);
    case "define_reminder": return defineReminder(args, data);
    case "ack_reminder": return ackReminder(args, data);
    case "define_user_fact": return defineUserFact(args, data);
    case "define_split_plan": return defineSplitPlan(args, data);
    case "update_routine_state": return updateRoutineState(args, data);
    case "delete_entity": return deleteEntity(args, data);
    case "get_state": return getState(data);
    case "next_target": return nextTarget(args, data);
    case "suggest_setup": return suggestSetup(data);
    case "check_reminders": return checkReminders(data);
    case "render_dashboard": return renderDashboard(args, data);
    default: throw new Error(`알 수 없는 도구: ${tool}`);
  }
}

async function getSettings(data: Data) {
  const s = await data.get("__settings");
  const sex = typeof s?.sex === "string" && ["male", "female", "unspecified"].includes(s.sex) ? s.sex : "unspecified";
  return {
    timezone: (typeof s?.timezone === "string" && s.timezone) || "Asia/Seoul",
    activity_factor: typeof s?.activity_factor === "number" ? s.activity_factor : 0,
    height_cm: typeof s?.height_cm === "number" ? s.height_cm : 0,
    sex,
    birth_year: typeof s?.birth_year === "number" ? s.birth_year : 0,
  };
}

const nowIso = () => new Date().toISOString();
const shortRand = () => Math.random().toString(36).slice(2, 10);

function dateInTz(tz: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}
function hhmmInTz(tz: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
function weekdayKey(tz: string, date: Date = new Date()): string {
  const wkd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  const map: Record<string, string> = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
  return map[wkd] ?? "mon";
}
const hhmmToMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };

function parseSchedule(schedule: string): string[] {
  const m = String(schedule ?? "").trim().match(/^daily\s+([\d:,\s]+)$/i);
  if (!m) return [];
  return m[1].split(",")
    .map(s => s.trim())
    .filter(s => /^\d{1,2}:\d{2}$/.test(s))
    .map(s => { const [h, mn] = s.split(":"); return `${h.padStart(2, "0")}:${mn}`; });
}

const mean = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
const nonNull = <T,>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const sumOrNull = (arr: (number | null | undefined)[]): number | null => {
  const nums = arr.filter((x): x is number => typeof x === "number");
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
};
const escapeHtml = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>
)[c]);

function evalTarget(value: number, min: number | null, max: number | null): boolean | null {
  if (min !== null && max !== null) return value >= min && value <= max;
  if (min !== null) return value >= min;
  if (max !== null) return value <= max;
  return null;
}

function computeMifflinStJeor(weight_kg: number, height_cm: number, age: number, sex: string): number | null {
  if (!Number.isFinite(weight_kg) || weight_kg <= 0) return null;
  if (!Number.isFinite(height_cm) || height_cm <= 0) return null;
  if (!Number.isFinite(age) || age <= 0) return null;
  if (sex !== "male" && sex !== "female") return null;
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

async function computeDerived(settings: any, data: Data) {
  const currentYear = new Date().getFullYear();
  const age = settings.birth_year > 0 ? currentYear - settings.birth_year : null;
  const baseEmpty = { age, bmr: null, bmr_source: null, maintenance_kcal: null };

  if (settings.height_cm <= 0) return baseEmpty;
  if (age === null) return baseEmpty;
  if (settings.sex !== "male" && settings.sex !== "female") return baseEmpty;

  const measurements = (await data.list("measure:body_weight_kg:"))
    .map(r => r.value).filter(nonNull)
    .sort((a: any, b: any) => String(a.measured_at).localeCompare(String(b.measured_at)));
  const latest: any = measurements.at(-1);
  if (!latest) return baseEmpty;

  const bmrRaw = computeMifflinStJeor(latest.value, settings.height_cm, age, settings.sex);
  if (bmrRaw === null) return baseEmpty;
  const bmr = Math.round(bmrRaw);
  const maintenance_kcal = settings.activity_factor > 0 ? Math.round(bmr * settings.activity_factor) : null;

  return {
    age,
    bmr,
    bmr_source: {
      formula: "Mifflin-St Jeor",
      weight_kg: latest.value,
      height_cm: settings.height_cm,
      age,
      sex: settings.sex,
      measured_at: latest.measured_at,
    },
    maintenance_kcal,
  };
}

async function setGoal(args: any, data: Data) {
  const text = String(args.text ?? "").trim();
  if (!text) throw new Error("text 필수.");
  if (text.length > 500) throw new Error("text 는 500자 이내.");
  const goal = { text, updated_at: nowIso() };
  await data.set("goal", goal);
  return { goal };
}

function defaultTargetSets(progression: string): number {
  if (progression === "time" || progression === "distance") return 1;
  return 3; // weight, reps, hold
}

function parsePositiveInt(v: any, field: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${field} 는 1 이상의 정수.`);
  }
  return n;
}

async function defineRoutine(args: any, data: Data) {
  const slug = String(args.slug ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error("slug 는 snake_case (소문자/숫자/_).");
  const display_name = String(args.display_name ?? "").trim();
  if (!display_name) throw new Error("display_name 필수.");
  const progression = String(args.progression ?? "weight").trim();
  if (!PROGRESSIONS.includes(progression as Progression)) {
    throw new Error(`progression 은 ${PROGRESSIONS.join(" / ")} 중 하나.`);
  }
  const unit = String(args.unit ?? "").trim();
  if (!unit) throw new Error("unit 필수.");

  let category: string | null = null;
  if (progression === "weight") {
    category = String(args.category ?? "").trim();
    if (!["compound", "isolation"].includes(category)) {
      throw new Error("progression=weight 일 때 category 는 compound 또는 isolation.");
    }
  } else if (args.category) {
    category = String(args.category);
  }

  const target_sets_raw = parsePositiveInt(args.target_sets, "target_sets");
  const target_sets = target_sets_raw ?? defaultTargetSets(progression);
  const target_reps = parsePositiveInt(args.target_reps, "target_reps");
  let target_reps_min = parsePositiveInt(args.target_reps_min, "target_reps_min");
  let target_reps_max = parsePositiveInt(args.target_reps_max, "target_reps_max");
  // 고정값 우선 — target_reps 가 있으면 range 무시
  if (target_reps !== null) {
    target_reps_min = null;
    target_reps_max = null;
  } else if (target_reps_min !== null && target_reps_max !== null) {
    if (target_reps_min > target_reps_max) {
      throw new Error("target_reps_min 은 target_reps_max 이하.");
    }
  } else if ((target_reps_min !== null) !== (target_reps_max !== null)) {
    throw new Error("target_reps_min 과 target_reps_max 는 같이 입력 (둘 다 또는 둘 다 생략).");
  }

  // working_value: 등록 시 초기값 (선택)
  let working_value: number | null = null;
  if (args.working_value !== undefined && args.working_value !== null) {
    const wv = Number(args.working_value);
    if (!Number.isFinite(wv) || wv < 0) throw new Error("working_value 는 0 이상의 숫자.");
    working_value = wv;
  }

  // memo: 자유 텍스트 (선택)
  let memo: string | null = null;
  if (args.memo !== undefined && args.memo !== null && args.memo !== "") {
    const m = String(args.memo);
    if (m.length > 1000) throw new Error("memo 는 1000자 이내.");
    memo = m;
  }

  const routine = {
    slug, display_name, progression, unit, category,
    default_rpe_target: typeof args.default_rpe_target === "number" ? args.default_rpe_target : 8,
    default_increment: typeof args.default_increment === "number" ? args.default_increment : null,
    weekly_cap: typeof args.weekly_cap === "number" ? args.weekly_cap : null,
    target_sets,
    target_reps,
    target_reps_min,
    target_reps_max,
    working_value,
    memo,
    defined_at: nowIso(),
  };
  await data.set(`routine:${slug}`, routine);
  return { routine };
}

async function updateRoutineState(args: any, data: Data) {
  const slug = String(args.slug ?? "").trim();
  if (!slug) throw new Error("slug 필수.");
  const existing = await data.get(`routine:${slug}`);
  if (!existing) throw new Error(`등록되지 않은 운동 slug: ${slug}. define_routine_exercise 먼저.`);

  const patch: Record<string, any> = { ...existing };

  // working_value: number | null
  if ("working_value" in args) {
    if (args.working_value === null) {
      patch.working_value = null;
    } else {
      const wv = Number(args.working_value);
      if (!Number.isFinite(wv) || wv < 0) throw new Error("working_value 는 0 이상의 숫자 또는 null.");
      patch.working_value = wv;
    }
  }

  // memo: string | null (빈 문자열도 클리어 취급)
  if ("memo" in args) {
    if (args.memo === null || args.memo === "") {
      patch.memo = null;
    } else {
      const m = String(args.memo);
      if (m.length > 1000) throw new Error("memo 는 1000자 이내.");
      patch.memo = m;
    }
  }

  // default_increment: number | null
  if ("default_increment" in args) {
    if (args.default_increment === null) {
      patch.default_increment = null;
    } else {
      const di = Number(args.default_increment);
      if (!Number.isFinite(di) || di <= 0) throw new Error("default_increment 는 0 초과 숫자 또는 null.");
      patch.default_increment = di;
    }
  }

  // default_rpe_target: number (1~10)
  if ("default_rpe_target" in args && args.default_rpe_target !== null) {
    const t = Number(args.default_rpe_target);
    if (!Number.isFinite(t) || t < 1 || t > 10) throw new Error("default_rpe_target 은 1~10.");
    patch.default_rpe_target = t;
  }

  // weekly_cap: number | null
  if ("weekly_cap" in args) {
    if (args.weekly_cap === null) {
      patch.weekly_cap = null;
    } else {
      const c = Number(args.weekly_cap);
      if (!Number.isFinite(c) || c < 0) throw new Error("weekly_cap 은 0 이상 또는 null.");
      patch.weekly_cap = c;
    }
  }

  // target_sets
  if ("target_sets" in args && args.target_sets !== null && args.target_sets !== undefined) {
    patch.target_sets = parsePositiveInt(args.target_sets, "target_sets")!;
  }

  // target_reps + range: 같은 규칙 — 고정 우선, 한쪽만 X
  let tr = "target_reps" in args ? args.target_reps : undefined;
  let trMin = "target_reps_min" in args ? args.target_reps_min : undefined;
  let trMax = "target_reps_max" in args ? args.target_reps_max : undefined;

  // 입력된 필드가 하나라도 있으면 셋 다 함께 재계산
  if (tr !== undefined || trMin !== undefined || trMax !== undefined) {
    const newReps = tr === undefined
      ? (typeof existing.target_reps === "number" ? existing.target_reps : null)
      : (tr === null ? null : parsePositiveInt(tr, "target_reps"));
    let newMin = trMin === undefined
      ? (typeof existing.target_reps_min === "number" ? existing.target_reps_min : null)
      : (trMin === null ? null : parsePositiveInt(trMin, "target_reps_min"));
    let newMax = trMax === undefined
      ? (typeof existing.target_reps_max === "number" ? existing.target_reps_max : null)
      : (trMax === null ? null : parsePositiveInt(trMax, "target_reps_max"));

    if (newReps !== null) {
      newMin = null; newMax = null;
    } else if (newMin !== null && newMax !== null) {
      if (newMin > newMax) throw new Error("target_reps_min 은 target_reps_max 이하.");
    } else if ((newMin !== null) !== (newMax !== null)) {
      throw new Error("target_reps_min 과 target_reps_max 는 같이 설정 (둘 다 또는 둘 다 null).");
    }
    patch.target_reps = newReps;
    patch.target_reps_min = newMin;
    patch.target_reps_max = newMax;
  }

  // next_session_goal: { value, note? } | null
  // 사용자 수동 지정 — source="manual" 로 마크. null = 클리어.
  if ("next_session_goal" in args) {
    if (args.next_session_goal === null) {
      patch.next_session_goal = null;
    } else if (typeof args.next_session_goal === "object") {
      const g = args.next_session_goal;
      const v = Number(g.value);
      if (!Number.isFinite(v)) throw new Error("next_session_goal.value 는 숫자.");
      let gnote: string | null = null;
      if (g.note !== undefined && g.note !== null && g.note !== "") {
        const n = String(g.note);
        if (n.length > 200) throw new Error("next_session_goal.note 는 200자 이내.");
        gnote = n;
      }
      patch.next_session_goal = {
        value: v,
        computed_at: nowIso(),
        source: "manual",
        note: gnote,
      };
    } else {
      throw new Error("next_session_goal 은 { value, note? } 또는 null.");
    }
  }

  patch.updated_at = nowIso();
  await data.set(`routine:${slug}`, patch);
  return { routine: patch };
}

function normalizeSet(s: any, progression: string): any {
  const rpe = Number(s.rpe);
  if (!Number.isFinite(rpe) || rpe < 0 || rpe > 10) {
    throw new Error("각 세트의 rpe 는 0~10 사이 숫자 ('힘들었음 점수').");
  }
  const is_warmup = s.is_warmup === true;
  switch (progression) {
    case "weight": {
      const reps = Number(s.reps), weight = Number(s.weight);
      if (!Number.isFinite(reps) || !Number.isFinite(weight)) {
        throw new Error("progression=weight 의 각 세트는 reps/weight 숫자 필수.");
      }
      return { reps, weight, rpe, is_warmup };
    }
    case "time": {
      const time = Number(s.time);
      if (!Number.isFinite(time)) throw new Error("progression=time 의 각 세트는 time 숫자 필수.");
      return { time, rpe, is_warmup };
    }
    case "distance": {
      const distance = Number(s.distance);
      if (!Number.isFinite(distance)) throw new Error("progression=distance 의 각 세트는 distance 숫자 필수.");
      return { distance, rpe, is_warmup };
    }
    case "reps": {
      const reps = Number(s.reps);
      if (!Number.isFinite(reps)) throw new Error("progression=reps 의 각 세트는 reps 숫자 필수.");
      return { reps, rpe, is_warmup };
    }
    case "hold": {
      const hold = Number(s.hold);
      if (!Number.isFinite(hold)) throw new Error("progression=hold 의 각 세트는 hold 숫자 필수.");
      return { hold, rpe, is_warmup };
    }
    default: throw new Error(`알 수 없는 progression: ${progression}`);
  }
}

function setValue(s: any, progression: string): number {
  switch (progression) {
    case "weight": return Number(s.weight);
    case "time": return Number(s.time);
    case "distance": return Number(s.distance);
    case "reps": return Number(s.reps);
    case "hold": return Number(s.hold);
    default: return NaN;
  }
}

function defaultIncrement(progression: string, category: string | null): number {
  if (progression === "weight") return category === "compound" ? 2.5 : 1.25;
  if (progression === "time") return 30;
  if (progression === "distance") return 100;
  if (progression === "reps") return 1;
  if (progression === "hold") return 5;
  return 1;
}

async function logSession(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  const routine = await data.get(`routine:${slug}`);
  if (!routine) throw new Error(`등록되지 않은 운동 slug: ${slug}. define_routine_exercise 먼저.`);
  const sets = Array.isArray(args.sets) ? args.sets : [];
  if (sets.length === 0) throw new Error("sets 1개 이상 필요.");
  const progression = routine.progression || "weight";
  const normalized = sets.map((s: any) => normalizeSet(s, progression));
  const performed_at = String(args.performed_at ?? nowIso());
  const note = args.note ? String(args.note) : undefined;
  const is_deload = args.is_deload === true;
  let superset_group: string | null = null;
  if (args.superset_group !== undefined && args.superset_group !== null && args.superset_group !== "") {
    const sg = String(args.superset_group).trim();
    if (sg.length === 0 || sg.length > 64) throw new Error("superset_group 은 1~64자.");
    superset_group = sg;
  }
  const session: any = { slug, sets: normalized, performed_at, progression, is_deload, superset_group };
  if (note) session.note = note;
  await data.set(`session:${slug}:${performed_at}:${shortRand()}`, session);
  const next = await computeNextTarget(slug, data).catch((e: any) => ({ error: e.message }));

  // 자동 stash — next_session_goal 갱신
  // 디로드 세션 직후엔 갱신 X (직전 본세션 기준 유지). 워밍업만 있던 세션도 갱신 X.
  // next.next_target 이 null 이면 (신호 부족) 갱신 X.
  let next_session_goal_updated = false;
  if (!is_deload && next && typeof (next as any).next_target === "number") {
    const goal = {
      value: (next as any).next_target,
      computed_at: nowIso(),
      source: "auto" as const,
      note: null as string | null,
    };
    const updatedRoutine = { ...routine, next_session_goal: goal, updated_at: nowIso() };
    await data.set(`routine:${slug}`, updatedRoutine);
    next_session_goal_updated = true;
  }

  return { saved: session, next_recommendation: next, next_session_goal_updated };
}

async function logActivity(args: any, data: Data) {
  const name = String(args.name ?? "").trim();
  if (!name) throw new Error("name 필수.");
  const intensity = String(args.intensity ?? "").trim();
  if (!["light", "moderate", "vigorous"].includes(intensity)) {
    throw new Error("intensity 는 light/moderate/vigorous.");
  }
  const duration_minutes = Number(args.duration_minutes);
  if (!Number.isFinite(duration_minutes) || duration_minutes <= 0) {
    throw new Error("duration_minutes 는 양수.");
  }
  const performed_at = String(args.performed_at ?? nowIso());
  const note = args.note ? String(args.note) : undefined;
  const activity: any = { name, intensity, duration_minutes, performed_at };
  if (note) activity.note = note;
  await data.set(`activity:${performed_at}:${shortRand()}`, activity);
  return { saved: activity };
}

async function defineMetric(args: any, data: Data) {
  const slug = String(args.slug ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error("slug 는 snake_case.");
  const display_name = String(args.display_name ?? "").trim();
  if (!display_name) throw new Error("display_name 필수.");
  const unit = String(args.unit ?? "").trim();
  if (!unit) throw new Error("unit 필수.");
  const priority = String(args.priority ?? "").trim();
  if (!["critical", "high", "normal"].includes(priority)) {
    throw new Error("priority 는 critical/high/normal.");
  }
  const metric = {
    slug, display_name, unit, priority,
    target_min: typeof args.target_min === "number" ? args.target_min : null,
    target_max: typeof args.target_max === "number" ? args.target_max : null,
    defined_at: nowIso(),
  };
  await data.set(`metric:${slug}`, metric);
  return { metric };
}

async function recordMetric(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  const metric = await data.get(`metric:${slug}`);
  if (!metric) throw new Error(`등록되지 않은 지표 slug: ${slug}. define_metric 먼저.`);
  const value = Number(args.value);
  if (!Number.isFinite(value)) throw new Error("value 는 숫자.");
  const measured_at = String(args.measured_at ?? nowIso());
  const context = args.context ? String(args.context) : undefined;
  const measurement: any = { slug, value, measured_at };
  if (context) measurement.context = context;
  await data.set(`measure:${slug}:${measured_at}:${shortRand()}`, measurement);

  const all = (await data.list(`measure:${slug}:`))
    .map(r => r.value).filter(nonNull)
    .sort((a: any, b: any) => String(a.measured_at).localeCompare(String(b.measured_at)));
  const prior = all.slice(0, -1);
  const prev = prior[prior.length - 1] ?? null;
  const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
  const last7 = prior.filter((m: any) => new Date(m.measured_at).getTime() >= sevenDaysAgo).map((m: any) => m.value);
  const avg7 = last7.length > 0 ? mean(last7) : null;

  return {
    saved: measurement,
    evaluation: {
      in_target: evalTarget(value, metric.target_min, metric.target_max),
      target_min: metric.target_min,
      target_max: metric.target_max,
      prev_value: prev?.value ?? null,
      prev_measured_at: prev?.measured_at ?? null,
      delta_from_prev: prev ? value - prev.value : null,
      avg_7days: avg7,
      delta_from_avg7: avg7 !== null ? value - avg7 : null,
    },
  };
}

async function logMeal(args: any, data: Data) {
  const name = String(args.name ?? "").trim();
  if (!name) throw new Error("name 필수.");
  const eaten_at = String(args.eaten_at ?? nowIso());
  const meal = {
    name, eaten_at,
    kcal: typeof args.kcal === "number" ? args.kcal : null,
    protein_g: typeof args.protein_g === "number" ? args.protein_g : null,
    carbs_g: typeof args.carbs_g === "number" ? args.carbs_g : null,
    fat_g: typeof args.fat_g === "number" ? args.fat_g : null,
  };
  await data.set(`meal:${eaten_at}:${shortRand()}`, meal);

  const settings = await getSettings(data);
  const today = dateInTz(settings.timezone);
  const todays = (await data.list("meal:"))
    .map(r => r.value).filter(nonNull)
    .filter((m: any) => dateInTz(settings.timezone, new Date(m.eaten_at)) === today);

  const today_totals = {
    count: todays.length,
    kcal: sumOrNull(todays.map((m: any) => m.kcal)),
    protein_g: sumOrNull(todays.map((m: any) => m.protein_g)),
    carbs_g: sumOrNull(todays.map((m: any) => m.carbs_g)),
    fat_g: sumOrNull(todays.map((m: any) => m.fat_g)),
  };

  let maintenance: any = null;
  if (settings.activity_factor > 0) {
    const derived = await computeDerived(settings, data);
    if (derived.bmr !== null && derived.maintenance_kcal !== null) {
      maintenance = {
        bmr: derived.bmr,
        bmr_source: derived.bmr_source,
        activity_factor: settings.activity_factor,
        maintenance_kcal: derived.maintenance_kcal,
        today_delta_kcal: today_totals.kcal !== null ? today_totals.kcal - derived.maintenance_kcal : null,
      };
    }
  }
  return { saved: meal, today_totals, maintenance };
}

async function defineReminder(args: any, data: Data) {
  const id = String(args.id ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error("id 는 snake_case.");
  const kind = String(args.kind ?? "").trim();
  if (!["supplement", "measurement", "action"].includes(kind)) {
    throw new Error("kind 는 supplement/measurement/action.");
  }
  const label = String(args.label ?? "").trim();
  if (!label) throw new Error("label 필수.");
  const schedule = String(args.schedule ?? "").trim();
  if (parseSchedule(schedule).length === 0) {
    throw new Error("schedule 형식: 'daily HH:MM' 또는 'daily HH:MM,HH:MM,...'.");
  }
  const reminder = {
    id, kind, label, schedule,
    window_minutes: typeof args.window_minutes === "number" ? args.window_minutes : 15,
    target_metric_slug: args.target_metric_slug ? String(args.target_metric_slug) : null,
    defined_at: nowIso(),
  };
  await data.set(`reminder:${id}`, reminder);
  return { reminder };
}

async function ackReminder(args: any, data: Data) {
  const id = String(args.id ?? "");
  const reminder = await data.get(`reminder:${id}`);
  if (!reminder) throw new Error(`등록되지 않은 알람 id: ${id}.`);
  const settings = await getSettings(data);

  let slot = args.slot ? String(args.slot) : "";
  if (!slot) {
    const today = dateInTz(settings.timezone);
    const nowMin = hhmmToMin(hhmmInTz(settings.timezone));
    const slots = parseSchedule(reminder.schedule);
    const past = slots.map(s => ({ s, m: hhmmToMin(s) }))
      .filter(x => x.m <= nowMin)
      .sort((a, b) => b.m - a.m);
    const chosen = past[0]?.s ?? slots[0];
    slot = `${today}T${chosen}`;
  }

  const ack = {
    reminder_id: id, slot, acknowledged_at: nowIso(),
    value: typeof args.value === "number" ? args.value : null,
  };
  await data.set(`ack:${id}:${slot}`, ack);

  let auto_recorded: any = null;
  if (reminder.kind === "measurement" && reminder.target_metric_slug && typeof args.value === "number") {
    try {
      auto_recorded = await recordMetric({
        slug: reminder.target_metric_slug,
        value: args.value,
        context: `reminder:${id}:${slot}`,
      }, data);
    } catch (e: any) {
      auto_recorded = { error: e.message };
    }
  }
  return { ack, auto_recorded };
}

async function defineUserFact(args: any, data: Data) {
  const axis = String(args.axis ?? "").trim();
  if (!FACT_AXES.includes(axis as FactAxis)) {
    throw new Error(`axis 는 ${FACT_AXES.join(" / ")} 중 하나.`);
  }
  const slug = String(args.slug ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error("slug 는 snake_case.");
  const label = String(args.label ?? "").trim();
  if (!label) throw new Error("label 필수.");
  const value = args.value;
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("value 는 object 필수 — 스칼라는 { v: ... } 로, 목록은 { items: [...] } 로 감쌀 것.");
  }
  const fact = { axis, slug, label, value, defined_at: nowIso() };
  await data.set(`fact:${axis}:${slug}`, fact);
  return { fact };
}

async function defineSplitPlan(args: any, data: Data) {
  const slug = String(args.slug ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error("slug 는 snake_case.");
  const name = String(args.name ?? "").trim();
  if (!name) throw new Error("name 필수.");

  const rawBuckets = Array.isArray(args.buckets) ? args.buckets : null;
  if (!rawBuckets || rawBuckets.length === 0) throw new Error("buckets 1개 이상 필요.");
  const buckets = rawBuckets.map((b: any, i: number) => {
    const key = String(b?.key ?? "").trim();
    if (!key) throw new Error(`buckets[${i}].key 필수.`);
    const label = String(b?.label ?? "").trim();
    if (!label) throw new Error(`buckets[${i}].label 필수.`);
    const routine_slugs = Array.isArray(b?.routine_slugs) ? b.routine_slugs.map((x: any) => String(x)) : [];
    return { key, label, routine_slugs };
  });
  const keys = new Set(buckets.map((b: any) => b.key));
  if (keys.size !== buckets.length) throw new Error("buckets.key 중복.");

  const rawAssign = args.assignment;
  if (!rawAssign || typeof rawAssign !== "object") throw new Error("assignment object 필수.");
  const kind = String(rawAssign.kind ?? "").trim();
  if (!SPLIT_KINDS.includes(kind as any)) {
    throw new Error(`assignment.kind 는 ${SPLIT_KINDS.join(" / ")} 중 하나.`);
  }
  let assignment: any = { kind };
  if (kind === "weekly") {
    const map = rawAssign.map;
    if (!map || typeof map !== "object") throw new Error("assignment.kind=weekly 일 때 map object 필수.");
    const norm: Record<string, string | null> = {};
    for (const w of WEEKDAYS) {
      const v = (map as any)[w];
      if (v === null || v === undefined || v === "") norm[w] = null;
      else {
        const sv = String(v);
        if (!keys.has(sv)) throw new Error(`assignment.map.${w}="${sv}" 가 buckets.key 에 없음.`);
        norm[w] = sv;
      }
    }
    assignment.map = norm;
  } else if (kind === "sequence") {
    const order = Array.isArray(rawAssign.order) ? rawAssign.order.map((x: any) => String(x)) : [];
    if (order.length === 0) throw new Error("assignment.kind=sequence 일 때 order 1개 이상.");
    for (const k of order) if (!keys.has(k)) throw new Error(`assignment.order 의 "${k}" 가 buckets.key 에 없음.`);
    assignment.order = order;
  }

  const is_active = !!args.is_active;
  if (is_active) {
    const existing = (await data.list("split_plan:")).map(r => r.value).filter(nonNull);
    for (const p of existing) {
      if (p.slug !== slug && p.is_active) {
        await data.set(`split_plan:${p.slug}`, { ...p, is_active: false });
      }
    }
  }

  const plan = { slug, name, buckets, assignment, is_active, defined_at: nowIso() };
  await data.set(`split_plan:${slug}`, plan);
  return { split_plan: plan };
}

async function deleteEntity(args: any, data: Data) {
  const kind = String(args.kind ?? "").trim();
  const id = String(args.id ?? "").trim();
  if (!id) throw new Error("id 필수.");
  let key: string;
  switch (kind) {
    case "routine": key = `routine:${id}`; break;
    case "metric": key = `metric:${id}`; break;
    case "reminder": key = `reminder:${id}`; break;
    case "split_plan": key = `split_plan:${id}`; break;
    case "fact": {
      const axis = String(args.axis ?? "").trim();
      if (!FACT_AXES.includes(axis as FactAxis)) {
        throw new Error(`kind=fact 일 때 axis 필수 — ${FACT_AXES.join(" / ")} 중 하나.`);
      }
      key = `fact:${axis}:${id}`;
      break;
    }
    default: throw new Error("kind 는 routine / metric / reminder / fact / split_plan 중 하나.");
  }
  return { deleted: await data.delete(key), kind, id, axis: args.axis ?? null };
}

async function getState(data: Data) {
  const settings = await getSettings(data);
  const goal = await data.get("goal");
  const today = dateInTz(settings.timezone);
  const nowMin = hhmmToMin(hhmmInTz(settings.timezone));
  const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;

  const [metricDefsRaw, routineDefsRaw, activitiesRaw, mealsRaw, reminderDefsRaw, factsRaw, splitPlansRaw, derived] = await Promise.all([
    data.list("metric:"),
    data.list("routine:"),
    data.list("activity:"),
    data.list("meal:"),
    data.list("reminder:"),
    data.list("fact:"),
    data.list("split_plan:"),
    computeDerived(settings, data),
  ]);
  const metricDefs = metricDefsRaw.map(r => r.value).filter(nonNull);
  const routineDefs = routineDefsRaw.map(r => r.value).filter(nonNull);
  const reminderDefs = reminderDefsRaw.map(r => r.value).filter(nonNull);
  const facts = factsRaw.map(r => r.value).filter(nonNull);
  const splitPlans = splitPlansRaw.map(r => r.value).filter(nonNull);

  const user_facts = {
    exercise: facts.filter((f: any) => f.axis === "exercise"),
    health_metric: facts.filter((f: any) => f.axis === "health_metric"),
    diet_reminder: facts.filter((f: any) => f.axis === "diet_reminder"),
    baseline: facts.filter((f: any) => f.axis === "baseline"),
  };

  const [metrics, routines, reminders] = await Promise.all([
    Promise.all(metricDefs.map(async (def: any) => {
      const all = (await data.list(`measure:${def.slug}:`))
        .map(r => r.value).filter(nonNull)
        .sort((a: any, b: any) => String(a.measured_at).localeCompare(String(b.measured_at)));
      const latest: any = all.at(-1) ?? null;
      const last7 = all.filter((m: any) => new Date(m.measured_at).getTime() >= sevenDaysAgo);
      const avg7 = last7.length > 0 ? mean(last7.map((m: any) => m.value)) : null;
      return {
        ...def,
        latest_value: latest?.value ?? null,
        latest_measured_at: latest?.measured_at ?? null,
        latest_context: latest?.context ?? null,
        in_target: latest ? evalTarget(latest.value, def.target_min, def.target_max) : null,
        avg_7days: avg7,
        sample_count: all.length,
      };
    })),
    Promise.all(routineDefs.map(async (def: any) => {
      const sessions = (await data.list(`session:${def.slug}:`))
        .map(r => r.value).filter(nonNull)
        .sort((a: any, b: any) => String(a.performed_at).localeCompare(String(b.performed_at)));
      const last: any = sessions.at(-1) ?? null;
      const progression_state = computeProgressionState(def, sessions);
      return { ...def, session_count: sessions.length, last_session: last, progression_state };
    })),
    Promise.all(reminderDefs.map(async (def: any) => {
      const slots = parseSchedule(def.schedule);
      const window = def.window_minutes ?? 15;
      const acks = await Promise.all(slots.map(s => data.get(`ack:${def.id}:${today}T${s}`)));
      const today_status = slots.map((s, i) => {
        const slotMin = hhmmToMin(s);
        const ack: any = acks[i];
        let status = "future";
        if (slotMin <= nowMin) {
          if (ack) status = "acked";
          else if (nowMin - slotMin <= window) status = "due";
          else status = "missed";
        }
        return { slot: s, status, acked_at: ack?.acknowledged_at ?? null };
      });
      return { ...def, today_status };
    })),
  ]);

  const recent_activities = activitiesRaw
    .map(r => r.value).filter(nonNull)
    .filter((a: any) => new Date(a.performed_at).getTime() >= sevenDaysAgo)
    .sort((a: any, b: any) => String(b.performed_at).localeCompare(String(a.performed_at)));

  const meals_today_items = mealsRaw
    .map(r => r.value).filter(nonNull)
    .filter((m: any) => dateInTz(settings.timezone, new Date(m.eaten_at)) === today)
    .sort((a: any, b: any) => String(a.eaten_at).localeCompare(String(b.eaten_at)));

  const meals_today = {
    date: today,
    items: meals_today_items,
    totals: {
      kcal: sumOrNull(meals_today_items.map((m: any) => m.kcal)),
      protein_g: sumOrNull(meals_today_items.map((m: any) => m.protein_g)),
      carbs_g: sumOrNull(meals_today_items.map((m: any) => m.carbs_g)),
      fat_g: sumOrNull(meals_today_items.map((m: any) => m.fat_g)),
      count: meals_today_items.length,
    },
  };

  const activePlan = splitPlans.find((p: any) => p.is_active) ?? null;
  const active_split_plan = activePlan
    ? await enrichActivePlan(activePlan, settings, data)
    : null;

  const anyRegistered = metricDefs.length > 0 || routineDefs.length > 0 || reminderDefs.length > 0 || facts.length > 0 || splitPlans.length > 0;
  let protocol_step: string;
  let recommended_next_action: string;
  if (!goal) {
    protocol_step = "awaiting_goal";
    recommended_next_action = "set_goal — 사용자 본인이 표현한 자연어 목표 한 문장을 받아 등록.";
  } else if (!anyRegistered) {
    protocol_step = "awaiting_initial_setup";
    recommended_next_action = "suggest_setup 으로 템플릿을 받아 사용자에게 제시 → 합의 → define_metric / define_routine_exercise / define_reminder / define_user_fact 로 등록.";
  } else {
    protocol_step = "operational";
    recommended_next_action = "사용자 요청 처리. 응답·계산은 본 state 안의 사실에만 근거.";
  }

  return {
    protocol_step,
    ai_rules: AI_RULES,
    recommended_next_action,
    goal: goal ?? null,
    settings,
    server_now: nowIso(),
    server_now_local: `${today} ${hhmmInTz(settings.timezone)}`,
    derived,
    metrics,
    routines,
    recent_activities,
    meals_today,
    reminders,
    user_facts,
    split_plans: splitPlans,
    active_split_plan,
  };
}

async function enrichActivePlan(plan: any, settings: any, data: Data) {
  const kind = plan.assignment?.kind;
  if (kind === "weekly") {
    const wkey = weekdayKey(settings.timezone);
    const bucketKey = plan.assignment.map?.[wkey] ?? null;
    const bucket = bucketKey ? plan.buckets.find((b: any) => b.key === bucketKey) : null;
    return {
      ...plan,
      today_bucket: bucket
        ? { weekday: wkey, key: bucket.key, label: bucket.label, routine_slugs: bucket.routine_slugs }
        : { weekday: wkey, key: null, label: "휴식일", routine_slugs: [] },
      next_bucket_hint: null,
    };
  }
  if (kind === "sequence") {
    return {
      ...plan,
      today_bucket: null,
      next_bucket_hint: await nextSequenceBucket(plan, data),
    };
  }
  return { ...plan, today_bucket: null, next_bucket_hint: null };
}

async function nextSequenceBucket(plan: any, data: Data) {
  const order: string[] = plan.assignment?.order ?? [];
  if (order.length === 0) return null;
  const bucketOf = (k: string) => plan.buckets.find((b: any) => b.key === k);

  const allSessions = (await data.list("session:"))
    .map(r => r.value).filter(nonNull)
    .sort((a: any, b: any) => String(b.performed_at).localeCompare(String(a.performed_at)));

  if (allSessions.length === 0) {
    const first = bucketOf(order[0]);
    return first ? {
      key: order[0], label: first.label, routine_slugs: first.routine_slugs,
      reason: "세션 기록 없음 — 첫 번째 차례.",
    } : null;
  }

  for (const sess of allSessions) {
    const found = plan.buckets.find((b: any) => Array.isArray(b.routine_slugs) && b.routine_slugs.includes(sess.slug));
    if (!found) continue;
    const idx = order.indexOf(found.key);
    if (idx === -1) continue;
    const nextIdx = (idx + 1) % order.length;
    const next = bucketOf(order[nextIdx]);
    if (!next) continue;
    return {
      key: next.key, label: next.label, routine_slugs: next.routine_slugs,
      last_bucket_key: found.key, last_session_at: sess.performed_at,
    };
  }
  const first = bucketOf(order[0]);
  return first ? {
    key: order[0], label: first.label, routine_slugs: first.routine_slugs,
    reason: "최근 세션이 plan buckets 에 매칭 안 됨 — 첫 번째부터.",
  } : null;
}

async function nextTarget(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  return await computeNextTarget(slug, data);
}

function routinePlan(routine: any) {
  const target_sets = typeof routine.target_sets === "number" ? routine.target_sets : null;
  const target_reps = typeof routine.target_reps === "number" ? routine.target_reps : null;
  const minOk = typeof routine.target_reps_min === "number";
  const maxOk = typeof routine.target_reps_max === "number";
  const target_reps_range = (minOk && maxOk)
    ? { min: routine.target_reps_min, max: routine.target_reps_max }
    : null;
  return { target_sets, target_reps, target_reps_range };
}

function computeProgressionState(routine: any, sessions: any[]) {
  const progression = routine.progression || "weight";
  const direction: "increase" | "decrease" = progression === "time" ? "decrease" : "increase";
  const wv = typeof routine.working_value === "number" ? routine.working_value : null;

  // 디로드 세션은 progression 추론에서 통째 제외 (워밍업 세트도 제외)
  const progSessions = sessions.filter((s: any) => s.is_deload !== true);
  if (progSessions.length === 0) {
    return {
      working_value: wv,
      current_value: null,
      current_at: null,
      pr_value: null,
      pr_at: null,
      baseline_value: null,
      baseline_at: null,
      direction,
    };
  }

  // current = 가장 최근 본세션의 본세트 평균
  let current_value: number | null = null;
  let current_at: string | null = null;
  for (let i = progSessions.length - 1; i >= 0; i--) {
    const sess: any = progSessions[i];
    const work = sess.sets.filter((s: any) => s.is_warmup !== true);
    if (work.length > 0) {
      current_value = mean(work.map((s: any) => setValue(s, progression)));
      current_at = sess.performed_at;
      break;
    }
  }

  // baseline = 첫 본세션의 본세트 평균
  let baseline_value: number | null = null;
  let baseline_at: string | null = null;
  for (const sess of progSessions) {
    const work = sess.sets.filter((s: any) => s.is_warmup !== true);
    if (work.length > 0) {
      baseline_value = mean(work.map((s: any) => setValue(s, progression)));
      baseline_at = sess.performed_at;
      break;
    }
  }

  // PR = 모든 본세션 · 본세트 단일값 중 최댓값 (time 은 최솟값)
  let pr_value: number | null = null;
  let pr_at: string | null = null;
  for (const sess of progSessions) {
    for (const s of sess.sets) {
      if (s.is_warmup === true) continue;
      const v = setValue(s, progression);
      if (!Number.isFinite(v)) continue;
      if (pr_value === null) {
        pr_value = v;
        pr_at = sess.performed_at;
      } else if (direction === "increase" ? v > pr_value : v < pr_value) {
        pr_value = v;
        pr_at = sess.performed_at;
      }
    }
  }

  return {
    working_value: wv,
    current_value,
    current_at,
    pr_value,
    pr_at,
    baseline_value,
    baseline_at,
    direction,
  };
}

async function computeNextTarget(slug: string, data: Data) {
  const routine = await data.get(`routine:${slug}`);
  if (!routine) throw new Error(`등록되지 않은 운동 slug: ${slug}.`);

  const sessions = (await data.list(`session:${slug}:`))
    .map(r => r.value).filter(nonNull)
    .sort((a: any, b: any) => String(a.performed_at).localeCompare(String(b.performed_at)));

  const plan = routinePlan(routine);
  const progression = routine.progression || "weight";
  const direction: "increase" | "decrease" = progression === "time" ? "decrease" : "increase";
  const hasWV = typeof routine.working_value === "number";

  // 신호 부족 (세션/본세션/본세트 없음) 시 — working_value 있으면 그걸 시작점으로 제안
  const fallbackNoSignal = (reason: string, extra: Record<string, any> = {}) => {
    if (hasWV) {
      return {
        next_target: routine.working_value,
        unit: routine.unit,
        progression,
        direction,
        plan,
        basis: {
          base_value: routine.working_value,
          base_source: "working_value",
          ...extra,
          reason,
        },
        working_value_recommendation: null,
      };
    }
    return { next_target: null, plan, reason, ...extra };
  };

  if (sessions.length === 0) {
    return fallbackNoSignal("세션 기록 없음 — 시작 값은 사용자가 선택.");
  }

  // 디로드 세션은 progression 추론에서 통째 제외
  const progSessions = sessions.filter((s: any) => s.is_deload !== true);
  const skipped_deload = sessions.length - progSessions.length;

  if (progSessions.length === 0) {
    return fallbackNoSignal(
      `최근 ${sessions.length}개 세션이 모두 디로드 — 추론 가능한 본세션 없음.`,
      { sessions_skipped_deload: skipped_deload },
    );
  }

  const last: any = progSessions[progSessions.length - 1];
  // 워밍업 세트 제외
  const workSets = last.sets.filter((s: any) => s.is_warmup !== true);
  const skipped_warmup = last.sets.length - workSets.length;

  if (workSets.length === 0) {
    return fallbackNoSignal(
      "직전 비-디로드 세션의 본세트 없음 (전부 워밍업).",
      { sessions_skipped_deload: skipped_deload, warmup_sets_skipped: skipped_warmup },
    );
  }

  const lastAvgRpe = mean(workSets.map((s: any) => Number(s.rpe)));
  const lastAvgValue = mean(workSets.map((s: any) => setValue(s, progression)));
  const target = typeof routine.default_rpe_target === "number" ? routine.default_rpe_target : 8;

  let increment: number = typeof routine.default_increment === "number"
    ? routine.default_increment
    : defaultIncrement(progression, routine.category ?? null);
  let increment_source = typeof routine.default_increment === "number" ? "routine.default_increment" : "default";
  if (progression === "weight" && routine.category === "compound") {
    const plateFact = await data.get(`fact:exercise:min_plate_increment_kg`);
    if (plateFact?.value && typeof plateFact.value.v === "number" && plateFact.value.v > 0) {
      increment = plateFact.value.v;
      increment_source = "fact:exercise:min_plate_increment_kg";
    }
  }

  let push: number;
  if (lastAvgRpe < target - 1) push = 2;
  else if (lastAvgRpe <= target) push = 1;
  else if (lastAvgRpe <= target + 1) push = 0;
  else push = -1;

  const delta = direction === "increase" ? push * increment : -(push * increment);

  // base = working_value (등록된 능력치) 우선, 없으면 직전 본세트 평균 fallback
  const baseValue = hasWV ? routine.working_value : lastAvgValue;
  const baseSource = hasWV ? "working_value" : "last_session_avg";
  let proposed = baseValue + delta;

  // weekly_cap baseline 도 디로드/워밍업 제외
  let cap_applied = false;
  if (typeof routine.weekly_cap === "number" && routine.weekly_cap > 0) {
    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    const recentProg = progSessions.filter((s: any) => new Date(s.performed_at).getTime() >= sevenDaysAgo);
    if (recentProg.length > 0) {
      const earliestWorkSets = recentProg[0].sets.filter((s: any) => s.is_warmup !== true);
      if (earliestWorkSets.length > 0) {
        const earliestAvg = mean(earliestWorkSets.map((s: any) => setValue(s, progression)));
        if (direction === "increase") {
          if (proposed - earliestAvg > routine.weekly_cap) {
            proposed = earliestAvg + routine.weekly_cap;
            cap_applied = true;
          }
        } else {
          if (earliestAvg - proposed > routine.weekly_cap) {
            proposed = earliestAvg - routine.weekly_cap;
            cap_applied = true;
          }
        }
      }
    }
  }

  // working_value 갱신 추천 — 코드는 자동 반영 안 함, AI 가 사용자 합의 후 update_routine_state 호출
  const wvRec = (() => {
    if (!hasWV) {
      return {
        current_working_value: null,
        last_session_avg: lastAvgValue,
        diff: null,
        suggested_new_value: lastAvgValue,
        recommend_update: true,
        reason: "working_value 미설정 — 직전 본세트 평균을 working_value 로 등록 권장.",
      };
    }
    const diff = lastAvgValue - routine.working_value;
    const recommend = Math.abs(diff) >= increment * 0.5;
    let reason: string;
    if (!recommend) {
      reason = "직전 본세트 평균이 working_value 와 거의 동일 — 갱신 불필요.";
    } else if (direction === "increase") {
      reason = diff > 0
        ? "직전 본세트 평균이 working_value 보다 큼 — 능력치 갱신 권장."
        : "직전 본세트 평균이 working_value 보다 낮음 — 능력치 하향 조정 검토 권장.";
    } else {
      // time: 낮을수록 좋음 — diff<0 이면 더 짧아졌다는 뜻 (성장)
      reason = diff < 0
        ? "직전 본세트 시간이 working_value 보다 짧음 — 능력치 갱신 권장."
        : "직전 본세트 시간이 working_value 보다 김 — 능력치 하향 조정 검토 권장.";
    }
    return {
      current_working_value: routine.working_value,
      last_session_avg: lastAvgValue,
      diff,
      suggested_new_value: recommend ? lastAvgValue : routine.working_value,
      recommend_update: recommend,
      reason,
    };
  })();

  return {
    next_target: proposed,
    unit: routine.unit,
    progression,
    direction,
    plan,
    basis: {
      base_value: baseValue,
      base_source: baseSource,
      last_avg_value: lastAvgValue,
      last_avg_rpe: lastAvgRpe,
      target_rpe: target,
      increment,
      increment_source,
      push_multiplier: push,
      delta,
      weekly_cap_applied: cap_applied,
      session_count: sessions.length,
      sessions_skipped_deload: skipped_deload,
      warmup_sets_skipped_in_last: skipped_warmup,
      work_sets_used: workSets.length,
      last_session_superset_group: last.superset_group ?? null,
    },
    working_value_recommendation: wvRec,
  };
}

const TEMPLATES = [
  {
    match: /(당뇨|혈당|glucose|diabet)/i,
    label: "혈당 관리 표준 셋업",
    metrics: [
      { slug: "fasting_glucose", display_name: "공복 혈당", unit: "mg/dL", target_min: 70, target_max: 100, priority: "critical" },
      { slug: "post_meal_glucose", display_name: "식후 2h 혈당", unit: "mg/dL", target_min: 70, target_max: 140, priority: "critical" },
      { slug: "hba1c", display_name: "당화혈색소", unit: "%", target_min: 4.0, target_max: 5.7, priority: "high" },
    ],
    reminders: [
      { id: "morning_glucose", kind: "measurement", label: "아침 공복 혈당 측정", schedule: "daily 07:00", target_metric_slug: "fasting_glucose" },
    ],
  },
  {
    match: /(체중|체지방|근비대|벌크|다이어트|감량|weight|fat|muscle|bulk|cut)/i,
    label: "체성분 추적 표준 셋업",
    metrics: [
      { slug: "body_weight_kg", display_name: "체중", unit: "kg", priority: "high" },
      { slug: "body_fat_pct", display_name: "체지방률", unit: "%", priority: "high" },
      { slug: "skeletal_muscle_kg", display_name: "골격근량", unit: "kg", priority: "high" },
    ],
    note: "기초대사량(BMR)·나이는 height_cm/sex/birth_year 설정 + body_weight_kg 측정으로 자동 계산. 별도 metric 등록 불필요.",
    reminders: [
      { id: "morning_weigh_in", kind: "measurement", label: "아침 체중 측정", schedule: "daily 07:00", target_metric_slug: "body_weight_kg" },
    ],
  },
  {
    match: /(근력|벤치|스쿼트|데드|3대|strength|bench|squat|deadlift|powerlift)/i,
    label: "3대 운동 루틴 표준 셋업",
    routines: [
      { slug: "squat", display_name: "백 스쿼트", progression: "weight", category: "compound", unit: "kg", default_rpe_target: 8, weekly_cap: 5, target_sets: 3, target_reps: 5 },
      { slug: "bench_press", display_name: "벤치프레스", progression: "weight", category: "compound", unit: "kg", default_rpe_target: 8, weekly_cap: 5, target_sets: 3, target_reps: 5 },
      { slug: "deadlift", display_name: "데드리프트", progression: "weight", category: "compound", unit: "kg", default_rpe_target: 8, weekly_cap: 5, target_sets: 3, target_reps: 5 },
    ],
    facts: [
      { axis: "exercise", slug: "min_plate_increment_kg", label: "최소 plate 증분", value_example: { v: 2.5 }, hint: "헬스장에 1.25kg 원판이 없으면 v: 5 로 등록." },
    ],
  },
  {
    match: /(혈압|고혈압|blood pressure|hypertension)/i,
    label: "혈압 관리 표준 셋업",
    metrics: [
      { slug: "systolic_bp", display_name: "수축기 혈압", unit: "mmHg", target_min: 90, target_max: 120, priority: "critical" },
      { slug: "diastolic_bp", display_name: "이완기 혈압", unit: "mmHg", target_min: 60, target_max: 80, priority: "critical" },
      { slug: "resting_hr", display_name: "안정시 심박수", unit: "bpm", target_min: 50, target_max: 80, priority: "high" },
    ],
    reminders: [
      { id: "morning_bp", kind: "measurement", label: "아침 혈압 측정", schedule: "daily 08:00", target_metric_slug: "systolic_bp" },
    ],
  },
  {
    match: /(영양제|supplement|비타민|오메가|vitamin|omega)/i,
    label: "기본 영양제 알람 셋업 (예시)",
    reminders: [
      { id: "vitamin_d", kind: "supplement", label: "비타민D 1정", schedule: "daily 09:00" },
      { id: "omega_3", kind: "supplement", label: "오메가-3", schedule: "daily 09:00" },
    ],
  },
  {
    match: /(마라톤|러닝|유산소|지구력|cardio|run|marathon|endurance)/i,
    label: "유산소 지구력 셋업",
    metrics: [
      { slug: "resting_hr", display_name: "안정시 심박수", unit: "bpm", priority: "high" },
      { slug: "vo2max", display_name: "VO2max", unit: "mL/kg/min", priority: "normal" },
    ],
    routines: [
      { slug: "run_5k", display_name: "5km 러닝", progression: "time", unit: "seconds", default_rpe_target: 8, target_sets: 1 },
    ],
  },
];

async function suggestSetup(data: Data) {
  const goal = await data.get("goal");
  if (!goal) {
    return { protocol_step: "awaiting_goal", templates: [], message: "goal 미설정 — set_goal 먼저." };
  }
  const text = String(goal.text ?? "");
  const templates = TEMPLATES.filter(t => t.match.test(text)).map(({ match, ...rest }) => rest);
  return {
    goal: goal.text,
    templates,
    note: "이는 '추천'이 아니라 '제안 후보'. AI 가 사용자에게 그대로 제시 → 합의 → define_metric / define_reminder / define_routine_exercise / define_user_fact 로 실제 등록. 빈 배열이면 goal 에 매칭 키워드가 없는 것이므로 AI 가 사용자와 직접 협의해서 정의.",
  };
}

async function checkReminders(data: Data) {
  const settings = await getSettings(data);
  const today = dateInTz(settings.timezone);
  const nowMin = hhmmToMin(hhmmInTz(settings.timezone));

  const reminderDefs = (await data.list("reminder:")).map(r => r.value).filter(nonNull);

  const candidates: Array<{ r: any; slot: string; window: number }> = [];
  for (const r of reminderDefs) {
    const window = r.window_minutes ?? 15;
    for (const slot of parseSchedule(r.schedule)) {
      const slotMin = hhmmToMin(slot);
      const elapsed = nowMin - slotMin;
      if (elapsed < 0 || elapsed > window) continue;
      candidates.push({ r, slot, window });
    }
  }

  const acks = await Promise.all(candidates.map(c => data.get(`ack:${c.r.id}:${today}T${c.slot}`)));
  const notifications: any[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (acks[i]) continue;
    const { r, slot, window } = candidates[i];
    const kindLabel = r.kind === "supplement" ? "[영양제]" : r.kind === "measurement" ? "[측정]" : "[행동]";
    notifications.push({
      id: `reminder-${r.id}-${today}-${slot}`,
      title: `${kindLabel} ${r.label}`,
      body: `${slot} 슬롯. ${window}분 안에 ack 안 하면 더 이상 안 옵니다.`,
      url: "/board",
    });
  }
  return { notifications };
}

async function renderDashboard(args: any, data: Data) {
  const tab = String(args.tab ?? "overview");
  const s = await getState(data);
  return { html: buildDashboardHtml(tab, s) };
}

function buildDashboardHtml(tab: string, s: any): string {
  const stepLabels: Record<string, string> = {
    awaiting_goal: "1단계 — 목표 대기",
    awaiting_initial_setup: "2단계 — 셋업 대기",
    operational: "운영 중",
  };
  const goalText = s.goal?.text
    ? escapeHtml(s.goal.text)
    : `<em style="color:#888">목표 미설정 — AI에게 "목표 설정해줘"</em>`;
  const tabs: [string, string][] = [
    ["overview", "전체"],
    ["exercise", "운동"],
    ["metrics", "지표"],
    ["diet", "식단·알람"],
    ["baseline", "베이스라인"],
  ];

  let content = "";
  if (tab === "overview") {
    content += renderOverviewCard(s);
  } else if (tab === "exercise") {
    content += renderSplitPlanCard(s.active_split_plan, s.routines);
    content += renderExerciseCard(s.routines, s.recent_activities);
    content += renderFactsCard("운동 환경/장비/제약", s.user_facts.exercise);
  } else if (tab === "metrics") {
    content += renderDerivedCard(s.derived);
    content += renderMetricsCard(s.metrics);
    content += renderFactsCard("건강 관련 사실 (알레르기·복용약 등)", s.user_facts.health_metric);
  } else if (tab === "diet") {
    content += renderDietCard(s.meals_today, s.reminders, s.derived);
    content += renderFactsCard("식단 제약·알람 관련", s.user_facts.diet_reminder);
  } else if (tab === "baseline") {
    content += renderBaselineSettingsCard(s.settings, s.derived);
    content += renderFactsCard("기본 정보 (천천히 변하거나 고정)", s.user_facts.baseline);
  }

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:14px;background:#0a0a0a;color:#e5e5e5;font-size:13px}
.hdr{border-left:3px solid #7c3aed;padding-left:12px;margin-bottom:14px}
.step{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px}
.goal{font-size:15px;margin-top:4px;color:#fafafa;line-height:1.4}
.tabs{display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid #2a2a2a;flex-wrap:wrap}
.tab{padding:7px 13px;cursor:pointer;color:#888;border:none;background:none;font-size:12px;font-family:inherit}
.tab.active{color:#fafafa;border-bottom:2px solid #7c3aed}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:13px;margin-bottom:10px}
.card h3{margin:0 0 9px;font-size:12px;color:#c0c0c0;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1f1f1f;gap:8px}
.row:last-child{border-bottom:none}
.row.hi{background:#1a1530;border-radius:4px;padding-left:6px;padding-right:6px;margin:0 -6px}
.name{color:#d4d4d4;min-width:0}
.val{color:#fafafa;font-variant-numeric:tabular-nums;text-align:right;flex-shrink:0;word-break:break-word}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:6px;vertical-align:middle}
.ok{background:#15402a;color:#4ade80}
.warn{background:#4a2f15;color:#fbbf24}
.crit{background:#4a1515;color:#f87171}
.due{background:#2a2a4a;color:#93c5fd}
.empty{color:#666;font-style:italic;padding:4px 0}
.meta{color:#777;font-size:11px}
</style></head><body>
<div class="hdr">
<div class="step">${escapeHtml(stepLabels[s.protocol_step] || s.protocol_step)} · ${escapeHtml(s.server_now_local)} (${escapeHtml(s.settings.timezone)})</div>
<div class="goal">${goalText}</div>
</div>
<div class="tabs">
${tabs.map(([t, l]) => `<button class="tab ${t === tab ? "active" : ""}" data-tab="${t}">${l}</button>`).join("")}
</div>
${content || '<div class="card"><div class="empty">데이터 없음.</div></div>'}
<script>
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  parent.postMessage({ type: 'widget-state-change', state: { tab: b.dataset.tab } }, '*');
}));
</script>
</body></html>`;
}

function renderOverviewCard(s: any): string {
  let html = "";
  const factCount = s.user_facts.exercise.length + s.user_facts.health_metric.length + s.user_facts.diet_reminder.length + s.user_facts.baseline.length;

  html += `<div class="card"><h3>요약</h3>`;
  html += `<div class="row"><div class="name">운동 루틴</div><div class="val">${s.routines.length}</div></div>`;
  html += `<div class="row"><div class="name">건강 지표</div><div class="val">${s.metrics.length}</div></div>`;
  html += `<div class="row"><div class="name">알람</div><div class="val">${s.reminders.length}</div></div>`;
  html += `<div class="row"><div class="name">사용자 사실 (4축 합계)</div><div class="val">${factCount}</div></div>`;
  html += `<div class="row"><div class="name">활성 분할</div><div class="val">${s.active_split_plan ? escapeHtml(s.active_split_plan.name) : '<span class="meta">없음</span>'}</div></div>`;
  if (s.derived?.age !== null) {
    html += `<div class="row"><div class="name">나이 (자동)</div><div class="val">${s.derived.age}세</div></div>`;
  }
  if (s.derived?.bmr !== null) {
    html += `<div class="row"><div class="name">기초대사량 (Mifflin-St Jeor)</div><div class="val">${s.derived.bmr} kcal</div></div>`;
  }
  html += `</div>`;

  if (s.active_split_plan) {
    html += renderTodayBucketCard(s.active_split_plan, s.routines);
  }

  const critical = s.metrics.filter((m: any) => m.priority === "critical" && m.in_target === false);
  if (critical.length > 0) {
    html += `<div class="card"><h3 style="color:#f87171">⚠ critical 지표 범위 이탈 (${critical.length})</h3>`;
    for (const m of critical) {
      html += `<div class="row"><div class="name">${escapeHtml(m.display_name)}</div><div class="val">${m.latest_value} ${escapeHtml(m.unit)}</div></div>`;
    }
    html += "</div>";
  }

  const t = s.meals_today.totals;
  html += `<div class="card"><h3>오늘 식단 · ${escapeHtml(s.meals_today.date)}</h3>`;
  if (t.count === 0) {
    html += '<div class="empty">아직 기록 없음.</div>';
  } else {
    const line = [
      t.kcal !== null ? `${t.kcal} kcal` : null,
      t.protein_g !== null ? `P ${t.protein_g}g` : null,
      t.carbs_g !== null ? `C ${t.carbs_g}g` : null,
      t.fat_g !== null ? `F ${t.fat_g}g` : null,
    ].filter(Boolean).join(" · ");
    html += `<div class="row"><div class="name">${t.count}끼 합계</div><div class="val">${escapeHtml(line) || '<span class="meta">영양 미입력</span>'}</div></div>`;
    if (s.derived?.maintenance_kcal !== null && t.kcal !== null) {
      const delta = t.kcal - s.derived.maintenance_kcal;
      const sign = delta >= 0 ? "+" : "";
      html += `<div class="row"><div class="name">Maintenance 대비</div><div class="val">${sign}${delta} kcal</div></div>`;
    }
  }
  html += "</div>";

  const todayPending: any[] = [];
  for (const r of s.reminders) {
    for (const sl of r.today_status) {
      if (sl.status === "due" || sl.status === "missed") {
        todayPending.push({ r, sl });
      }
    }
  }
  if (todayPending.length > 0) {
    html += `<div class="card"><h3>오늘 알람 ack 대기/미수행 (${todayPending.length})</h3>`;
    for (const p of todayPending) {
      const cls = p.sl.status === "due" ? "due" : "warn";
      html += `<div class="row"><div class="name">${escapeHtml(p.r.label)}</div><div class="val"><span class="badge ${cls}">${p.sl.slot}</span></div></div>`;
    }
    html += "</div>";
  }
  return html;
}

function formatRoutineOrder(routine_slugs: any[], routines: any[]): string {
  const list = Array.isArray(routine_slugs) ? routine_slugs : [];
  if (list.length === 0) return "";
  const nameOf = (slug: string) => {
    const r = routines.find((x: any) => x?.slug === slug);
    return r?.display_name || slug;
  };
  return list.map((slug: any, i: number) => `${i + 1}. ${escapeHtml(nameOf(String(slug)))}`).join(" → ");
}

function renderTodayBucketCard(plan: any, routines: any[] = []): string {
  const kind = plan.assignment?.kind;
  let html = `<div class="card"><h3>오늘 차례 — ${escapeHtml(plan.name)}</h3>`;
  if (kind === "weekly") {
    const tb = plan.today_bucket;
    if (tb?.key) {
      html += `<div class="row"><div class="name">오늘 묶음</div><div class="val">${escapeHtml(tb.label)} <span class="meta">(${escapeHtml(tb.key)})</span></div></div>`;
      const ordered = formatRoutineOrder(tb.routine_slugs, routines);
      html += `<div class="row"><div class="name"><span class="meta">순서</span></div><div class="val"><span class="meta">${ordered || "없음"}</span></div></div>`;
    } else {
      html += `<div class="row"><div class="name">오늘</div><div class="val"><span class="meta">휴식일</span></div></div>`;
    }
  } else if (kind === "sequence") {
    const h = plan.next_bucket_hint;
    if (h) {
      html += `<div class="row"><div class="name">다음 차례</div><div class="val">${escapeHtml(h.label)} <span class="meta">(${escapeHtml(h.key)})</span></div></div>`;
      const ordered = formatRoutineOrder(h.routine_slugs, routines);
      html += `<div class="row"><div class="name"><span class="meta">순서</span></div><div class="val"><span class="meta">${ordered || "없음"}</span></div></div>`;
      if (h.last_session_at) {
        html += `<div class="row"><div class="name"><span class="meta">직전 ${escapeHtml(h.last_bucket_key)}</span></div><div class="val"><span class="meta">${escapeHtml(String(h.last_session_at).slice(0, 10))}</span></div></div>`;
      } else if (h.reason) {
        html += `<div class="row"><div class="name"></div><div class="val"><span class="meta">${escapeHtml(h.reason)}</span></div></div>`;
      }
    }
  } else if (kind === "freestyle") {
    html += `<div class="row"><div class="name">자유 선택</div><div class="val">${plan.buckets.length}개 묶음 중 선택</div></div>`;
  }
  html += "</div>";
  return html;
}

function renderSplitPlanCard(plan: any, routines: any[] = []): string {
  if (!plan) {
    return '<div class="card"><h3>분할 계획</h3><div class="empty">활성 분할 없음 — 체리피커 모드 또는 미설정.</div></div>';
  }
  const kind = plan.assignment?.kind;
  let html = `<div class="card"><h3>활성 분할 — ${escapeHtml(plan.name)} <span class="meta">(${escapeHtml(kind)})</span></h3>`;

  if (kind === "weekly") {
    const WEEK_LABEL: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
    const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const todayKey = plan.today_bucket?.weekday;
    for (const w of order) {
      const bk = plan.assignment.map?.[w];
      const bucket = bk ? plan.buckets.find((b: any) => b.key === bk) : null;
      const isToday = todayKey === w;
      const cls = isToday ? "row hi" : "row";
      const badge = isToday ? ' <span class="badge due">오늘</span>' : "";
      html += `<div class="${cls}"><div class="name">${WEEK_LABEL[w]}${badge}</div><div class="val">${bucket ? escapeHtml(bucket.label) : '<span class="meta">휴식</span>'}</div></div>`;
    }
  } else if (kind === "sequence") {
    const nextKey = plan.next_bucket_hint?.key;
    for (const k of plan.assignment.order) {
      const bucket = plan.buckets.find((b: any) => b.key === k);
      if (!bucket) continue;
      const isNext = nextKey === k;
      const cls = isNext ? "row hi" : "row";
      const badge = isNext ? ' <span class="badge due">다음</span>' : "";
      html += `<div class="${cls}"><div class="name">${escapeHtml(bucket.key)}${badge}</div><div class="val">${escapeHtml(bucket.label)}</div></div>`;
    }
  } else {
    for (const bucket of plan.buckets) {
      html += `<div class="row"><div class="name">${escapeHtml(bucket.key)}</div><div class="val">${escapeHtml(bucket.label)}</div></div>`;
    }
  }
  html += "</div>";

  html += `<div class="card"><h3>분할 묶음 상세 (${plan.buckets.length})</h3>`;
  for (const b of plan.buckets) {
    const ordered = formatRoutineOrder(b.routine_slugs, routines);
    html += `<div class="row"><div class="name">${escapeHtml(b.key)} · ${escapeHtml(b.label)}</div><div class="val"><span class="meta">${ordered || "없음"}</span></div></div>`;
  }
  html += "</div>";
  return html;
}

function renderMetricsCard(metrics: any[]): string {
  if (metrics.length === 0) {
    return '<div class="card"><h3>건강 지표</h3><div class="empty">등록된 지표 없음.</div></div>';
  }
  const rows = metrics.map(m => {
    let badge = "";
    if (m.in_target === true) badge = '<span class="badge ok">정상</span>';
    else if (m.in_target === false) {
      const cls = m.priority === "critical" ? "crit" : "warn";
      badge = `<span class="badge ${cls}">범위 이탈</span>`;
    } else if (m.priority === "critical") {
      badge = '<span class="badge warn">critical</span>';
    }
    const v = m.latest_value !== null
      ? `${m.latest_value} ${escapeHtml(m.unit)}`
      : '<span class="meta">측정 없음</span>';
    const trend = m.avg_7days !== null && m.latest_value !== null
      ? ` <span class="meta">7d평균 ${m.avg_7days.toFixed(1)}</span>` : "";
    return `<div class="row"><div class="name">${escapeHtml(m.display_name)}${badge}</div><div class="val">${v}${trend}</div></div>`;
  }).join("");
  return `<div class="card"><h3>건강 지표 (${metrics.length})</h3>${rows}</div>`;
}

function formatRoutinePlan(r: any): string {
  const sets = typeof r.target_sets === "number" ? r.target_sets : null;
  if (sets === null) return "";
  const reps = typeof r.target_reps === "number" ? r.target_reps : null;
  const minOk = typeof r.target_reps_min === "number";
  const maxOk = typeof r.target_reps_max === "number";
  if (reps !== null) return `${sets}×${reps}`;
  if (minOk && maxOk) return `${sets}×${r.target_reps_min}-${r.target_reps_max}`;
  return `${sets}세트`;
}

function formatNextSessionGoal(r: any): string {
  const g = r.next_session_goal;
  if (!g || typeof g.value !== "number") return "";
  const unit = r.unit ? escapeHtml(String(r.unit)) : "";
  const valStr = `${roundForDisplay(g.value)}${unit ? ` ${unit}` : ""}`;
  const srcBadge = g.source === "manual" ? ` <span class="meta">(직접 지정)</span>` : "";
  const noteStr = g.note ? ` <span class="meta">· ${escapeHtml(String(g.note))}</span>` : "";
  return `다음 목표 <b>${valStr}</b>${srcBadge}${noteStr}`;
}

function formatProgressionState(r: any): string {
  const ps = r.progression_state;
  if (!ps) return "";
  const unit = r.unit ? escapeHtml(String(r.unit)) : "";
  const fmt = (v: number | null) => v === null ? null : `${roundForDisplay(v)}${unit ? ` ${unit}` : ""}`;
  const parts: string[] = [];
  const cur = fmt(ps.current_value);
  const wv = fmt(ps.working_value);
  const pr = fmt(ps.pr_value);
  if (wv) parts.push(`현재 능력치 <b>${wv}</b>`);
  if (cur && (!wv || ps.current_value !== ps.working_value)) parts.push(`직전 ${cur}`);
  if (pr) parts.push(`최고 ${pr}`);
  return parts.join(" · ");
}

function roundForDisplay(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // 정수면 정수로, 아니면 소수점 2자리까지
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return (Math.round(v * 100) / 100).toString();
}

function formatLastSessionSummary(last: any): string {
  if (!last) return '<span class="meta">기록 없음</span>';
  const date = escapeHtml(String(last.performed_at).slice(0, 10));
  const total = last.sets.length;
  const warmupCount = last.sets.filter((s: any) => s.is_warmup === true).length;
  const workCount = total - warmupCount;
  const supersetBadge = last.superset_group ? ` <span class="badge due">SS</span>` : "";

  if (last.is_deload === true) {
    return `<span class="badge warn">디로드</span> ${total}세트 · ${date}${supersetBadge}`;
  }
  if (warmupCount > 0) {
    return `${workCount}세트 <span class="meta">+W${warmupCount}</span> · ${date}${supersetBadge}`;
  }
  return `${total}세트 · ${date}${supersetBadge}`;
}

function renderExerciseCard(routines: any[], activities: any[]): string {
  let html = '<div class="card"><h3>운동 루틴</h3>';
  if (routines.length === 0 && activities.length === 0) {
    html += '<div class="empty">등록된 루틴/활동 없음.</div></div>';
    return html;
  }
  for (const r of routines) {
    const progBadge = r.progression ? `<span class="meta">(${escapeHtml(r.progression)})</span>` : "";
    const planStr = formatRoutinePlan(r);
    const planHtml = planStr ? ` <span class="meta">· ${escapeHtml(planStr)}</span>` : "";
    const summary = formatLastSessionSummary(r.last_session);
    html += `<div class="row"><div class="name">${escapeHtml(r.display_name)} ${progBadge}${planHtml}</div><div class="val">${summary}</div></div>`;
    const stateLine = formatProgressionState(r);
    if (stateLine) {
      html += `<div class="meta" style="margin-left:4px;margin-bottom:4px">${stateLine}</div>`;
    }
    const goalLine = formatNextSessionGoal(r);
    if (goalLine) {
      html += `<div class="meta" style="margin-left:4px;margin-bottom:4px">🎯 ${goalLine}</div>`;
    }
    if (r.memo) {
      html += `<div class="meta" style="margin-left:4px;margin-bottom:6px">📝 ${escapeHtml(r.memo)}</div>`;
    }
  }
  if (activities.length > 0) {
    html += `<div class="meta" style="margin:8px 0 4px">최근 7일 활동 ${activities.length}건</div>`;
    for (const a of activities.slice(0, 5)) {
      html += `<div class="row"><div class="name">${escapeHtml(a.name)} <span class="meta">(${a.intensity})</span></div><div class="val">${a.duration_minutes}분</div></div>`;
    }
  }
  html += "</div>";
  return html;
}

function renderDietCard(mealsToday: any, reminders: any[], derived: any): string {
  let html = `<div class="card"><h3>오늘 식단 · ${escapeHtml(mealsToday.date)}</h3>`;
  if (mealsToday.items.length === 0) {
    html += '<div class="empty">오늘 기록된 끼 없음.</div>';
  } else {
    const t = mealsToday.totals;
    const totalLine = [
      t.kcal !== null ? `${t.kcal} kcal` : null,
      t.protein_g !== null ? `P ${t.protein_g}g` : null,
      t.carbs_g !== null ? `C ${t.carbs_g}g` : null,
      t.fat_g !== null ? `F ${t.fat_g}g` : null,
    ].filter(Boolean).join(" · ");
    html += `<div class="row"><div class="name">합계 (${t.count}끼)</div><div class="val">${escapeHtml(totalLine) || '<span class="meta">영양 미입력</span>'}</div></div>`;
    if (derived?.maintenance_kcal !== null && t.kcal !== null) {
      const delta = t.kcal - derived.maintenance_kcal;
      const sign = delta >= 0 ? "+" : "";
      const cls = Math.abs(delta) < 200 ? "ok" : "warn";
      html += `<div class="row"><div class="name">Maintenance 대비 <span class="badge ${cls}">${sign}${delta}</span></div><div class="val">${derived.maintenance_kcal} kcal</div></div>`;
    }
    for (const m of mealsToday.items.slice(-3)) {
      const v = m.kcal !== null ? `${m.kcal} kcal` : '<span class="meta">—</span>';
      html += `<div class="row"><div class="name">${escapeHtml(m.name)}</div><div class="val">${v}</div></div>`;
    }
  }
  html += "</div>";

  html += '<div class="card"><h3>알람</h3>';
  if (reminders.length === 0) {
    html += '<div class="empty">등록된 알람 없음.</div>';
  } else {
    for (const r of reminders) {
      const slotsHtml = r.today_status.map((sl: any) => {
        const cls = sl.status === "acked" ? "ok"
          : sl.status === "due" ? "due"
          : sl.status === "missed" ? "warn" : "";
        return `<span class="badge ${cls}">${sl.slot}</span>`;
      }).join(" ");
      html += `<div class="row"><div class="name">${escapeHtml(r.label)} <span class="meta">(${r.kind})</span></div><div class="val">${slotsHtml}</div></div>`;
    }
  }
  html += "</div>";
  return html;
}

function renderDerivedCard(derived: any): string {
  if (!derived || (derived.age === null && derived.bmr === null)) return "";
  let html = '<div class="card"><h3>자동 계산</h3>';
  if (derived.age !== null) {
    html += `<div class="row"><div class="name">현재 나이</div><div class="val">${derived.age}세</div></div>`;
  }
  if (derived.bmr !== null) {
    html += `<div class="row"><div class="name">기초대사량 (Mifflin-St Jeor)</div><div class="val">${derived.bmr} kcal</div></div>`;
    const src = derived.bmr_source;
    if (src) {
      html += `<div class="row"><div class="name"><span class="meta">기준</span></div><div class="val"><span class="meta">${src.weight_kg}kg · ${src.height_cm}cm · ${src.age}세 · ${src.sex}</span></div></div>`;
    }
  }
  if (derived.maintenance_kcal !== null) {
    html += `<div class="row"><div class="name">Maintenance (BMR × AF)</div><div class="val">${derived.maintenance_kcal} kcal</div></div>`;
  }
  html += "</div>";
  return html;
}

function renderBaselineSettingsCard(settings: any, derived: any): string {
  const unsetMeta = '<span class="meta">미설정</span>';
  const sexLabel = settings.sex === "male" ? "남성" : settings.sex === "female" ? "여성" : unsetMeta;
  let html = '<div class="card"><h3>고정 설정 (nesy.app UI 폼)</h3>';
  html += `<div class="row"><div class="name">Timezone</div><div class="val">${escapeHtml(settings.timezone)}</div></div>`;
  html += `<div class="row"><div class="name">신장</div><div class="val">${settings.height_cm > 0 ? `${settings.height_cm} cm` : unsetMeta}</div></div>`;
  html += `<div class="row"><div class="name">성별</div><div class="val">${sexLabel}</div></div>`;
  html += `<div class="row"><div class="name">출생년도</div><div class="val">${settings.birth_year > 0 ? `${settings.birth_year}년` : unsetMeta}</div></div>`;
  html += `<div class="row"><div class="name">Activity factor</div><div class="val">${settings.activity_factor > 0 ? settings.activity_factor : unsetMeta}</div></div>`;
  if (derived?.age !== null) {
    html += `<div class="row"><div class="name">현재 나이 (자동)</div><div class="val">${derived.age}세</div></div>`;
  }
  html += "</div>";
  return html;
}

function renderFactsCard(title: string, facts: any[]): string {
  let html = `<div class="card"><h3>${escapeHtml(title)} (${facts.length})</h3>`;
  if (facts.length === 0) {
    html += '<div class="empty">등록된 사실 없음.</div></div>';
    return html;
  }
  for (const f of facts) {
    const valueStr = factValueSummary(f.value);
    html += `<div class="row"><div class="name">${escapeHtml(f.label)} <span class="meta">${escapeHtml(f.slug)}</span></div><div class="val">${escapeHtml(valueStr)}</div></div>`;
  }
  html += "</div>";
  return html;
}

function factValueSummary(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "object") return String(v);
  const keys = Object.keys(v);
  if (keys.length === 1 && "v" in v) return String(v.v);
  if (keys.length === 1 && Array.isArray(v.items)) return v.items.map((it: any) => typeof it === "object" ? JSON.stringify(it) : String(it)).join(", ");
  try { return JSON.stringify(v); } catch { return "[object]"; }
}
