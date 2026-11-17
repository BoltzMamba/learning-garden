/** GitHub-style year grid: columns are weeks (Sun→Sat), rows are weekdays. */
import { addDays, dayOfWeek, formatCalendarDate, parseCalendarDate } from './dates.ts';

export type Level = 0 | 1 | 2 | 3 | 4;

export interface CalendarCell {
  date: string;
  count: number;
  level: Level;
  /** False for padding days belonging to the neighbouring year. */
  inYear: boolean;
  isFuture: boolean;
}

export interface CalendarYear {
  year: number;
  weeks: CalendarCell[][];
  /** Week index where each month (0-11) starts. */
  monthStarts: number[];
  total: number;
  activeDays: number;
  /** Count that maps to the darkest level this year. */
  reference: number;
}

/**
 * Intensity reference for a year: the 90th percentile of its active days,
 * never below 4. Small counts are never inflated, and one exceptional day
 * does not wash out the rest of the year.
 */
export function levelReference(counts: Iterable<number>): number {
  const active = [...counts].filter((n) => n > 0).sort((a, b) => a - b);
  if (!active.length) return 4;
  const p90 = active[Math.min(active.length - 1, Math.floor(active.length * 0.9))];
  return Math.max(4, p90);
}

/** Level 1–4 in proportion to the year's reference count. */
export function levelForCount(count: number, reference = 4): Level {
  if (count <= 0) return 0;
  return Math.min(4, Math.ceil((4 * count) / reference)) as Level;
}

export function buildCalendarYear(year: number, counts: ReadonlyMap<string, number>, today: string): CalendarYear {
  const first = formatCalendarDate(year, 1, 1);
  const last = formatCalendarDate(year, 12, 31);
  let cursor = addDays(first, -dayOfWeek(first));
  const end = addDays(last, 6 - dayOfWeek(last));

  const weeks: CalendarCell[][] = [];
  const monthStarts: number[] = [];
  const prefix = `${String(year).padStart(4, '0')}-`;
  const reference = levelReference([...counts].filter(([d]) => d.startsWith(prefix)).map(([, n]) => n));
  let total = 0;
  let activeDays = 0;

  while (cursor <= end) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const { year: y, day } = parseCalendarDate(cursor);
      const inYear = y === year;
      const count = inYear ? (counts.get(cursor) ?? 0) : 0;
      if (inYear) {
        total += count;
        if (count > 0) activeDays++;
        if (day === 1) monthStarts.push(weeks.length);
      }
      week.push({ date: cursor, count, level: levelForCount(count, reference), inYear, isFuture: cursor > today });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }

  return { year, weeks, monthStarts, total, activeDays, reference };
}

/** Years to offer in the calendar: every year with activity plus the current year. */
export function calendarYears(dates: Iterable<string>, today: string): number[] {
  const years = new Set<number>([parseCalendarDate(today).year]);
  for (const d of dates) years.add(parseCalendarDate(d).year);
  return [...years].sort((a, b) => b - a);
}
