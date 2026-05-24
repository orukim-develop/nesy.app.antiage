type Data = {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  list: (prefix?: string, limit?: number) => Promise<Array<{ key: string; value: any; updated_at: string }>>;
};

const FACT_AXES = ["exercise", "health_metric", "diet_reminder", "baseline"] as const;
type FactAxis = typeof FACT_AXES[number];

const AI_RULES = [
  "응답·추천 전 반드시 get_state 호출.",
  "goal 이 비어있으면 set_goal 부터.",
  "사용자가 명시한 항목만 등록 — 임의 등록 금지.",
  "빈 추론으로 추천 금지 — 사실(get_state 결과)에 근거.",
  "시각·날짜는 settings.timezone 기준 — 추측 금지.",
  "의학적 진단·처방 흉내 금지.",
  "응답 전 goal 문장을 다시 읽고 사용자 발화와 정합성 검증.",
  "user_fact 등록 전 반드시 사용자에게 '[축이름] 카테고리에 [라벨]로 넣을게요' 라고 명시 후 합의 받기.",
  "축이 모호하면 사용자에게 'A 또는 B, 어느 쪽?' 직접 질문 — AI 단독 결정 금지.",
  "BMR 은 별도 metric 등록 불필요 — height_cm/sex/birth_year + body_weight_kg 측정으로 자동 계산되어 derived 에 들어옴.",
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
    case "delete_entity": return deleteEntity(args, data);
    case "get_state": return getState(data);
    case "next_weight": return nextWeight(args, data);
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

async function defineRoutine(args: any, data: Data) {
  const slug = String(args.slug ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error("slug 는 snake_case (소문자/숫자/_).");
  const display_name = String(args.display_name ?? "").trim();
  if (!display_name) throw new Error("display_name 필수.");
  const category = String(args.category ?? "").trim();
  if (!["compound", "isolation"].includes(category)) throw new Error("category 는 compound 또는 isolation.");
  const unit = String(args.unit ?? "").trim();
  if (!["kg", "lb"].includes(unit)) throw new Error("unit 는 kg 또는 lb.");
  const routine = {
    slug, display_name, category, unit,
    default_rir_target: typeof args.default_rir_target === "number" ? args.default_rir_target : 2,
    weekly_cap_kg: typeof args.weekly_cap_kg === "number" ? args.weekly_cap_kg : null,
    defined_at: nowIso(),
  };
  await data.set(`routine:${slug}`, routine);
  return { routine };
}

async function logSession(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  const routine = await data.get(`routine:${slug}`);
  if (!routine) throw new Error(`등록되지 않은 운동 slug: ${slug}. define_routine_exercise 먼저.`);
  const sets = Array.isArray(args.sets) ? args.sets : [];
  if (sets.length === 0) throw new Error("sets 1개 이상 필요.");
  const normalized = sets.map((s: any) => ({
    reps: Number(s.reps), weight: Number(s.weight), rir: Number(s.rir),
  }));
  for (const s of normalized) {
    if (!Number.isFinite(s.reps) || !Number.isFinite(s.weight) || !Number.isFinite(s.rir)) {
      throw new Error("각 세트는 reps/weight/rir 모두 숫자.");
    }
  }
  const performed_at = String(args.performed_at ?? nowIso());
  const note = args.note ? String(args.note) : undefined;
  const session: any = { slug, sets: normalized, performed_at };
  if (note) session.note = note;
  await data.set(`session:${slug}:${performed_at}:${shortRand()}`, session);
  const next = await computeNextWeight(slug, data).catch((e: any) => ({ error: e.message }));
  return { saved: session, next_recommendation: next };
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

async function deleteEntity(args: any, data: Data) {
  const kind = String(args.kind ?? "").trim();
  const id = String(args.id ?? "").trim();
  if (!id) throw new Error("id 필수.");
  let key: string;
  switch (kind) {
    case "routine": key = `routine:${id}`; break;
    case "metric": key = `metric:${id}`; break;
    case "reminder": key = `reminder:${id}`; break;
    case "fact": {
      const axis = String(args.axis ?? "").trim();
      if (!FACT_AXES.includes(axis as FactAxis)) {
        throw new Error(`kind=fact 일 때 axis 필수 — ${FACT_AXES.join(" / ")} 중 하나.`);
      }
      key = `fact:${axis}:${id}`;
      break;
    }
    default: throw new Error("kind 는 routine / metric / reminder / fact 중 하나.");
  }
  return { deleted: await data.delete(key), kind, id, axis: args.axis ?? null };
}

async function getState(data: Data) {
  const settings = await getSettings(data);
  const goal = await data.get("goal");
  const today = dateInTz(settings.timezone);
  const nowMin = hhmmToMin(hhmmInTz(settings.timezone));
  const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;

  const [metricDefsRaw, routineDefsRaw, activitiesRaw, mealsRaw, reminderDefsRaw, factsRaw, derived] = await Promise.all([
    data.list("metric:"),
    data.list("routine:"),
    data.list("activity:"),
    data.list("meal:"),
    data.list("reminder:"),
    data.list("fact:"),
    computeDerived(settings, data),
  ]);
  const metricDefs = metricDefsRaw.map(r => r.value).filter(nonNull);
  const routineDefs = routineDefsRaw.map(r => r.value).filter(nonNull);
  const reminderDefs = reminderDefsRaw.map(r => r.value).filter(nonNull);
  const facts = factsRaw.map(r => r.value).filter(nonNull);

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
      return { ...def, session_count: sessions.length, last_session: last };
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

  const anyRegistered = metricDefs.length > 0 || routineDefs.length > 0 || reminderDefs.length > 0 || facts.length > 0;
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
  };
}

async function nextWeight(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  return await computeNextWeight(slug, data);
}

async function computeNextWeight(slug: string, data: Data) {
  const routine = await data.get(`routine:${slug}`);
  if (!routine) throw new Error(`등록되지 않은 운동 slug: ${slug}.`);

  const sessions = (await data.list(`session:${slug}:`))
    .map(r => r.value).filter(nonNull)
    .sort((a: any, b: any) => String(a.performed_at).localeCompare(String(b.performed_at)));

  if (sessions.length === 0) {
    return { next_weight: null, reason: "세션 기록 없음 — 시작 무게는 사용자가 선택." };
  }

  const last: any = sessions[sessions.length - 1];
  const lastAvgRir = mean(last.sets.map((s: any) => s.rir));
  const lastAvgWeight = mean(last.sets.map((s: any) => s.weight));
  const target = routine.default_rir_target ?? 2;

  let increment = routine.category === "compound" ? 2.5 : 1.25;
  let increment_source = "default";
  if (routine.category === "compound") {
    const plateFact = await data.get(`fact:exercise:min_plate_increment_kg`);
    if (plateFact?.value && typeof plateFact.value.v === "number" && plateFact.value.v > 0) {
      increment = plateFact.value.v;
      increment_source = "fact:exercise:min_plate_increment_kg";
    }
  }

  let delta: number;
  if (lastAvgRir > target + 1) delta = increment * 2;
  else if (lastAvgRir >= target) delta = increment;
  else if (lastAvgRir >= target - 1) delta = 0;
  else delta = -increment;

  let proposed = lastAvgWeight + delta;
  let cap_applied = false;
  if (routine.weekly_cap_kg && routine.weekly_cap_kg > 0) {
    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    const recent = sessions.filter((s: any) => new Date(s.performed_at).getTime() >= sevenDaysAgo);
    if (recent.length > 0) {
      const earliestAvg = mean(recent[0].sets.map((s: any) => s.weight));
      if (proposed - earliestAvg > routine.weekly_cap_kg) {
        proposed = earliestAvg + routine.weekly_cap_kg;
        cap_applied = true;
      }
    }
  }

  return {
    next_weight: proposed,
    unit: routine.unit,
    basis: {
      last_avg_weight: lastAvgWeight,
      last_avg_rir: lastAvgRir,
      target_rir: target,
      increment,
      increment_source,
      delta_before_cap: delta,
      weekly_cap_applied: cap_applied,
      session_count: sessions.length,
    },
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
      { slug: "squat", display_name: "백 스쿼트", category: "compound", unit: "kg", default_rir_target: 2, weekly_cap_kg: 5 },
      { slug: "bench_press", display_name: "벤치프레스", category: "compound", unit: "kg", default_rir_target: 2, weekly_cap_kg: 5 },
      { slug: "deadlift", display_name: "데드리프트", category: "compound", unit: "kg", default_rir_target: 2, weekly_cap_kg: 5 },
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
  if (s.derived?.age !== null) {
    html += `<div class="row"><div class="name">나이 (자동)</div><div class="val">${s.derived.age}세</div></div>`;
  }
  if (s.derived?.bmr !== null) {
    html += `<div class="row"><div class="name">기초대사량 (Mifflin-St Jeor)</div><div class="val">${s.derived.bmr} kcal</div></div>`;
  }
  html += `</div>`;

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

function renderExerciseCard(routines: any[], activities: any[]): string {
  let html = '<div class="card"><h3>운동</h3>';
  if (routines.length === 0 && activities.length === 0) {
    html += '<div class="empty">등록된 루틴/활동 없음.</div></div>';
    return html;
  }
  for (const r of routines) {
    const last = r.last_session;
    const summary = last
      ? `${last.sets.length}세트 · ${escapeHtml(String(last.performed_at).slice(0, 10))}`
      : '<span class="meta">기록 없음</span>';
    html += `<div class="row"><div class="name">${escapeHtml(r.display_name)} <span class="meta">(${r.category})</span></div><div class="val">${summary}</div></div>`;
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
