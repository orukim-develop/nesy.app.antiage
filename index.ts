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
  "★ 이 마도서는 '기록' 과 '한눈에 보기(시각화)' 전용이다. 마도서 이름으로 의학·식이·운동 조언/추천/처방/식단작성 절대 금지 — 마도서의 어떤 출력값도 조언이 아니다. 사용자가 적어달라고 한 사실만 적고, 현재 상태와 추이만 보여준다. 다음 무게·칼로리·식단·운동량을 마도서가 정해주지 않는다. 모든 도구 응답에 _guard 가 동봉된다 — '몰랐다' 는 통하지 않는다.",
  "★ 조언 책임 분리(필수) — 마도서는 어떤 조언에도 책임이 없고, 조언의 책임은 전적으로 AI(너) 본인에게 있다. AI 가 굳이 조언하려면 마도서 답변과 분리한 뒤, 응답에 동봉된 _guard.disclaimer 문구를 사용자에게 그대로 먼저 보여주고 말해야 한다. disclaimer 없이는 어떤 조언도 금지. 마도서가 추천하는 것처럼 말하지 말 것. 의학적 내용은 전문가(의사·영양사 등) 상담을 반드시 함께 권한다.",
  "응답 전 반드시 get_state 호출 — 모든 답변·표시는 get_state 의 기록된 사실에만 근거. 사실에 없는 값을 지어내지 말 것.",
  "goal 이 비어있으면 set_goal 부터 — goal 은 사용자가 말한 목표 문장을 그대로 기록만 한다.",
  "사용자가 명시적으로 말한 항목만 등록 — 임의 등록·임의 식단·임의 측정값 생성 절대 금지.",
  "시각·날짜는 settings.timezone 기준 — 추측 금지.",
  "★ 사용자 앞 발화는 사용자 발화 언어 그대로의 자연어로. 한국어 화자면 한국어, 영어 화자면 영어, 다른 언어면 그 언어. slug, snake_case 식별자, JSON 키, 도구 이름(define_*/log_* 등), axis/progression/kind 의 영어 코드값(exercise/health_metric/weight/time/weekly 등) 절대 노출 금지. 도구 호출은 내부에서만, 사용자에겐 자연어 라벨/display_name 으로 풀어쓴다. 위반 시 사용자가 '코드처럼 말한다' 며 신뢰 잃음.",
  "user_fact 등록 전 사용자 발화 언어로 분류 의도 명시 후 합의 (영문 axis 값 노출 금지). 축 자연어 표현 예시 — 한국어: exercise='운동 환경/장비/제약', health_metric='건강 관련 정보(알레르기·복용약·만성질환 등)', diet_reminder='식단 제약/알람 관련', baseline='기본 정보(직업·수면·생활패턴 등)'. 영어: exercise='workout environment/equipment/constraints', health_metric='health-related info (allergies, meds, conditions)', diet_reminder='diet constraints / reminders', baseline='baseline info (job, sleep, lifestyle)'. 다른 언어는 의미 보존하며 그 언어로 자연 번역. 좋은 예(한): '이거 운동 환경 정보로 저장할게요 — 헬스장 최소 증분 2.5kg' / 좋은 예(영): 'Logging this as workout environment — gym minimum plate increment 2.5kg' / 나쁜 예: 'exercise 카테고리에 min_plate_increment_kg 으로 넣을게요'.",
  "축이 모호하면 두 선택지를 사용자 발화 언어로 풀어서 직접 질문 — AI 단독 결정 금지.",
  "운동 등록 시 진척 축 사용자 발화 언어로 자연스럽게 합의 — 무게↑ / 시간↓ / 거리↑ / 횟수↑ / 유지시간↑ 중 어느 축인지 (한국어 예 '무게 늘리기 / 시간 줄이기 / 거리 늘리기 / 횟수 늘리기 / 유지 시간 늘리기', 영어 예 'add weight / cut time / extend distance / more reps / longer hold'). 'progression=weight' 같이 코드값 노출 금지. 표준 인체 가정 금지 — 다리/팔 없는 사용자도 본인이 가능한 형태(기어가기 등) 등록 가능.",
  "운동 등록 시 계획된 세트수·횟수(또는 범위) 사용자 발화 언어로 함께 합의 — 무게/횟수 진척이면 횟수도 같이(한국어 예 '3세트 5회' 또는 '3세트 8~12회 범위', 영어 예 '3 sets of 5 reps' 또는 '3 sets of 8-12 reps'), 시간/거리/유지시간 진척이면 세트수만 자연스럽게 (보통 1세트). 'target_sets=3' 같이 코드값 노출 금지. 사용자가 묻지 않으면 기본값 사용 OK.",
  "진척 추적 대상 vs 자유 활동 분류 모호하면 사용자 발화 언어로 직접 질문 (한국어 예 '이거 진척 추적할까요, 아니면 그냥 활동 기록만 할까요?', 영어 예 'Track this as progression, or just log it as an activity?'). 축구·테니스·등산 같은 스포츠는 보통 log_activity 가 자연스럽지만, 사용자가 '시간 늘리기' / '거리 늘리기' 같은 축으로 진척 추적 원하면 적절한 progression 으로 루틴 등록도 가능 — 사용자 의도 확인 후.",
  "RPE 는 1~10 (높을수록 힘듦) — 사용자에게는 RPE 용어 노출 금지, 사용자 언어로 풀어 묻기 (한국어 '힘들었음 점수', 영어 'how hard it felt (1-10)').",
  "세션 기록 시 progression 추론과 분리되는 3가지 케이스 자동 인지 — (a) 워밍업 세트는 sets[].is_warmup=true (b) 컨디션 안 좋아 그날만 가볍게 한 디로드 세션은 is_deload=true (c) 여러 운동을 한 묶음으로 한 슈퍼셋/자이언트셋은 같은 superset_group 키 ('ss-<짧은랜덤>' 형식, AI 가 생성) 로 묶을 routine 들 각각 log_routine_session. 이 표시들은 추이(progression_state) 계산에서 자동 분리되어 운동 기록이 왜곡되지 않음. 사용자에게는 코드값/필드명 노출 금지, 사용자 발화 언어로 자연스럽게 확인 — 한국어 예 '앞 2세트는 워밍업으로 기록할까요?' / '오늘은 디로드 데이로 기록할게요 — progression 추적엔 영향 없어요' / '벤치+푸시업 슈퍼셋으로 묶을게요'. 영어 예 'Mark the first 2 sets as warmup?' / 'Logging today as a deload — won\\'t affect progression' / 'Grouping bench+pushup as a superset'.",
  "운동 흐름 — ① 등록(define_routine_exercise) → ② 묶음(define_split_plan, 선택) → ③ 실행 기록(log_routine_session). 마도서는 다음 목표를 자동으로 계산·추천하지 않는다. 사용자가 스스로 '다음엔 X 해볼래' 라고 다음 목표를 말하면 그 말을 update_routine_state 의 next_session_goal 에 그대로 기록만 한다 (source=manual). 마도서가 다음 무게/시간/거리를 제안하지 말 것.",
  "working_value(현재 능력치) 는 사용자가 스스로 밝힌 '현재 기준값' — 기록·표시 전용. 사용자가 '현재 능력치를 X 로 해줘' 라고 명시할 때만 update_routine_state 로 갱신. 마도서가 갱신을 권하거나 자동 갱신하지 않는다. 'working_value' 코드값 노출 금지 — '현재 능력치' 처럼 자연어로.",
  "routine.memo 는 사용자가 남기는 자유 메모 — 기록·표시 전용. AI 가 메모를 근거로 증량·디로드·식단 같은 조언을 마도서 이름으로 하지 말 것 (조언이 필요하면 마도서 밖, AI 본인 판단으로 분리해 말한다). 메모 등록/수정은 '루틴 메모' 처럼 자연어 합의 후 update_routine_state.",
  "분할 등록 시 종류 사용자 발화 언어로 자연스럽게 합의 — 요일별 / 순환 / 그룹만 정해두고 매번 골라하기 (한국어 예 '요일별(월=가슴/화=등) / 순환(A→B→C→D 순서대로 도는) / 그룹만 정해두고 매번 골라하기', 영어 예 'weekly schedule / rotation cycle / grouped pick-and-choose'). 'weekly/sequence/freestyle' 같이 영어 코드값 노출 금지. 매번 자유롭게 골라하는 체리피커는 분할 등록 안 함.",
  "★ 기록 수정/삭제 — 사용자가 '아까 등록한 점심 칼로리 잘못 적었어' / '방금 측정한 혈압 지워줘' / '오늘 운동 세션 잘못 입력' 같이 말하면, get_state 의 meals_today.items[].id / metrics[].latest_id / routines[].last_session.id / recent_activities[].id 로 해당 기록의 id 를 찾아 처리. 끼니(meal) 수정은 log_meal({id: 'meal:...', ...새 값}) 로 upsert — 단순. 그 외 기록(measure/session/activity) 수정은 delete_entity({kind, id}) 후 다시 log_* — 별도 update 도구 없음. session 삭제는 해당 기록만 지운다. id 는 'meal:...' / 'measure:slug:...' / 'session:slug:...' / 'activity:...' 형식의 전체 key — 사용자에게 절대 노출 금지, 내부에서만 사용. 사용자에겐 자연어로 — 한국어 예 '아까 등록한 점심(450kcal) 을 600kcal 로 수정할게요' / 영어 예 'Updating the lunch you logged earlier (450 kcal) to 600 kcal'.",
  "★ 끼니 프리셋(meal_preset) — 사용자가 자주 먹는 끼를 한 번 정의해두고 다음에 빠르게 호출. 두 시점: (a) 등록: 사용자가 '이거 자주 먹어, 다음엔 빨리 등록하게 저장해줘' 같이 말하면 log_meal 호출 시 as_preset_slug 추가 — 끼 기록 + 프리셋 동시 저장. (b) 사용: get_state.meal_presets[] 에서 사용자 발화에 해당하는 프리셋 식별 후 log_meal({from_preset_slug: '...'}) — 영양값 자동 채움 (호출 args 가 명시한 값은 override 우선). 프리셋 slug 는 영문 snake_case 라 사용자 노출 금지 — 사용자에겐 프리셋 'name' 으로 합의. 한국어 예 '아침 정식(오트밀+그릭요거트, 400kcal) 으로 등록할게요' / 영어 예 'Logging breakfast as your usual oatmeal+greek yogurt (400 kcal)'. 프리셋 등록 전 반드시 사용자 합의 — 임의 등록 금지. 삭제는 delete_entity({kind:'meal_preset', id: slug}).",
  "set_size — 1세트의 고정 크기(카디오 인터벌·격투 라운드 등) 를 기록·표시하기 위한 값 (예 '세트당 5분'). 위젯에 '세트당 N{unit}' 으로 표시됨. 사용자에게 코드값 노출 금지, 자연어로 합의. display_name 에 같은 정보(분/세트 시간)가 중복되면 update_routine_state 로 라벨 정리 권유 (예 'RowErg (5분짜리)' → 'RowErg').",
  "칼로리 기준선은 마도서가 계산하지 않는다 (BMR·유지칼로리 산출 금지). 사용자가 직접 '내 하루 기준 칼로리는 X' 라고 정하면 설정값(daily_kcal_reference)으로 기록되어 오늘 섭취와 비교 표시될 뿐 — 적정량을 마도서가 추천하지 않는다.",
];

