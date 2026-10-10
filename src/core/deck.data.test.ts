import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDeck } from './deck';

/** data/ にある実際の CSV が検証を通ること（データを編集した PR をこのテストで守る）。 */
describe('data/decks/japanese-history', () => {
  const dir = new URL('../../data/decks/japanese-history/', import.meta.url);
  const result = buildDeck({
    id: 'japanese-history',
    name: '日本史年表',
    core: readFileSync(new URL('core.csv', dir), 'utf8'),
    pool: readFileSync(new URL('pool.csv', dir), 'utf8'),
  });

  it('core.csv と pool.csv が検証を通る', () => {
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('出題対象の出来事がある（誤答用の pool.csv は空でもよい）', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.deck.events.map((event) => event.role);
    expect(roles).toContain('core');
  });
});
