import { buildDeck } from './deck';
import { ERAS } from './era';
import {
  TIMELINE_PATTERNS,
  VOCABULARY_PATTERNS,
  type Deck,
  type DeckKind,
  type Event,
  type Item,
  type Pattern,
  type PatternMode,
  type VocabularyDeck,
  type VocabularyPattern,
  type VocabularyPatternMode,
  type Word,
  type TimelineDeck,
  type TimelinePattern,
  type TimelinePatternMode,
} from './models';
import { buildQuestion, isEligibleFor, population } from './quiz';
import { formatRange } from './range';
import type { ReviewRules } from './review';
import type { SessionLabels, StatsRules } from './stats';
import {
  VOCABULARY_CATEGORIES,
  buildVocabularyDeck,
  buildQuestion as buildVocabularyQuestion,
  isEligibleFor as isVocabularyEligibleFor,
} from './vocabulary';
import { formatAnswerYears, formatEventYear } from './year';

/**
 * 教材の定義の一覧と、教材の種類ごとの振り分け（設計書 5 章の冒頭）。
 *
 * 教材の種類ごとに違うもの（設計書 5 章の冒頭の表）は、種類ごとに 1 つの `KindRules` にまとめる。年表は、CSV の
 * 変換と検証を `deck.ts`、適格判定と選択肢の作り方を `quiz.ts`、範囲を `range.ts` に置き、パターンの表示名と
 * 画面の言葉と合わせて、ここで `TIMELINE_RULES` にする。
 * 復習（`review.ts`）と成績（`stats.ts`）は `KindRules` を通してだけ項目の中身に触れ、教材の種類を知らない。
 * 記録・セッション・書き出し（`storage/`）は項目の中身を扱わない（項目の id とパターンで記録する）。
 * 種類を足すときは、`DeckKind`・`Deck`・`Pattern`・`Question`（`models.ts`）と、ここの振り分け
 * （`buildDeckFromCsv`・`deckModel`）に足す。
 */

/** 教材の定義（設計書 5 章の冒頭・5.5 節）。 */
export interface DeckDefinition {
  /** 教材の id。セッションの `deckId` と出題設定の鍵に使うので変えない。 */
  id: string;
  kind: DeckKind;
  /** 表示名。 */
  name: string;
  /** 項目の id の接頭辞。項目の id は全教材を通して一意になる。 */
  idPrefix: string;
  /** データのディレクトリ名（`data/decks/<dir>/` に `core.csv` と `pool.csv` を置く）。 */
  dir: string;
}

/** 教材の定義の一覧。並びはホームの切り替えの順で、先頭の教材を既定にする（設計書 6.9 節）。 */
export const DECK_DEFINITIONS: readonly DeckDefinition[] = [
  {
    id: 'japanese-history',
    kind: 'timeline',
    name: '日本史年表',
    idPrefix: 'jh-',
    dir: 'japanese-history',
  },
  {
    id: 'japanese-vocabulary',
    kind: 'vocabulary',
    name: '語彙',
    idPrefix: 'jv-',
    dir: 'japanese-vocabulary',
  },
];

export type BuildDeckFromCsvResult = { ok: true; deck: Deck } | { ok: false; errors: string[] };

/**
 * 教材の CSV（`core.csv` と `pool.csv`）から教材を作って検証する（教材の種類で振り分ける）。
 * エラーは「ファイル名 行番号 列名: 内容」の形で全件を返す（教材名は呼び出し側で付ける）。
 */
export function buildDeckFromCsv(
  definition: DeckDefinition,
  files: { core: string; pool: string },
): BuildDeckFromCsvResult {
  switch (definition.kind) {
    case 'vocabulary':
      return buildVocabularyDeck({ ...definition, ...files, categories: VOCABULARY_CATEGORIES });
    case 'timeline':
      return buildDeck({
        id: definition.id,
        name: definition.name,
        idPrefix: definition.idPrefix,
        core: files.core,
        pool: files.pool,
      });
  }
}

/** 画面の言葉（教材の種類ごと）。 */
export interface KindLabels {
  /** 項目の呼び名（年表は「出来事」）。「出題できる出来事」「出題する出来事」「出来事別」「間違えた出来事」に使う。 */
  item: string;
  /** 基本データの呼び名（年表は「基本の年表」）。「基本の年表のみ」などに使う。 */
  core: string;
  /** まとめる単位の呼び名（年表は「時代」）。成績の「時代別」に使う。 */
  group: string;
}

/**
 * 教材の種類ごとの差分（設計書 5 章の冒頭の表）。復習（`ReviewRules`）・成績（`StatsRules`）・履歴の表示
 * （`SessionLabels`）が使うものと、画面の言葉・項目の表示をまとめる。
 */
