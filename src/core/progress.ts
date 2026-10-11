/**
 * 出題中と結果の画面の、進み具合の区切り（1 問ずつの判定の色）を作る。
 */

/** 1 問の判定。`gaveUp` は「わからない」（記録は不正解だが、表示では不正解と分ける）。 */
export type AnswerOutcome = 'correct' | 'wrong' | 'gaveUp';

/** 区切り 1 つの状態。答えた問題は判定、今の問題は `current`、まだの問題は `upcoming`。 */
export type ProgressStep = AnswerOutcome | 'current' | 'upcoming';

/** 区切りで示す問題数の上限。これを超えると区切りにせず、1 本の帯で示す。 */
export const MAX_PROGRESS_STEPS = 20;

/**
 * 問題ごとの区切りの状態を返す。問題数が `MAX_PROGRESS_STEPS` を超えるときは `null`（1 本の帯で示す）。
 *
 * - `outcomes`: 答えた問題の判定（出題の順）。
 * - `current`: 今の問題の位置（0 から）。判定の済んだ問題は判定を優先する。結果の画面のように今の問題が無いときは `null`。
 */
export function progressSteps(
  total: number,
  outcomes: readonly AnswerOutcome[],
  current: number | null,
): ProgressStep[] | null {
  if (total > MAX_PROGRESS_STEPS) {
    return null;
  }
  const steps: ProgressStep[] = [];
  for (let i = 0; i < total; i++) {
    if (i < outcomes.length) {
      steps.push(outcomes[i]);
    } else {
      steps.push(i === current ? 'current' : 'upcoming');
    }
  }
  return steps;
}

/** 1 本の帯で示すときの、答えた問題の割合（0〜1）。問題数が 0 なら 0。 */
export function answeredRatio(total: number, answered: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, answered / total));
}
