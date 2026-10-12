import type { Event, Range, TimelineRange } from './models';
import { normalizeYearInput } from './year';

/**
 * 出題範囲で出来事を絞り込む（設計書 6.1 節の 2）。判定には代表年 `year` だけを使い、`altYears` は使わない。
 *
 * - 全範囲: 絞り込みなし。
 * - 年号の範囲: 両端を含む。空（`null`）の側は開いた範囲で、両方空なら全範囲と同じ。
 *   `from` は正の整数なので、紀元前（負の年）の出来事は `from` が空のときだけ含まれる。
 * - 時代: 出来事の確定した時代（CSV の `era` による上書きを反映したもの）が、選んだ時代のどれかに当たるもの。
 */
export function filterByRange(events: readonly Event[], range: TimelineRange): Event[] {
  switch (range.kind) {
    case 'all':
      return [...events];
    case 'years': {
      const { from, to } = range;
      return events.filter(
        (event) => (from === null || event.year >= from) && (to === null || event.year <= to),
      );
    }
    case 'eras': {
      const eras = new Set(range.eras);
      return events.filter((event) => eras.has(event.era));
    }
  }
}

/** 出題範囲の表示（例: `全範囲`、`700年〜1600年`、`700年〜`、`〜1600年`、`奈良・江戸`）。履歴で使う。 */
export function formatRange(range: Range): string {
  switch (range.kind) {
    case 'all':
      return '全範囲';
    case 'years':
      if (range.from === null && range.to === null) {
        return '全範囲';
      }
      return `${range.from === null ? '' : `${range.from}年`}〜${range.to === null ? '' : `${range.to}年`}`;
    case 'eras':
      return range.eras.join('・');
    case 'categories':
      return range.categories.join('・');
  }
}

/**
 * 出題範囲を開始できない理由（設計書 6.1 節の 2）。開始できるなら `null`。
 * 開始年が終了年より大きいとき、時代を 1 つも選んでいないときに理由を返す。
 */
export function validateRange(range: Range): string | null {
  if (range.kind === 'years' && range.from !== null && range.to !== null && range.from > range.to) {
    return '開始年が終了年より後になっています';
  }
  if (range.kind === 'eras' && range.eras.length === 0) {
    return '時代を 1 つ以上選んでください';
  }
  return null;
}

/**
 * 年号の範囲の入力欄の値を読む（設計書 6.1 節の 2: 1〜4 桁の正の整数のみ）。
 * 空なら `null`（開いた範囲）、1〜4 桁の正の整数ならその値、それ以外は `undefined`（無効な入力）。
 * 全角数字と前後の空白は年号入力と同じく受け付ける。
 */
export function parseRangeYear(text: string): number | null | undefined {
  if (text.trim() === '') {
    return null;
  }
  const year = normalizeYearInput(text);
  return year !== null && year > 0 ? year : undefined;
}
