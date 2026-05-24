type Data = {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  list: (prefix?: string, limit?: number) => Promise<Array<{ key: string; value: any; updated_at: string }>>;
};

const AI_RULES = [
  "응답·추천 전 반드시 get_state 호출.",
  "goal 이 비어있으면 set_goal 부터.",
  "사용자가 명시한 항목만 등록 — 임의 등록 금지.",
  "빈 추론으로 추천 금지 — 사실(get_state 결과)에 근거.",
  "시각·날짜는 settings.timezone 기준 — 추측 금지.",
  "의학적 진단·처방 흉내 금지.",
  "응답 전 goal 문장을 다시 읽고 사용자 발화와 정합성 검증.",
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
    case "delete_routine_exercise": return deleteRoutine(args, data);
    case "log_routine_session": return logSession(args, data);
    case "log_activity": return logActivity(args, data);
    case "define_metric": return defineMetric(args, data);
    case "delete_metric": return deleteMetric(args, data);
    case "record_metric": return recordMetric(args, data);
    case "log_meal": return logMeal(args, data);
    case "define_reminder": return defineReminder(args, data);
    case "delete_reminder": return deleteReminder(args, data);
    case "ack_reminder": return ackReminder(args, data);
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
  return {
    timezone: (typeof s?.timezone === "string" && s.timezone) || "Asia/Seoul",
    activity_factor: typeof s?.activity_factor === "number" ? s.activity_factor : 0,
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

async function deleteRoutine(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  return { deleted: await data.delete(`routine:${slug}`), slug };
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

async function deleteMetric(args: any, data: Data) {
  const slug = String(args.slug ?? "");
  return { deleted: await data.delete(`metric:${slug}`), slug };
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
    const bmrs = (await data.list("measure:bmr:"))
      .map(r => r.value).filter(nonNull)
      .sort((a: any, b: any) => String(a.measured_at).localeCompare(String(b.measured_at)));
    const latest: any = bmrs.at(-1);
    if (latest) {
      const m = latest.value * settings.activity_factor;
      maintenance = {
        bmr: latest.value,
        activity_factor: settings.activity_factor,
        maintenance_kcal: Math.round(m),
        today_delta_kcal: today_totals.kcal !== null ? Math.round(today_totals.kcal - m) : null,
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

async function deleteReminder(args: any, data: Data) {
  const id = String(args.id ?? "");
  return { deleted: await data.delete(`reminder:${id}`), id };
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

async function getState(data: Data) {
  const settings = await getSettings(data);
  const goal = await data.get("goal");
  const today = dateInTz(settings.timezone);
  const nowMin = hhmmToMin(hhmmInTz(settings.timezone));
  const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;

  const [metricDefsRaw, routineDefsRaw, activitiesRaw, mealsRaw, reminderDefsRaw] = await Promise.all([
    data.list("metric:"),
    data.list("routine:"),
    data.list("activity:"),
    data.list("meal:"),
    data.list("reminder:"),
  ]);
  const metricDefs = metricDefsRaw.map(r => r.value).filter(nonNull);
  const routineDefs = routineDefsRaw.map(r => r.value).filter(nonNull);
  const reminderDefs = reminderDefsRaw.map(r => r.value).filter(nonNull);

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

  let protocol_step: string;
  let recommended_next_action: string;
  if (!goal) {
    protocol_step = "awaiting_goal";
    recommended_next_action = "set_goal — 사용자 본인이 표현한 자연어 목표 한 문장을 받아 등록.";
  } else if (metricDefs.length === 0 && routineDefs.length === 0 && reminderDefs.length === 0) {
    protocol_step = "awaiting_initial_setup";
    recommended_next_action = "suggest_setup 으로 템플릿을 받아 사용자에게 제시 → 합의 → define_metric / define_routine_exercise / define_reminder 로 등록.";
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
    metrics,
    routines,
    recent_activities,
    meals_today,
    reminders,
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
  const increment = routine.category === "compound" ? 2.5 : 1.25;

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
      { slug: "bmr", display_name: "기초대사량", unit: "kcal", priority: "normal" },
    ],
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
    note: "이는 '추천'이 아니라 '제안 후보'. AI 가 사용자에게 그대로 제시 → 합의 → define_metric / define_reminder / define_routine_exercise 로 실제 등록. 빈 배열이면 goal 에 매칭 키워드가 없는 것이므로 AI 가 사용자와 직접 협의해서 정의.",
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
    ["overview", "전체"], ["exercise", "운동"], ["metrics", "지표"], ["diet", "식단·알람"],
  ];

  let content = "";
  if (tab === "overview" || tab === "metrics") content += renderMetricsCard(s.metrics);
  if (tab === "overview" || tab === "exercise") content += renderExerciseCard(s.routines, s.recent_activities);
  if (tab === "overview" || tab === "diet") content += renderDietCard(s.meals_today, s.reminders);

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:14px;background:#0a0a0a;color:#e5e5e5;font-size:13px}
.hdr{border-left:3px solid #7c3aed;padding-left:12px;margin-bottom:14px}
.step{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px}
.goal{font-size:15px;margin-top:4px;color:#fafafa;line-height:1.4}
.tabs{display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid #2a2a2a}
.tab{padding:7px 13px;cursor:pointer;color:#888;border:none;background:none;font-size:12px;font-family:inherit}
.tab.active{color:#fafafa;border-bottom:2px solid #7c3aed}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:13px;margin-bottom:10px}
.card h3{margin:0 0 9px;font-size:12px;color:#c0c0c0;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1f1f1f;gap:8px}
.row:last-child{border-bottom:none}
.name{color:#d4d4d4;min-width:0}
.val{color:#fafafa;font-variant-numeric:tabular-nums;text-align:right;flex-shrink:0}
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

function renderDietCard(mealsToday: any, reminders: any[]): string {
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
