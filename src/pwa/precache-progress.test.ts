import { describe, expect, it } from 'vitest';
import { countUncachedFiles } from './precache-progress';

const keys = [
  'https://example.test/index.html?__WB_REVISION__=new',
  'https://example.test/app.js',
  'https://example.test/decks.js',
  'https://example.test/icon.png',
];

describe('countUncachedFiles', () => {
  it('全部キャッシュ済みなら 0', () => {
    expect(countUncachedFiles(keys, new Set(keys))).toBe(0);
  });
  it('半分キャッシュ済みなら残りだけ数える', () => {
    expect(countUncachedFiles(keys, new Set(keys.slice(0, 2)))).toBe(2);
  });
  it('空のキャッシュなら全部数える', () => {
    expect(countUncachedFiles(keys, new Set())).toBe(4);
  });
  it('URL が同じでも revision が違えば取り込みが必要', () => {
    expect(
      countUncachedFiles(
        keys,
        new Set(['https://example.test/index.html?__WB_REVISION__=old', ...keys.slice(1)]),
      ),
    ).toBe(1);
  });
  it('対象の一覧が空なら 0', () => {
    expect(countUncachedFiles([], new Set(keys))).toBe(0);
  });
});
