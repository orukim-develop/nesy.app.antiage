// render_dashboard — /board 위젯.
//
// 구조: 헤더 (goal) + 3축 카드:
//   1) 운동      — 등록 루틴 + 최근 7일 세션 + 최근 활동
//   2) 건강지표  — 등록 metric 각각의 최근값·target·trend
//   3) 식단·알람 — 오늘 식단 누적 + 활성 알람 + 다음 슬롯
//
// 외부 라이브러리 임포트 금지 (V8 isolate). 모든 SVG/HTML 직접.

import type { RunCtx } from './types.ts';
import {
  getGoal,
  loadAllExercises, loadAllSessions, loadAllActivities,
  loadAllMetrics, loadMetricRecordsFor,
  loadAllMeals,
  loadAllReminders, loadAllReminderAcks,
  findLastSessionFor, bestSet,
} from './store.ts';
import { getSettings } from './settings.ts';
import { todayIso, nowMinutesInTz, hhmmToMinutes, daysBetween, escapeHtml } from './utils.ts';

export async function renderDashboardTool(ctx: RunCtx) {
  const settings = await getSettings(ctx);
  const tz = settings.timezone;
  const today = todayIso(tz);
  const nowMin = nowMinutesInTz(tz);

  const [goal, exercises, sessions, activities, metrics, meals, reminders, reminderAcks] =
    await Promise.all([
      getGoal(ctx),
      loadAllExercises(ctx),
      loadAllSessions(ctx),
      loadAllActivities(ctx),
      loadAllMetrics(ctx),
      loadAllMeals(ctx),
      loadAllReminders(ctx),
      loadAllReminderAcks(ctx),
    ]);

  const css = buildCss();
  const body =
    sectionGoal(goal, today) +
    (await sectionMetrics(ctx, metrics, today)) +
    sectionExercise(exercises, sessions, activities, today) +
    sectionMealsAndReminders(meals, reminders, reminderAcks, today, nowMin, tz);

  const html =
    `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>${css}</style></head>` +
    `<body><div class="dashboard">${body}</div></body></html>`;

  return { html };
}

