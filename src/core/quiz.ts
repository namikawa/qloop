import type { Event } from './models';

/** 4 択に必要な誤答の数。 */
export const CHOICE_DISTRACTOR_COUNT = 3;

/** `approx` の出来事が絡むとき、誤答の候補から外す年の差（この年数以内は除外）。 */
const APPROX_EXCLUSION_YEARS = 50;

/**
 * 4 択の誤答の候補（設計書 6.3 節の除外規則 1〜3 を適用した後のもの）。
 * `allEvents` は core と pool の全出来事。並びは `allEvents` の順を保つ。
 *
 * 1. 出題した出来事自身を除く。
 * 2. `year` または `altYears` のいずれかが出題年（`event.year`）と一致するものを除く。
 * 3. 出題した出来事か候補のどちらかが `approx` なら、`year` の差が 50 年以内のものを除く。
 */
export function distractorCandidates(event: Event, allEvents: readonly Event[]): Event[] {
  return allEvents.filter((candidate) => {
    if (candidate.id === event.id) {
      return false;
    }
    if (candidate.year === event.year || candidate.altYears.includes(event.year)) {
      return false;
    }
    if (
      (event.approx || candidate.approx) &&
      Math.abs(candidate.year - event.year) <= APPROX_EXCLUSION_YEARS
    ) {
      return false;
    }
    return true;
  });
}

/** 4 択に出せるか（除外規則を適用した後の誤答の候補が 3 件以上あるか）。 */
export function isChoiceEligible(event: Event, allEvents: readonly Event[]): boolean {
  return distractorCandidates(event, allEvents).length >= CHOICE_DISTRACTOR_COUNT;
}
