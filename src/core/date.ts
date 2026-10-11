/**
 * 暦日の計算（設計書 7 章「日付の数え方」）。復習と連続学習日数の日付計算はすべてここを通す。
 *
 * 時刻は UTC の ISO 8601 文字列で保存し、学習日と経過日数は端末の現在のタイムゾーンでの暦日で数える。
 * 暦（タイムゾーン）は「時刻から暦日 `YYYY-MM-DD` を求める関数」（`DateKeyFn`）として注入できるようにし、
 * テストでは固定のタイムゾーンの暦を渡す。既定は端末ローカルの暦（`localDateKey`）。
 */

/** 時刻から暦日（`YYYY-MM-DD`）を求める関数。 */
export type DateKeyFn = (date: Date) => string;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** 端末ローカルの暦日を `YYYY-MM-DD` にする。 */
export function localDateKey(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** 端末ローカルの暦日の 0 時。 */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 暦日 `YYYY-MM-DD` の通し番号（1970-01-01 を 0 とする日数）。形式が違えば例外を投げる。 */
function dayNumber(key: string): number {
  const match = DATE_KEY.exec(key);
  if (match === null) {
    throw new Error(`暦日の形式ではありません: ${key}`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** 暦日 `from` から `to` までの日数（`to` が後なら正）。 */
export function daysBetweenKeys(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** 暦日 `key` の `days` 日後（負なら前）の暦日。 */
export function addDaysToKey(key: string, days: number): string {
  return new Date((dayNumber(key) + days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 時刻 `from` から `to` までの経過日数を、暦日の差で求める（時刻の差ではない）。
 * 例: 23:59 の 2 分後の 0:01 は 1 日。暦は `dateKey` で決める。
 */
export function calendarDaysBetween(
  from: Date,
  to: Date,
  dateKey: DateKeyFn = localDateKey,
): number {
  return daysBetweenKeys(dateKey(from), dateKey(to));
}

/**
 * 時刻 `time` が、`now` の暦日から `days` 日前の 0 時以降か（境界を含む）。
 * `days` 日前の 0 時以降であることと、暦日の差が `days` 日以内であることは同じなので、暦日の差で判定する。
 */
export function isWithinDays(
  time: Date,
  now: Date,
  days: number,
  dateKey: DateKeyFn = localDateKey,
): boolean {
  return calendarDaysBetween(time, now, dateKey) <= days;
}

/** 端末ローカルの日付の表示（例: `2026/10/11`）。成績画面の最終回答日に使う。 */
export function formatLocalDate(date: Date): string {
  return `${pad(date.getFullYear(), 4)}/${pad(date.getMonth() + 1, 2)}/${pad(date.getDate(), 2)}`;
}

/** 端末ローカルの日時の表示（例: `2026/10/11 09:05`）。成績画面の履歴に使う。 */
export function formatLocalDateTime(date: Date): string {
  return `${formatLocalDate(date)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}`;
}

/** 書き出しのファイル名に使う端末ローカルの日付（例: `20261011`）。 */
export function compactLocalDate(date: Date): string {
  return localDateKey(date).replace(/-/g, '');
}
