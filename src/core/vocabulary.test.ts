import { describe, expect, it } from 'vitest';
import { VOCABULARY_RULES, deckModel, DECK_DEFINITIONS } from './decks';
import type { EventStats, Session, VocabularyPattern, Word } from './models';
import { filterByScope, population } from './quiz';
import { mulberry32 } from './random';
import { generateReviewSession, reviewCandidates } from './review';
import { describeSession, summarizeStats } from './stats';
import {
  buildQuestion,
  buildVocabularyDeck,
  distractorCandidates,
  eligibleQuestions,
  filterByRange,
  generateChoices,
  generateSession,
  isEligibleFor,
  normalizeVocabularySettings,
  VOCABULARY_CSV_COLUMNS,
} from './vocabulary';

const HEADER = VOCABULARY_CSV_COLUMNS.join(',');
function word(id: string, extra: Partial<Word> = {}): Word {
  return {
    id,
    word: `言葉${id}`,
    meaning: `意味${id}のこと`,
    category: '慣用句',
    reading: null,
    level: '中学',
    role: 'core',
    similar: [],
    ...extra,
  };
}
const WORDS = Array.from({ length: 8 }, (_, index) => word(`jv-${index + 1}`));
function row(item: Word): string {
  return [
    item.id,
    item.word,
    item.meaning,
    item.category,
    item.reading ?? '',
    item.level,
    item.similar.join(';'),
  ].join(',');
}
function csv(items: Word[]): string {
  return [HEADER, ...items.map(row)].join('\n');
}
function build(core = csv(WORDS), pool = HEADER) {
  return buildVocabularyDeck({
    id: 'japanese-vocabulary',
    name: '語彙',
    idPrefix: 'jv-',
    categories: ['慣用句'],
    core,
    pool,
  });
}
function errors(core: string, pool: string): string[] {
  const result = build(core, pool);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}
function stats(item: Word, pattern: VocabularyPattern): EventStats {
  return {
    eventId: item.id,
    pattern,
    attempts: 2,
    correct: 0,
    lastCorrect: false,
    lastAnsweredAt: '2026-10-12T01:00:00.000Z',
    lastWrongAt: '2026-10-12T01:00:00.000Z',
  };
}

