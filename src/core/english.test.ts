import { describe, expect, it } from 'vitest';
import { browseRangeText, browseGroups } from './browse';
import { DECK_DEFINITIONS, deckModel } from './decks';
import {
  buildEnglishDeck,
  buildQuestion,
  choiceDisplay,
  distractorCandidates,
  eligibleQuestions,
  ENGLISH_CSV_COLUMNS,
  englishLessons,
  filterByRange,
  formatEnglishRange,
  generateChoices,
  generateSession,
  isEligibleFor,
  isCorrectSpelling,
  isSpellingEligible,
  meaningWithPos,
  normalizeEnglishSettings,
  normalizeEnglishWord,
  sameAnswerGroup,
  spellingAnswers,
} from './english';
import {
  ENGLISH_PATTERNS,
  type EnglishChoicePattern,
  type EnglishWord,
  type EnglishSettings,
  type EventStats,
  type Session,
} from './models';
import { mulberry32 } from './random';
import { generateReviewSession, reviewCandidates } from './review';
import { describeSession, summarizeStats } from './stats';

function word(id: string, extra: Partial<EnglishWord> = {}): EnglishWord {
  return {
    id,
    word: `word-${id}`,
    meaning: `意味${id}`,
    pos: '名詞',
    book: 'STAGE2',
    lesson: 4,
    similar: [],
    role: 'core',
    level: '中学',
    ...extra,
  };
}
const WORDS = Array.from({ length: 8 }, (_, index) => word(`en-${index + 1}`));
const CHOICE_PATTERNS: readonly EnglishChoicePattern[] = [
  'englishMeaningChoice',
  'englishWordChoice',
];
const HEADER = ENGLISH_CSV_COLUMNS.join(',');
function csv(items: readonly EnglishWord[]): string {
  return [
    HEADER,
    ...items.map((item) =>
      [
        item.id,
        item.word,
        item.meaning,
        item.pos ?? '',
        item.book,
        item.lesson,
        item.similar.join(';'),
      ]
        .map((cell) => {
          const text = String(cell);
          return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    ),
  ].join('\n');
}
function build(core = csv(WORDS)) {
  return buildEnglishDeck({ id: 'english-words', name: '英単語', idPrefix: 'en-', core });
}
function errors(core: string): string[] {
  const result = build(core);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}
function candidateIds(
  target: EnglishWord,
  pattern: EnglishChoicePattern,
  all: readonly EnglishWord[],
): string[] {
  return distractorCandidates(target, pattern, all).flatMap((group) =>
    group.map((item) => item.id),
  );
}

describe('英単語の正規化', () => {
  it.each([
    ["here's", 'here’s'],
    ["here's", 'ＨＥＲＥ＇Ｓ'],
    ['hello', ' Ｈｅｌｌｏ！？． '],
    ['take it easy', '  Take   it\t easy.  '],
    ['what ... for', 'What ... for?'],
    ['a-b(c)', 'Ａ－Ｂ（Ｃ）'],
  ])('%s と %s は同じ英単語', (left, right) => {
    expect(normalizeEnglishWord(right)).toBe(normalizeEnglishWord(left));
  });
  it('空と全角空白を入力にも使える形にし、穴や内部の記号は保つ', () => {
    expect(normalizeEnglishWord('　 \t')).toBe('');
    expect(normalizeEnglishWord('What ... for?')).toBe('what ... for');
    expect(normalizeEnglishWord('a.b?c!')).toBe('a.b?c');
    expect(normalizeEnglishWord('①')).toBe('①');
  });
});

describe('つづり入力', () => {
  it.each([
    ["here's", 'Here’s'],
    ["here's", "here's"],
    ["here's", ' ＨＥＲＥ＇Ｓ！？． '],
    ['Never mind.', 'Never mind'],
    ['Never mind.', 'never mind.'],
    ['Never mind.', '  NEVER　 \t mind!?  '],
    ['liberty', 'ｌｉｂｅｒｔｙ'],
  ])('%s の正解に表記違いの %s を受け付ける', (answer, input) => {
    expect(isCorrectSpelling(input, [word('en-0001', { word: answer })])).toBe(true);
  });
  it.each(['', '　 \t', '...', '?', '！？．'])('正規化して空になる %s は回答できない', (input) => {
    expect(normalizeEnglishWord(input)).toBe('');
    expect(isCorrectSpelling(input, [word('empty', { word: '...' })])).toBe(false);
  });
  it('カードの文が同じ行だけが別解になり、similarの相手と異なる品詞を含めない', () => {
    const someone = word('en-0001', { word: 'someone', meaning: '誰か', pos: '代名詞' });
    const somebody = word('en-0002', {
      word: 'somebody',
      meaning: '誰か',
      pos: '代名詞',
      similar: ['en-0003'],
    });
    const anybody = word('en-0003', {
      word: 'anybody',
      meaning: '誰か（疑問文）',
      pos: '代名詞',
      similar: ['en-0004'],
    });
    const nobody = word('en-0004', { word: 'nobody', meaning: '誰も…ない', pos: '代名詞' });
    const otherPos = word('en-0005', { word: 'other', meaning: '誰か', pos: '名詞' });
    const items = [somebody, nobody, someone, anybody, otherPos];
    for (const source of [someone, somebody]) {
      const question = buildQuestion(source, 'englishSpelling', items, 2026, mulberry32(0));
      expect(question.answers).toEqual([someone, somebody]);
      for (const input of ['someone', 'somebody'])
        expect(isCorrectSpelling(input, question.answers)).toBe(true);
      for (const input of ['anybody', 'nobody', 'other'])
        expect(isCorrectSpelling(input, question.answers)).toBe(false);
    }
    expect(spellingAnswers(otherPos, items)).toEqual([otherPos]);
  });
  it('正規化したつづりの重複をまとめ、表記と並びに最小のidを使う', () => {
    const first = word('en-0001', { word: 'Liberty!', meaning: '自由' });
    const second = word('en-0002', { word: 'freedom', meaning: '自由' });
    const again = word('en-0003', { word: 'ｌｉｂｅｒｔｙ', meaning: '自由', lesson: 5 });
    const items = [again, second, first];
    for (const source of items) expect(spellingAnswers(source, items)).toEqual([first, second]);
    expect(items).toEqual([again, second, first]);
  });
  it.each(['What ... for?', 'Would you mind …ing?'])(
    '穴のある %s は通常・ミックス・復習と別解から外すが、CSVの4択検証は通る',
    (text) => {
      const target = word('en-0000', { word: text, meaning: WORDS[0].meaning });
      const items = [target, ...WORDS];
      expect(isSpellingEligible(target)).toBe(false);
      expect(isEligibleFor(target, 'englishSpelling', items)).toBe(false);
      expect(eligibleQuestions([target], items, 'englishSpelling')).toEqual([]);
      expect(
        generateSession({
          candidates: [target],
          allWords: items,
          mode: 'englishSpelling',
          count: 'all',
          rng: mulberry32(0),
        }),
      ).toEqual([]);
      expect(eligibleQuestions([target], items, 'mixed')[0].patterns).toEqual(CHOICE_PATTERNS);
      for (const [value, pattern] of [
        [0, 'englishMeaningChoice'],
        [0.499, 'englishMeaningChoice'],
        [0.5, 'englishWordChoice'],
        [0.999, 'englishWordChoice'],
      ] as const) {
        expect(
          generateSession({
            candidates: [target],
            allWords: items,
            mode: 'mixed',
            count: 10,
            rng: () => value,
          })[0].pattern,
        ).toBe(pattern);
      }
      const question = buildQuestion(WORDS[0], 'englishSpelling', items, 2026, mulberry32(0));
      expect(question.answers).toEqual([WORDS[0]]);
      expect(isCorrectSpelling(text, question.answers)).toBe(false);
      const rules = deckModel({
        id: 'english-words',
        kind: 'english',
        name: '英単語',
        items,
      }).rules;
      expect(
        reviewCandidates({
          population: items,
          allItems: items,
          rules,
          now: new Date('2026-10-17'),
          stats: [
            {
              eventId: target.id,
              pattern: 'englishSpelling',
              attempts: 1,
              correct: 0,
              lastCorrect: false,
              lastWrongAt: '2026-10-17T00:00:00.000Z',
              lastAnsweredAt: '2026-10-17T00:00:00.000Z',
              consecutiveCorrect: 0,
            },
          ],
        }),
      ).toEqual([]);
      expect(build(csv(items)).ok).toBe(true);
    },
  );
});

describe('同じ答えの集まりと誤答の除外', () => {
  const someone = word('someone', { word: 'someone', meaning: '誰か' });
  const somebody = word('somebody', { word: 'somebody', meaning: '誰か', similar: ['anybody'] });
  const anybody = word('anybody', { word: 'anybody', meaning: '誰か（疑問文）' });
  const reverse = word('reverse', { word: 'anyone', meaning: '誰でも', similar: ['anybody'] });
  const all = [someone, somebody, anybody, reverse, ...WORDS];
  it('同じ意味と片側の similar を推移的にたどり、どの行からも同じ集まりを返す', () => {
    for (const item of all.slice(0, 4)) {
      expect(sameAnswerGroup(item, all).map((answer) => answer.id)).toEqual([
        'someone',
        'somebody',
        'anybody',
        'reverse',
      ]);
      expect(sameAnswerGroup(item, all)).toBe(sameAnswerGroup(someone, all));
    }
    // 配列が違えば、新しい意味や参照を含む集まりとして計算する。
    expect(sameAnswerGroup(someone, [someone]).map((answer) => answer.id)).toEqual(['someone']);
  });
  it('両パターンで、集まりの意味・英単語を持つ別のレッスンの行も除く', () => {
    const again = word('again', {
      word: 'ＡＮＹＢＯＤＹ!',
      meaning: '別レッスンの意味',
      lesson: 5,
    });
    const sameMeaning = word('same-meaning', { meaning: '誰でも', lesson: 5 });
    const items = [...all, again, sameMeaning];
    expect(candidateIds(someone, 'englishMeaningChoice', items)).not.toEqual(
      expect.arrayContaining(['someone', 'somebody', 'anybody', 'reverse', 'same-meaning']),
    );
    expect(candidateIds(someone, 'englishMeaningChoice', items)).toEqual([
      ...WORDS.map((item) => item.id),
      'again',
    ]);
    expect(candidateIds(someone, 'englishWordChoice', items)).toEqual(WORDS.map((item) => item.id));
  });
  it('意味 4 択は同じ word の全レッスンの集まりを除き、英単語 4 択は出題行の集まりだけを使う', () => {
    const bank = word('bank', { word: 'bank', meaning: '銀行' });
    const riverBank = word('river-bank', { word: 'ＢＡＮＫ.', meaning: '土手', lesson: 5 });
    const embankment = word('embankment', { word: 'embankment', meaning: '土手', lesson: 6 });
    const linked = word('linked', { meaning: '堤防', similar: ['embankment'] });
    const items = [bank, riverBank, embankment, linked, ...WORDS];
    for (const target of [bank, riverBank]) {
      expect(candidateIds(target, 'englishMeaningChoice', items)).toEqual(
        WORDS.map((item) => item.id),
      );
    }
    expect(candidateIds(bank, 'englishWordChoice', items)).toEqual([
      'embankment',
      'linked',
      ...WORDS.map((item) => item.id),
    ]);
    expect(candidateIds(riverBank, 'englishWordChoice', items)).toEqual(
      WORDS.map((item) => item.id),
    );
  });
  it('表示の重複は1件とみなし、意味と正規化した英単語をそれぞれまとめる', () => {
    const target = word('target');
    const items = [
      target,
      word('a', { word: "here's", meaning: '同じ意味' }),
      word('b', { word: 'ＨＥＲＥ’Ｓ!', meaning: '同じ意味', lesson: 5 }),
      word('c'),
      word('d'),
    ];
    for (const pattern of CHOICE_PATTERNS) {
      const candidates = distractorCandidates(target, pattern, items);
      expect(candidates).toHaveLength(3);
      expect(candidates[0].map((item) => item.id)).toEqual(['a', 'b']);
      const choices = generateChoices(target, pattern, items, mulberry32(0));
      expect(new Set(choices.map((item) => choiceDisplay(item, pattern))).size).toBe(4);
    }
  });
  it('適格条件は異なる表示3件以上で、パターン・配列ごとに異なる', () => {
    const target = word('target');
    const items = [
      target,
      word('a', { meaning: '同じ意味' }),
      word('b', { meaning: '同じ意味' }),
      word('c'),
    ];
    expect(isEligibleFor(target, 'englishMeaningChoice', items)).toBe(false);
    expect(isEligibleFor(target, 'englishWordChoice', items)).toBe(true);
    const expanded = [...items, word('d')];
    expect(isEligibleFor(target, 'englishMeaningChoice', expanded)).toBe(true);
    expect(isEligibleFor(target, 'englishMeaningChoice', items)).toBe(false);
    expect(eligibleQuestions([target, target], items, 'mixed')).toEqual([
      { word: target, patterns: ['englishWordChoice', 'englishSpelling'] },
    ]);
    expect(eligibleQuestions([target], items, 'englishMeaningChoice')).toEqual([]);
    expect(() => generateChoices(target, 'englishMeaningChoice', items, mulberry32(1))).toThrow(
      '2 件しかありません',
    );
  });
});

describe('品詞の優先と問題列', () => {
  it.each(CHOICE_PATTERNS)(
    '%s は同じ品詞だけで3件あればそこから取り、足りなければ他の品詞で補う',
    (pattern) => {
      const target = word('target');
      const preferred = [word('a'), word('b'), word('c'), word('d')];
      const others = [word('e', { pos: '動詞' }), word('f', { pos: '形容詞' })];
      const picked = new Set<string>();
      for (let seed = 0; seed < 30; seed++) {
        const choices = generateChoices(
          target,
          pattern,
          [target, ...preferred, ...others],
          mulberry32(seed),
        );
        expect(choices).toContain(target);
        expect(choices).toHaveLength(4);
        expect(choices.every((item) => item.pos === '名詞')).toBe(true);
        choices.filter((item) => item !== target).forEach((item) => picked.add(item.id));
        const supplemented = generateChoices(
          target,
          pattern,
          [target, ...preferred.slice(0, 2), ...others],
          mulberry32(seed),
        );
        expect(supplemented).toEqual(expect.arrayContaining(preferred.slice(0, 2)));
        expect(supplemented.filter((item) => item.pos !== '名詞')).toHaveLength(1);
      }
      expect(picked.size).toBe(4);
    },
  );
  it('空どうしは同じ品詞で、複合品詞は文字列として一致するときだけ優先する', () => {
    for (const pos of [null, '名詞・形容詞']) {
      const target = word('target', { pos });
      const preferred = ['a', 'b', 'c'].map((id) => word(id, { pos }));
      const items = [
        target,
        ...preferred,
        word('d', { pos: '動詞' }),
        word('e', { pos: '形容詞' }),
      ];
      for (const pattern of CHOICE_PATTERNS) {
        expect(new Set(generateChoices(target, pattern, items, mulberry32(1)))).toEqual(
          new Set([target, ...preferred]),
        );
      }
    }
  });
  it.each(CHOICE_PATTERNS)('%s のまとめた表示はどれか一行の品詞が同じなら優先する', (pattern) => {
    const target = word('target');
    const first = word('first', { word: 'same', meaning: '同じ', pos: '動詞' });
    const match = word('match', { word: 'ＳＡＭＥ!', meaning: '同じ', lesson: 5 });
    const b = word('b');
    const c = word('c');
    const items = [target, first, match, b, c, word('other', { pos: '動詞' })];
    for (let seed = 0; seed < 20; seed++) {
      const choices = generateChoices(target, pattern, items, mulberry32(seed));
      expect(choices).toEqual(expect.arrayContaining([target, match, b, c]));
      expect(choices).not.toContain(first);
    }
  });
  it('ミックスは1/3と2/3を境に等確率で選び、不適格な形式は出さない', () => {
    for (const [value, pattern] of [
      [0, 'englishMeaningChoice'],
      [1 / 3 - 0.0001, 'englishMeaningChoice'],
      [1 / 3, 'englishWordChoice'],
      [2 / 3 - 0.0001, 'englishWordChoice'],
      [2 / 3, 'englishSpelling'],
      [0.999, 'englishSpelling'],
    ] as const) {
      const session = generateSession({
        candidates: [WORDS[0]],
        allWords: WORDS,
        mode: 'mixed',
        count: 10,
        rng: () => value,
      });
      expect(session[0].pattern).toBe(pattern);
    }
    const target = word('target');
    const items = [
      target,
      word('a', { meaning: '同じ' }),
      word('b', { meaning: '同じ' }),
      word('c'),
    ];
    expect(
      generateSession({
        candidates: [target],
        allWords: items,
        mode: 'mixed',
        count: 10,
        rng: () => 0,
      })[0].pattern,
    ).toBe('englishWordChoice');
    for (const [value, pattern] of [
      [0.499, 'englishWordChoice'],
      [0.5, 'englishSpelling'],
      [0.999, 'englishSpelling'],
    ] as const) {
      expect(
        generateSession({
          candidates: [target],
          allWords: items,
          mode: 'mixed',
          count: 10,
          rng: () => value,
        })[0].pattern,
      ).toBe(pattern);
    }
    expect(
      generateSession({
        candidates: [target],
        allWords: [target],
        mode: 'mixed',
        count: 10,
        rng: () => 0,
      })[0].pattern,
    ).toBe('englishSpelling');
  });
  it('問題列は重複せず、問題数を守り、選択肢は固定シードで再現できる', () => {
    const items = Array.from({ length: 25 }, (_, i) => word(`en-${i}`));
    const before = structuredClone(items);
    for (const count of [10, 20, 'all'] as const) {
      const run = () =>
        generateSession({
          candidates: [...items, items[0]],
          allWords: items,
          mode: 'mixed',
          count,
          rng: mulberry32(2),
        });
      const session = run();
      expect(session).toHaveLength(count === 'all' ? 25 : count);
      expect(new Set(session.map((question) => question.item.id)).size).toBe(session.length);
      expect(run()).toEqual(session);
    }
    expect(items).toEqual(before);
    const positions = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      positions.add(
        buildQuestion(
          items[0],
          'englishMeaningChoice',
          items,
          2026,
          mulberry32(seed),
        ).choices.indexOf(items[0]),
      );
    }
    expect(positions.size).toBe(4);
  });
});

describe('レッスン・表示・設定', () => {
  const items = [
    word('en-0003', { book: 'STAGE3', lesson: 1 }),
    word('en-0002', { lesson: 5 }),
    word('en-0004', { lesson: 4 }),
    word('en-0001', { lesson: 4 }),
    word('en-0005', { book: 'STAGE1', lesson: 10 }),
    word('en-0006', { book: 'STAGE1', lesson: 2 }),
  ];
  const lessons = [
    'STAGE1 Lesson 2',
    'STAGE1 Lesson 10',
    'STAGE2 Lesson 4',
    'STAGE2 Lesson 5',
    'STAGE3 Lesson 1',
  ];
  it('データから本の順・番号の順で重複のないレッスンの一覧を作る', () => {
    expect(englishLessons(items)).toEqual(lessons);
  });
  it('範囲はレッスン名で絞り、誤答は別レッスンからも選ぶ', () => {
    const candidates = filterByRange(items, {
      kind: 'categories',
      categories: ['STAGE2 Lesson 4', 'STAGE3 Lesson 1'],
    });
    expect(candidates.map((item) => item.id)).toEqual(['en-0003', 'en-0004', 'en-0001']);
    expect(filterByRange(items, { kind: 'all' })).toEqual(items);
    expect(filterByRange(items, { kind: 'categories', categories: [] })).toEqual([]);
    const question = generateSession({
      candidates: [items[0]],
      allWords: items,
      mode: 'englishWordChoice',
      count: 'all',
      rng: mulberry32(1),
    })[0];
    expect(question.pattern).toBe('englishWordChoice');
    if (question.pattern !== 'englishWordChoice') throw new Error('英単語4択の問題が必要です');
    expect(question.choices.some((item) => item.book !== 'STAGE3')).toBe(true);
  });
  it('保存設定のレッスンを本の順・番号の順にし、無いものを除き、空なら全範囲にする', () => {
    const settings: EnglishSettings = {
      pattern: 'mixed',
      count: 10,
      range: {
        kind: 'categories',
        categories: [
          'STAGE3 Lesson 1',
          'STAGE2 Lesson 5',
          'STAGE2 Lesson 4',
          'STAGE2 Lesson 4',
          'STAGE1 Lesson 1',
        ],
      },
    };
    expect(normalizeEnglishSettings(settings, lessons)).toEqual({
      pattern: 'mixed',
      count: 10,
      range: {
        kind: 'categories',
        categories: ['STAGE2 Lesson 4', 'STAGE2 Lesson 5', 'STAGE3 Lesson 1'],
      },
    });
    expect(normalizeEnglishSettings(settings, []).range).toEqual({ kind: 'all' });
    expect(normalizeEnglishSettings({ ...settings, range: { kind: 'all' } }, lessons)).toEqual({
      pattern: 'mixed',
      count: 10,
      range: { kind: 'all' },
    });
  });
  it('範囲を本ごとにまとめ、全範囲と一覧の未選択を表示する', () => {
    const categories = ['STAGE3 Lesson 1', 'STAGE2 Lesson 5', 'STAGE2 Lesson 4', 'STAGE2 Lesson 5'];
    expect(formatEnglishRange({ kind: 'categories', categories })).toBe(
      'STAGE2 Lesson 4・5、STAGE3 Lesson 1',
    );
    expect(formatEnglishRange({ kind: 'all' })).toBe('全範囲');
    expect(formatEnglishRange(null)).toBe('');
    const rules = deckModel({ id: 'english-words', name: '英単語', kind: 'english', items }).rules;
    expect(browseRangeText('レッスン', rules.groups, categories, rules.browseRangeText)).toBe(
      'STAGE2 Lesson 4・5、STAGE3 Lesson 1',
    );
    expect(browseRangeText('レッスン', rules.groups, [], rules.browseRangeText)).toBe(
      'すべてのレッスン',
    );
  });
  it.each([
    ['名詞', '(名) 場所、地点'],
    ['名詞・形容詞', '(名・形) 場所、地点'],
    [
      '動詞・副詞・代名詞・前置詞・接続詞・助動詞・間投詞・冠詞・数詞',
      '(動・副・代・前・接・助動・間・冠・数) 場所、地点',
    ],
    [null, '場所、地点'],
  ])('品詞 %s の意味を表示する', (pos, expected) => {
    expect(meaningWithPos({ pos, meaning: '場所、地点' })).toBe(expected);
  });
  it('一覧は本・番号の見出しとidの順で、チップは本の見出しの下のLessonだけにする', () => {
    const model = deckModel({ id: 'english-words', kind: 'english', name: '英単語', items });
    const { rules } = model;
    const sections = browseGroups(model.population, rules, 'all', []);
    expect(sections.map((section) => section.name)).toEqual(lessons);
    expect(
      sections.find((section) => section.name === 'STAGE2 Lesson 4')!.items.map((item) => item.id),
    ).toEqual(['en-0001', 'en-0004']);
    expect(rules.groupHeading('STAGE2 Lesson 4')).toBe('STAGE2');
    expect(rules.groupChipLabel('STAGE2 Lesson 4')).toBe('Lesson 4');
    expect(rules.labels).toEqual({ item: '英単語', core: null, group: 'レッスン' });
    expect(rules.browse).toMatchObject({
      name: '英単語を覚える',
      layout: 'stacked',
      hideOptions: [
        { value: 'back', label: '意味' },
        { value: 'front', label: '英単語' },
      ],
    });
    expect(rules.browse.front(items[0])).toBe(items[0].word);
    expect(rules.browse.back(items[0])).toBe(`(名) ${items[0].meaning}`);
    expect(rules.browse.reading(items[0])).toBeNull();
    expect(rules.patterns.map(rules.patternLabel)).toEqual([
      '意味 4 択',
      '英単語 4 択',
      'つづり入力',
    ]);
    expect(rules.patternLabel('mixed')).toBe('ミックス');
    expect(rules.itemTitle(items[0])).toBe(items[0].word);
    expect(rules.itemDetail(items[0])).toBe(`(名) ${items[0].meaning} · STAGE3 Lesson 1`);
    expect(rules.itemReading(items[0])).toBeNull();
    expect(rules.resultLayout).toBe('stacked');
    expect(rules.answerText(items[0])).toBe(`(名) ${items[0].meaning}`);
    expect(DECK_DEFINITIONS[2]).toEqual({
      id: 'english-words',
      kind: 'english',
      name: '英単語',
      idPrefix: 'en-',
      dir: 'english-words',
      hasPool: false,
    });
  });
});

describe('英単語の CSV', () => {
  it('前後の空白だけ除き、原文・空の品詞・複合品詞・参照を取り込む', () => {
    const extra = word('en-9', {
      word: ' What ... for? ',
      meaning: ' 意味、～…（注記）。 ',
      pos: null,
      book: 'STAGE3',
      lesson: 1,
      similar: ['en-1'],
    });
    const result = build(
      '\ufeff' +
        csv([...WORDS, extra, word('en-10', { pos: '名詞・形容詞' })]).replace(/\n/g, '\r\n'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck).toMatchObject({ id: 'english-words', kind: 'english', name: '英単語' });
    expect(result.deck.items[8]).toEqual({
      ...extra,
      word: 'What ... for?',
      meaning: '意味、～…（注記）。',
    });
    expect(result.deck.items[9].pos).toBe('名詞・形容詞');
  });
  it.each(['id', 'word', 'meaning', 'book', 'lesson'] as const)('%s は必須', (column) => {
    const cells = ['en-9', 'extra', '意味', '', 'STAGE2', '4', ''];
    cells[ENGLISH_CSV_COLUMNS.indexOf(column)] = '';
    expect(errors(`${csv(WORDS)}\n${cells.join(',')}`)).toContain(
      `core.csv 10 行目 ${column}: 必須です`,
    );
  });
  it('idは一意で、wordは正規化した本・番号の組で一意。同じ意味と別レッスンの同じwordは許す', () => {
    expect(errors(csv([...WORDS, word(WORDS[0].id)])).join('\n')).toContain('core.csv 10 行目 id:');
    const extra = word('en-9', { word: WORDS[0].word.toUpperCase() + '！' });
    expect(errors(csv([...WORDS, extra])).join('\n')).toContain(
      'core.csv 10 行目 word: 英単語・本・レッスンの組は core.csv 2 行目と重複',
    );
    expect(build(csv([...WORDS, { ...extra, lesson: 5 }])).ok).toBe(true);
    expect(build(csv([...WORDS, { ...extra, book: 'STAGE1' }])).ok).toBe(true);
    expect(build(csv([...WORDS, word('en-9', { meaning: WORDS[0].meaning })])).ok).toBe(true);
  });
  it.each([
    ['別の接頭辞', { id: 'jh-9' }, 'id'],
    ['接頭辞だけ', { id: 'en-' }, 'id'],
    ['未知の本', { book: 'STAGE4' }, 'book'],
    ['未知の品詞', { pos: '不明' }, 'pos'],
    ['複合品詞の未知の部分', { pos: '名詞・不明' }, 'pos'],
    ['複合品詞の空の部分', { pos: '名詞・' }, 'pos'],
    ['51コードポイント', { meaning: '😀'.repeat(51) }, 'meaning'],
    ['自分への参照', { similar: ['en-9'] }, 'similar'],
    ['不存在の参照', { similar: ['missing'] }, 'similar'],
    ['空の参照', { similar: ['en-1', ''] }, 'similar'],
  ])('%sを拒む', (_, extra, column) => {
    expect(
      errors(csv([...WORDS, word('en-9', extra as Partial<EnglishWord>)])).join('\n'),
    ).toContain(`core.csv 10 行目 ${column}:`);
  });
  it.each(['0', '-1', '1.5', '1e2', 'abc', '9007199254740992'])(
    'レッスン番号%sを拒む',
    (lesson) => {
      expect(errors(`${csv(WORDS)}\nen-9,extra,意味,,STAGE2,${lesson},`).join('\n')).toContain(
        'core.csv 10 行目 lesson: 正の整数',
      );
    },
  );
  it('意味はUTF-16ではなく50コードポイントまで、カンマと引用符を保存する', () => {
    expect(build(csv([...WORDS, word('en-9', { meaning: '😀'.repeat(50) })])).ok).toBe(true);
    const item = word('en-9', { word: 'say "hello", please', meaning: '「こんにちは」と言う' });
    const result = build(csv([...WORDS, item]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deck.items[8]).toEqual(item);
  });
  it('ヘッダー固定・列数・引用符・セル内改行を検証し、全エラーを行順で返す', () => {
    expect(errors('id,word\n')[0]).toMatch(/^core.csv 1 行目: ヘッダー/);
    const found = errors(
      `${csv(WORDS)}\nen-9,少ない\nen-10,"閉じない\nen-11,word,意味,不明,STAGE4,0,\nen-12,word,"改\r行",,STAGE2,4,`,
    );
    expect(found).toHaveLength(6);
    expect(found[0]).toMatch(/^core.csv 10 行目: 列の数/);
    expect(found[1]).toMatch(/^core.csv 11 行目:/);
    expect(found.slice(2, 5).every((error) => error.startsWith('core.csv 12 行目 '))).toBe(true);
    expect(found[5]).toMatch(/^core.csv 13 行目: セル内の改行/);
  });
  it('similarは後の行を参照できる。全行で両パターンに異なる表示が3件以上必要', () => {
    expect(build(csv([word('en-9', { similar: ['en-1'] }), ...WORDS])).ok).toBe(true);
    const found = errors(csv(WORDS.slice(0, 3)));
    expect(found).toHaveLength(6);
    expect(found[0]).toContain('意味 4 択の誤答候補が 2 件');
    expect(found[1]).toContain('英単語 4 択の誤答候補が 2 件');
    expect(
      errors(
        csv(
          WORDS.slice(0, 4).map((item, i) => ({ ...item, meaning: i > 0 ? '同じ' : item.meaning })),
        ),
      ).some((error) => error.includes('意味 4 択')),
    ).toBe(true);
    expect(
      errors(
        csv(
          WORDS.slice(0, 4).map((item, i) => ({
            ...item,
            word: i > 0 ? 'same' : item.word,
            lesson: i + 1,
          })),
        ),
      ).some((error) => error.includes('英単語 4 択')),
    ).toBe(true);
  });
});

describe('共通の復習と成績への接続', () => {
  it('記録された3パターンを復習し、レッスン別・英単語別・履歴を集計する', () => {
    const model = deckModel({ id: 'english-words', name: '英単語', kind: 'english', items: WORDS });
    const stats: EventStats[] = ENGLISH_PATTERNS.map((pattern) => ({
      eventId: WORDS[0].id,
      pattern,
      attempts: 2,
      correct: 0,
      lastCorrect: false,
      lastWrongAt: '2026-10-15T01:00:00.000Z',
      lastAnsweredAt: '2026-10-15T01:00:00.000Z',
      consecutiveCorrect: 0,
    }));
    const now = new Date('2026-10-15T02:00:00.000Z');
    const candidates = reviewCandidates({
      population: model.population,
      allItems: WORDS,
      rules: model.rules,
      stats,
      now,
    });
    expect(candidates.map((candidate) => candidate.pattern)).toEqual(ENGLISH_PATTERNS);
    const questions = generateReviewSession({
      candidates,
      allItems: WORDS,
      count: 'all',
      currentYear: 2026,
      rng: mulberry32(1),
      rules: model.rules,
    });
    expect(questions).toHaveLength(3);
    expect(questions.map((question) => question.pattern).sort()).toEqual(
      [...ENGLISH_PATTERNS].sort(),
    );
    expect(questions.find((question) => question.pattern === 'englishSpelling')).toEqual({
      item: WORDS[0],
      pattern: 'englishSpelling',
      answers: [WORDS[0]],
    });
    expect(
      questions
        .filter((question) => question.pattern !== 'englishSpelling')
        .every((question) => 'choices' in question && question.choices.length === 4),
    ).toBe(true);
    const session: Session = {
      id: 's1',
      deckId: model.deck.id,
      mode: 'normal',
      pattern: 'englishMeaningChoice',
      range: { kind: 'categories', categories: ['STAGE2 Lesson 4'] },
      total: 10,
      answered: 4,
      correct: 0,
      startedAt: now.toISOString(),
      endedAt: null,
    };
    const summary = summarizeStats({
      deckId: model.deck.id,
      population: model.population,
      rules: model.rules,
      stats: [...stats, { ...stats[0], eventId: 'jh-other' }],
      sessions: [session, { ...session, id: 's2', deckId: 'japanese-history' }],
      studyDays: [],
      now,
    });
    expect(summary.overall).toMatchObject({ attempts: 6, correct: 0 });
    expect(summary.groups).toEqual([{ group: 'STAGE2 Lesson 4', attempts: 6, correct: 0 }]);
    expect(summary.items[0].patterns.map((record) => record.pattern)).toEqual(ENGLISH_PATTERNS);
    expect(summary.history.map((record) => record.id)).toEqual(['s1']);
    expect(describeSession(session, model.rules)).toBe('通常 · STAGE2 Lesson 4 · 意味 4 択');
  });
});
