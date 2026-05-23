// render_dashboard — /board 위젯. SPEC §5.
// 외부 차트 라이브러리 임포트 금지 (V8 isolate). SVG 직접.

import type { RunCtx, WeightEntry, InBodyEntry, Session, Meal } from './types.ts';
import { getSettings } from './settings.ts';
import {
  loadAllSessions, loadAllWeights, loadAllInBody, loadAllBlood, loadAllMeals,
  loadInjuryHistory, getActiveInjury,
} from './store.ts';
import { daysBetween, escapeHtml, parseDate, todayIso } from './utils.ts';

const TRACKED_EXERCISES = ['squat', 'deadlift', 'bench_press', 'shoulder_press'];
const EX_LABEL: Record<string, string> = {
  squat: '스쿼트', deadlift: '데드리프트', bench_press: '벤치', shoulder_press: '숄더',
};

export async function renderDashboard(ctx: RunCtx) {
  const today = todayIso();
  const settings = await getSettings(ctx);

  const [sessions, weights, inbodyAll, bloodAll, meals, injuryHistory, activeInjury] =
    await Promise.all([
      loadAllSessions(ctx),
      loadAllWeights(ctx),
      loadAllInBody(ctx),
      loadAllBlood(ctx),
      loadAllMeals(ctx),
      loadInjuryHistory(ctx),
      getActiveInjury(ctx),
    ]);

  const css = buildCss();
  const body =
    sectionHeader(today, settings, activeInjury) +
    sectionWeightChart(weights, settings, today, injuryHistory) +
    sectionInBody(inbodyAll) +
    sectionExercises(sessions, today, injuryHistory, activeInjury) +
    sectionBlood(bloodAll, settings, today) +
    sectionDiet(meals, inbodyAll, settings, today);

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
    .dashboard { padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px; }
    .card.wide { grid-column: 1 / -1; }
    .card h3 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.4px; }
    .card .num { font-size: 18px; font-weight: 600; }
    .card .sub { color: #888; font-size: 11px; }
    .pill { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px; margin-right: 4px; font-weight: 500; }
    .pill.ok { background: #e7f7ec; color: #1e7a3a; }
    .pill.warn { background: #fff4e0; color: #aa6700; }
    .pill.alert { background: #fde7e7; color: #b51d1d; }
    .pill.info { background: #e8eef9; color: #2752a3; }
    .row { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
    .row.tight { margin-top: 2px; }
    .bar { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 11px; }
    .bar .label { width: 64px; color: #555; }
    .bar .track { position: relative; flex: 1; height: 10px; background: #eee; border-radius: 5px; overflow: hidden; }
    .bar .fill { position: absolute; left: 0; top: 0; bottom: 0; background: #4f7df0; }
    .bar .fill.neg { background: #d75858; }
    .bar .v { width: 56px; text-align: right; color: #333; font-variant-numeric: tabular-nums; }
    svg .grid { stroke: #ddd; stroke-width: 1; }
    svg .guideline { stroke: #c3a155; stroke-dasharray: 3 3; stroke-width: 1; }
    svg .axis { stroke: #999; stroke-width: 1; }
    svg .axis-text { fill: #888; font-size: 9px; }
    svg .data-line { stroke: #4f7df0; stroke-width: 1.5; fill: none; }
    svg .data-area { fill: rgba(79,125,240,0.08); }
    svg .injury-band { fill: rgba(200,200,200,0.25); }
    svg .pt-fasted { fill: #4f7df0; }
    svg .pt-postmeal { fill: #f0904f; }
    svg .pt-postworkout { fill: #4fa07d; }
    svg .pt-unknown { fill: #999; }
    .legend { display: flex; gap: 10px; font-size: 10px; color: #666; margin-top: 4px; }
    .legend .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 3px; vertical-align: middle; }
    .empty { color: #aaa; font-style: italic; font-size: 11px; padding: 8px 0; text-align: center; }
    .injury-active { color: #b51d1d; font-weight: 600; }
    .injury-clear { color: #1e7a3a; }
  `;
}

// ─────────────────────────────────────────────────────────────────────
// 헤더
// ─────────────────────────────────────────────────────────────────────
function sectionHeader(today: string, settings: import('./types.ts').Settings, activeInjury: import('./types.ts').InjuryRecord | null): string {
  let injuryHtml = `<span class="injury-clear">활성 부상 없음</span>`;
  if (activeInjury) {
    const since = daysBetween(activeInjury.started, today);
    injuryHtml = `<span class="injury-active">⚠ 부상: ${escapeHtml(activeInjury.site)} (${since}일째)</span>`;
  }
  return `<div class="card wide">
    <div class="row tight">
      <div><span class="num">${escapeHtml(today)}</span></div>
      <div class="sub">목표 ${settings.target_weight_min}–${settings.target_weight_max}kg · ${escapeHtml(settings.target_weight_rule)}</div>
    </div>
    <div class="row tight">${injuryHtml}</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 체중 차트 (30일)
// ─────────────────────────────────────────────────────────────────────
function sectionWeightChart(
  weights: WeightEntry[], settings: import('./types.ts').Settings, today: string,
  injuryHistory: import('./types.ts').InjuryRecord[],
): string {
  const W = 460, H = 140, PAD_L = 28, PAD_R = 8, PAD_T = 8, PAD_B = 18;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const cutoffStart = subtractDays(today, 30);
  const pts = weights
    .filter((w) => w.date >= cutoffStart && w.date <= today)
    .map((w) => ({
      day: daysBetween(cutoffStart, w.date),
      kg: w.weight_kg,
      ctx: w.measurement_context,
    }))
    .sort((a, b) => a.day - b.day);

  if (pts.length === 0) {
    return `<div class="card wide"><h3>체중 추이 (30일)</h3><div class="empty">데이터 없음 — record_weight 호출 필요.</div></div>`;
  }

  // Y 축 범위: target range 포함 ± 1kg 여유.
  const minKg = Math.min(settings.target_weight_min - 1, ...pts.map((p) => p.kg));
  const maxKg = Math.max(settings.target_weight_max + 1, ...pts.map((p) => p.kg));
  const range = Math.max(1, maxKg - minKg);

  const x = (day: number) => PAD_L + (day / 30) * chartW;
  const y = (kg: number) => PAD_T + (1 - (kg - minKg) / range) * chartH;

  // 부상 밴드 (30일 창 내 부상 기간).
  let injuryBands = '';
  for (const inj of injuryHistory) {
    const start = inj.started;
    const end = inj.recovered || today;
    if (end < cutoffStart || start > today) continue;
    const startDay = Math.max(0, daysBetween(cutoffStart, start));
    const endDay = Math.min(30, daysBetween(cutoffStart, end));
    if (endDay < startDay) continue;
    injuryBands += `<rect class="injury-band" x="${x(startDay)}" y="${PAD_T}" width="${Math.max(2, x(endDay) - x(startDay))}" height="${chartH}"></rect>`;
  }

  // 가이드라인 (target min/max).
  const guideMin = `<line class="guideline" x1="${PAD_L}" y1="${y(settings.target_weight_min)}" x2="${W - PAD_R}" y2="${y(settings.target_weight_min)}"></line>`;
  const guideMax = `<line class="guideline" x1="${PAD_L}" y1="${y(settings.target_weight_max)}" x2="${W - PAD_R}" y2="${y(settings.target_weight_max)}"></line>`;

  // 데이터 라인.
  const polyPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const dataLine = `<path class="data-line" d="${polyPath}"></path>`;
  const dataArea = `<path class="data-area" d="${polyPath} L${x(pts[pts.length - 1].day).toFixed(1)},${y(minKg).toFixed(1)} L${x(pts[0].day).toFixed(1)},${y(minKg).toFixed(1)} Z"></path>`;

  // 데이터 점 (context별 색).
  const dots = pts.map((p) => `<circle class="pt-${p.ctx}" cx="${x(p.day).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="2.5"></circle>`).join('');

  // Y 축 레이블.
  const yLabels = [minKg, settings.target_weight_min, settings.target_weight_max, maxKg]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((v) => `<text class="axis-text" x="${PAD_L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`)
    .join('');

  // X 축 (오늘 기준 0/-15/-30).
  const xLabels = [0, 15, 30]
    .map((d) => `<text class="axis-text" x="${x(d).toFixed(1)}" y="${H - 4}" text-anchor="middle">${d === 0 ? '-30d' : d === 30 ? '오늘' : '-15d'}</text>`)
    .join('');

  return `<div class="card wide">
    <h3>체중 추이 (30일)</h3>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${injuryBands}
      <line class="axis" x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}"></line>
      <line class="axis" x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}"></line>
      ${guideMin}${guideMax}
      ${dataArea}${dataLine}${dots}
      ${yLabels}${xLabels}
    </svg>
    <div class="legend">
      <span><span class="dot" style="background:#4f7df0"></span>공복</span>
      <span><span class="dot" style="background:#f0904f"></span>식후</span>
      <span><span class="dot" style="background:#4fa07d"></span>운동후</span>
      <span><span class="dot" style="background:#c3a155"></span>목표 ${settings.target_weight_min}–${settings.target_weight_max}</span>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// InBody
// ─────────────────────────────────────────────────────────────────────
function sectionInBody(inbodyAll: InBodyEntry[]): string {
  const sorted = [...inbodyAll].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted[0];
  const prev = sorted[1];
  if (!last) {
    return `<div class="card"><h3>InBody</h3><div class="empty">기록 없음.</div></div>`;
  }
  const dateLine = `<div class="sub">${escapeHtml(last.date)}${prev ? ` vs ${escapeHtml(prev.date)}` : ''}</div>`;

  const rows: string[] = [];
  function row(label: string, cur: number, prevVal: number | null, unit: string, opts?: { betterDirection?: 'up' | 'down' }) {
    let deltaHtml = '';
    if (prevVal !== null) {
      const d = cur - prevVal;
      const dStr = (d > 0 ? '+' : '') + d.toFixed(1);
      const isGood = opts?.betterDirection === 'down' ? d < 0 : d > 0;
      const cls = Math.abs(d) < 0.05 ? 'sub' : isGood ? 'pill ok' : 'pill warn';
      deltaHtml = `<span class="${cls}">${dStr}${unit}</span>`;
    }
    rows.push(`<div class="row tight"><span>${label}</span><span><span class="num">${cur.toFixed(1)}</span>${unit} ${deltaHtml}</span></div>`);
  }
  row('체중', last.weight_kg, prev?.weight_kg ?? null, 'kg', { betterDirection: 'down' });
  row('골격근', last.skeletal_muscle_kg, prev?.skeletal_muscle_kg ?? null, 'kg', { betterDirection: 'up' });
  row('체지방', last.body_fat_kg, prev?.body_fat_kg ?? null, 'kg', { betterDirection: 'down' });
  row('체지방률', last.body_fat_pct, prev?.body_fat_pct ?? null, '%', { betterDirection: 'down' });
  rows.push(`<div class="row tight"><span class="sub">BMR</span><span><span class="num">${last.bmr_kcal}</span> kcal</span></div>`);

  return `<div class="card"><h3>InBody</h3>${dateLine}${rows.join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 운동 누적 (4 운동, 최근 4주 top set)
// ─────────────────────────────────────────────────────────────────────
function sectionExercises(
  sessions: Session[], today: string,
  injuryHistory: import('./types.ts').InjuryRecord[], activeInjury: import('./types.ts').InjuryRecord | null,
): string {
  const W = 460, H = 110, PAD_L = 28, PAD_R = 8, PAD_T = 6, PAD_B = 16;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const days = 28;
  const cutoff = subtractDays(today, days);

  // 각 운동의 top set 시계열.
  const series: Record<string, { day: number; top: number; date: string }[]> = {};
  for (const name of TRACKED_EXERCISES) series[name] = [];
  for (const s of sessions) {
    if (s.date < cutoff || s.date > today) continue;
    for (const ex of s.exercises) {
      if (!series[ex.name]) continue;
      let top = -Infinity;
      for (const set of ex.sets) {
        if (set.weight_kg !== undefined && set.weight_kg > top) top = set.weight_kg;
      }
      if (top > -Infinity) {
        series[ex.name].push({ day: daysBetween(cutoff, s.date), top, date: s.date });
      }
    }
  }

  const allTops = Object.values(series).flat().map((p) => p.top);
  if (allTops.length === 0) {
    return `<div class="card wide"><h3>운동 (4주 top set)</h3><div class="empty">최근 4주 기록 없음.</div></div>`;
  }
  const minKg = Math.max(0, Math.min(...allTops) - 5);
  const maxKg = Math.max(...allTops) + 5;
  const range = Math.max(1, maxKg - minKg);
  const x = (d: number) => PAD_L + (d / days) * chartW;
  const y = (kg: number) => PAD_T + (1 - (kg - minKg) / range) * chartH;

  // 부상 밴드.
  let injuryBands = '';
  const bandsSource = [...injuryHistory];
  if (activeInjury) bandsSource.push(activeInjury);
  for (const inj of bandsSource) {
    const start = inj.started;
    const end = inj.recovered || today;
    if (end < cutoff || start > today) continue;
    const sd = Math.max(0, daysBetween(cutoff, start));
    const ed = Math.min(days, daysBetween(cutoff, end));
    if (ed < sd) continue;
    injuryBands += `<rect class="injury-band" x="${x(sd)}" y="${PAD_T}" width="${Math.max(2, x(ed) - x(sd))}" height="${chartH}"></rect>`;
  }

  const colors: Record<string, string> = {
    squat: '#4f7df0', deadlift: '#d75858', bench_press: '#4fa07d', shoulder_press: '#c3a155',
  };
  let lines = '';
  let legend = '';
  for (const name of TRACKED_EXERCISES) {
    const pts = series[name].sort((a, b) => a.day - b.day);
    if (pts.length === 0) continue;
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.top).toFixed(1)}`).join(' ');
    lines += `<path d="${path}" fill="none" stroke="${colors[name]}" stroke-width="1.5"></path>`;
    lines += pts.map((p) => `<circle cx="${x(p.day).toFixed(1)}" cy="${y(p.top).toFixed(1)}" r="2" fill="${colors[name]}"></circle>`).join('');
    const lastTop = pts[pts.length - 1].top;
    legend += `<span><span class="dot" style="background:${colors[name]}"></span>${EX_LABEL[name]} ${lastTop}kg</span>`;
  }

  const yLabels = [minKg, (minKg + maxKg) / 2, maxKg]
    .map((v) => `<text class="axis-text" x="${PAD_L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(0)}</text>`)
    .join('');

  return `<div class="card wide">
    <h3>운동 top set (4주)</h3>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${injuryBands}
      <line class="axis" x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}"></line>
      <line class="axis" x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}"></line>
      ${lines}${yLabels}
      <text class="axis-text" x="${PAD_L}" y="${H - 4}" text-anchor="start">-28d</text>
      <text class="axis-text" x="${W - PAD_R}" y="${H - 4}" text-anchor="end">오늘</text>
    </svg>
    <div class="legend">${legend}</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 혈액검사
// ─────────────────────────────────────────────────────────────────────
function sectionBlood(bloodAll: import('./types.ts').BloodPanel[], settings: import('./types.ts').Settings, today: string): string {
  const sorted = [...bloodAll].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted[0];
  if (!last) {
    return `<div class="card"><h3>혈액검사</h3><div class="empty">기록 없음.</div><div class="sub">다음 예정: ${escapeHtml(settings.next_blood_panel_target)}</div></div>`;
  }
  const rows: string[] = [];
  function row(label: string, value: number | undefined, unit: string, flagFn?: (v: number) => 'ok' | 'warn' | 'alert') {
    if (value === undefined) return;
    const cls = flagFn ? flagFn(value) : 'ok';
    rows.push(`<div class="row tight"><span>${label}</span><span><span class="num">${value}</span> ${unit} <span class="pill ${cls}">${cls === 'ok' ? '정상' : cls === 'warn' ? '경계' : '높음/결핍'}</span></span></div>`);
  }
  row('LDL', last.ldl_mg_dl, 'mg/dL', (v) => v >= 160 ? 'alert' : v >= 130 ? 'warn' : 'ok');
  row('HDL', last.hdl_mg_dl, 'mg/dL', (v) => v < 40 ? 'alert' : 'ok');
  row('요산', last.uric_acid_mg_dl, 'mg/dL', (v) => v >= 7.0 ? 'alert' : 'ok');
  row('비타민D', last.vitamin_d_ng_ml, 'ng/mL', (v) => v < 20 ? 'alert' : v < 30 ? 'warn' : 'ok');
  row('공복혈당', last.fasting_glucose_mg_dl, 'mg/dL', (v) => v >= 126 ? 'alert' : v >= 100 ? 'warn' : 'ok');
  row('HbA1c', last.hba1c_pct, '%', (v) => v >= 6.5 ? 'alert' : v >= 5.7 ? 'warn' : 'ok');

  const due = settings.next_blood_panel_target;
  return `<div class="card"><h3>혈액검사</h3>
    <div class="sub">${escapeHtml(last.date)}</div>
    ${rows.join('')}
    <div class="sub" style="margin-top:6px">다음 예정: ${escapeHtml(due)}</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 식단 (7일 평균)
// ─────────────────────────────────────────────────────────────────────
function sectionDiet(meals: Meal[], inbodyAll: InBodyEntry[], settings: import('./types.ts').Settings, today: string): string {
  const cutoff = subtractDays(today, 7);
  const window = meals.filter((m) => m.date >= cutoff && m.date <= today);
  if (window.length === 0) {
    return `<div class="card wide"><h3>식단 (7일 평균)</h3><div class="empty">최근 7일 기록 없음.</div></div>`;
  }
  const byDay: Record<string, { kcal: number; protein: number }> = {};
  for (const m of window) {
    if (!byDay[m.date]) byDay[m.date] = { kcal: 0, protein: 0 };
    byDay[m.date].kcal += typeof m.total_kcal_estimated === 'number'
      ? m.total_kcal_estimated
      : m.items.reduce((s, it) => s + (it.estimated_kcal || 0), 0);
    byDay[m.date].protein += m.items.reduce((s, it) => s + (it.protein_g || 0), 0);
  }
  const days = Object.keys(byDay).length;
  const avgKcal = Math.round(Object.values(byDay).reduce((s, v) => s + v.kcal, 0) / days);
  const avgProtein = Number((Object.values(byDay).reduce((s, v) => s + v.protein, 0) / days).toFixed(1));

  const inbody = [...inbodyAll].sort((a, b) => b.date.localeCompare(a.date))[0];
  let maintLine = '';
  let statusPill = '';
  if (inbody) {
    const af = settings.activity_factor;
    const mn = Math.round(inbody.bmr_kcal * (af - 0.05));
    const mx = Math.round(inbody.bmr_kcal * (af + 0.05));
    maintLine = `<div class="sub">유지 추정 ${mn}–${mx} kcal (BMR ${inbody.bmr_kcal} × ${af})</div>`;
    let cls = 'pill info', label = '유지';
    if (avgKcal < mn - 150) { cls = 'pill warn'; label = 'deficit'; }
    else if (avgKcal < mn) { cls = 'pill info'; label = 'slight deficit'; }
    else if (avgKcal > mx + 150) { cls = 'pill alert'; label = 'surplus'; }
    else if (avgKcal > mx) { cls = 'pill warn'; label = 'slight surplus'; }
    statusPill = `<span class="${cls}">${label}</span>`;
  }

  return `<div class="card wide"><h3>식단 (7일 평균, ${days}일치)</h3>
    <div class="row tight"><span>평균 칼로리</span><span><span class="num">${avgKcal}</span> kcal ${statusPill}</span></div>
    <div class="row tight"><span>평균 단백질</span><span><span class="num">${avgProtein}</span> g</span></div>
    ${maintLine}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 유틸 (모듈 로컬)
// ─────────────────────────────────────────────────────────────────────
function subtractDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() - days);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