// ── 면책·가드 ──────────────────────────────────────────────
// 사용자에게 그대로 보여줄 면책 문구. AI 가 조언을 하면 반드시 이 문구를 먼저 보여준 뒤 말한다.
const ADVICE_DISCLAIMER =
  "⚠️ 여기서부터는 마도서의 기록이 아니라 AI(저)의 개인 판단입니다. " +
  "마도서는 기록·시각화만 하며 이 조언에 어떤 책임도 없습니다. " +
  "이 조언의 책임은 전적으로 AI(저)에게 있습니다. " +
  "의학·식이·운동 관련 내용은 반드시 의사·영양사 등 전문가와 상담하세요.";

// 모든 도구 응답에 동봉되는 가드. AI 가 매 호출마다 보게 되어 '몰랐다' 가 불가능하다.
const MADOSEO_GUARD = {
  scope: "이 마도서는 기록·시각화 전용이다.",
  no_advice: "마도서 이름으로 의학·식이·운동 조언/추천/처방/식단작성을 절대 하지 않는다. 마도서의 어떤 출력값도 조언이 아니다.",
  liability: "마도서는 어떤 조언에도 책임이 없다. 조언을 한다면 그 책임은 전적으로 AI 본인에게 있다.",
  if_ai_insists_on_advice:
    "AI 가 굳이 조언하려면, 마도서 답변과 명확히 분리한 뒤 아래 disclaimer 문구를 사용자에게 그대로 먼저 보여주고 말해야 한다. disclaimer 없이 조언 금지.",
  disclaimer: ADVICE_DISCLAIMER,
};

