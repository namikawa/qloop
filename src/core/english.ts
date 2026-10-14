import { parseCsv } from './csv';
import {
  ENGLISH_PATTERNS,
  type EnglishDeck,
  type EnglishPattern,
  type EnglishPatternMode,
  type EnglishQuestion,
  type EnglishRange,
  type EnglishSettings,
  type EnglishWord,
  type QuestionCount,
  type Range,
} from './models';
import { CHOICE_DISTRACTOR_COUNT } from './quiz';
import { randomInt, shuffle, type Rng } from './random';

export const ENGLISH_BOOKS: readonly string[] = ['STAGE1', 'STAGE2', 'STAGE3'];
export const ENGLISH_POS: Readonly<Record<string, string>> = {
  名詞: '名',
  動詞: '動',
  形容詞: '形',
  副詞: '副',
  代名詞: '代',
  前置詞: '前',
  接続詞: '接',
  助動詞: '助動',
  間投詞: '間',
  冠詞: '冠',
  数詞: '数',
};
export const ENGLISH_CSV_COLUMNS = [
  'id',
  'word',
  'meaning',
  'pos',
  'book',
  'lesson',
  'similar',
] as const;
type Column = (typeof ENGLISH_CSV_COLUMNS)[number];

/** 表示は原文を保ち、同一性とつづり入力の比較だけを正規化する。 */
export function normalizeEnglishWord(text: string): string {
  return text
    .replace(/[！-～]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/’/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.?!]+$/, '')
    .trim();
}

export function lessonName(word: Pick<EnglishWord, 'book' | 'lesson'>): string {
  return `${word.book} Lesson ${word.lesson}`;
}

function lessonParts(name: string): { book: string; lesson: number } {
  const [book, , number] = name.split(' ');
  return { book, lesson: Number(number) };
}

function orderedLessons(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => {
    const left = lessonParts(a);
    const right = lessonParts(b);
    return (
      ENGLISH_BOOKS.indexOf(left.book) - ENGLISH_BOOKS.indexOf(right.book) ||
      left.lesson - right.lesson
    );
  });
}

export function englishLessons(words: readonly EnglishWord[]): string[] {
  return orderedLessons(words.map(lessonName));
}

export function lessonHeading(name: string): string {
  return lessonParts(name).book;
}

export function lessonChipLabel(name: string): string {
  return `Lesson ${lessonParts(name).lesson}`;
}

export function formatEnglishRange(range: Range | null): string {
  if (range === null) return '';
  if (range.kind !== 'categories') return '全範囲';
  const lessons = orderedLessons(range.categories);
  return ENGLISH_BOOKS.flatMap((book) => {
    const numbers = lessons
      .filter((name) => lessonHeading(name) === book)
      .map((name) => lessonParts(name).lesson);
    return numbers.length ? [`${book} Lesson ${numbers.join('・')}`] : [];
  }).join('、');
}

export function meaningWithPos(word: Pick<EnglishWord, 'pos' | 'meaning'>): string {
  return word.pos === null
    ? word.meaning
    : `(${word.pos
        .split('・')
        .map((part) => ENGLISH_POS[part])
        .join('・')}) ${word.meaning}`;
}

interface AnswerIndex {
  byId: Map<string, EnglishWord>;
  byMeaning: Map<string, EnglishWord[]>;
  links: Map<string, Set<string>>;
  groups: Map<string, readonly EnglishWord[]>;
}
const answerCache = new WeakMap<readonly EnglishWord[], AnswerIndex>();

/** 同じ意味と両方向の similar をたどった集まりを、配列・行ごとに覚える。 */
export function sameAnswerGroup(
  word: EnglishWord,
  allWords: readonly EnglishWord[],
): readonly EnglishWord[] {
  let index = answerCache.get(allWords);
  if (!index) {
    index = { byId: new Map(), byMeaning: new Map(), links: new Map(), groups: new Map() };
    for (const item of allWords) {
      index.byId.set(item.id, item);
      const meanings = index.byMeaning.get(item.meaning) ?? [];
      meanings.push(item);
      index.byMeaning.set(item.meaning, meanings);
      for (const id of item.similar) {
        const forward = index.links.get(item.id) ?? new Set();
        forward.add(id);
        index.links.set(item.id, forward);
        const backward = index.links.get(id) ?? new Set();
        backward.add(item.id);
        index.links.set(id, backward);
      }
    }
    answerCache.set(allWords, index);
  }
  const cached = index.groups.get(word.id);
  if (cached) return cached;
  const reached = new Map<string, EnglishWord>();
  const pending = [word];
  while (pending.length) {
    const current = pending.pop()!;
    if (reached.has(current.id)) continue;
    reached.set(current.id, current);
    pending.push(...(index.byMeaning.get(current.meaning) ?? []));
    for (const id of index.links.get(current.id) ?? []) {
      const linked = index.byId.get(id);
      if (linked) pending.push(linked);
    }
  }
  const group = allWords.filter((item) => reached.has(item.id));
  for (const item of group) index.groups.set(item.id, group);
  return group;
}

