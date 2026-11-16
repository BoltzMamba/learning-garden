/**
 * Calendar-date utilities.
 *
 * Learning dates are *calendar dates* (`YYYY-MM-DD`), not instants. They are
 * stored and compared as strings and only converted to `Date` objects through
 * `Date.UTC`, so the host machine's timezone can never shift a date by a day.
 *
 * "Today" is resolved in the configured calendar timezone (Asia/Singapore).
 */

export const CALENDAR_TIMEZONE = 'Asia/Singapore';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

export function parseCalendarDate(value: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(value);
  if (!m) throw new Error(`Invalid calendar date "${value}": expected YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid calendar date "${value}": day does not exist`);
  }
  return { year, month, day };
}

export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatCalendarDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Normalise a frontmatter value into `YYYY-MM-DD`.
 *
 * YAML turns an unquoted `2026-11-16` into a `Date` at UTC midnight, so for
 * `Date` inputs we read the UTC components (never local ones).
 */
export function normalizeCalendarDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid date value');
    return formatCalendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  parseCalendarDate(value);
  return value;
}

/** Today's calendar date in `timeZone` (default Asia/Singapore). */
export function todayInTimeZone(timeZone: string = CALENDAR_TIMEZONE, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUtcMs(date: string): number {
  const { year, month, day } = parseCalendarDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  return formatCalendarDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

export function yearOf(date: string): number {
  return parseCalendarDate(date).year;
}

/** Format a calendar date for display without any timezone shift. */
export function formatDisplayDate(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(toUtcMs(date)));
}
