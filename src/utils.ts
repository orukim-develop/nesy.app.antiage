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

export function nowHHMM(tz = 'Asia/Seoul'): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(new Date()).replace(':', '');
  } catch {
    const d = new Date();
    return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
  }
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

// prefix 안의 모든 row 를 한 번에 가져옴 — value 포함.
// 플랫폼 contract: data.list 는 [{key, value, updated_at}]. 절대 list 뒤에 N 개 get 부르지 말 것.
// 1000 cap 잘림 대비 페이징.
export interface ListedRow {
  key: string;
  value: any;
  updated_at: string;
}

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