describe('語彙の CSV', () => {
  it('型・role・空の level と reading・similar を変換する', () => {
    const core = [HEADER, ...WORDS.slice(0, 4).map(row)].join('\n');
    const pool = `${HEADER}\njv-9, 言葉九 ,意味九のこと,慣用句,ことばきゅう,,jv-1;jv-2\njv-10,言葉十,意味十のこと,慣用句,,高校,`;
    const result = build(core, pool);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck).toMatchObject({
      id: 'japanese-vocabulary',
      name: '語彙',
      kind: 'vocabulary',
    });
    expect(result.deck.items[4]).toEqual(
      word('jv-9', {
        word: '言葉九',
        meaning: '意味九のこと',
        reading: 'ことばきゅう',
        role: 'pool',
        similar: ['jv-1', 'jv-2'],
      }),
    );
    expect(result.deck.items[5]).toMatchObject({ level: '高校', reading: null, role: 'pool' });
  });
  it.each(['id', 'word', 'meaning', 'category'] as const)('%s は空にできない', (column) => {
    const cells = row(word('jv-9')).split(',');
    cells[VOCABULARY_CSV_COLUMNS.indexOf(column)] = '';
    expect(errors(csv(WORDS), `${HEADER}\n${cells.join(',')}`)).toContain(
      `pool.csv 2 行目 ${column}: 必須です`,
    );
  });
  it.each(['id', 'word', 'meaning'] as const)('%s はファイルをまたいでも一意', (column) => {
    const duplicate = word('jv-9', { [column]: WORDS[0][column] });
    expect(errors(csv(WORDS), csv([duplicate])).join('\n')).toContain(
      `pool.csv 2 行目 ${column}: 「${duplicate[column]}」は core.csv 2 行目と重複しています`,
    );
  });
  it.each([
    ['接頭辞', { id: 'jh-1' }, 'id'],
    ['接頭辞のみ', { id: 'jv-' }, 'id'],
    ['知らない種類', { category: 'ことわざ' }, 'category'],
    ['知らない学習段階', { level: '大学' }, 'level'],
    ['31 コードポイントの意味', { meaning: '😀'.repeat(31) }, 'meaning'],
    ['自分自身の similar', { similar: ['jv-9'] }, 'similar'],
    ['存在しない similar', { similar: ['jv-missing'] }, 'similar'],
    ['空の similar の参照先', { similar: ['jv-1', ''] }, 'similar'],
  ])('%s を拒む', (_, extra, column) => {
    const invalid = word('jv-9', extra as Partial<Word>);
    expect(errors(csv(WORDS), csv([invalid])).join('\n')).toContain(`pool.csv 2 行目 ${column}:`);
  });
  it('意味は UTF-16 の単位数でなくコードポイント 30 個まで', () => {
    expect(build(csv(WORDS), csv([word('jv-9', { meaning: '😀'.repeat(30) })])).ok).toBe(true);
  });
  it('similar は後のファイル・後の行を参照でき、片方だけに書けばよい', () => {
    const core = [...WORDS.slice(0, 4)];
    core[0] = word(core[0].id, { similar: ['jv-9'] });
    expect(build(csv(core), csv([word('jv-9', { similar: ['jv-10'] }), word('jv-10')])).ok).toBe(
      true,
    );
  });
  it('ヘッダーと列数を検証し、エラーはファイル・行の順ですべて返す', () => {
    expect(errors('id,word\n', HEADER)[0]).toMatch(/^core.csv 1 行目: ヘッダー/);
    const found = errors(
      `${csv(WORDS)}\njv-9,少ない\njh-10,言葉十,意味十,不明,,大学,`,
      `${HEADER}\njv-11,少ない`,
    );
    expect(found).toHaveLength(5);
    expect(found[0]).toMatch(/^core.csv 10 行目: 列の数/);
    expect(found.slice(1, 4).every((error) => error.startsWith('core.csv 11 行目 '))).toBe(true);
    expect(found[4]).toMatch(/^pool.csv 2 行目:/);
  });
  it('除外後に誤答が 3 件に満たない基本データは拒み、追加データだけなら受け付ける', () => {
    expect(errors(csv(WORDS.slice(0, 3)), HEADER)).toHaveLength(3);
    expect(
      build(csv(WORDS), csv([word('jv-9', { similar: WORDS.map((item) => item.id) })])).ok,
    ).toBe(true);
  });
  it('同じ行の列のエラーと similar の各参照のエラーもすべて返す', () => {
    const found = errors(
      csv(WORDS),
      csv([word('jv-9', { word: '', meaning: '', similar: ['jv-9', 'missing'] })]),
    );
    expect(found).toHaveLength(4);
    expect(found).toEqual(
      expect.arrayContaining([
        'pool.csv 2 行目 word: 必須です',
        'pool.csv 2 行目 meaning: 必須です',
        'pool.csv 2 行目 similar: 自分自身の id は指定できません',
        'pool.csv 2 行目 similar: 「missing」はどのファイルにも存在しません',
      ]),
    );
  });
  it('高校の追加データも基本データの誤答候補に使える', () => {
    expect(
      build(
        csv([WORDS[0]]),
        csv(WORDS.slice(1, 4).map((item) => ({ ...item, role: 'pool', level: '高校' }))),
      ).ok,
    ).toBe(true);
  });
});