// ─────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────
function buildCss(): string {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; background: #fafafa; }
    .dashboard { padding: 10px; display: grid; grid-template-columns: 1fr; gap: 8px; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px; }
    .card h3 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.4px; }
    .card .num { font-size: 16px; font-weight: 600; }
    .card .sub { color: #888; font-size: 11px; }
    .pill { display: inline-block; padding: 1px 6px; border-radius: 9px; font-size: 10px; margin-left: 4px; font-weight: 500; }
    .pill.ok { background: #e7f7ec; color: #1e7a3a; }
    .pill.warn { background: #fff4e0; color: #aa6700; }
    .pill.alert { background: #fde7e7; color: #b51d1d; }
    .pill.info { background: #e8eef9; color: #2752a3; }
    .pill.muted { background: #eee; color: #777; }
    .row { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
    .row.tight { margin-top: 2px; }
    .row.head { font-weight: 600; color: #444; }
    .empty { color: #aaa; font-style: italic; font-size: 11px; padding: 6px 0; text-align: center; }
    .goal-text { font-size: 13px; color: #222; line-height: 1.5; }
    .goal-empty { color: #b51d1d; font-weight: 600; }
    .metric-block { padding: 6px 0; border-bottom: 1px dashed #eee; }
    .metric-block:last-child { border-bottom: none; }
    .metric-block .meta { font-size: 10px; color: #999; margin-top: 2px; }
    .axis-text { fill: #888; font-size: 9px; }
    svg .axis { stroke: #aaa; stroke-width: 1; }
    svg .data-line { stroke: #4f7df0; stroke-width: 1.5; fill: none; }
    svg .target-band { fill: rgba(195,161,85,0.15); }
    svg .pt { fill: #4f7df0; }
    .reminder-slot { display: inline-block; padding: 1px 5px; margin: 1px 2px 1px 0; border-radius: 3px; font-size: 10px; font-variant-numeric: tabular-nums; background: #eef; color: #335; }
    .reminder-slot.acked { background: #e7f7ec; color: #1e7a3a; text-decoration: line-through; }
    .reminder-slot.overdue { background: #fde7e7; color: #b51d1d; }
    .axis-label { color: #2752a3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  `;
}

// ─────────────────────────────────────────────────────────────────────
// 1) 헤더 + Goal
// ─────────────────────────────────────────────────────────────────────
function sectionGoal(goal: { description: string; set_at: string } | null, today: string): string {
  if (!goal) {
    return `<div class="card">
      <h3>${escapeHtml(today)} · 목표</h3>
      <div class="goal-empty">목표 미설정.</div>
      <div class="sub">호출 AI 가 "어떤 건강 목표를 갖고 있어?" 묻고 set_goal 호출.</div>
    </div>`;
  }
  return `<div class="card">
    <h3>${escapeHtml(today)} · 목표</h3>
    <div class="goal-text">${escapeHtml(goal.description)}</div>
    <div class="sub">설정: ${escapeHtml(goal.set_at.slice(0, 10))}</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 2) 건강지표 카드 (각 metric: 최근값·target·30일 trend)
// ─────────────────────────────────────────────────────────────────────
async function sectionMetrics(ctx: RunCtx, metrics: import('./types.ts').MetricDef[], today: string): Promise<string> {
  const header = `<div class="axis-label">건강지표</div>`;
  if (metrics.length === 0) {
    return `<div class="card">${header}<h3>등록된 지표 없음</h3>
      <div class="empty">propose_setup_from_goal → set_metric 으로 등록.</div></div>`;
  }

  // priority 정렬 (critical → high → normal)
  const order: Record<string, number> = { critical: 0, high: 1, normal: 2 };
  const sorted = [...metrics].sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));

  const blocks = await Promise.all(sorted.map(async (m) => {
    const records = await loadMetricRecordsFor(ctx, m.slug);
    records.sort((a, b) => b.measured_at.localeCompare(a.measured_at));
    const latest = records[0];

    let valueHtml = '';
    let pill = '';
    if (latest) {
      let cls = 'pill muted', label = '범위 미설정';
      if (m.target_min !== undefined || m.target_max !== undefined) {
        const inRange =
          (m.target_min === undefined || latest.value >= m.target_min) &&
          (m.target_max === undefined || latest.value <= m.target_max);
        cls = inRange ? 'pill ok' : 'pill alert';
        label = inRange ? '범위 안' : '범위 밖';
      }
      pill = `<span class="${cls}">${label}</span>`;
      valueHtml = `<span class="num">${latest.value}</span> ${escapeHtml(m.unit)} ${pill}`;
    } else {
      valueHtml = `<span class="sub">기록 없음</span>`;
    }

    const tRange = formatTargetRange(m.target_min, m.target_max, m.unit);
    const ageStr = latest ? `${daysBetween(latest.measured_at.slice(0, 10), today)}일 전` : '—';
    const chart = renderMetricSparkline(records, m.target_min, m.target_max);

    return `<div class="metric-block">
      <div class="row tight"><span><strong>${escapeHtml(m.display_name)}</strong> <span class="sub">(${escapeHtml(m.priority)})</span></span><span>${valueHtml}</span></div>
      <div class="meta">target ${tRange} · 마지막 측정 ${ageStr}${latest?.context ? ` · ${escapeHtml(latest.context)}` : ''}</div>
      ${chart}
    </div>`;
  }));

  return `<div class="card">${header}<h3>지표 ${metrics.length}개</h3>${blocks.join('')}</div>`;
}

function formatTargetRange(tmin: number | undefined, tmax: number | undefined, unit: string): string {
  if (tmin === undefined && tmax === undefined) return '없음';
  if (tmin !== undefined && tmax !== undefined) return `${tmin}~${tmax} ${escapeHtml(unit)}`;
  if (tmin !== undefined) return `≥ ${tmin} ${escapeHtml(unit)}`;
  return `≤ ${tmax} ${escapeHtml(unit)}`;
}

function renderMetricSparkline(records: { value: number; measured_at: string }[], tmin?: number, tmax?: number): string {
  if (records.length < 2) return '';
  const W = 360, H = 36, PAD = 4;
  const sorted = [...records].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const vals = sorted.map((r) => r.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (tmin !== undefined) lo = Math.min(lo, tmin);
  if (tmax !== undefined) hi = Math.max(hi, tmax);
  const range = Math.max(0.1, hi - lo);
  const x = (i: number) => PAD + (i / (sorted.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - lo) / range) * (H - PAD * 2);

  let band = '';
  if (tmin !== undefined && tmax !== undefined) {
    band = `<rect class="target-band" x="${PAD}" y="${y(tmax).toFixed(1)}" width="${W - PAD * 2}" height="${(y(tmin) - y(tmax)).toFixed(1)}"></rect>`;
  }
  const path = sorted.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ');
  const dots = sorted.map((r, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(r.value).toFixed(1)}" r="1.8"></circle>`).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;margin-top:3px">${band}<path class="data-line" d="${path}"></path>${dots}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────
// 3) 운동 카드 — 루틴 운동 + 최근 7일 세션 + 최근 활동
// ─────────────────────────────────────────────────────────────────────
function sectionExercise(
  exercises: import('./types.ts').ExerciseDef[],
  sessions: import('./types.ts').SessionRecord[],
  activities: import('./types.ts').ActivityRecord[],
  today: string,
): string {
  const header = `<div class="axis-label">운동</div>`;
  const rows: string[] = [];

  if (exercises.length === 0) {
    rows.push(`<div class="empty">루틴 운동 미등록.</div>`);
  } else {
    rows.push(`<div class="row tight head"><span>루틴 운동 ${exercises.length}개</span><span>마지막 top set</span></div>`);
    for (const e of exercises) {
      const last = findLastSessionFor(sessions, e.slug);
      const top = last ? bestSet(last.sets) : null;
      const ageDays = last ? daysBetween(last.created_at.slice(0, 10), today) : null;
      const topHtml = top
        ? `${top.weight_kg}kg × ${top.reps}${top.rir !== undefined ? ` (RIR ${top.rir})` : ''} <span class="sub">${ageDays}일 전</span>`
        : `<span class="sub">기록 없음</span>`;
      const prHtml = e.current_pr_kg !== null ? `<span class="pill info">PR ${e.current_pr_kg}kg</span>` : '';
      rows.push(`<div class="row tight"><span>${escapeHtml(e.display_name)} ${prHtml}</span><span>${topHtml}</span></div>`);
    }
  }

  // 최근 7일 비루틴 활동
  const cutoff7 = subtractDaysIso(today, 7);
  const recentAct = activities
    .filter((a) => a.performed_at.slice(0, 10) >= cutoff7)
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))
    .slice(0, 7);
  if (recentAct.length > 0) {
    rows.push(`<div class="row tight head" style="margin-top:8px"><span>최근 활동</span><span></span></div>`);
    for (const a of recentAct) {
      const d = a.performed_at.slice(0, 10);
      const ageDays = daysBetween(d, today);
      const meta = [
        a.duration_min ? `${a.duration_min}분` : null,
        a.intensity ? a.intensity : null,
        a.distance_km ? `${a.distance_km}km` : null,
      ].filter(Boolean).join(' · ');
      rows.push(`<div class="row tight"><span>${escapeHtml(a.name)}${meta ? ` <span class="sub">(${meta})</span>` : ''}</span><span class="sub">${ageDays === 0 ? '오늘' : `${ageDays}일 전`}</span></div>`);
    }
  }

  return `<div class="card">${header}<h3>운동 · 활동</h3>${rows.join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 4) 식단·알람 카드 — 오늘 식단 + 활성 알람 + 다음 슬롯
// ─────────────────────────────────────────────────────────────────────
function sectionMealsAndReminders(
  meals: import('./types.ts').MealRecord[],
  reminders: import('./types.ts').ReminderDef[],
  reminderAcks: import('./types.ts').ReminderAck[],
  today: string,
  nowMin: number,
  tz: string,
): string {
  const header = `<div class="axis-label">식단 · 알람</div>`;
  const rows: string[] = [];

  // 오늘 식단 누적
  const todayMeals = meals.filter((m) => m.eaten_at.slice(0, 10) === today);
  const kcal = sumOpt(todayMeals.map((m) => m.kcal));
  const protein = sumOpt(todayMeals.map((m) => m.protein_g));
  const carbs = sumOpt(todayMeals.map((m) => m.carbs_g));
  const fat = sumOpt(todayMeals.map((m) => m.fat_g));

  rows.push(`<div class="row tight head"><span>오늘 식단 (${todayMeals.length}끼)</span><span></span></div>`);
  if (todayMeals.length === 0) {
    rows.push(`<div class="empty">기록 없음.</div>`);
  } else {
    rows.push(`<div class="row tight"><span>칼로리</span><span><span class="num">${kcal ?? '—'}</span> kcal</span></div>`);
    rows.push(`<div class="row tight"><span>단백질 / 탄수 / 지방</span><span>${protein ?? '—'} / ${carbs ?? '—'} / ${fat ?? '—'} g</span></div>`);
  }

  // 알람
  const activeReminders = reminders.filter((r) => !r.end_date || r.end_date >= today);
  const todayAcks = reminderAcks.filter((a) => a.acked_at.slice(0, 10) === today);
  const ackKey = (slug: string, slot: string) => `${slug}@${today}T${slot}:00`;
  const ackedSet = new Set(todayAcks.map((a) => `${a.slug}@${a.slot_iso}`));

  rows.push(`<div class="row tight head" style="margin-top:8px"><span>알람 ${activeReminders.length}개 (tz ${escapeHtml(tz)})</span><span></span></div>`);
  if (activeReminders.length === 0) {
    rows.push(`<div class="empty">활성 알람 없음.</div>`);
  } else {
    const sorted = [...activeReminders].sort((a, b) => a.schedule_times[0].localeCompare(b.schedule_times[0]));
    for (const r of sorted) {
      const slotsHtml = r.schedule_times.map((s) => {
        const slotMin = hhmmToMinutes(s);
        const acked = ackedSet.has(ackKey(r.slug, s));
        const overdue = !acked && nowMin > slotMin + r.window_minutes;
        const cls = acked ? 'reminder-slot acked' : overdue ? 'reminder-slot overdue' : 'reminder-slot';
        return `<span class="${cls}">${s}</span>`;
      }).join('');
      const typeLabel = r.type === 'supplement' ? '복용' : r.type === 'measurement' ? '측정' : '실행';
      rows.push(`<div class="row tight"><span>${escapeHtml(r.display_name)} <span class="sub">[${typeLabel}]</span></span><span>${slotsHtml}</span></div>`);
    }
  }

  return `<div class="card">${header}<h3>오늘 식단 · 알람</h3>${rows.join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 로컬 유틸
// ─────────────────────────────────────────────────────────────────────
function sumOpt(arr: (number | undefined)[]): number | null {
  const f = arr.filter((x): x is number => typeof x === 'number');
  if (f.length === 0) return null;
  return Number(f.reduce((s, x) => s + x, 0).toFixed(1));
}

function subtractDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
