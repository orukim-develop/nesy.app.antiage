// 날짜·문자열·수치 헬퍼. 외부 의존 없음.

export const nowIso = (): string => new Date().toISOString();

export const newId = (): string =>
  (crypto as any).randomUUID().replace(/-/g, '').slice(0, 12);

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

export function daysBetween(a: string, b: string): number {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / (24 * 3600 * 1000));
}

export function todayIso(tz = 'Asia/Seoul'): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  } catch {
    return formatDate(new Date());
  }
}

// 'HH:MM' 24시간 형식 in 주어진 timezone
export function nowHHMMColon(tz = 'Asia/Seoul'): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(new Date());
  } catch {
    const d = new Date();
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
}

// 주어진 timezone 의 현재 시각을 분 단위 정수로 (00:00 = 0, 23:59 = 1439)
export function nowMinutesInTz(tz = 'Asia/Seoul'): number {
  const hhmm = nowHHMMColon(tz);
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// 가장 가까운 step 배수로 반올림 (compute_next_load 의 2.5kg 단위).
export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function escapeHtml(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ───── 검증 헬퍼 ─────

export const SLUG_RE = /^[a-z][a-z0-9_]*$/;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertSlug(slug: unknown, field = 'slug'): asserts slug is string {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`${field} 는 snake_case 영문 시작 (받음: ${JSON.stringify(slug)})`);
  }
}

export function assertHHMM(t: unknown, field = 'time'): asserts t is string {
  if (typeof t !== 'string' || !HHMM_RE.test(t)) {
    throw new Error(`${field} 는 'HH:MM' 24시간 형식 (받음: ${JSON.stringify(t)})`);
  }
}

export function assertPositiveNumber(v: unknown, field: string, max = Infinity): asserts v is number {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${field} 는 숫자 필요 (받음: ${JSON.stringify(v)})`);
  if (v < 0) throw new Error(`${field} 음수 불가 (받음: ${v})`);
  if (v > max) throw new Error(`${field} 비현실적으로 큼 (max ${max}, 받음: ${v})`);
}

export function assertEnum<T extends string>(v: unknown, allowed: readonly T[], field: string): asserts v is T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new Error(`${field} 는 ${allowed.join(' | ')} 중 하나 (받음: ${JSON.stringify(v)})`);
  }
}

// prefix 안의 모든 row 페이징해서 한 번에. value 포함.
export interface ListedRow { key: string; value: any; updated_at: string }

export async function listAllRows(
  data: { list(prefix?: string, limit?: number): Promise<ListedRow[]> },
  prefix: string,
): Promise<ListedRow[]> {
  const PAGE = 1000;
  const out: ListedRow[] = [];
  let startAfter: string | undefined;
  for (let i = 0; i < 100; i++) {
    const page = startAfter
      ? await (data.list as any)(prefix, PAGE, startAfter)
      : await data.list(prefix, PAGE);
    if (!page || page.length === 0) break;
    for (const r of page) out.push(r);
    if (page.length < PAGE) break;
    const last = page[page.length - 1]?.key;
    if (!last || last === startAfter) break;
    startAfter = last;
  }
  return out;
}