describe('語彙の出題', () => {
  const target = word('a', { similar: ['forward'] });
  const all = [
    target,
    word('forward'),
    word('reverse', { similar: ['a'] }),
    word('other', { category: 'ことわざ' }),
    word('1'),
    word('2', { role: 'pool' }),
    word('3', { level: '高校', role: 'pool' }),
  ];
  it('自分・種類違い・similar の両方向を除外し、高校も誤答に使う', () => {
    expect(distractorCandidates(target, all).map((item) => item.id)).toEqual(['1', '2', '3']);
    for (const pattern of VOCABULARY_RULES.patterns) {
      expect(isEligibleFor(target, pattern, all)).toBe(true);
      expect(isEligibleFor(target, pattern, all.slice(0, -1))).toBe(false);
    }
  });
  it('選択肢は正解を含む重複のない 4 件で、同じシードなら一致する', () => {
    const before = structuredClone(WORDS);
    for (let seed = 0; seed < 30; seed++) {
      const choices = generateChoices(WORDS[0], WORDS, mulberry32(seed));
      expect(choices).toHaveLength(4);
      expect(new Set(choices.map((item) => item.id)).size).toBe(4);
      expect(choices).toContain(WORDS[0]);
      expect(generateChoices(WORDS[0], WORDS, mulberry32(seed))).toEqual(choices);
    }
    expect(WORDS).toEqual(before);
  });
  it('正解の位置は 4 か所のどこにも来て、誤答は候補の全件から選ばれる', () => {
    const target = WORDS[0];
    const candidateIds = distractorCandidates(target, WORDS).map((item) => item.id);
    const positions = [0, 0, 0, 0];
    const picked = new Set<string>();
    const runs = 400;
    for (let seed = 0; seed < runs; seed++) {
      const choices = generateChoices(target, WORDS, mulberry32(seed));
      positions[choices.indexOf(target)]++;
      for (const choice of choices) {
        if (choice.id !== target.id) {
          picked.add(choice.id);
        }
      }
    }
    // 期待値は各位置 100 回（400 回 ÷ 4）。正解を決まった位置に置く作りなら、0 回の位置が出る
    for (const count of positions) {
      expect(count).toBeGreaterThan(runs / 4 / 2);
    }
    // 候補の先頭 3 件だけを誤答にする作りなら、残りの候補が一度も選ばれない
    expect([...picked].sort()).toEqual([...candidateIds].sort());
  });
  it('両パターンで除外後の候補から選び、不適格な言葉を作ろうとすると失敗する', () => {
    for (const pattern of VOCABULARY_RULES.patterns) {
      expect(buildQuestion(target, pattern, all, 2026, mulberry32(1))).toMatchObject({
        item: target,
        pattern,
      });
      expect(
        new Set(
          buildQuestion(target, pattern, all, 2026, mulberry32(1)).choices.map((item) => item.id),
        ),
      ).toEqual(new Set(['a', '1', '2', '3']));
    }
    expect(() => generateChoices(target, all.slice(0, -1), mulberry32(1))).toThrow(
      '2 件しかありません',
    );
  });
  it('ミックスは 0.5 を境に 2 つのパターンを等確率で選ぶ', () => {
    for (const [value, pattern] of [
      [0, 'meaningChoice'],
      [0.499, 'meaningChoice'],
      [0.5, 'wordChoice'],
      [0.999, 'wordChoice'],
    ] as const) {
      expect(
        generateSession({
          candidates: [target],
          allWords: all,
          mode: 'mixed',
          count: 10,
          rng: () => value,
        })[0].pattern,
      ).toBe(pattern);
    }
  });
  it('基本のみ・すべて・全範囲・種類の範囲は出題する言葉を絞り、誤答の候補は絞らない', () => {
    const targets = population(all);
    expect(targets.map((item) => item.id)).not.toContain('3');
    expect(filterByScope(targets, 'core').map((item) => item.id)).not.toContain('2');
    expect(filterByScope(targets, 'all')).toEqual(targets);
    expect(filterByRange(targets, { kind: 'all' })).toEqual(targets);
    expect(
      filterByRange(targets, { kind: 'categories', categories: ['ことわざ'] }).map(
        (item) => item.id,
      ),
    ).toEqual(['other']);
    expect(filterByRange(targets, { kind: 'categories', categories: [] })).toEqual([]);
    const questions = generateSession({
      candidates: [target],
      allWords: all,
      mode: 'wordChoice',
      count: 'all',
      rng: mulberry32(1),
    });
    expect(questions[0].choices.map((item) => item.id)).toContain('3');
  });
  it('不適格な pool 行は通常・ミックスから外れ、重複 id と問題数の上限も守る', () => {
    const invalid = word('invalid', { category: 'ことわざ', role: 'pool' });
    const items = [...WORDS, invalid];
    for (const mode of ['meaningChoice', 'wordChoice', 'mixed'] as const) {
      expect(eligibleQuestions([...items, WORDS[0]], items, mode)).toHaveLength(8);
      const questions = generateSession({
        candidates: items,
        allWords: items,
        mode,
        count: 10,
        rng: mulberry32(10),
      });
      expect(questions).toHaveLength(8);
      expect(questions.map((question) => question.item.id)).not.toContain('invalid');
      expect(new Set(questions.map((question) => question.item.id)).size).toBe(8);
      expect(
        generateSession({
          candidates: items,
          allWords: items,
          mode,
          count: 'all',
          rng: mulberry32(10),
        }),
      ).toEqual(questions);
    }
    const many = Array.from({ length: 25 }, (_, i) => word(`w-${i}`));
    for (const count of [10, 20, 'all'] as const)
      expect(
        generateSession({
          candidates: many,
          allWords: many,
          mode: 'mixed',
          count,
          rng: mulberry32(1),
        }),
      ).toHaveLength(count === 'all' ? 25 : count);
  });
});

