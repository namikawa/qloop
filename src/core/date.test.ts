import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  calendarDaysBetween,
  compactLocalDate,
  daysBetweenKeys,
  formatLocalDate,
  formatLocalDateTime,
  isWithinDays,
  localDateKey,
  startOfLocalDay,
  type DateKeyFn,
} from './date';

const HOUR = 60 * 60 * 1000;

/** UTC からの時差（時間）を固定した暦。端末のタイムゾーンの代わりに注入する。 */
function fixedOffsetDateKey(offsetHours: number): DateKeyFn {
  return (date) => new Date(date.getTime() + offsetHours * HOUR).toISOString().slice(0, 10);
}

const UTC = fixedOffsetDateKey(0);
const JST = fixedOffsetDateKey(9);
const NEW_YORK = fixedOffsetDateKey(-4);

describe('localDateKey', () => {
  it('端末ローカルの暦日を YYYY-MM-DD にする', () => {
    expect(localDateKey(new Date(2026, 0, 2, 23, 59, 59))).toBe('2026-01-02');
    expect(localDateKey(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31');
  });
});

describe('startOfLocalDay', () => {
  it('端末ローカルの暦日の 0 時を返す', () => {
    expect(startOfLocalDay(new Date(2026, 9, 11, 23, 59, 59, 999))).toEqual(
      new Date(2026, 9, 11, 0, 0, 0, 0),
    );
    expect(startOfLocalDay(new Date(2026, 9, 11))).toEqual(new Date(2026, 9, 11));
  });
});

describe('daysBetweenKeys と addDaysToKey', () => {
  it('暦日の差を数える（月・年の境目、うるう年）', () => {
    expect(daysBetweenKeys('2026-10-11', '2026-10-11')).toBe(0);
    expect(daysBetweenKeys('2026-10-11', '2026-10-25')).toBe(14);
    expect(daysBetweenKeys('2026-10-25', '2026-10-11')).toBe(-14);
    expect(daysBetweenKeys('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetweenKeys('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetweenKeys('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('暦日を前後にずらす', () => {
    expect(addDaysToKey('2026-10-11', -1)).toBe('2026-10-10');
    expect(addDaysToKey('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysToKey('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDaysToKey('2026-10-11', 14)).toBe('2026-10-25');
  });

  it('暦日の形式でなければ例外を投げる', () => {
    expect(() => daysBetweenKeys('2026/10/11', '2026-10-11')).toThrow();
  });
});

describe('calendarDaysBetween', () => {
  it('経過日数は時刻の差ではなく暦日の差（深夜をまたげば 2 分でも 1 日）', () => {
    // JST の 10 月 11 日 23:59 と 10 月 12 日 0:01
    const before = new Date('2026-10-11T14:59:00.000Z');
    const after = new Date('2026-10-11T15:01:00.000Z');
    expect(calendarDaysBetween(before, after, JST)).toBe(1);
    // UTC の暦ではどちらも 10 月 11 日
    expect(calendarDaysBetween(before, after, UTC)).toBe(0);
  });

  it('24 時間近く離れていても、同じ暦日なら 0 日', () => {
    // JST の 10 月 11 日 0:01 と 23:59
    const morning = new Date('2026-10-10T15:01:00.000Z');
    const night = new Date('2026-10-11T14:59:00.000Z');
    expect(calendarDaysBetween(morning, night, JST)).toBe(0);
    expect(calendarDaysBetween(morning, night, UTC)).toBe(1);
  });

  it('同じ時刻の組でも、注入したタイムゾーンによって暦日の差が変わる', () => {
    const from = new Date('2026-10-01T02:00:00.000Z');
    const to = new Date('2026-10-15T23:00:00.000Z');
    expect(calendarDaysBetween(from, to, UTC)).toBe(14);
    expect(calendarDaysBetween(from, to, JST)).toBe(15);
    expect(calendarDaysBetween(from, to, NEW_YORK)).toBe(15);
  });

  it('暦を渡さなければ端末ローカルの暦を使う', () => {
    expect(calendarDaysBetween(new Date(2026, 9, 11, 23, 59), new Date(2026, 9, 12, 0, 1))).toBe(1);
  });
});

describe('isWithinDays', () => {
  // JST の 10 月 25 日 9:00
  const now = new Date('2026-10-25T00:00:00.000Z');

  it('N 日前の 0 時ちょうどは含み、その直前は含まない（境界を含む）', () => {
    // JST の 10 月 11 日 0:00（14 日前の 0 時）
    expect(isWithinDays(new Date('2026-10-10T15:00:00.000Z'), now, 14, JST)).toBe(true);
    // JST の 10 月 10 日 23:59:59.999
    expect(isWithinDays(new Date('2026-10-10T14:59:59.999Z'), now, 14, JST)).toBe(false);
  });

  it('今日の時刻は 0 日前として含む', () => {
    expect(isWithinDays(now, now, 0, JST)).toBe(true);
    expect(isWithinDays(new Date('2026-10-24T14:59:00.000Z'), now, 0, JST)).toBe(false);
  });

  it('端末ローカルの暦では「startOfLocalDay(now) から N 日戻した 0 時以降」と同じ結果になる', () => {
    const localNow = new Date(2026, 9, 25, 9, 30);
    const start = startOfLocalDay(localNow);
    const threshold = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 14);
    for (const time of [
      new Date(2026, 9, 10, 23, 59, 59, 999),
      new Date(2026, 9, 11, 0, 0, 0, 0),
      new Date(2026, 9, 11, 12, 0),
      new Date(2026, 9, 25, 9, 0),
      new Date(2026, 8, 30, 12, 0),
    ]) {
      expect(isWithinDays(time, localNow, 14)).toBe(time.getTime() >= threshold.getTime());
    }
  });
});

describe('日付の表示', () => {
  it('端末ローカルの日付と日時を表示する', () => {
    const date = new Date(2026, 0, 2, 9, 5, 30);
    expect(formatLocalDate(date)).toBe('2026/01/02');
    expect(formatLocalDateTime(date)).toBe('2026/01/02 09:05');
    expect(compactLocalDate(date)).toBe('20260102');
  });
});
