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

test("delete_entity session — next_session_goal 재계산", async () => {
  const data = makeData();
  await call(data, "define_routine_exercise", {
    slug: "bench", display_name: "벤치", progression: "weight", category: "compound", unit: "kg",
    working_value: 100, target_sets: 3, target_reps: 5,
  });
  // 첫 세션 — RPE 7 (target 8 보다 낮음 → push=1 → +2.5)
  await call(data, "log_routine_session", {
    slug: "bench",
    sets: [
      { reps: 5, weight: 100, rpe: 7 },
      { reps: 5, weight: 100, rpe: 7 },
      { reps: 5, weight: 100, rpe: 7 },
    ],
  });
  const s1 = await call(data, "get_state", {});
  const goal1 = s1.routines[0].next_session_goal;
  assert(goal1 && goal1.value === 102.5, `첫 stash 102.5 — got ${JSON.stringify(goal1)}`);

  // 두 번째 세션 — RPE 9 (target 8 보다 높음 → push=0 → +0)
  await call(data, "log_routine_session", {
    slug: "bench",
    sets: [
      { reps: 5, weight: 102.5, rpe: 9 },
      { reps: 5, weight: 102.5, rpe: 9 },
      { reps: 5, weight: 102.5, rpe: 9 },
    ],
  });
  const s2 = await call(data, "get_state", {});
  const goal2 = s2.routines[0].next_session_goal;
  assert(goal2 && goal2.value === 100, `두번째 stash 100 (working_value 유지) — got ${JSON.stringify(goal2)}`);

  // 두 번째 세션 삭제 → goal 이 다시 첫 세션 기준으로 재계산되어야 함 (102.5)
  const sessionId = s2.routines[0].last_session.id;
  assert(typeof sessionId === "string" && sessionId.startsWith("session:bench:"), "session id prefix");
  const d = await call(data, "delete_entity", { kind: "session", id: sessionId });
  eq(d.deleted, true, "삭제 성공");
  eq(d.side_effect?.recomputed_next_session_goal_for, "bench", "side_effect 보고");

  const s3 = await call(data, "get_state", {});
  const goal3 = s3.routines[0].next_session_goal;
  assert(goal3 && goal3.value === 102.5, `재계산 후 102.5 (첫 세션 기준) — got ${JSON.stringify(goal3)}`);
});

test("delete_entity session — 마지막 세션 삭제 시 goal 클리어", async () => {
  const data = makeData();
  await call(data, "define_routine_exercise", {
    slug: "squat", display_name: "스쿼트", progression: "weight", category: "compound", unit: "kg",
    target_sets: 3, target_reps: 5,
  });
  await call(data, "log_routine_session", {
    slug: "squat", sets: [{ reps: 5, weight: 80, rpe: 7 }],
  });
  const s1 = await call(data, "get_state", {});
  assert(s1.routines[0].next_session_goal !== null, "초기 stash 있음");

  const sessionId = s1.routines[0].last_session.id;
  const d = await call(data, "delete_entity", { kind: "session", id: sessionId });
  eq(d.deleted, true, "삭제 성공");
  // working_value 가 없으면 신호 부족 → fallback 도 null → goal 클리어
  // 단 last 세션의 평균이 working_value 의 fallback 으로 잡힐 수 있어 — 확인
  const s2 = await call(data, "get_state", {});
  // 세션 0개 → next_target=null → stash 클리어
  assert(s2.routines[0].next_session_goal === null, `세션 0개면 goal null — got ${JSON.stringify(s2.routines[0].next_session_goal)}`);
  eq(d.side_effect?.cleared_next_session_goal_for, "squat", "cleared side_effect");
});

// ── id 가 get_state 에 surface ────────────────────────
test("get_state — meal/activity/metric/session 모두 id 노출", async () => {
  const data = makeData();
  await call(data, "log_meal", { name: "끼니1", kcal: 300 });
  await call(data, "log_activity", { name: "조깅", intensity: "moderate", duration_minutes: 20 });
  await call(data, "define_metric", { slug: "bp", display_name: "혈압", unit: "mmHg", priority: "high" });
  await call(data, "record_metric", { slug: "bp", value: 120 });
  await call(data, "define_routine_exercise", {
    slug: "dl", display_name: "데드", progression: "weight", category: "compound", unit: "kg", target_sets: 1, target_reps: 5,
  });
  await call(data, "log_routine_session", { slug: "dl", sets: [{ reps: 5, weight: 100, rpe: 8 }] });

  const s = await call(data, "get_state", {});
  assert(s.meals_today.items[0].id?.startsWith("meal:"), "meal id");
  assert(s.recent_activities[0].id?.startsWith("activity:"), "activity id");
  assert(s.metrics[0].latest_id?.startsWith("measure:bp:"), "metric latest_id");
  assert(s.routines[0].last_session.id?.startsWith("session:dl:"), "session id");
});

test("delete_entity 모르는 kind → 에러 메시지에 신규 kind 포함", async () => {
  const data = makeData();
  let err: any = null;
  try { await call(data, "delete_entity", { kind: "unknown", id: "x" }); } catch (e) { err = e; }
  assert(err && /meal/.test(err.message) && /session/.test(err.message), "에러에 meal/session 언급");
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
