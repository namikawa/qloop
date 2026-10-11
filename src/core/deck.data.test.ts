import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDeck } from './deck';
import { generateYearChoices, isYearChoiceEligible, isYearInputEligible } from './quiz';
import { mulberry32 } from './random';

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

  it('基本の年表（core.csv）の出来事がある（追加データの pool.csv は空でもよい）', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.deck.events.map((event) => event.role);
    expect(roles).toContain('core');
  });

  it('年号入力に適格な全出来事で、今年を 2026 として年号 4 択の選択肢を作れる', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const targets = result.deck.events.filter(isYearInputEligible);
    expect(targets.length).toBeGreaterThan(0);
    const rng = mulberry32(2026);
    const problems: string[] = [];
    for (const event of targets) {
      expect(isYearChoiceEligible(event)).toBe(true);
      // 乱数によって選ぶ k が変わるので、何度か作る
      for (let i = 0; i < 20; i++) {
        const years = generateYearChoices(event, 2026, rng);
        const distractors = years.filter((year) => year !== event.year);
        const valid =
          years.length === 4 &&
          new Set(years).size === 4 &&
          years.every((year, j) => j === 0 || years[j - 1] < year) &&
          years.includes(event.year) &&
          distractors.every(
            (year) =>
              Math.abs(year - event.year) <= 10 &&
              year > 0 &&
              year <= 2026 &&
              !event.altYears.includes(year),
          );
        if (!valid) {
          problems.push(`${event.id} ${event.title}: ${years.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
