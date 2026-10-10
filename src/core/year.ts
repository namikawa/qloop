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
