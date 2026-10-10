import type { Event } from './models';

/**
 * 出来事の年の表示（設計書 5.3 節）。出題・判定後の表示・まとめ・成績で共通に使う。
 * `yearLabel` があればそれを使い、無ければ「○○年」「○○年ごろ」「紀元前○○年」「紀元前○○年ごろ」。
 */
export function formatEventYear(event: Pick<Event, 'year' | 'approx' | 'yearLabel'>): string {
  if (event.yearLabel !== null && event.yearLabel !== '') {
    return event.yearLabel;
  }
  return formatYear(event.year, event.approx);
}

/** 年の数値を表示用の文字列にする。紀元前は負数で表す。 */
export function formatYear(year: number, approx = false): string {
  const base = year < 0 ? `紀元前${-year}年` : `${year}年`;
  return approx ? `${base}ごろ` : base;
}

/**
 * 正解の年の表示（判定後の表示とまとめ画面で使う）。`formatEventYear` の表示に、
 * 追加で正解とみなす年（`altYears`）があれば「・」区切りで併記する。例: `1185年・1192年`
 */
export function formatAnswerYears(
  event: Pick<Event, 'year' | 'approx' | 'yearLabel' | 'altYears'>,
): string {
  return [formatEventYear(event), ...event.altYears.map((year) => formatYear(year))].join('・');
}

const FULLWIDTH_DIGIT = /[０-９]/g;
const YEAR_INPUT = /^[0-9]{1,4}$/;

/**
 * 年号入力の正規化（設計書 6.2 節）。前後の空白を除き、全角数字を半角に直し、
 * 1〜4 桁の数字なら整数にして返す（先頭の 0 は無視する。`0710` は 710）。それ以外は `null`。
 */
export function normalizeYearInput(text: string): number | null {
  const halfWidth = text
    .trim()
    .replace(FULLWIDTH_DIGIT, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  return YEAR_INPUT.test(halfWidth) ? Number(halfWidth) : null;
}
