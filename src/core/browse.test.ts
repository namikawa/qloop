import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { availableBrowseGroups, browseCountText, browseGroups, browseReviewIds } from './browse';
import {
  buildDeckFromCsv,
  deckModel,
  DECK_DEFINITIONS,
  TIMELINE_RULES,
  VOCABULARY_RULES,
} from './decks';
import type { Event, EventStats, Item, Pattern, Word } from './models';
import { reviewCandidates } from './review';

function event(id: string, year: number, overrides: Partial<Event> = {}): Event {
  return {
    id,
    year,
    title: id,
    era: '江戸',
    level: '中学',
    role: 'core',
    approx: false,
    altYears: [],
    yearLabel: null,
    ...overrides,
  };
}

function word(id: string, text: string, overrides: Partial<Word> = {}): Word {
  return {
    id,
    word: text,
    meaning: `${text}の意味`,
    category: '慣用句',
    reading: null,
    similar: [],
    level: '中学',
    role: 'core',
    ...overrides,
  };
}

describe('年表の一覧', () => {
  const items = [
    event('b', 1700),
    event('a', 1700),
    event('c', 1603),
    event('old', 1185, { era: '平安' }),
    event('new', 1573, { era: '室町' }),
    event('pool', 1926, { era: '昭和', role: 'pool' }),
    event('last', 1989, { era: '平成' }),
  ];

  it('確定した時代の表の順、年の昇順、同じ年は id 順に並べ、入力を変えない', () => {
    const before = [...items];
    const sections = browseGroups(items, TIMELINE_RULES, 'all', []);
    expect(sections.map((section) => section.name)).toEqual([
      '平安',
      '室町',
      '江戸',
      '昭和',
      '平成',
    ]);
    expect(sections.flatMap((section) => section.items.map((item) => item.id))).toEqual([
      'old',
      'new',
      'c',
      'a',
      'b',
      'pool',
      'last',
    ]);
    expect(items).toEqual(before);
  });

  it('基本のみ・すべてと複数の時代を組み合わせ、空の時代の見出しを出さない', () => {
    expect(browseGroups(items, TIMELINE_RULES, 'core', ['平成', '昭和'])).toEqual([
      { name: '平成', items: [items[6]] },
    ]);
    expect(
      browseGroups(items, TIMELINE_RULES, 'all', ['平成', '昭和']).map((section) => section.name),
    ).toEqual(['昭和', '平成']);
    expect(browseGroups(items, TIMELINE_RULES, 'core', ['昭和'])).toEqual([]);
    expect(
      browseGroups(items, TIMELINE_RULES, 'core', []).flatMap((section) => section.items),
    ).toHaveLength(6);
  });

  it('チップは scope によらず母集団にある時代だけを表の順で出す', () => {
    expect(availableBrowseGroups(items, TIMELINE_RULES)).toEqual([
      '平安',
      '室町',
      '江戸',
      '昭和',
      '平成',
    ]);
  });

  it('年は別解を併記し、題名を後ろに表示する', () => {
    const item = event('year', 1185, { title: '出来事', altYears: [1192] });
    expect(TIMELINE_RULES.browse.front(item)).toBe('1185年・1192年');
    expect(TIMELINE_RULES.browse.back(item)).toBe('出来事');
  });
});

describe('語彙の一覧', () => {
  // 種類の順は定義で決まる。現行データが慣用句だけでも複数種類の絞り込みを検証する。
  const rules = { ...VOCABULARY_RULES, groups: ['慣用句', 'ことわざ', '四字熟語'] };
  const items = [
    word('fire', '顔から火が出る', { reading: 'かおからひがでる' }),
    word('wide-b', '顔が広い', { reading: 'かおがひろい' }),
    word('wide-a', '同じ読み', { reading: 'かおがひろい' }),
    word('kana', 'いたちごっこ'),
    word('proverb', 'あ', { category: 'ことわざ', role: 'pool' }),
    word('idiom', 'い', { category: '四字熟語' }),
  ];

  it('種類の順、日本語の照合順（濁点含む）、読みが無い言葉、同じ読みの id 順で並ぶ', () => {
    const sections = browseGroups(items, rules, 'all', []);
    expect(sections.map((section) => section.name)).toEqual(rules.groups);
    expect(sections.flatMap((section) => section.items.map((item) => item.id))).toEqual([
      'kana',
      'wide-a',
      'wide-b',
      'fire',
      'proverb',
      'idiom',
    ]);
    expect(new Intl.Collator('ja').compare('かおがひろい', 'かおからひがでる')).toBeLessThan(0);
  });

  it('種類を複数選べ、未選択は全部で、基本のみで空になる種類は出さない', () => {
    expect(
      browseGroups(items, rules, 'all', ['四字熟語', 'ことわざ']).map((section) => section.name),
    ).toEqual(['ことわざ', '四字熟語']);
    expect(
      browseGroups(items, rules, 'core', ['ことわざ', '四字熟語']).map((section) => section.name),
    ).toEqual(['四字熟語']);
    expect(browseGroups(items, rules, 'all', []).flatMap((section) => section.items)).toHaveLength(
      6,
    );
    expect(
      availableBrowseGroups(
        items.filter((item) => item.category !== '四字熟語'),
        rules,
      ),
    ).toEqual(['慣用句', 'ことわざ']);
  });

  it('言葉・読みと意味を表示し、読みが無いときは null', () => {
    expect(rules.browse.front(items[0])).toBe('顔から火が出る');
    expect(rules.browse.reading(items[0])).toBe('かおからひがでる');
    expect(rules.browse.reading(items[3])).toBeNull();
    expect(rules.browse.back(items[0])).toBe(items[0].meaning);
  });
});

