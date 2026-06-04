// 메모리 기반 Data mock + 핵심 시나리오 sanity 테스트.
// 실행: bun sanity.test.ts
import { run } from "./index";

type Row = { key: string; value: any; updated_at: string };

function makeData() {
  const store = new Map<string, Row>();
  return {
    async get(key: string) { return store.get(key)?.value ?? null; },
    async set(key: string, value: any) {
      store.set(key, { key, value, updated_at: new Date().toISOString() });
    },
    async delete(key: string) { return store.delete(key); },
    async list(prefix = "", limit?: number) {
      const out: Row[] = [];
      for (const row of store.values()) {
        if (row.key.startsWith(prefix)) out.push(row);
        if (limit && out.length >= limit) break;
      }
      return out;
    },
    _raw: store,
  };
}

let passed = 0, failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push({ name, fn });
const assert = (cond: any, msg: string) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};
const eq = <T>(actual: T, expected: T, msg: string) => {
  if (actual !== expected) throw new Error(`${msg} — expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
};

const call = (data: any, tool: string, args: any = {}) =>
  run({ input: { tool, args }, secrets: {}, data });

// ── 면책·가드(_guard) ─────────────────────────────────
test("_guard — 모든 응답에 조언금지·면책 가드가 동봉된다", async () => {
  const data = makeData();
  const samples = [
    await call(data, "get_state"),
    await call(data, "set_goal", { text: "건강 기록" }),
    await call(data, "log_meal", { name: "아침", kcal: 300 }),
    await call(data, "render_dashboard", { tab: "overview" }),
  ];
  for (const r of samples) {
    assert(r._guard, "_guard 존재");
    assert(/조언/.test(r._guard.no_advice), "조언 금지 문구");
    assert(/책임/.test(r._guard.liability), "책임 분리 문구");
    assert(typeof r._guard.disclaimer === "string" && r._guard.disclaimer.length > 10, "disclaimer 문구 존재");
  }
});

test("_guard.disclaimer — 마도서 면책 + AI 책임 + 전문가 상담 포함", async () => {
  const data = makeData();
  const d = (await call(data, "get_state"))._guard.disclaimer;
  assert(/마도서/.test(d), "마도서 면책 언급");
  assert(/책임/.test(d), "책임 소재 언급");
  assert(/전문가|의사|영양사/.test(d), "전문가 상담 권고 포함");
});

test("_guard — 새 운동 도구(define_exercise/define_routine/log_workout) 응답에도 동봉", async () => {
  const data = makeData();
  const a = await call(data, "define_exercise", { slug: "sq", display_name: "스쿼트", progression: "weight", category: "compound", unit: "kg" });
  assert(a._guard && /조언/.test(a._guard.no_advice), "define_exercise 가드");
  const b = await call(data, "define_routine", { slug: "leg", display_name: "다리", source_text: "스쿼트 5세트", blocks: [{ kind: "straight", label: "스쿼트 5세트", items: [{ exercise_slug: "sq", sets: 5, reps: 5 }] }] });
  assert(b._guard && /조언/.test(b._guard.no_advice), "define_routine 가드");
  const c = await call(data, "log_workout", { routine_slug: "leg", blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "sq", sets: [{ reps: 5, weight: 100 }] }] }] });
  assert(c._guard && /조언/.test(c._guard.no_advice), "log_workout 가드");
});

// ── 끼니 upsert ───────────────────────────────────────
test("log_meal 신규 등록 → id 반환", async () => {
  const data = makeData();
  const r = await call(data, "log_meal", { name: "아침", kcal: 400 });
  assert(typeof r.id === "string" && r.id.startsWith("meal:"), "id 는 meal: 로 시작");
  eq(r.saved.name, "아침", "name 보존");
  eq(r.saved.kcal, 400, "kcal 보존");
  eq(r.today_totals.count, 1, "오늘 1끼");
});

test("log_meal upsert — 같은 id 로 재호출 시 덮어쓰기", async () => {
  const data = makeData();
  const r1 = await call(data, "log_meal", { name: "점심", kcal: 500 });
  const id = r1.id;
  const r2 = await call(data, "log_meal", { id, name: "점심 (수정)", kcal: 700, eaten_at: r1.saved.eaten_at });
  eq(r2.id, id, "같은 id 유지");
  eq(r2.saved.name, "점심 (수정)", "name 덮어쓰기");
  eq(r2.saved.kcal, 700, "kcal 덮어쓰기");
  eq(r2.today_totals.count, 1, "여전히 1끼 (중복 아님)");
  eq(r2.today_totals.kcal, 700, "합계 새 값");
});

test("log_meal id 가 잘못된 prefix 면 에러", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "log_meal", { id: "wrong:key", name: "x" }); } catch (e) { err = e; }
  assert(err && /meal:/.test(err.message), "에러 메시지에 meal: 언급");
});

test("log_meal id 가 존재 X 면 에러 — 신규는 id 생략 강제", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "log_meal", { id: "meal:2026-01-01T00:00:00Z:abc", name: "x" }); } catch (e) { err = e; }
  assert(err && /없음|신규/.test(err.message), "id 없음 안내");
});

// ── 기록 삭제 ──────────────────────────────────────────
test("delete_entity meal — 전체 key 로 삭제", async () => {
  const data = makeData();
  const r = await call(data, "log_meal", { name: "저녁" });
  const d = await call(data, "delete_entity", { kind: "meal", id: r.id });
  eq(d.deleted, true, "삭제 성공");
  const state = await call(data, "get_state", {});
  eq(state.meals_today.items.length, 0, "오늘 끼니 0");
});

test("delete_entity activity — 전체 key 로 삭제", async () => {
  const data = makeData();
  await call(data, "log_activity", { name: "산책", intensity: "light", duration_minutes: 30 });
  const state1 = await call(data, "get_state", {});
  eq(state1.recent_activities.length, 1, "1건");
  const id = state1.recent_activities[0].id;
  assert(typeof id === "string" && id.startsWith("activity:"), "id 는 activity: prefix");
  const d = await call(data, "delete_entity", { kind: "activity", id });
  eq(d.deleted, true, "삭제 성공");
  const state2 = await call(data, "get_state", {});
  eq(state2.recent_activities.length, 0, "0건");
});

test("delete_entity measure — latest_id 로 삭제", async () => {
  const data = makeData();
  await call(data, "define_metric", { slug: "body_weight_kg", display_name: "체중", unit: "kg", priority: "high" });
  await call(data, "record_metric", { slug: "body_weight_kg", value: 70 });
  const state1 = await call(data, "get_state", {});
  const id = state1.metrics[0].latest_id;
  assert(typeof id === "string" && id.startsWith("measure:body_weight_kg:"), "id prefix");
  const d = await call(data, "delete_entity", { kind: "measure", id });
  eq(d.deleted, true, "삭제 성공");
  const state2 = await call(data, "get_state", {});
  eq(state2.metrics[0].latest_value, null, "측정 없음");
});

test("delete_entity workout — 기록만 삭제, 사용자가 정한 다음 목표는 건드리지 않음", async () => {
  const data = makeData();
  await call(data, "define_exercise", {
    slug: "bench", display_name: "벤치", progression: "weight", category: "compound", unit: "kg",
    default_sets: 3, default_reps: 5,
  });
  // 다음 목표는 사용자가 직접 정한 값 — 마도서가 계산하지 않는다.
  await call(data, "update_exercise", {
    slug: "bench", next_session_goal: { value: 102.5, note: "다음엔 이거" },
  });
  await call(data, "log_workout", {
    routine_slug: "_adhoc",
    blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "bench", sets: [{ reps: 5, weight: 100, rpe: 7 }] }] }],
  });
  const s1 = await call(data, "get_state", {});
  const ex1 = s1.exercises.find((x: any) => x.slug === "bench");
  const workoutId = ex1.last_session.id;
  assert(typeof workoutId === "string" && workoutId.startsWith("workout:_adhoc:"), `workout id prefix — got ${workoutId}`);

  // workout 삭제는 그 기록만 지운다 — 다음 목표를 재계산/클리어하지 않음 (side_effect 없음).
  const d = await call(data, "delete_entity", { kind: "workout", id: workoutId });
  eq(d.deleted, true, "삭제 성공");
  eq(d.side_effect, null, "workout 삭제 부수효과 없음");

  const s2 = await call(data, "get_state", {});
  const ex2 = s2.exercises.find((x: any) => x.slug === "bench");
  assert(ex2.next_session_goal && ex2.next_session_goal.value === 102.5, `다음 목표 유지 — got ${JSON.stringify(ex2.next_session_goal)}`);
  eq(ex2.session_count, 0, "기록 삭제됨");
});

// ── id 가 get_state 에 surface ────────────────────────
test("get_state — meal/activity/metric/workout 모두 id 노출", async () => {
  const data = makeData();
  await call(data, "log_meal", { name: "끼니1", kcal: 300 });
  await call(data, "log_activity", { name: "조깅", intensity: "moderate", duration_minutes: 20 });
  await call(data, "define_metric", { slug: "bp", display_name: "혈압", unit: "mmHg", priority: "high" });
  await call(data, "record_metric", { slug: "bp", value: 120 });
  await call(data, "define_exercise", {
    slug: "dl", display_name: "데드", progression: "weight", category: "compound", unit: "kg", default_sets: 1, default_reps: 5,
  });
  await call(data, "log_workout", { routine_slug: "_adhoc", blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "dl", sets: [{ reps: 5, weight: 100, rpe: 8 }] }] }] });

  const s = await call(data, "get_state", {});
  assert(s.meals_today.items[0].id?.startsWith("meal:"), "meal id");
  assert(s.recent_activities[0].id?.startsWith("activity:"), "activity id");
  assert(s.metrics[0].latest_id?.startsWith("measure:bp:"), "metric latest_id");
  assert(s.exercises[0].last_session.id?.startsWith("workout:"), "workout id");
});

test("delete_entity 모르는 kind → 에러 메시지에 신규 kind 포함", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "delete_entity", { kind: "unknown", id: "x" }); } catch (e) { err = e; }
  assert(err && /meal/.test(err.message) && /workout/.test(err.message), "에러에 meal/workout 언급");
});

// ── 끼니 프리셋 ───────────────────────────────────────
test("log_meal as_preset_slug — 끼니 + 프리셋 동시 저장", async () => {
  const data = makeData();
  const r = await call(data, "log_meal", {
    name: "아침 오트밀+요거트", kcal: 420, protein_g: 25, carbs_g: 55, fat_g: 12,
    as_preset_slug: "breakfast_oatmeal",
  });
  assert(r.preset_saved, "preset_saved 반환");
  eq(r.preset_saved.slug, "breakfast_oatmeal", "slug 보존");
  eq(r.preset_saved.name, "아침 오트밀+요거트", "name 보존");
  eq(r.preset_saved.kcal, 420, "kcal 보존");
  eq(r.preset_saved.protein_g, 25, "protein 보존");
  // 끼니도 같이 저장됐는지 확인
  eq(r.today_totals.count, 1, "끼니 1건");
  // get_state.meal_presets 에 노출
  const s = await call(data, "get_state", {});
  eq(s.meal_presets.length, 1, "프리셋 1개");
  eq(s.meal_presets[0].slug, "breakfast_oatmeal", "프리셋 slug 노출");
});

test("log_meal from_preset_slug — 프리셋 영양값 자동 채움", async () => {
  const data = makeData();
  // 프리셋 등록
  await call(data, "log_meal", {
    name: "아침 오트밀", kcal: 400, protein_g: 20, carbs_g: 50, fat_g: 10,
    as_preset_slug: "breakfast",
  });
  // 다음 날 같은 프리셋 호출 — name/macro 다 생략
  const r = await call(data, "log_meal", { from_preset_slug: "breakfast" });
  eq(r.saved.name, "아침 오트밀", "name 자동 채움");
  eq(r.saved.kcal, 400, "kcal 자동 채움");
  eq(r.saved.protein_g, 20, "protein 자동 채움");
  eq(r.saved.carbs_g, 50, "carbs 자동 채움");
  eq(r.saved.fat_g, 10, "fat 자동 채움");
  eq(r.preset_used, "breakfast", "preset_used 보고");
});

test("log_meal from_preset_slug — 명시 args 가 프리셋 override", async () => {
  const data = makeData();
  await call(data, "log_meal", {
    name: "기본 아침", kcal: 400, protein_g: 20,
    as_preset_slug: "breakfast",
  });
  // 호출 시 kcal 만 override
  const r = await call(data, "log_meal", {
    from_preset_slug: "breakfast", kcal: 500,
  });
  eq(r.saved.name, "기본 아침", "name 은 프리셋");
  eq(r.saved.kcal, 500, "kcal 는 override");
  eq(r.saved.protein_g, 20, "protein 은 프리셋");
});

test("log_meal from_preset_slug — name override 가능", async () => {
  const data = makeData();
  await call(data, "log_meal", {
    name: "기본 아침", kcal: 400,
    as_preset_slug: "breakfast",
  });
  const r = await call(data, "log_meal", {
    from_preset_slug: "breakfast", name: "오늘은 아점",
  });
  eq(r.saved.name, "오늘은 아점", "name override 우선");
  eq(r.saved.kcal, 400, "kcal 는 프리셋");
});

test("log_meal from_preset_slug — 존재하지 않는 프리셋 → 에러", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "log_meal", { from_preset_slug: "nope" }); } catch (e) { err = e; }
  assert(err && /프리셋/.test(err.message), "프리셋 없음 에러");
});

test("log_meal as_preset_slug — 잘못된 snake_case → 에러", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "log_meal", { name: "x", as_preset_slug: "BadSlug" }); } catch (e) { err = e; }
  assert(err && /snake_case/.test(err.message), "snake_case 에러");
});

test("log_meal from_preset_slug — 잘못된 snake_case → 에러", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "log_meal", { from_preset_slug: "Bad-Slug" }); } catch (e) { err = e; }
  assert(err && /snake_case/.test(err.message), "snake_case 에러");
});

test("log_meal as_preset_slug 같은 slug 재호출 → 프리셋 덮어쓰기", async () => {
  const data = makeData();
  await call(data, "log_meal", {
    name: "아침 V1", kcal: 400,
    as_preset_slug: "breakfast",
  });
  await call(data, "log_meal", {
    name: "아침 V2", kcal: 500,
    as_preset_slug: "breakfast",
  });
  const s = await call(data, "get_state", {});
  eq(s.meal_presets.length, 1, "프리셋 여전히 1개 (덮어쓰기)");
  eq(s.meal_presets[0].name, "아침 V2", "최신 name");
  eq(s.meal_presets[0].kcal, 500, "최신 kcal");
});

test("delete_entity meal_preset — slug 로 삭제", async () => {
  const data = makeData();
  await call(data, "log_meal", {
    name: "삭제 대상", kcal: 300,
    as_preset_slug: "to_delete",
  });
  const s1 = await call(data, "get_state", {});
  eq(s1.meal_presets.length, 1, "프리셋 등록됨");

  const d = await call(data, "delete_entity", { kind: "meal_preset", id: "to_delete" });
  eq(d.deleted, true, "삭제 성공");

  const s2 = await call(data, "get_state", {});
  eq(s2.meal_presets.length, 0, "프리셋 0개");
});

test("delete_entity 에러 메시지에 meal_preset 포함", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "delete_entity", { kind: "unknown", id: "x" }); } catch (e) { err = e; }
  assert(err && /meal_preset/.test(err.message), "에러에 meal_preset 언급");
});

test("log_meal — name 도 프리셋도 없으면 에러", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "log_meal", {}); } catch (e) { err = e; }
  assert(err && /name/.test(err.message), "name 필수 에러");
});

// ── 운동(v2): 운동(exercise) ──────────────────────────
test("define_exercise — set_size 라운드트립 + get_state.exercises 노출", async () => {
  const data = makeData();
  const r = await call(data, "define_exercise", {
    slug: "treadmill_jog", display_name: "트레드밀 조깅",
    progression: "distance", unit: "km/h", baseline_value: 9,
    default_sets: 20, set_size: { value: 1, unit: "min" },
  });
  eq(r.exercise.set_size.value, 1, "value 보존");
  eq(r.exercise.set_size.unit, "min", "unit 보존");
  eq(r.exercise.baseline_value, 9, "baseline 보존");
  eq(r.exercise.baseline_source, "manual", "등록 시 baseline → manual");
  const s = await call(data, "get_state");
  const def = s.exercises.find((x: any) => x.slug === "treadmill_jog");
  assert(def && def.set_size, "get_state.exercises 에 set_size 노출");
  eq(def.set_size.value, 1, "get_state value");
});

test("define_exercise — set_size 생략 → null, baseline 생략 → null", async () => {
  const data = makeData();
  const r = await call(data, "define_exercise", {
    slug: "squat", display_name: "백 스쿼트",
    progression: "weight", category: "compound", unit: "kg",
  });
  eq(r.exercise.set_size, null, "set_size 생략 시 null");
  eq(r.exercise.baseline_value, null, "baseline 생략 시 null");
  eq(r.exercise.baseline_source, null, "baseline_source null");
});

test("define_exercise — set_size 잘못된 입력 거부", async () => {
  const data = makeData();
  const base = { display_name: "x", progression: "reps", unit: "번" };
  const cases = [
    { args: { set_size: { value: 0, unit: "min" } }, label: "value_zero" },
    { args: { set_size: { value: 1, unit: "" } }, label: "unit_empty" },
    { args: { set_size: "not_object" }, label: "not_object" },
    { args: { set_size: { value: "abc", unit: "min" } }, label: "value_nan" },
  ];
  for (const c of cases) {
    let err: any = null;
    try { await call(data, "define_exercise", { ...base, slug: `x_${c.label}`, ...c.args }); } catch (e) { err = e; }
    assert(err && /set_size/.test(err.message), `${c.label}: set_size 에러 (got: ${err?.message ?? "no error"})`);
  }
});

test("update_exercise — set_size 추가/변경/유지/클리어", async () => {
  const data = makeData();
  await call(data, "define_exercise", {
    slug: "rower", display_name: "RowErg", progression: "time", unit: "min/500m", baseline_value: 2.4,
  });
  const r1 = await call(data, "update_exercise", { slug: "rower", set_size: { value: 5, unit: "min" } });
  eq(r1.exercise.set_size.value, 5, "추가 후 value");
  const r2 = await call(data, "update_exercise", { slug: "rower", memo: "유지 확인" });
  eq(r2.exercise.set_size.value, 5, "생략 시 유지");
  eq(r2.exercise.memo, "유지 확인", "memo 변경");
  const r3 = await call(data, "update_exercise", { slug: "rower", set_size: null });
  eq(r3.exercise.set_size, null, "null 클리어");
});

test("update_exercise — baseline_value 갱신은 source=manual", async () => {
  const data = makeData();
  await call(data, "define_exercise", { slug: "ohp", display_name: "오버헤드", progression: "weight", category: "compound", unit: "kg", baseline_value: 40 });
  const r = await call(data, "update_exercise", { slug: "ohp", baseline_value: 42.5 });
  eq(r.exercise.baseline_value, 42.5, "갱신값");
  eq(r.exercise.baseline_source, "manual", "수동 갱신 source");
});

test("update_exercise — display_name 변경 + 다른 필드 유지", async () => {
  const data = makeData();
  await call(data, "define_exercise", {
    slug: "rg", display_name: "RowErg (5분짜리)", progression: "time", unit: "min/500m",
    baseline_value: 2.4, set_size: { value: 5, unit: "min" },
  });
  const r = await call(data, "update_exercise", { slug: "rg", display_name: "RowErg" });
  eq(r.exercise.display_name, "RowErg", "라벨 변경 반영");
  eq(r.exercise.baseline_value, 2.4, "baseline 유지");
  eq(r.exercise.set_size.value, 5, "set_size 유지");
});

// ── 운동(v2): 루틴(routine_v2) ────────────────────────
test("define_routine — blocks 라운드트립 (슈퍼셋 items 2개)", async () => {
  const data = makeData();
  await call(data, "define_exercise", { slug: "bench", display_name: "벤치", progression: "weight", category: "compound", unit: "kg" });
  await call(data, "define_exercise", { slug: "row", display_name: "바벨로우", progression: "weight", category: "compound", unit: "kg" });
  const r = await call(data, "define_routine", {
    slug: "push_a", display_name: "푸시 A",
    source_text: "벤치 5×5 하고 벤치+로우 슈퍼셋 3라운드",
    blocks: [
      { kind: "straight", label: "벤치 5세트 5회", items: [{ exercise_slug: "bench", sets: 5, reps: 5 }] },
      { kind: "superset", label: "벤치+로우 슈퍼셋 3라운드", items: [{ exercise_slug: "bench" }, { exercise_slug: "row" }], prescription: { rounds: 3 } },
    ],
  });
  eq(r.routine.blocks.length, 2, "블록 2개");
  eq(r.routine.source_text, "벤치 5×5 하고 벤치+로우 슈퍼셋 3라운드", "원문 보존");
  eq(r.routine.blocks[0].block_id, "b1", "block_id 자동 부여");
  eq(r.routine.blocks[1].items.length, 2, "슈퍼셋 items 2개");
  eq(r.routine.blocks[1].prescription.rounds, 3, "rounds 보존");
  const s = await call(data, "get_state");
  assert(s.routines_v2.find((x: any) => x.slug === "push_a"), "get_state.routines_v2 노출");
});

test("define_routine — 미등록 운동 참조 시 에러", async () => {
  const data = makeData();
  let err: any = null;
  try {
    await call(data, "define_routine", { slug: "x", display_name: "x", blocks: [{ kind: "straight", label: "없는운동", items: [{ exercise_slug: "ghost" }] }] });
  } catch (e) { err = e; }
  assert(err && /ghost/.test(err.message) && /미등록/.test(err.message), "미등록 운동 에러");
});

test("define_routine — 모르는 kind 도 거부 안 함 (custom 처럼 보존)", async () => {
  const data = makeData();
  await call(data, "define_exercise", { slug: "kb", display_name: "케틀벨", progression: "reps", unit: "회" });
  const r = await call(data, "define_routine", {
    slug: "weird", display_name: "특이",
    blocks: [{ kind: "death_by_burpee", label: "데스 바이 버피", items: [{ exercise_slug: "kb" }], note: "1분에 1개씩 늘려가기", params: { start: 1 } }],
  });
  eq(r.routine.blocks[0].kind, "death_by_burpee", "모르는 kind 보존");
  eq(r.routine.blocks[0].note, "1분에 1개씩 늘려가기", "note 보존");
  eq(r.routine.blocks[0].params.start, 1, "params 보존");
});

test("define_routine — label 누락 시 에러", async () => {
  const data = makeData();
  await call(data, "define_exercise", { slug: "p", display_name: "푸시업", progression: "reps", unit: "회" });
  let err: any = null;
  try { await call(data, "define_routine", { slug: "y", display_name: "y", blocks: [{ kind: "straight", items: [{ exercise_slug: "p" }] }] }); } catch (e) { err = e; }
  assert(err && /label/.test(err.message), "label 필수 에러");
});

// ── 운동(v2): 기록(log_workout) + 진척 ────────────────
test("log_workout → progression_state(현재/최고) 계산", async () => {
  const data = makeData();
  await call(data, "define_exercise", { slug: "sq", display_name: "스쿼트", progression: "weight", category: "compound", unit: "kg", baseline_value: 100 });
  await call(data, "log_workout", { routine_slug: "_adhoc", performed_at: "2026-06-01T12:00:00.000Z", blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "sq", sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] }] }] });
  await call(data, "log_workout", { routine_slug: "_adhoc", performed_at: "2026-06-03T12:00:00.000Z", blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "sq", sets: [{ reps: 5, weight: 105 }] }] }] });
  const s = await call(data, "get_state");
  const ex = s.exercises.find((x: any) => x.slug === "sq");
  eq(ex.session_count, 2, "세션 2개");
  eq(ex.progression_state.current_value, 105, "현재=최근 본세트 평균");
  eq(ex.progression_state.pr_value, 105, "최고 105");
  eq(ex.progression_state.working_value, 100, "기준값 반영");
});

// ── 운동(v2): 배치(schedule) ──────────────────────────
test("define_schedule — 루틴 가리키는 묶음 라운드트립 + 활성 노출", async () => {
  const data = makeData();
  await call(data, "define_exercise", { slug: "bench", display_name: "벤치", progression: "weight", category: "compound", unit: "kg" });
  await call(data, "define_routine", { slug: "push_a", display_name: "푸시 A", blocks: [{ kind: "straight", label: "벤치 5세트", items: [{ exercise_slug: "bench", sets: 5, reps: 5 }] }] });
  const r = await call(data, "define_schedule", {
    slug: "ppl", name: "PPL",
    buckets: [{ key: "push", label: "푸시", routine_v2_slugs: ["push_a"] }],
    assignment: { kind: "weekly", map: { mon: "push" } },
    is_active: true,
  });
  eq(r.schedule.buckets[0].routine_v2_slugs[0], "push_a", "루틴 참조 보존");
  const s = await call(data, "get_state");
  assert(s.active_schedule && s.active_schedule.name === "PPL", "active_schedule 노출");
});

test("define_schedule — 미등록 루틴 참조 시 에러", async () => {
  const data = makeData();
  let err: any = null;
  try {
    await call(data, "define_schedule", { slug: "x", name: "x", buckets: [{ key: "a", label: "a", routine_v2_slugs: ["ghost_routine"] }], assignment: { kind: "freestyle" } });
  } catch (e) { err = e; }
  assert(err && /ghost_routine/.test(err.message) && /미등록/.test(err.message), "미등록 루틴 에러");
});

// ── 운동(v2) 위젯 렌더 ─────────────────────────────────
const everyDay = (b: string) => ({ mon: b, tue: b, wed: b, thu: b, fri: b, sat: b, sun: b });

test("render_dashboard 운동탭 — 슈퍼셋 묶음 박스/라운드/한국어 뱃지, kind 코드값 미노출", async () => {
  const data = makeData();
  await call(data, "set_goal", { text: "근력" });
  await call(data, "define_exercise", { slug: "bench", display_name: "벤치프레스", progression: "weight", category: "compound", unit: "kg", baseline_value: 80, default_reps: 5 });
  await call(data, "define_exercise", { slug: "row", display_name: "바벨로우", progression: "weight", category: "compound", unit: "kg", baseline_value: 60, default_reps: 8 });
  await call(data, "define_routine", {
    slug: "push_a", display_name: "푸시 A", source_text: "벤치+로우 슈퍼셋 3라운드",
    blocks: [{ kind: "superset", label: "벤치+로우 슈퍼셋", items: [{ exercise_slug: "bench" }, { exercise_slug: "row" }], prescription: { rounds: 3 } }],
  });
  await call(data, "define_schedule", { slug: "ppl", name: "PPL", buckets: [{ key: "push", label: "푸시", routine_v2_slugs: ["push_a"] }], assignment: { kind: "weekly", map: everyDay("push") }, is_active: true });
  const r = await call(data, "render_dashboard", { tab: "exercise" });
  assert(typeof r.html === "string", "html 반환");
  assert(/block-group/.test(r.html), "슈퍼셋 묶음 박스(.block-group)");
  assert(/슈퍼셋/.test(r.html), "한국어 종류 뱃지");
  assert(/라운드 1/.test(r.html) && /라운드 3/.test(r.html), "라운드 구획");
  assert(/벤치프레스/.test(r.html) && /바벨로우/.test(r.html), "운동 이름");
  assert(!/>superset</.test(r.html), "kind 코드값(superset) 미노출");
});

test("render_dashboard 운동탭 — 기준값 초과 시 '바꿀까요?' + 확정해야만 갱신(source=logged)", async () => {
  const data = makeData();
  await call(data, "set_goal", { text: "근력" });
  await call(data, "define_exercise", { slug: "sq", display_name: "스쿼트", progression: "weight", category: "compound", unit: "kg", baseline_value: 100, default_reps: 5, default_sets: 3 });
  await call(data, "define_routine", { slug: "leg", display_name: "레그", blocks: [{ kind: "straight", label: "스쿼트 3세트", items: [{ exercise_slug: "sq", sets: 3 }] }] });
  await call(data, "define_schedule", { slug: "s", name: "S", buckets: [{ key: "a", label: "레그", routine_v2_slugs: ["leg"] }], assignment: { kind: "weekly", map: everyDay("a") }, is_active: true });
  // 105kg 한 세트 기록 (위젯 동작)
  await call(data, "render_dashboard", { tab: "exercise", action: { kind: "log_block_set", routine: "leg", block_id: "b1", exercise: "sq", i: 0, w: 105, r: 5, nonce: "n1" } });
  let s = await call(data, "get_state");
  eq(s.exercises.find((x: any) => x.slug === "sq").baseline_value, 100, "확인 전 기준값 유지");
  const r = await call(data, "render_dashboard", { tab: "exercise" });
  assert(/바꿀까요/.test(r.html), "기준값 변경 제안 표시");
  assert(/raiseBaseline\('sq',105\)/.test(r.html), "raiseBaseline 버튼");
  // 확정
  await call(data, "render_dashboard", { tab: "exercise", action: { kind: "raise_baseline", exercise: "sq", value: 105, nonce: "n2" } });
  s = await call(data, "get_state");
  const ex = s.exercises.find((x: any) => x.slug === "sq");
  eq(ex.baseline_value, 105, "확인 후 기준값 105");
  eq(ex.baseline_source, "logged", "source=logged");
});

test("render_dashboard 운동탭 — 모르는 kind 도 안 터지고 note 표시", async () => {
  const data = makeData();
  await call(data, "set_goal", { text: "x" });
  await call(data, "define_exercise", { slug: "kb", display_name: "케틀벨 스윙", progression: "reps", unit: "회", baseline_value: 20 });
  await call(data, "define_routine", { slug: "weird", display_name: "특이", source_text: "데스 바이 버피", blocks: [{ kind: "death_by_burpee", label: "데스 바이 버피", items: [{ exercise_slug: "kb" }], note: "1분마다 1개씩 늘리기" }] });
  await call(data, "define_schedule", { slug: "s", name: "S", buckets: [{ key: "a", label: "특이", routine_v2_slugs: ["weird"] }], assignment: { kind: "weekly", map: everyDay("a") }, is_active: true });
  const r = await call(data, "render_dashboard", { tab: "exercise" });
  assert(typeof r.html === "string" && r.html.length > 100, "렌더 성공(안 터짐)");
  assert(/1분마다 1개씩 늘리기/.test(r.html), "note 표시");
  assert(/케틀벨 스윙/.test(r.html), "운동 이름 표시");
});

test("render_dashboard 운동탭 — 인터벌/드롭세트는 단계별 행으로 + pill", async () => {
  const data = makeData();
  await call(data, "set_goal", { text: "x" });
  await call(data, "define_exercise", { slug: "row_erg", display_name: "로잉", progression: "distance", unit: "m", baseline_value: 250 });
  await call(data, "define_exercise", { slug: "bp", display_name: "벤치", progression: "weight", category: "compound", unit: "kg", baseline_value: 80 });
  await call(data, "define_routine", {
    slug: "cond", display_name: "컨디셔닝",
    blocks: [
      { kind: "interval", label: "로잉 인터벌 4라운드", items: [{ exercise_slug: "row_erg" }], prescription: { rounds: 4, work: { value: 1, unit: "min" }, rest: { value: 1, unit: "min" } } },
      { kind: "dropset", label: "벤치 드롭세트", items: [{ exercise_slug: "bp" }], prescription: { drops: [{}, {}, {}] } },
    ],
  });
  await call(data, "define_schedule", { slug: "s", name: "S", buckets: [{ key: "a", label: "컨디셔닝", routine_v2_slugs: ["cond"] }], assignment: { kind: "weekly", map: everyDay("a") }, is_active: true });
  const r = await call(data, "render_dashboard", { tab: "exercise" });
  const rows = (r.html.match(/data-row=/g) || []).length;
  assert(rows >= 7, `단계별 입력 행 다수(인터벌4+드롭3) — got ${rows}`);
  assert(/인터벌/.test(r.html), "인터벌 뱃지");
  assert(/라운드/.test(r.html), "인터벌 pill");
});

test("render_dashboard 운동탭 — 2회 이상 기록 시 추세 미니 그래프(spark)", async () => {
  const data = makeData();
  await call(data, "set_goal", { text: "x" });
  await call(data, "define_exercise", { slug: "sq", display_name: "스쿼트", progression: "weight", category: "compound", unit: "kg", baseline_value: 100 });
  await call(data, "log_workout", { routine_slug: "_adhoc", performed_at: "2026-06-01T12:00:00.000Z", blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "sq", sets: [{ reps: 5, weight: 100 }] }] }] });
  await call(data, "log_workout", { routine_slug: "_adhoc", performed_at: "2026-06-03T12:00:00.000Z", blocks: [{ block_id: "b1", kind: "straight", entries: [{ exercise_slug: "sq", sets: [{ reps: 5, weight: 105 }] }] }] });
  const s = await call(data, "get_state");
  const ex = s.exercises.find((x: any) => x.slug === "sq");
  eq(ex.recent_points.length, 2, "recent_points 2개");
  const r = await call(data, "render_dashboard", { tab: "exercise" });
  assert(/class="spark"/.test(r.html), "스파크라인 SVG 표시");
});

// ── 실행 ───────────────────────────────────────────────
(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ ${t.name}\n     ${e.message}`);
    }
  }
  console.log(`\n${passed}/${passed + failed} pass`);
  // @ts-ignore — bun 런타임에 process 존재
  if (failed > 0) process.exit(1);
})();