export async function run({ input, data }: {
  input: { tool: string; args: Record<string, any> };
  secrets: Record<string, string>;
  data: Data;
}): Promise<any> {
  const { tool, args = {} } = input;
  const result = await dispatchTool(tool, args, data);
  // 모든 객체 응답에 가드 동봉 — AI 가 매 호출마다 보게 되어 '몰랐다' 가 불가능하다.
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { _guard: MADOSEO_GUARD, ...result };
  }
  return result;
}

async function dispatchTool(tool: string, args: Record<string, any>, data: Data): Promise<any> {
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
    case "check_reminders": return checkReminders(data);
    case "render_dashboard": return renderDashboard(args, data);
    default: throw new Error(`알 수 없는 도구: ${tool}`);
  }
}

async function getSettings(data: Data) {
  const s = await data.get("__settings");
  return {
    timezone: (typeof s?.timezone === "string" && s.timezone) || "Asia/Seoul",
    // 사용자가 직접 정하는 하루 기준 칼로리 (선택). 마도서가 계산하지 않음 — 오늘 섭취와 비교 표시용.
    daily_kcal_reference: typeof s?.daily_kcal_reference === "number" && s.daily_kcal_reference > 0 ? s.daily_kcal_reference : null,
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

function parseSetSize(v: any): { value: number; unit: string } | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error("set_size 는 { value, unit } 객체.");
  }
  const value = Number(v.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("set_size.value 는 0 초과의 숫자.");
  }
  const unit = String(v.unit ?? "").trim();
  if (!unit) throw new Error("set_size.unit 필수 (예: 'min', 'sec', 'm').");
  if (unit.length > 20) throw new Error("set_size.unit 은 20자 이내.");
  return { value, unit };
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

  // set_size: 1세트의 고정 크기 (선택). 카디오 인터벌(트레드밀 1분), 격투 라운드(3분), RowErg 인터벌(5분) 등.
  const set_size = parseSetSize(args.set_size);

  const routine = {
    slug, display_name, progression, unit, category,
    target_sets,
    target_reps,
    target_reps_min,
    target_reps_max,
    working_value,
    memo,
    set_size,
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

  // display_name: string (라벨만 변경 — 구조 영향 X)
  if ("display_name" in args && args.display_name !== null && args.display_name !== undefined) {
    const dn = String(args.display_name).trim();
    if (!dn) throw new Error("display_name 은 비어있을 수 없음.");
    if (dn.length > 200) throw new Error("display_name 은 200자 이내.");
    patch.display_name = dn;
  }

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

  // target_sets
  if ("target_sets" in args && args.target_sets !== null && args.target_sets !== undefined) {
    patch.target_sets = parsePositiveInt(args.target_sets, "target_sets")!;
  }

  // set_size: { value, unit } | null (명시적 클리어)
  if ("set_size" in args) {
    patch.set_size = args.set_size === null ? null : parseSetSize(args.set_size);
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
  // rpe('힘들었음 점수', 0~10) 는 선택 — 주면 기록만 한다. 마도서는 rpe 로 아무것도 추천/계산하지 않음.
  let rpe: number | null = null;
  if (s.rpe !== undefined && s.rpe !== null && s.rpe !== "") {
    const r = Number(s.rpe);
    if (!Number.isFinite(r) || r < 0 || r > 10) {
      throw new Error("각 세트의 rpe 는 0~10 사이 숫자 ('힘들었음 점수'). 생략 가능.");
    }
    rpe = r;
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
  // 마도서는 세션을 기록만 한다 — 다음 목표를 계산·추천하지 않음.
  // (다음 목표는 사용자가 직접 말할 때만 update_routine_state 로 기록됨)
  return { saved: session };
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
  const eaten_at = String(args.eaten_at ?? nowIso());

  // from_preset_slug — 프리셋의 영양값을 기본값으로 사용 (호출 args 가 명시한 값이 우선)
  let preset: any = null;
  let preset_used_slug: string | null = null;
  if (args.from_preset_slug !== undefined && args.from_preset_slug !== null && String(args.from_preset_slug).trim() !== "") {
    const ps = String(args.from_preset_slug).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(ps)) throw new Error("from_preset_slug 는 snake_case.");
    preset = await data.get(`meal_preset:${ps}`);
    if (!preset) throw new Error(`등록되지 않은 끼니 프리셋 slug: ${ps}.`);
    preset_used_slug = ps;
  }

  const name = String(args.name ?? preset?.name ?? "").trim();
  if (!name) throw new Error("name 필수.");

  const pick = (field: string): number | null => {
    if (typeof args[field] === "number") return args[field];
    if (preset && typeof preset[field] === "number") return preset[field];
    return null;
  };

  const meal = {
    name, eaten_at,
    kcal: pick("kcal"),
    protein_g: pick("protein_g"),
    carbs_g: pick("carbs_g"),
    fat_g: pick("fat_g"),
    from_preset_slug: preset_used_slug,
  };

  // id 가 주어지면 upsert (같은 key 덮어쓰기) — 수정용. 없으면 새 key 생성.
  let key: string;
  if (args.id !== undefined && args.id !== null && String(args.id).trim() !== "") {
    key = String(args.id).trim();
    if (!key.startsWith("meal:")) throw new Error("id 는 'meal:' 로 시작하는 전체 key.");
    const existing = await data.get(key);
    if (!existing) throw new Error(`id '${key}' 의 끼니 없음 — 신규 등록은 id 생략.`);
  } else {
    key = `meal:${eaten_at}:${shortRand()}`;
  }
  await data.set(key, meal);

  // as_preset_slug — 이 끼니의 영양 정보를 프리셋으로도 동시 저장 (덮어쓰기)
  let preset_saved: any = null;
  if (args.as_preset_slug !== undefined && args.as_preset_slug !== null && String(args.as_preset_slug).trim() !== "") {
    const ps = String(args.as_preset_slug).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(ps)) throw new Error("as_preset_slug 는 snake_case.");
    preset_saved = {
      slug: ps,
      name,
      kcal: meal.kcal,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
      defined_at: nowIso(),
    };
    await data.set(`meal_preset:${ps}`, preset_saved);
  }

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

  // 칼로리 기준선은 사용자가 직접 설정한 값(daily_kcal_reference) — 마도서가 계산하지 않음.
  // 기준이 있으면 오늘 섭취와의 차이를 사실로만 보여준다 (적정량 추천 X).
  const daily_kcal_reference = settings.daily_kcal_reference;
  const today_delta_kcal = (daily_kcal_reference !== null && today_totals.kcal !== null)
    ? today_totals.kcal - daily_kcal_reference
    : null;
  return { saved: meal, id: key, today_totals, daily_kcal_reference, today_delta_kcal, preset_used: preset_used_slug, preset_saved };
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
  let sideEffect: any = null;

  switch (kind) {
    // ── 정의(definition) — id 는 slug ───────────────
    case "routine": key = `routine:${id}`; break;
    case "metric": key = `metric:${id}`; break;
    case "reminder": key = `reminder:${id}`; break;
    case "split_plan": key = `split_plan:${id}`; break;
    case "meal_preset": key = `meal_preset:${id}`; break;
    case "fact": {
      const axis = String(args.axis ?? "").trim();
      if (!FACT_AXES.includes(axis as FactAxis)) {
        throw new Error(`kind=fact 일 때 axis 필수 — ${FACT_AXES.join(" / ")} 중 하나.`);
      }
      key = `fact:${axis}:${id}`;
      break;
    }

    // ── 기록(record) — id 는 전체 key (prefix 포함) ───────
    case "meal":
      if (!id.startsWith("meal:")) throw new Error("meal id 는 'meal:' 로 시작하는 전체 key.");
      key = id;
      break;
    case "measure":
      if (!id.startsWith("measure:")) throw new Error("measure id 는 'measure:' 로 시작하는 전체 key.");
      key = id;
      break;
    case "activity":
      if (!id.startsWith("activity:")) throw new Error("activity id 는 'activity:' 로 시작하는 전체 key.");
      key = id;
      break;
    case "session": {
      if (!id.startsWith("session:")) throw new Error("session id 는 'session:' 로 시작하는 전체 key.");
      // 세션은 기록만 — 삭제 시 해당 기록만 지운다.
      // (다음 목표는 사용자가 직접 정하는 값이라 세션 삭제로 건드리지 않음)
      key = id;
      break;
    }

    default: throw new Error("kind 는 routine / metric / reminder / fact / split_plan / meal_preset / meal / measure / session / activity 중 하나.");
  }
  return { deleted: await data.delete(key), kind, id, axis: args.axis ?? null, side_effect: sideEffect };
}

async function getState(data: Data) {
  const settings = await getSettings(data);
  const goal = await data.get("goal");
  const today = dateInTz(settings.timezone);
  const nowMin = hhmmToMin(hhmmInTz(settings.timezone));
  const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;

  const [metricDefsRaw, routineDefsRaw, activitiesRaw, mealsRaw, reminderDefsRaw, factsRaw, splitPlansRaw, mealPresetsRaw] = await Promise.all([
    data.list("metric:"),
    data.list("routine:"),
    data.list("activity:"),
    data.list("meal:"),
    data.list("reminder:"),
    data.list("fact:"),
    data.list("split_plan:"),
    data.list("meal_preset:"),
  ]);
  const metricDefs = metricDefsRaw.map(r => r.value).filter(nonNull);
  const routineDefs = routineDefsRaw.map(r => r.value).filter(nonNull);
  const reminderDefs = reminderDefsRaw.map(r => r.value).filter(nonNull);
  const facts = factsRaw.map(r => r.value).filter(nonNull);
  const splitPlans = splitPlansRaw.map(r => r.value).filter(nonNull);
  const meal_presets = mealPresetsRaw.map(r => r.value).filter(nonNull);

  const user_facts = {
    exercise: facts.filter((f: any) => f.axis === "exercise"),
    health_metric: facts.filter((f: any) => f.axis === "health_metric"),
    diet_reminder: facts.filter((f: any) => f.axis === "diet_reminder"),
    baseline: facts.filter((f: any) => f.axis === "baseline"),
  };

  const [metrics, routines, reminders] = await Promise.all([
    Promise.all(metricDefs.map(async (def: any) => {
      const allRows = await data.list(`measure:${def.slug}:`);
      const all = allRows
        .map(r => ({ id: r.key, ...r.value })).filter((m: any) => m && typeof m.value === "number")
        .sort((a: any, b: any) => String(a.measured_at).localeCompare(String(b.measured_at)));
      const latest: any = all.at(-1) ?? null;
      const last7 = all.filter((m: any) => new Date(m.measured_at).getTime() >= sevenDaysAgo);
      const avg7 = last7.length > 0 ? mean(last7.map((m: any) => m.value)) : null;
      return {
        ...def,
        latest_id: latest?.id ?? null,
        latest_value: latest?.value ?? null,
        latest_measured_at: latest?.measured_at ?? null,
        latest_context: latest?.context ?? null,
        in_target: latest ? evalTarget(latest.value, def.target_min, def.target_max) : null,
        avg_7days: avg7,
        sample_count: all.length,
      };
    })),
    Promise.all(routineDefs.map(async (def: any) => {
      const sessionRows = await data.list(`session:${def.slug}:`);
      const sessions = sessionRows
        .map(r => ({ id: r.key, ...r.value })).filter((s: any) => s && Array.isArray(s.sets))
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
    .map(r => ({ id: r.key, ...r.value })).filter((a: any) => a && typeof a.name === "string")
    .filter((a: any) => new Date(a.performed_at).getTime() >= sevenDaysAgo)
    .sort((a: any, b: any) => String(b.performed_at).localeCompare(String(a.performed_at)));

  const meals_today_items = mealsRaw
    .map(r => ({ id: r.key, ...r.value })).filter((m: any) => m && typeof m.name === "string")
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
    recommended_next_action = "set_goal — 사용자 본인이 표현한 자연어 목표 한 문장을 받아 그대로 기록.";
  } else if (!anyRegistered) {
    protocol_step = "awaiting_initial_setup";
    recommended_next_action = "사용자와 직접 협의해 '무엇을 기록할지' 정한 뒤 define_metric / define_routine_exercise / define_reminder / define_user_fact 로 등록. 마도서가 기록 항목을 추천하지 말 것.";
  } else {
    protocol_step = "operational";
    recommended_next_action = "사용자 요청 처리. 응답·표시는 본 state 안의 기록된 사실에만 근거.";
  }

  return {
    protocol_step,
    ai_rules: AI_RULES,
    recommended_next_action,
    goal: goal ?? null,
    settings,
    server_now: nowIso(),
    server_now_local: `${today} ${hhmmInTz(settings.timezone)}`,
    metrics,
    routines,
    recent_activities,
    meals_today,
    reminders,
    user_facts,
    split_plans: splitPlans,
    active_split_plan,
    meal_presets,
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
    content += renderMetricsCard(s.metrics);
    content += renderFactsCard("건강 관련 사실 (알레르기·복용약 등)", s.user_facts.health_metric);
  } else if (tab === "diet") {
    content += renderDietCard(s.meals_today, s.reminders, s.settings);
    content += renderMealPresetCard(s.meal_presets);
    content += renderFactsCard("식단 제약·알람 관련", s.user_facts.diet_reminder);
  } else if (tab === "baseline") {
    content += renderBaselineSettingsCard(s.settings);
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
.row.stacked{flex-direction:column;align-items:stretch;gap:2px;padding:6px 0}
.row.stacked .name{font-size:11px;color:#a0a0a0}
.row.stacked .val{text-align:left;white-space:normal;font-size:12px;color:#d4d4d4}
.name{color:#d4d4d4;min-width:0;word-break:break-word}
.val{color:#fafafa;font-variant-numeric:tabular-nums;text-align:right;flex-shrink:0;word-break:break-word;overflow-wrap:anywhere}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:6px;vertical-align:middle}
.ok{background:#15402a;color:#4ade80}
.warn{background:#4a2f15;color:#fbbf24}
.crit{background:#4a1515;color:#f87171}
.due{background:#2a2a4a;color:#93c5fd}
.empty{color:#666;font-style:italic;padding:4px 0}
.scope{font-size:10px;color:#666;text-align:center;margin-top:16px;padding-top:10px;border-top:1px solid #1f1f1f;line-height:1.6}
.scope b{color:#9a8cce}
.meta{color:#777;font-size:11px}
.dim{opacity:.6}
.tag{display:inline-block;font-size:10px;color:#a0a0a0;background:#1f1f1f;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle}
.tag.dim{background:#1a1a1a;color:#666}
.sub-hdr{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px;padding-top:8px;border-top:1px solid #1f1f1f}
.routine{padding:8px 6px;margin:0 -6px;border-bottom:1px solid #1f1f1f}
.routine:last-child{border-bottom:none}
.routine-hdr{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:5px}
.routine-name{color:#d4d4d4;min-width:0}
.routine-last{color:#fafafa;font-size:11px;font-variant-numeric:tabular-nums;text-align:right;flex-shrink:0}
.goal-line{font-size:13px;color:#fafafa;padding:5px 8px;background:#1a1530;border-left:2px solid #7c3aed;border-radius:0 4px 4px 0;margin:3px 0}
.goal-line b{color:#c4b5fd;font-size:14px}
.goal-line.dim{background:#161616;border-left-color:#333;color:#666}
.goal-note{font-size:11px;color:#a0a0a0;margin-top:3px}
.stat-row{display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 2px;font-size:11px;color:#888}
.stat{white-space:nowrap}
.stat-k{color:#666;margin-right:3px}
.stat b{color:#d4d4d4}
.memo{font-size:11px;color:#c0c0c0;background:#181818;padding:5px 8px;border-radius:4px;margin:4px 0 2px;border-left:2px solid #444}
.kbar{height:6px;background:#1f1f1f;border-radius:3px;overflow:hidden;margin:6px 0 4px;position:relative}
.kbar-fill{height:100%;background:linear-gradient(90deg,#4ade80 0%,#fbbf24 80%,#f87171 100%);transition:width .2s}
.kbar-mark{position:absolute;top:-2px;bottom:-2px;width:2px;background:#888;opacity:.7}
.meal-row{display:flex;gap:10px;padding:6px 4px;border-bottom:1px solid #1f1f1f;align-items:baseline}
.meal-row:last-child{border-bottom:none}
.meal-time{color:#666;font-size:11px;font-variant-numeric:tabular-nums;min-width:42px;flex-shrink:0}
.meal-name{color:#d4d4d4;flex:1;min-width:0;word-break:break-word}
.meal-kcal{color:#fafafa;font-variant-numeric:tabular-nums;flex-shrink:0;font-size:12px}
.meal-macro{color:#888;font-size:10px;flex-shrink:0;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="hdr">
<div class="step">${escapeHtml(stepLabels[s.protocol_step] || s.protocol_step)} · ${escapeHtml(s.server_now_local)} (${escapeHtml(s.settings.timezone)})</div>
<div class="goal">${goalText}</div>
</div>
<div class="tabs">
${tabs.map(([t, l]) => `<button class="tab ${t === tab ? "active" : ""}" data-tab="${t}">${l}</button>`).join("")}
</div>
${content || '<div class="card"><div class="empty">데이터 없음.</div></div>'}
<div class="scope">이 마도서는 <b>기록·시각화 전용</b>입니다 · 조언·추천을 하지 않습니다<br>조언이 필요하면 AI가 마도서와 분리해 자기 책임으로 말합니다</div>
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
  html += `</div>`;

  if (s.active_split_plan) {
    html += renderTodayBucketCard(s.active_split_plan, s.routines);
  }

  // 오늘 차례 묶음의 루틴들에 stash 된 다음 목표 — overview 에서 하이라이트
  const todayGoals = collectTodayGoals(s);
  if (todayGoals.length > 0) {
    html += `<div class="card"><h3>오늘 운동 다음 목표 (${todayGoals.length})</h3>`;
    for (const item of todayGoals) {
      const g = item.goal;
      const unit = item.unit ? ` ${escapeHtml(String(item.unit))}` : "";
      const valStr = `${roundForDisplay(g.value)}${unit}`;
      const noteStr = g.note ? ` <span class="meta">· ${escapeHtml(String(g.note))}</span>` : "";
      html += `<div class="row"><div class="name">${escapeHtml(item.display_name)}</div><div class="val">🎯 <b>${valStr}</b> <span class="badge due">직접 지정</span>${noteStr}</div></div>`;
    }
    html += `</div>`;
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
    const kcalRef = s.settings?.daily_kcal_reference ?? null;
    if (kcalRef !== null && t.kcal !== null) {
      const delta = t.kcal - kcalRef;
      const sign = delta >= 0 ? "+" : "";
      html += `<div class="row"><div class="name">${t.count}끼 합계</div><div class="val"><b>${t.kcal}</b> / ${kcalRef} kcal <span class="badge meta">${sign}${delta}</span></div></div>`;
      html += renderKcalBar(t.kcal, kcalRef);
    } else if (t.kcal !== null) {
      html += `<div class="row"><div class="name">${t.count}끼 합계</div><div class="val"><b>${t.kcal} kcal</b></div></div>`;
    } else {
      html += `<div class="row"><div class="name">${t.count}끼 기록</div><div class="val"><span class="meta">칼로리 미입력</span></div></div>`;
    }
    const macroParts = [
      t.protein_g !== null ? `<span class="stat"><span class="stat-k">P</span> <b>${t.protein_g}g</b></span>` : null,
      t.carbs_g !== null ? `<span class="stat"><span class="stat-k">C</span> <b>${t.carbs_g}g</b></span>` : null,
      t.fat_g !== null ? `<span class="stat"><span class="stat-k">F</span> <b>${t.fat_g}g</b></span>` : null,
    ].filter(Boolean);
    if (macroParts.length > 0) {
      html += `<div class="stat-row">${macroParts.join("")}</div>`;
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

function collectTodayGoals(s: any): Array<{ display_name: string; unit: string | null; goal: any }> {
  // 활성 분할의 오늘/다음 묶음 routine_slugs 우선, 없으면 전체 routine 의 stash 된 goal
  const plan = s.active_split_plan;
  let slugs: string[] | null = null;
  if (plan?.today_bucket?.routine_slugs?.length > 0) {
    slugs = plan.today_bucket.routine_slugs;
  } else if (plan?.next_bucket_hint?.routine_slugs?.length > 0) {
    slugs = plan.next_bucket_hint.routine_slugs;
  }
  const list: Array<{ display_name: string; unit: string | null; goal: any }> = [];
  if (slugs) {
    for (const slug of slugs) {
      const r = s.routines.find((x: any) => x?.slug === slug);
      if (r?.next_session_goal && typeof r.next_session_goal.value === "number") {
        list.push({ display_name: r.display_name, unit: r.unit ?? null, goal: r.next_session_goal });
      }
    }
  } else {
    // 분할 없으면 — stash 된 모든 루틴 (최대 5개)
    for (const r of s.routines) {
      if (r?.next_session_goal && typeof r.next_session_goal.value === "number") {
        list.push({ display_name: r.display_name, unit: r.unit ?? null, goal: r.next_session_goal });
        if (list.length >= 5) break;
      }
    }
  }
  return list;
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
    html += `<div class="row stacked"><div class="name">${escapeHtml(b.key)} · ${escapeHtml(b.label)}</div><div class="val">${ordered || '<span class="meta">없음</span>'}</div></div>`;
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

  let base: string;
  if (reps !== null) base = `${sets}×${reps}`;
  else if (minOk && maxOk) base = `${sets}×${r.target_reps_min}-${r.target_reps_max}`;
  else base = `${sets}세트`;

  const ss = r.set_size;
  if (ss && typeof ss.value === "number" && typeof ss.unit === "string") {
    base += ` · 세트당 ${roundForDisplay(ss.value)}${ss.unit}`;
  }
  return base;
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

function progressionLabel(progression: string): string {
  switch (progression) {
    case "weight": return "무게 ↑";
    case "time": return "시간 ↓";
    case "distance": return "거리 ↑";
    case "reps": return "횟수 ↑";
    case "hold": return "유지 ↑";
    default: return progression;
  }
}

function renderRoutineBlock(r: any): string {
  const planStr = formatRoutinePlan(r);
  const planTag = planStr ? `<span class="tag">${escapeHtml(planStr)}</span>` : "";
  const progTag = r.progression ? `<span class="tag dim">${escapeHtml(progressionLabel(r.progression))}</span>` : "";
  const summary = formatLastSessionSummary(r.last_session);

  // 다음 목표 — 가장 큰 라인
  const g = r.next_session_goal;
  let goalBlock = "";
  if (g && typeof g.value === "number") {
    const unit = r.unit ? ` ${escapeHtml(String(r.unit))}` : "";
    const valStr = `${roundForDisplay(g.value)}${unit}`;
    const srcBadge = `<span class="badge due" style="margin-left:6px">직접 지정</span>`;
    const noteStr = g.note ? `<div class="goal-note">📝 ${escapeHtml(String(g.note))}</div>` : "";
    goalBlock = `<div class="goal-line">🎯 다음 목표 <b>${valStr}</b>${srcBadge}${noteStr}</div>`;
  } else {
    goalBlock = `<div class="goal-line dim">🎯 다음 목표 <span class="meta">미설정 — 사용자가 "다음엔 X" 라고 말하면 그대로 기록</span></div>`;
  }

  // 능력치 라인 — 현재 / 직전 / 최고
  const ps = r.progression_state ?? {};
  const unit = r.unit ? ` ${escapeHtml(String(r.unit))}` : "";
  const fmt = (v: number | null | undefined) => (typeof v === "number") ? `${roundForDisplay(v)}${unit}` : null;
  const wv = fmt(ps.working_value);
  const cur = fmt(ps.current_value);
  const pr = fmt(ps.pr_value);
  const stateParts: string[] = [];
  if (wv) stateParts.push(`<span class="stat"><span class="stat-k">현재</span> <b>${wv}</b></span>`);
  if (cur) {
    const sameAsWv = wv && ps.current_value === ps.working_value;
    if (!sameAsWv) stateParts.push(`<span class="stat"><span class="stat-k">직전</span> ${cur}</span>`);
  }
  if (pr) stateParts.push(`<span class="stat"><span class="stat-k">최고</span> ${pr}</span>`);
  const stateLine = stateParts.length > 0
    ? `<div class="stat-row">${stateParts.join("")}</div>`
    : "";

  // 메모 — 콜아웃
  const memoBlock = r.memo
    ? `<div class="memo">📝 ${escapeHtml(r.memo)}</div>`
    : "";

  return `<div class="routine">
<div class="routine-hdr">
<div class="routine-name">${escapeHtml(r.display_name)} ${planTag}${progTag}</div>
<div class="routine-last">${summary}</div>
</div>
${goalBlock}
${stateLine}
${memoBlock}
</div>`;
}

function renderExerciseCard(routines: any[], activities: any[]): string {
  let html = '<div class="card"><h3>운동 루틴</h3>';
  if (routines.length === 0 && activities.length === 0) {
    html += '<div class="empty">등록된 루틴/활동 없음.</div></div>';
    return html;
  }
  for (const r of routines) {
    html += renderRoutineBlock(r);
  }
  if (activities.length > 0) {
    html += `<div class="sub-hdr">최근 7일 자유 활동 ${activities.length}건</div>`;
    for (const a of activities.slice(0, 5)) {
      html += `<div class="row"><div class="name">${escapeHtml(a.name)} <span class="meta">(${escapeHtml(a.intensity)})</span></div><div class="val">${a.duration_minutes}분</div></div>`;
    }
  }
  html += "</div>";
  return html;
}

function formatHmFromIso(iso: string, tz: string): string {
  try {
    return hhmmInTz(tz, new Date(iso));
  } catch {
    return String(iso).slice(11, 16);
  }
}

function renderKcalBar(consumed: number, reference: number): string {
  // 0~1.2 비율 막대. 1.0 위치에 사용자가 정한 기준 칼로리 마크 (마도서가 계산한 값 아님).
  const ratio = Math.max(0, Math.min(1.2, consumed / reference));
  const widthPct = (ratio / 1.2) * 100;
  const markPct = (1.0 / 1.2) * 100;
  return `<div class="kbar"><div class="kbar-fill" style="width:${widthPct.toFixed(1)}%"></div><div class="kbar-mark" style="left:${markPct.toFixed(1)}%"></div></div>`;
}

function renderDietCard(mealsToday: any, reminders: any[], settings: any): string {
  let html = `<div class="card"><h3>오늘 식단 · ${escapeHtml(mealsToday.date)}</h3>`;
  if (mealsToday.items.length === 0) {
    html += '<div class="empty">오늘 기록된 끼 없음.</div>';
  } else {
    const t = mealsToday.totals;

    // 오늘 섭취 + (사용자가 직접 정한) 기준 칼로리 비교 — 가장 위. 마도서는 적정량을 계산/추천하지 않는다.
    const kcalRef = settings?.daily_kcal_reference ?? null;
    if (kcalRef !== null && t.kcal !== null) {
      const delta = t.kcal - kcalRef;
      const sign = delta >= 0 ? "+" : "";
      html += `<div class="row"><div class="name">오늘 섭취</div><div class="val"><b>${t.kcal}</b> / ${kcalRef} kcal <span class="badge meta">${sign}${delta}</span></div></div>`;
      html += renderKcalBar(t.kcal, kcalRef);
    } else if (t.kcal !== null) {
      html += `<div class="row"><div class="name">오늘 섭취</div><div class="val"><b>${t.kcal} kcal</b> <span class="meta">(기준 칼로리 미설정)</span></div></div>`;
    } else {
      html += `<div class="row"><div class="name">${t.count}끼 기록</div><div class="val"><span class="meta">칼로리 미입력</span></div></div>`;
    }

    // 매크로 합계
    const macroParts = [
      t.protein_g !== null ? `<span class="stat"><span class="stat-k">P</span> <b>${t.protein_g}g</b></span>` : null,
      t.carbs_g !== null ? `<span class="stat"><span class="stat-k">C</span> <b>${t.carbs_g}g</b></span>` : null,
      t.fat_g !== null ? `<span class="stat"><span class="stat-k">F</span> <b>${t.fat_g}g</b></span>` : null,
    ].filter(Boolean);
    if (macroParts.length > 0) {
      html += `<div class="stat-row">${macroParts.join("")}</div>`;
    }

    // 끼 목록 — 시간순 (전체)
    html += `<div class="sub-hdr">끼니 ${t.count}건</div>`;
    for (const m of mealsToday.items) {
      const hm = escapeHtml(formatHmFromIso(m.eaten_at, settings.timezone));
      const kcalStr = m.kcal !== null ? `${m.kcal} kcal` : '<span class="meta">—</span>';
      const macroStr = [
        m.protein_g !== null ? `P${m.protein_g}` : null,
        m.carbs_g !== null ? `C${m.carbs_g}` : null,
        m.fat_g !== null ? `F${m.fat_g}` : null,
      ].filter(Boolean).join("/");
      const macroHtml = macroStr ? ` <span class="meal-macro">${escapeHtml(macroStr)}</span>` : "";
      html += `<div class="meal-row"><div class="meal-time">${hm}</div><div class="meal-name">${escapeHtml(m.name)}</div><div class="meal-kcal">${kcalStr}</div>${macroHtml}</div>`;
    }
  }
  html += "</div>";

  html += '<div class="card"><h3>알람</h3>';
  if (reminders.length === 0) {
    html += '<div class="empty">등록된 알람 없음.</div>';
  } else {
    for (const r of reminders) {
      const kindKr = r.kind === "supplement" ? "영양제" : r.kind === "measurement" ? "측정" : "행동";
      const slotsHtml = r.today_status.map((sl: any) => {
        const cls = sl.status === "acked" ? "ok"
          : sl.status === "due" ? "due"
          : sl.status === "missed" ? "warn" : "dim";
        return `<span class="badge ${cls}">${sl.slot}</span>`;
      }).join(" ");
      html += `<div class="row"><div class="name">${escapeHtml(r.label)} <span class="tag dim">${kindKr}</span></div><div class="val">${slotsHtml}</div></div>`;
    }
  }
  html += "</div>";
  return html;
}

function renderMealPresetCard(presets: any[]): string {
  let html = `<div class="card"><h3>자주 먹는 끼 (${presets.length})</h3>`;
  if (presets.length === 0) {
    html += '<div class="empty">등록된 프리셋 없음 — "이거 자주 먹어, 저장해줘" 라고 말하면 다음에 빠르게 등록 가능.</div></div>';
    return html;
  }
  for (const p of presets) {
    const kcalStr = typeof p.kcal === "number" ? `${p.kcal} kcal` : '<span class="meta">—</span>';
    const macros = [
      typeof p.protein_g === "number" ? `P${p.protein_g}` : null,
      typeof p.carbs_g === "number" ? `C${p.carbs_g}` : null,
      typeof p.fat_g === "number" ? `F${p.fat_g}` : null,
    ].filter(Boolean).join("/");
    const macroHtml = macros ? ` <span class="meal-macro">${escapeHtml(macros)}</span>` : "";
    html += `<div class="meal-row"><div class="meal-name">${escapeHtml(p.name)}</div><div class="meal-kcal">${kcalStr}</div>${macroHtml}</div>`;
  }
  html += "</div>";
  return html;
}

function renderBaselineSettingsCard(settings: any): string {
  const unsetMeta = '<span class="meta">미설정</span>';
  const kcalRef = settings?.daily_kcal_reference ?? null;
  let html = '<div class="card"><h3>고정 설정 (nesy.app UI 폼)</h3>';
  html += `<div class="row"><div class="name">Timezone</div><div class="val">${escapeHtml(settings.timezone)}</div></div>`;
  html += `<div class="row"><div class="name">하루 기준 칼로리 <span class="meta">(직접 입력)</span></div><div class="val">${kcalRef !== null ? `${kcalRef} kcal` : unsetMeta}</div></div>`;
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
    // 짧은 스칼라(`{v: 2.5}` 등) 는 inline, 그 외(목록/구조체)는 stacked 로 값을 다음 줄에
    const isShort = valueStr.length <= 18 && !valueStr.includes(",") && !valueStr.includes("{");
    if (isShort) {
      html += `<div class="row"><div class="name">${escapeHtml(f.label)}</div><div class="val">${escapeHtml(valueStr)}</div></div>`;
    } else {
      html += `<div class="row stacked"><div class="name">${escapeHtml(f.label)}</div><div class="val">${escapeHtml(valueStr)}</div></div>`;
    }
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