export interface KindRules<I extends Item, P extends Pattern>
  extends ReviewRules<I, P>, StatsRules<I, P>, SessionLabels {
  readonly kind: DeckKind;
  readonly labels: KindLabels;
  /** 項目の見出し（成績の項目別と、まとめの間違えた項目）。年表は出来事の文。 */
  itemTitle(item: I): string;
  /** 成績の項目別で、見出しの下に出す補足。年表は年の表示。 */
  itemDetail(item: I): string;
  /** 一覧に添える読み（設計書 5.7・6.8 節、8 章）。読みが無い項目は null。 */
  itemReading(item: I): string | null;
  /** まとめの一覧の並べ方（設計書 6.4・6.8 節）。年表は横、語彙は縦に並べる。 */
  readonly resultLayout: 'inline' | 'stacked';
  /** まとめの間違えた項目に添える正解。年表は正解の年（別解を併記）。 */
  answerText(item: I): string;
}

/** 年表の出題パターンの表示名（出題設定・成績の内訳・履歴で共通に使う正本）。 */
const TIMELINE_PATTERN_LABELS: Readonly<Record<TimelinePatternMode, string>> = {
  yearInput: '年号入力',
  yearChoice: '年号 4 択',
  choice: '出来事 4 択',
  mixed: 'ミックス',
};

/** 年表の教材の差分。 */
export const TIMELINE_RULES: KindRules<Event, TimelinePattern> = {
  kind: 'timeline',
  labels: { item: '出来事', core: '基本の年表', group: '時代' },
  patterns: TIMELINE_PATTERNS,
  patternLabel: (pattern: PatternMode) =>
    TIMELINE_PATTERN_LABELS[pattern as TimelinePatternMode] ?? pattern,
  formatRange,
  isEligibleFor,
  buildQuestion,
  groups: ERAS.map((era) => era.name),
  groupOf: (event) => event.era,
  itemTitle: (event) => event.title,
  itemDetail: (event) => formatEventYear(event),
  itemReading: () => null,
  resultLayout: 'inline',
  answerText: (event) => formatAnswerYears(event),
};

const VOCABULARY_PATTERN_LABELS: Readonly<Record<VocabularyPatternMode, string>> = {
  meaningChoice: '意味 4 択',
  wordChoice: '言葉 4 択',
  mixed: 'ミックス',
};

/** 語彙の教材の差分（設計書 5.7・6.8 節、7・8 章）。 */
export const VOCABULARY_RULES: KindRules<Word, VocabularyPattern> = {
  kind: 'vocabulary',
  labels: { item: '言葉', core: '基本の語彙', group: '種類' },
  patterns: VOCABULARY_PATTERNS,
  patternLabel: (pattern: PatternMode) =>
    VOCABULARY_PATTERN_LABELS[pattern as VocabularyPatternMode] ?? pattern,
  formatRange,
  isEligibleFor: isVocabularyEligibleFor,
  buildQuestion: buildVocabularyQuestion,
  groups: VOCABULARY_CATEGORIES,
  groupOf: (word) => word.category,
  itemTitle: (word) => word.word,
  itemDetail: (word) => (word.reading ? `${word.reading} · ${word.category}` : word.category),
  itemReading: (word) => word.reading,
  resultLayout: 'stacked',
  answerText: (word) => word.meaning,
};

/** 年表の教材と、その差分・母集団。 */
export interface TimelineDeckModel {
  kind: 'timeline';
  deck: TimelineDeck;
  rules: KindRules<Event, TimelinePattern>;
  /** 出題の母集団（`level` が `中学` の項目）。復習と成績はこの全体を対象にする。 */
  population: Event[];
}

/** 語彙の教材と、その差分・母集団（設計書 5 章の冒頭・6.8 節）。 */
export interface VocabularyDeckModel {
  kind: 'vocabulary';
  deck: VocabularyDeck;
  rules: KindRules<Word, VocabularyPattern>;
  population: Word[];
}

/** 教材と、その種類の差分・母集団（設計書 5 章の冒頭）。画面はこれを通して教材を扱う。 */
export type DeckModel = TimelineDeckModel | VocabularyDeckModel;

/** 教材の種類の差分を組み合わせる（教材の種類で振り分ける）。 */
export function deckModel(deck: TimelineDeck): TimelineDeckModel;
export function deckModel(deck: VocabularyDeck): VocabularyDeckModel;
export function deckModel(deck: Deck): DeckModel;
export function deckModel(deck: Deck): DeckModel {
  switch (deck.kind) {
    case 'timeline':
      return { kind: 'timeline', deck, rules: TIMELINE_RULES, population: population(deck.items) };
    case 'vocabulary':
      return {
        kind: 'vocabulary',
        deck,
        rules: VOCABULARY_RULES,
        population: population(deck.items),
      };
  }
}

/**
 * 選ぶ教材を決める（設計書 6.9 節）。`id` の教材があればそれ、`id` が `null` のときと、無い教材を指しているときは
 * 先頭の教材。
 */
export function pickDeck<D extends { deck: { id: string } }>(
  decks: readonly D[],
  id: string | null,
): D {
  return decks.find((model) => model.deck.id === id) ?? decks[0];
}
