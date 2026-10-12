import { parseCsv } from './csv';
import {
  VOCABULARY_PATTERNS,
  type QuestionCount,
  type Role,
  type VocabularyDeck,
  type VocabularyPattern,
  type VocabularyPatternMode,
  type VocabularyQuestion,
  type VocabularyRange,
  type VocabularySettings,
  type Word,
} from './models';
import { CHOICE_DISTRACTOR_COUNT } from './quiz';
import { randomInt, shuffle, type Rng } from './random';

/** 種類の一覧と並び（設計書 5.7 節）。範囲のチップと成績で共通に使う。 */
export const VOCABULARY_CATEGORIES: readonly string[] = ['慣用句'];
/** 語彙の CSV の列（設計書 5.7 節）。順序も固定。 */
export const VOCABULARY_CSV_COLUMNS = [
  'id',
  'word',
  'meaning',
  'category',
  'reading',
  'level',
  'similar',
] as const;
type Column = (typeof VOCABULARY_CSV_COLUMNS)[number];

interface Location {
  fileIndex: number;
  line: number;
  label: string;
}
interface DataError {
  at: Location;
  column: Column | null;
  message: string;
}

/**
 * 語彙の教材を作り、列・一意性・参照・基本データの適格条件を検証する（設計書 5.7 節）。
 * 全エラーを「ファイル名 行番号 列名: 内容」の形で、ファイル順・行順に返す。
 */
export function buildVocabularyDeck(input: {
  id: string;
  name: string;
  idPrefix: string;
  core: string;
  pool: string;
  categories: readonly string[];
}): { ok: true; deck: VocabularyDeck } | { ok: false; errors: string[] } {
  const errors: DataError[] = [];
  const items: Word[] = [];
  const locations = new Map<Word, Location>();
  const references: { at: Location; id: string; similar: string[] }[] = [];
  const seen = {
    id: new Map<string, Location>(),
    word: new Map<string, Location>(),
    meaning: new Map<string, Location>(),
  };
  const sources: { file: string; role: Role; text: string }[] = [
    { file: 'core.csv', role: 'core', text: input.core },
    { file: 'pool.csv', role: 'pool', text: input.pool },
  ];
  sources.forEach((source, fileIndex) => {
    const locate = (line: number): Location => ({
      fileIndex,
      line,
      label: `${source.file} ${line} 行目`,
    });
    const parsed = parseCsv(source.text, VOCABULARY_CSV_COLUMNS);
    errors.push(
      ...parsed.errors.map(({ line, message }) => ({ at: locate(line), column: null, message })),
    );
    for (const row of parsed.rows) {
      const at = locate(row.line);
      const cells = row.cells.map((cell) => cell.trim());
      const cell = (column: Column) => cells[VOCABULARY_CSV_COLUMNS.indexOf(column)];
      let valid = true;
      const fail = (column: Column, message: string) => {
        errors.push({ at, column, message });
        valid = false;
      };
      for (const column of ['id', 'word', 'meaning', 'category'] as const) {
        if (cell(column) === '') {
          fail(column, '必須です');
        }
      }
      const id = cell('id');
      if (id !== '' && (!id.startsWith(input.idPrefix) || id.length <= input.idPrefix.length)) {
        fail('id', `「${id}」は ${input.idPrefix} で始めてください`);
      }
      for (const column of ['id', 'word', 'meaning'] as const) {
        const value = cell(column);
        if (value === '') {
          continue;
        }
        const first = seen[column].get(value);
        if (first) {
          fail(column, `「${value}」は ${first.label}と重複しています`);
        } else {
          seen[column].set(value, at);
        }
      }
      const category = cell('category');
      if (category !== '' && !input.categories.includes(category)) {
        fail('category', `「${category}」は種類の一覧にありません`);
      }
      const level = cell('level') || '中学';
      if (level !== '中学' && level !== '高校') {
        fail('level', `「${level}」は 中学・高校・空のいずれかで書いてください`);
      }
      if ([...cell('meaning')].length > 30) {
        fail('meaning', '30 字（コードポイント）以内で書いてください');
      }
      const similar =
        cell('similar') === ''
          ? []
          : cell('similar')
              .split(';')
              .map((value) => value.trim());
      references.push({ at, id, similar });
      if (valid && (level === '中学' || level === '高校')) {
        const word: Word = {
          id,
          word: cell('word'),
          meaning: cell('meaning'),
          category,
          reading: cell('reading') || null,
          level,
          role: source.role,
          similar,
        };
        items.push(word);
        locations.set(word, at);
      }
    }
  });
  for (const reference of references) {
    const { at } = reference;
    for (const id of reference.similar) {
      if (id === reference.id) {
        errors.push({ at, column: 'similar', message: '自分自身の id は指定できません' });
      } else if (!seen.id.has(id)) {
        errors.push({ at, column: 'similar', message: `「${id}」はどのファイルにも存在しません` });
      }
    }
  }
  for (const [word, at] of locations) {
    if (word.role === 'core') {
      const count = distractorCandidates(word, items).length;
      if (count < CHOICE_DISTRACTOR_COUNT) {
        errors.push({
          at,
          column: 'word',
          message: `4 択の誤答候補が ${count} 件しかありません（除外規則の適用後に ${CHOICE_DISTRACTOR_COUNT} 件以上必要です）`,
        });
      }
    }
  }
  if (errors.length) {
    errors.sort((a, b) => a.at.fileIndex - b.at.fileIndex || a.at.line - b.at.line);
    return {
      ok: false,
      errors: errors.map(
        ({ at, column, message }) =>
          `${at.label}${column === null ? '' : ` ${column}`}: ${message}`,
      ),
    };
  }
  return { ok: true, deck: { id: input.id, kind: 'vocabulary', name: input.name, items } };
}