it('隠す選択肢は年表が年・出来事、語彙が意味・言葉の順', () => {
  expect(TIMELINE_RULES.browse.hideOptions).toEqual([
    { value: 'front', label: '年' },
    { value: 'back', label: '出来事' },
  ]);
  expect(VOCABULARY_RULES.browse.hideOptions).toEqual([
    { value: 'back', label: '意味' },
    { value: 'front', label: '言葉' },
  ]);
});

it('件数の行は全体・選択した範囲（表の順）・0 件を表す', () => {
  expect(browseCountText('時代', TIMELINE_RULES.groups, [], 371)).toBe('すべての時代 371 件');
  expect(browseCountText('時代', TIMELINE_RULES.groups, ['平成', '昭和'], 91)).toBe(
    '昭和・平成 91 件',
  );
  expect(browseCountText('種類', VOCABULARY_RULES.groups, [], 314)).toBe('すべての種類 314 件');
  expect(browseCountText('種類', ['慣用句', 'ことわざ'], ['ことわざ', '慣用句'], 10)).toBe(
    '慣用句・ことわざ 10 件',
  );
  expect(browseCountText('時代', TIMELINE_RULES.groups, ['縄文'], 0)).toBe('ありません');
  expect(browseCountText('種類', VOCABULARY_RULES.groups, [], 0)).toBe('ありません');
});

it('復習の候補はホームと同じ入力で、複数のパターンでも項目の札は 1 つ', () => {
  const item = event('review', 1603);
  const now = new Date('2026-10-14T12:00:00+09:00');
  const stats: EventStats[] = (['yearInput', 'yearChoice'] as const).map((pattern) => ({
    eventId: item.id,
    pattern,
    attempts: 1,
    correct: 0,
    lastAnsweredAt: now.toISOString(),
    lastCorrect: false,
    lastWrongAt: now.toISOString(),
    consecutiveCorrect: 0,
  }));
  const candidates = reviewCandidates({
    population: [item],
    allItems: [item],
    stats,
    now,
    rules: TIMELINE_RULES,
  });
  expect(candidates).toHaveLength(2);
  expect([...browseReviewIds(candidates)]).toEqual(['review']);
  expect(browseReviewIds(candidates).has('unanswered')).toBe(false);
  expect(browseReviewIds([]).size).toBe(0);
});

for (const definition of DECK_DEFINITIONS) {
  describe(`実データの一覧（${definition.name}）`, () => {
    const dir = new URL(`../../data/decks/${definition.dir}/`, import.meta.url);
    const result = buildDeckFromCsv(definition, {
      core: readFileSync(new URL('core.csv', dir), 'utf8'),
      pool: readFileSync(new URL('pool.csv', dir), 'utf8'),
    });
    it('母集団の全項目が 1 回ずつ出て、高校の項目は出ない', () => {
      expect(result.ok ? [] : result.errors).toEqual([]);
      if (!result.ok) throw new Error('教材データの検証に失敗しました');
      const model = deckModel(result.deck);
      const sections = browseGroups<Item>(model.population, model.rules, 'all', []);
      const displayed = sections.flatMap((section) => section.items);
      const ids = displayed.map((item) => item.id);
      expect(ids.length).toBe(model.population.length);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(model.population.map((item) => item.id).sort());
      expect(displayed.every((item) => item.level === '中学')).toBe(true);
      expect(
        result.deck.items
          .filter((item) => item.level === '高校')
          .every((item) => !ids.includes(item.id)),
      ).toBe(true);
      const candidates = reviewCandidates<Item, Pattern>({
        population: model.population,
        allItems: result.deck.items,
        rules: model.rules,
        now: new Date('2026-10-14T12:00:00+09:00'),
        stats: [],
      });
      expect(browseReviewIds(candidates).size).toBe(0);
    });
  });
}