describe('語彙の差分・復習・成績', () => {
  it('教材の定義とパターン・項目・範囲の表示', () => {
    expect(DECK_DEFINITIONS[1]).toEqual({
      id: 'japanese-vocabulary',
      kind: 'vocabulary',
      name: '語彙',
      idPrefix: 'jv-',
      dir: 'japanese-vocabulary',
    });
    const rules = VOCABULARY_RULES;
    expect(rules.patterns.map(rules.patternLabel)).toEqual(['意味 4 択', '言葉 4 択']);
    expect(rules.patternLabel('mixed')).toBe('ミックス');
    expect(rules.labels).toEqual({ item: '言葉', core: '基本の語彙', group: '種類' });
    expect(rules.itemTitle(WORDS[0])).toBe(WORDS[0].word);
    expect(rules.itemDetail(WORDS[0])).toBe('慣用句');
    expect(rules.answerText(WORDS[0])).toBe(WORDS[0].meaning);
    expect(rules.resultLayout).toBe('stacked');
    expect(rules.formatRange({ kind: 'all' })).toBe('全範囲');
    expect(
      describeSession(
        {
          mode: 'normal',
          range: { kind: 'categories', categories: ['慣用句', 'ことわざ'] },
          pattern: 'wordChoice',
        },
        rules,
      ),
    ).toBe('通常 · 慣用句・ことわざ · 言葉 4 択');
  });
  it('読みがある言葉は一覧の読みを返し、成績の補足の先頭に添える', () => {
    const item = word('jv-test', { word: '烏合の衆', reading: 'うごうのしゅう' });
    expect(VOCABULARY_RULES.itemReading(item)).toBe('うごうのしゅう');
    expect(VOCABULARY_RULES.itemDetail(item)).toBe('うごうのしゅう · 慣用句');
  });
  it('読みが無い言葉は一覧の読みを返さず、成績の補足にも空の区切りを残さない', () => {
    const item = word('jv-test', { word: 'いたちごっこ', reading: null });
    expect(VOCABULARY_RULES.itemReading(item)).toBeNull();
    expect(VOCABULARY_RULES.itemDetail(item)).toBe('慣用句');
  });
  it('母集団は中学の言葉で、復習は不適格な pool 行を除いて同じ規則で問題を作る', () => {
    const invalid = word('invalid', { role: 'pool', category: 'ことわざ' });
    const high = word('high', { level: '高校', role: 'pool' });
    const model = deckModel({
      id: 'japanese-vocabulary',
      kind: 'vocabulary',
      name: '語彙',
      items: [...WORDS, invalid, high],
    });
    expect(model.rules).toBe(VOCABULARY_RULES);
    expect(model.population).not.toContain(high);
    const candidates = reviewCandidates({
      population: model.population,
      allItems: model.deck.items,
      stats: [
        stats(WORDS[0], 'meaningChoice'),
        stats(WORDS[0], 'wordChoice'),
        stats(invalid, 'meaningChoice'),
        stats(invalid, 'wordChoice'),
        stats(high, 'wordChoice'),
      ],
      now: new Date('2026-10-12T02:00:00.000Z'),
      rules: model.rules,
    });
    expect(candidates.map((candidate) => candidate.pattern)).toEqual([
      'meaningChoice',
      'wordChoice',
    ]);
    const questions = generateReviewSession({
      candidates,
      allItems: model.deck.items,
      count: 'all',
      currentYear: 2026,
      rng: mulberry32(1),
      rules: model.rules,
    });
    expect(questions).toHaveLength(2);
    for (const question of questions) {
      expect(question.item.id).toBe(WORDS[0].id);
      expect('choices' in question && question.choices.length).toBe(4);
    }
  });
  it('種類別とパターン別の成績は語彙だけを数え、履歴も教材で分ける', () => {
    const summary = summarizeStats({
      deckId: 'japanese-vocabulary',
      population: WORDS,
      stats: [
        stats(WORDS[0], 'meaningChoice'),
        stats(WORDS[0], 'wordChoice'),
        stats(word('jh-other'), 'meaningChoice'),
      ],
      sessions: [
        {
          id: 'word-session',
          deckId: 'japanese-vocabulary',
          mode: 'normal',
          pattern: 'meaningChoice',
          range: { kind: 'all' },
          startedAt: '2026-10-12T01:00:00.000Z',
          endedAt: null,
          total: 10,
          answered: 4,
          correct: 0,
        },
        {
          id: 'history-session',
          deckId: 'japanese-history',
          mode: 'normal',
          pattern: 'choice',
          range: { kind: 'all' },
          startedAt: '2026-10-12T01:00:00.000Z',
          endedAt: null,
          total: 10,
          answered: 10,
          correct: 10,
        },
      ] satisfies Session[],
      studyDays: [],
      now: new Date('2026-10-12T02:00:00.000Z'),
      rules: VOCABULARY_RULES,
    });
    expect(summary.overall).toMatchObject({ attempts: 4, correct: 0 });
    expect(summary.history.map((session) => session.id)).toEqual(['word-session']);
    expect(summary.groups).toEqual([{ group: '慣用句', attempts: 4, correct: 0 }]);
    expect(summary.items[0].patterns.map((record) => record.pattern)).toEqual([
      'meaningChoice',
      'wordChoice',
    ]);
  });
  it('保存した種類を現在の一覧の順で並べ、未知の種類を除く', () => {
    const settings = {
      scope: 'core' as const,
      pattern: 'mixed' as const,
      count: 10 as const,
      range: { kind: 'categories' as const, categories: ['B', '不明', 'A', 'A'] },
    };
    expect(normalizeVocabularySettings(settings, ['A', 'B']).range).toEqual({
      kind: 'categories',
      categories: ['A', 'B'],
    });
    expect(normalizeVocabularySettings(settings).range).toEqual({ kind: 'all' });
  });
});
