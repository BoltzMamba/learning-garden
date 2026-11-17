import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addDays,
  dayOfWeek,
  daysInYear,
  formatDisplayDate,
  isLeapYear,
  isValidCalendarDate,
  normalizeCalendarDate,
  todayInTimeZone,
} from '../src/lib/dates.ts';
import { buildCalendarYear, calendarYears, levelForCount, levelReference } from '../src/lib/calendar.ts';

describe('calendar dates', () => {
  test('leap years', () => {
    assert.equal(isLeapYear(2024), true);
    assert.equal(isLeapYear(2028), true);
    assert.equal(isLeapYear(2026), false);
    assert.equal(isLeapYear(1900), false);
    assert.equal(isLeapYear(2000), true);
    assert.equal(isValidCalendarDate('2028-02-29'), true);
    assert.equal(isValidCalendarDate('2026-02-29'), false);
    assert.equal(isValidCalendarDate('2026-13-01'), false);
    assert.equal(isValidCalendarDate('2026-1-01'), false);
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  });

  test('year boundaries', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  });

  test('Singapore "today" does not shift via UTC conversion', () => {
    // 2026-11-16 16:30 UTC is already 2026-11-17 00:30 in Singapore (UTC+8).
    assert.equal(todayInTimeZone('Asia/Singapore', new Date('2026-11-16T16:30:00Z')), '2026-11-17');
    // 2026-11-16 15:59 UTC is still 2026-11-16 23:59 in Singapore.
    assert.equal(todayInTimeZone('Asia/Singapore', new Date('2026-11-16T15:59:00Z')), '2026-11-16');
    // New Year in Singapore while UTC is still in the old year.
    assert.equal(todayInTimeZone('Asia/Singapore', new Date('2026-12-31T16:00:00Z')), '2027-01-01');
  });

  test('YAML Date values normalise via UTC parts, never local time', () => {
    // js-yaml parses `published: 2026-11-16` as 2026-11-16T00:00:00Z.
    assert.equal(normalizeCalendarDate(new Date('2026-11-16T00:00:00Z')), '2026-11-16');
    assert.equal(normalizeCalendarDate('2026-01-01'), '2026-01-01');
    assert.throws(() => normalizeCalendarDate('2026-02-30'));
  });

  test('display formatting keeps the calendar day', () => {
    assert.equal(formatDisplayDate('2026-01-01', 'en-US'), 'Jan 1, 2026');
    assert.equal(formatDisplayDate('2026-12-31', 'en-US'), 'Dec 31, 2026');
  });

  test('weekday arithmetic', () => {
    assert.equal(dayOfWeek('2026-11-16'), 1); // Monday
    assert.equal(dayOfWeek('2027-01-01'), 5); // Friday
  });
});

describe('calendar grid', () => {
  test('every day of a leap year appears exactly once', () => {
    const grid = buildCalendarYear(2028, new Map([['2028-02-29', 3]]), '2028-12-31');
    const days = grid.weeks.flat().filter((c) => c.inYear);
    assert.equal(days.length, daysInYear(2028));
    assert.equal(new Set(days.map((d) => d.date)).size, 366);
    assert.equal(days.find((d) => d.date === '2028-02-29')?.count, 3);
    assert.equal(grid.total, 3);
    assert.equal(grid.monthStarts.length, 12);
    for (const week of grid.weeks) assert.equal(week.length, 7);
    assert.equal(grid.weeks[0][0].date, '2027-12-26'); // padded back to Sunday
  });

  test('counts in neighbouring years do not leak into the grid', () => {
    const counts = new Map([
      ['2026-12-31', 1],
      ['2027-01-01', 5],
    ]);
    const grid2026 = buildCalendarYear(2026, counts, '2026-12-31');
    const grid2027 = buildCalendarYear(2027, counts, '2027-12-31');
    assert.equal(grid2026.total, 1);
    assert.equal(grid2027.total, 5);
    const padding = grid2026.weeks.flat().find((c) => c.date === '2027-01-01');
    assert.equal(padding?.inYear, false);
    assert.equal(padding?.count, 0);
  });

  test('intensity levels and available years', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => levelForCount(n)), [0, 1, 2, 3, 4, 4, 4]);
    // A busier year scales the colours: 20 contributions is the darkest when the reference is 20.
    assert.deepEqual([1, 5, 10, 15, 20, 40].map((n) => levelForCount(n, 20)), [1, 1, 2, 3, 4, 4]);
    assert.equal(levelReference([]), 4);
    assert.equal(levelReference([1, 1, 2]), 4);
    assert.equal(levelReference([...Array(9).fill(10), 80]), 80);
    assert.equal(levelReference([...Array(20).fill(10), 80]), 10);
    assert.deepEqual(calendarYears(['2025-03-01', '2024-01-01'], '2026-11-16'), [2026, 2025, 2024]);
  });
});