/** 誤答の候補（設計書 6.8 節の除外規則）。同じ種類から選び、similar は両方向に効かせる。 */
export function distractorCandidates(word: Word, allWords: readonly Word[]): Word[] {
  return allWords.filter(
    (candidate) =>
      candidate.id !== word.id &&
      candidate.category === word.category &&
      !word.similar.includes(candidate.id) &&
      !candidate.similar.includes(word.id),
  );
}

const eligibilityCache = new WeakMap<readonly Word[], Map<string, boolean>>();
/** 両パターンの適格判定（設計書 6.8 節の 3）。誤答候補が 3 件以上あるかを配列ごとに覚えておく。 */
export function isEligibleFor(
  word: Word,
  _pattern: VocabularyPattern,
  allWords: readonly Word[],
): boolean {
  let cache = eligibilityCache.get(allWords);
  if (!cache) {
    cache = new Map();
    eligibilityCache.set(allWords, cache);
  }
  let eligible = cache.get(word.id);
  if (eligible === undefined) {
    eligible = distractorCandidates(word, allWords).length >= CHOICE_DISTRACTOR_COUNT;
    cache.set(word.id, eligible);
  }
  return eligible;
}

/** 選択肢を作る（設計書 6.8 節）。誤答を重複なく一様に 3 件選び、正解と合わせてシャッフルする。 */
export function generateChoices(word: Word, allWords: readonly Word[], rng: Rng): Word[] {
  const candidates = distractorCandidates(word, allWords);
  if (candidates.length < CHOICE_DISTRACTOR_COUNT) {
    throw new Error(`「${word.word}」の誤答候補が ${candidates.length} 件しかありません`);
  }
  return shuffle([word, ...shuffle(candidates, rng).slice(0, CHOICE_DISTRACTOR_COUNT)], rng);
}

/** 適格な言葉とパターンから 1 問を作り、選択肢を確定する（設計書 6.8 節・7 章。通常と復習で共通）。 */
export function buildQuestion(
  word: Word,
  pattern: VocabularyPattern,
  allWords: readonly Word[],
  _currentYear: number,
  rng: Rng,
): VocabularyQuestion {
  return { item: word, pattern, choices: generateChoices(word, allWords, rng) };
}

/** 適格な言葉と使えるパターンを選ぶ（設計書 6.8 節の 3）。重複 id と不適格な言葉は除く。 */
export function eligibleQuestions(
  candidates: readonly Word[],
  allWords: readonly Word[],
  mode: VocabularyPatternMode,
): { word: Word; patterns: readonly VocabularyPattern[] }[] {
  const seen = new Set<string>();
  return candidates
    .filter((word) => {
      if (seen.has(word.id)) {
        return false;
      }
      seen.add(word.id);
      return isEligibleFor(word, 'meaningChoice', allWords);
    })
    .map((word) => ({ word, patterns: mode === 'mixed' ? VOCABULARY_PATTERNS : [mode] }));
}

/**
 * 問題列と選択肢をセッション開始時に確定する（設計書 6.1 節の 4〜6・6.8 節）。
 * 同じ言葉は 1 回だけ出し、ミックスは 1 問ごとに 2 パターンから等確率で選ぶ。
 */
export function generateSession(input: {
  candidates: readonly Word[];
  allWords: readonly Word[];
  mode: VocabularyPatternMode;
  count: QuestionCount;
  rng: Rng;
}): VocabularyQuestion[] {
  const { candidates, allWords, mode, count, rng } = input;
  const eligible = shuffle(eligibleQuestions(candidates, allWords, mode), rng);
  return eligible
    .slice(0, count === 'all' ? eligible.length : count)
    .map(({ word, patterns }) =>
      buildQuestion(word, patterns[randomInt(patterns.length, rng)], allWords, 0, rng),
    );
}

/** 出題範囲で言葉を絞り込む（設計書 6.8 節の 2）。種類は選んだどれかに当たる言葉を含める。 */
export function filterByRange(words: readonly Word[], range: VocabularyRange): Word[] {
  return range.kind === 'all'
    ? [...words]
    : words.filter((word) => range.categories.includes(word.category));
}

/** 保存した種類を現在の一覧の順に並べ、未知の種類を除く（設計書 6.8 節）。残りが空なら全範囲に戻す。 */
export function normalizeVocabularySettings(
  settings: VocabularySettings,
  categories: readonly string[] = VOCABULARY_CATEGORIES,
): VocabularySettings {
  if (settings.range.kind === 'all') {
    return settings;
  }
  const selected = settings.range.categories;
  const known = categories.filter((category) => selected.includes(category));
  return {
    ...settings,
    range: known.length ? { kind: 'categories', categories: known } : { kind: 'all' },
  };
}
