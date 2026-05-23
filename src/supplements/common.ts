// 영양제 도메인 공용 검증·헬퍼.

const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !slug) throw new Error('slug 필수.');
  if (!SLUG_RE.test(slug)) {
    throw new Error(`slug "${slug}" 형식 위반. 영문 소문자 시작, snake_case 만 (예: vitamin_d, omega3).`);
  }
  if (slug.length > 48) throw new Error('slug 는 48자 이내.');
  return slug;
}

export function validateTime(t: unknown, where: string): string {
  if (typeof t !== 'string' || !TIME_RE.test(t)) {
    throw new Error(`${where}: "HH:MM" 24시간 형식만 (예: 09:00, 21:30).`);
  }
  return t;
}

export function timeToKey(hhmm: string): string {
  return hhmm.replace(':', '');
}

// 사용자 timezone 기준 현재 'YYYY-MM-DD' 와 'HH:MM'.
export function nowInTz(tz: string): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  return { date, time };
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 슬롯 시간이 today 부터 며칠 후의 슬롯인지 (음수면 과거). every_n_days 계산용.
export function daysSinceIso(startIso: string, todayIso: string): number {
  const a = parseIso(startIso);
  const b = parseIso(todayIso);
  return Math.round((b - a) / (24 * 3600 * 1000));
}

function parseIso(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
