import { describe, expect, it } from 'vitest';
import { answeredRatio, MAX_PROGRESS_STEPS, progressSteps } from './progress';

describe('progressSteps', () => {
  it('答えた問題は判定、今の問題は current、残りは upcoming にする', () => {
    expect(progressSteps(5, ['correct', 'wrong'], 2)).toEqual([
      'correct',
      'wrong',
      'current',
      'upcoming',
      'upcoming',
    ]);
  });

  it('今の問題の判定が済んでいれば、その判定を出す', () => {
    expect(progressSteps(4, ['correct', 'wrong', 'gaveUp'], 2)).toEqual([
      'correct',
      'wrong',
      'gaveUp',
      'upcoming',
    ]);
  });

  it('最初の問題の回答前は、先頭だけ current にする', () => {
    expect(progressSteps(3, [], 0)).toEqual(['current', 'upcoming', 'upcoming']);
  });

  it('今の問題が無いとき（結果の画面）は、答えていない問題を upcoming にする', () => {
    expect(progressSteps(4, ['correct', 'gaveUp'], null)).toEqual([
      'correct',
      'gaveUp',
      'upcoming',
      'upcoming',
    ]);
    expect(progressSteps(2, ['wrong', 'correct'], null)).toEqual(['wrong', 'correct']);
  });

  it(`問題数が ${MAX_PROGRESS_STEPS} までは区切りにし、超えると null を返す`, () => {
    expect(progressSteps(MAX_PROGRESS_STEPS, [], 0)).toHaveLength(MAX_PROGRESS_STEPS);
    expect(progressSteps(MAX_PROGRESS_STEPS + 1, [], 0)).toBeNull();
  });

  it('問題数が 0 なら空の配列', () => {
    expect(progressSteps(0, [], null)).toEqual([]);
  });
});

describe('answeredRatio', () => {
  it('答えた問題の割合を返す', () => {
    expect(answeredRatio(40, 10)).toBe(0.25);
    expect(answeredRatio(40, 40)).toBe(1);
  });

  it('問題数が 0 なら 0、範囲の外は 0〜1 に収める', () => {
    expect(answeredRatio(0, 0)).toBe(0);
    expect(answeredRatio(10, 12)).toBe(1);
    expect(answeredRatio(10, -1)).toBe(0);
  });
});