export function choiceDisplay(word: EnglishWord, pattern: EnglishPattern): string {
  return pattern === 'englishMeaningChoice' ? word.meaning : normalizeEnglishWord(word.word);
}

const candidateCache = new WeakMap<readonly EnglishWord[], Map<string, EnglishWord[][]>>();

/** 表示が同じ候補は一組にし、品詞の優先には組の全行を使う。 */
export function distractorCandidates(
  word: EnglishWord,
  pattern: EnglishPattern,
  allWords: readonly EnglishWord[],
): EnglishWord[][] {
  let cache = candidateCache.get(allWords);
  if (!cache) {
    cache = new Map();
    candidateCache.set(allWords, cache);
  }
  const key = `${pattern}:${word.id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const excluded = new Set<string>();
  if (pattern === 'englishMeaningChoice') {
    const normalized = normalizeEnglishWord(word.word);
    for (const item of allWords) {
      if (normalizeEnglishWord(item.word) === normalized) {
        for (const answer of sameAnswerGroup(item, allWords)) excluded.add(answer.meaning);
      }
    }
  } else {
    for (const answer of sameAnswerGroup(word, allWords))
      excluded.add(normalizeEnglishWord(answer.word));
  }
  const grouped = new Map<string, EnglishWord[]>();
  for (const candidate of allWords) {
    const display = choiceDisplay(candidate, pattern);
    if (candidate.id === word.id || excluded.has(display)) continue;
    const group = grouped.get(display) ?? [];
    group.push(candidate);
    grouped.set(display, group);
  }
  const candidates = [...grouped.values()];
  cache.set(key, candidates);
  return candidates;
}

const eligibilityCache = new WeakMap<readonly EnglishWord[], Map<string, boolean>>();
export function isEligibleFor(
  word: EnglishWord,
  pattern: EnglishPattern,
  allWords: readonly EnglishWord[],
): boolean {
  let cache = eligibilityCache.get(allWords);
  if (!cache) {
    cache = new Map();
    eligibilityCache.set(allWords, cache);
  }
  const key = `${pattern}:${word.id}`;
  let eligible = cache.get(key);
  if (eligible === undefined) {
    eligible = distractorCandidates(word, pattern, allWords).length >= CHOICE_DISTRACTOR_COUNT;
    cache.set(key, eligible);
  }
  return eligible;
}

export function generateChoices(
  word: EnglishWord,
  pattern: EnglishPattern,
  allWords: readonly EnglishWord[],
  rng: Rng,
): EnglishWord[] {
  const candidates = distractorCandidates(word, pattern, allWords);
  if (candidates.length < CHOICE_DISTRACTOR_COUNT) {
    throw new Error(`「${word.word}」の誤答候補が ${candidates.length} 件しかありません`);
  }
  const preferred = candidates.filter((group) => group.some((item) => item.pos === word.pos));
  const picked = shuffle(preferred, rng).slice(0, CHOICE_DISTRACTOR_COUNT);
  const remaining = candidates.filter((group) => !picked.includes(group));
  picked.push(...shuffle(remaining, rng).slice(0, CHOICE_DISTRACTOR_COUNT - picked.length));
  const distractors = picked.map(
    (group) => group.find((item) => item.pos === word.pos) ?? group[0],
  );
  return shuffle([word, ...distractors], rng);
}

export function buildQuestion(
  word: EnglishWord,
  pattern: EnglishPattern,
  allWords: readonly EnglishWord[],
  _currentYear: number,
  rng: Rng,
): EnglishQuestion {
  return { item: word, pattern, choices: generateChoices(word, pattern, allWords, rng) };
}

export function eligibleQuestions(
  candidates: readonly EnglishWord[],
  allWords: readonly EnglishWord[],
  mode: EnglishPatternMode,
): { word: EnglishWord; patterns: readonly EnglishPattern[] }[] {
  const seen = new Set<string>();
  return candidates.flatMap((word) => {
    if (seen.has(word.id)) return [];
    seen.add(word.id);
    const patterns = (mode === 'mixed' ? ENGLISH_PATTERNS : [mode]).filter((pattern) =>
      isEligibleFor(word, pattern, allWords),
    );
    return patterns.length ? [{ word, patterns }] : [];
  });
}

export function generateSession(input: {
  candidates: readonly EnglishWord[];
  allWords: readonly EnglishWord[];
  mode: EnglishPatternMode;
  count: QuestionCount;
  rng: Rng;
}): EnglishQuestion[] {
  const { candidates, allWords, mode, count, rng } = input;
  const eligible = shuffle(eligibleQuestions(candidates, allWords, mode), rng);
  return eligible
    .slice(0, count === 'all' ? eligible.length : count)
    .map(({ word, patterns }) =>
      buildQuestion(word, patterns[randomInt(patterns.length, rng)], allWords, 0, rng),
    );
}

export function filterByRange(words: readonly EnglishWord[], range: EnglishRange): EnglishWord[] {
  return range.kind === 'all'
    ? [...words]
    : words.filter((word) => range.categories.includes(lessonName(word)));
}

export function normalizeEnglishSettings(
  settings: EnglishSettings,
  lessons: readonly string[],
): EnglishSettings {
  const { pattern, count, range } = settings;
  if (range.kind === 'all') return { pattern, count, range };
  const known = orderedLessons(lessons.filter((name) => range.categories.includes(name)));
  return {
    pattern,
    count,
    range: known.length ? { kind: 'categories', categories: known } : { kind: 'all' },
  };
}

/** CSV の全エラーをファイル・行・列付きで返す。意味や表記は利用者の一覧を正とする。 */
export function buildEnglishDeck(input: {
  id: string;
  name: string;
  idPrefix: string;
  core: string;
}): { ok: true; deck: EnglishDeck } | { ok: false; errors: string[] } {
  const errors: { line: number; column: Column | null; message: string }[] = [];
  const items: EnglishWord[] = [];
  const locations = new Map<EnglishWord, number>();
  const seenIds = new Map<string, number>();
  const seenWords = new Map<string, number>();
  const references: { line: number; id: string; similar: string[] }[] = [];
  const parsed = parseCsv(input.core, ENGLISH_CSV_COLUMNS);
  errors.push(...parsed.errors.map(({ line, message }) => ({ line, column: null, message })));
  for (const row of parsed.rows) {
    const cells = row.cells.map((cell) => cell.trim());
    const cell = (column: Column) => cells[ENGLISH_CSV_COLUMNS.indexOf(column)];
    let valid = true;
    const fail = (column: Column, message: string) => {
      errors.push({ line: row.line, column, message });
      valid = false;
    };
    for (const column of ['id', 'word', 'meaning', 'book', 'lesson'] as const) {
      if (cell(column) === '') fail(column, '必須です');
    }
    const id = cell('id');
    if (id !== '') {
      if (!id.startsWith(input.idPrefix) || id.length <= input.idPrefix.length)
        fail('id', `「${id}」は ${input.idPrefix} で始めてください`);
      const first = seenIds.get(id);
      if (first !== undefined) fail('id', `「${id}」は core.csv ${first} 行目と重複しています`);
      else seenIds.set(id, row.line);
    }
    const book = cell('book');
    if (book !== '' && !ENGLISH_BOOKS.includes(book))
      fail('book', `「${book}」は本の一覧にありません`);
    const lesson = Number(cell('lesson'));
    if (
      cell('lesson') !== '' &&
      (!/^\d+$/.test(cell('lesson')) || !Number.isSafeInteger(lesson) || lesson <= 0)
    )
      fail('lesson', '正の整数で書いてください');
    if (cell('word') !== '' && book !== '' && lesson > 0) {
      const key = JSON.stringify([normalizeEnglishWord(cell('word')), book, lesson]);
      const first = seenWords.get(key);
      if (first !== undefined)
        fail('word', `英単語・本・レッスンの組は core.csv ${first} 行目と重複しています`);
      else seenWords.set(key, row.line);
    }
    if ([...cell('meaning')].length > 50)
      fail('meaning', '50 字（コードポイント）以内で書いてください');
    const pos = cell('pos') || null;
    if (pos !== null && pos.split('・').some((part) => !Object.hasOwn(ENGLISH_POS, part)))
      fail('pos', `「${pos}」は品詞の一覧の値を「・」でつないでください`);
    const similar =
      cell('similar') === ''
        ? []
        : cell('similar')
            .split(';')
            .map((id) => id.trim());
    references.push({ line: row.line, id, similar });
    if (valid) {
      const word: EnglishWord = {
        id,
        word: cell('word'),
        meaning: cell('meaning'),
        pos,
        book,
        lesson,
        similar,
        level: '中学',
        role: 'core',
      };
      items.push(word);
      locations.set(word, row.line);
    }
  }
  for (const reference of references) {
    for (const id of reference.similar) {
      if (id === reference.id)
        errors.push({
          line: reference.line,
          column: 'similar',
          message: '自分自身の id は指定できません',
        });
      else if (!seenIds.has(id))
        errors.push({
          line: reference.line,
          column: 'similar',
          message: `「${id}」はファイルに存在しません`,
        });
    }
  }
  for (const word of items) {
    for (const pattern of ENGLISH_PATTERNS) {
      const count = distractorCandidates(word, pattern, items).length;
      if (count < CHOICE_DISTRACTOR_COUNT)
        errors.push({
          line: locations.get(word)!,
          column: 'word',
          message: `${pattern === 'englishMeaningChoice' ? '意味' : '英単語'} 4 択の誤答候補が ${count} 件しかありません（異なる表示が ${CHOICE_DISTRACTOR_COUNT} 件以上必要です）`,
        });
    }
  }
  if (errors.length) {
    errors.sort((a, b) => a.line - b.line);
    return {
      ok: false,
      errors: errors.map(
        ({ line, column, message }) =>
          `core.csv ${line} 行目${column === null ? '' : ` ${column}`}: ${message}`,
      ),
    };
  }
  return { ok: true, deck: { id: input.id, kind: 'english', name: input.name, items } };
}
