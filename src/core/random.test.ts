import { describe, expect, it } from 'vitest';
import { mulberry32, shuffle, uuidFromRng } from './random';

describe('mulberry32', () => {
  it('同じシードなら同じ列を返し、0 以上 1 未満に収まる', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('シードが違えば違う列を返す', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('shuffle', () => {
  it('要素を保ったまま並びを変え、元の配列は変えない', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(items, mulberry32(7));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('uuidFromRng', () => {
  it('版 4 の UUID の形式になる', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      expect(uuidFromRng(rng)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
