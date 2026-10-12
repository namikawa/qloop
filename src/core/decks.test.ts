import { describe, expect, it } from 'vitest';
import { DECK_DEFINITIONS, deckModel, pickDeck, TIMELINE_RULES } from './decks';
import type { Event, TimelineDeck, TimelinePatternMode } from './models';

function ev(id: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    year: 1600,
    title: `出来事 ${id}`,
    era: '江戸',
    approx: false,
    altYears: [],
    yearLabel: null,
    level: '中学',
    role: 'core',
    ...extra,
  };
}

function deckOf(id: string, items: Event[] = []): TimelineDeck {
  return { id, kind: 'timeline', name: `教材 ${id}`, items };
}

describe('DECK_DEFINITIONS', () => {
  it('最初の教材は日本史年表（年表。id の接頭辞は jh-）', () => {
    expect(DECK_DEFINITIONS[0]).toEqual({
      id: 'japanese-history',
      kind: 'timeline',
      name: '日本史年表',
      idPrefix: 'jh-',
      dir: 'japanese-history',
    });
  });

  it('教材の id・id の接頭辞・データのディレクトリは教材ごとに違う', () => {
    for (const key of ['id', 'idPrefix', 'dir'] as const) {
      const values = DECK_DEFINITIONS.map((definition) => definition[key]);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('TIMELINE_RULES', () => {
  it('パターンは 年号入力・年号 4 択・出来事 4 択 の順', () => {
    expect(TIMELINE_RULES.patterns).toEqual(['yearInput', 'yearChoice', 'choice']);
  });

  it('パターンの表示名は 年号入力・年号 4 択・出来事 4 択・ミックス', () => {
    const modes: TimelinePatternMode[] = ['yearInput', 'yearChoice', 'choice', 'mixed'];
    expect(
      Object.fromEntries(modes.map((mode) => [mode, TIMELINE_RULES.patternLabel(mode)])),
    ).toEqual({
      yearInput: '年号入力',
      yearChoice: '年号 4 択',
      choice: '出来事 4 択',
      mixed: 'ミックス',
    });
  });

  it('画面の言葉は 出来事・基本の年表・時代', () => {
    expect(TIMELINE_RULES.labels).toEqual({ item: '出来事', core: '基本の年表', group: '時代' });
  });

  it('まとめる単位は時代（時代区分表の順）で、出来事の確定した時代を使う', () => {
    expect(TIMELINE_RULES.groups[0]).toBe('縄文');
    expect(TIMELINE_RULES.groups.at(-1)).toBe('令和');
    expect(TIMELINE_RULES.groupOf(ev('a', { year: 1185, era: '平安' }))).toBe('平安');
  });

  it('項目の表示は、見出しが出来事の文、補足が年の表示、まとめの正解が別解を併記した年', () => {
    const event = ev('a', { year: 1185, title: '鎌倉幕府の成立', altYears: [1192] });
    expect(TIMELINE_RULES.itemTitle(event)).toBe('鎌倉幕府の成立');
    expect(TIMELINE_RULES.itemDetail(event)).toBe('1185年');
    expect(TIMELINE_RULES.itemReading(event)).toBeNull();
    expect(TIMELINE_RULES.resultLayout).toBe('inline');
    expect(TIMELINE_RULES.answerText(event)).toBe('1185年・1192年');
  });
});

describe('deckModel', () => {
  it('年表の教材に年表の差分と、中学の項目の母集団を組み合わせる', () => {
    const items = [ev('a'), ev('b', { level: '高校' }), ev('c', { role: 'pool' })];
    const model = deckModel(deckOf('test', items));
    expect(model.rules).toBe(TIMELINE_RULES);
    expect(model.deck.items).toBe(items);
    expect(model.population.map((item) => item.id)).toEqual(['a', 'c']);
  });
});

describe('pickDeck', () => {
  const decks = [deckModel(deckOf('first')), deckModel(deckOf('second'))];

  it('id の教材を選ぶ', () => {
    expect(pickDeck(decks, 'second').deck.id).toBe('second');
  });

  it('id が無いときと、無い教材を指しているときは最初の教材', () => {
    expect(pickDeck(decks, null).deck.id).toBe('first');
    expect(pickDeck(decks, 'removed').deck.id).toBe('first');
  });
});
