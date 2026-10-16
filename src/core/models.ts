/** 時代区分（設計書 5.3 節の表）。CSV の `era` 列にもこの名前を書く。 */
export type Era =
  | '縄文'
  | '弥生'
  | '古墳'
  | '飛鳥'
  | '奈良'
  | '平安'
  | '鎌倉'
  | '室町'
  | '安土桃山'
  | '江戸'
  | '明治'
  | '大正'
  | '昭和'
  | '平成'
  | '令和';

/**
 * 年表の出題パターン。`yearInput` = 年号入力（パターン A）、`yearChoice` = 年号 4 択（パターン C）、
 * `choice` = 出来事 4 択（パターン B）。`choice` は 0.1 系の記録を引き継ぐため名前を変えない（設計書 5.4 節）。
 */
export type TimelinePattern = 'yearInput' | 'yearChoice' | 'choice';

/** 型にパターンを足すとき、一覧への追加も型検査で必須にする。 */
const TIMELINE_PATTERN_KEYS: Record<TimelinePattern, true> = {
  yearInput: true,
  yearChoice: true,
  choice: true,
};

/** 年表の出題パターンの並び（年号入力・年号 4 択・出来事 4 択）。ミックスはこの中から選ぶ。 */
export const TIMELINE_PATTERNS: readonly TimelinePattern[] = Object.keys(
  TIMELINE_PATTERN_KEYS,
) as TimelinePattern[];

/** 語彙の出題パターン（設計書 6.8 節）。 */
export type VocabularyPattern = 'meaningChoice' | 'wordChoice';

/** 型にパターンを足すとき、一覧への追加も型検査で必須にする。 */
const VOCABULARY_PATTERN_KEYS: Record<VocabularyPattern, true> = {
  meaningChoice: true,
  wordChoice: true,
};

/** 語彙の出題パターンの並び（設計書 6.8 節）。ミックスはこの中から選ぶ。 */
export const VOCABULARY_PATTERNS: readonly VocabularyPattern[] = Object.keys(
  VOCABULARY_PATTERN_KEYS,
) as VocabularyPattern[];

/** 英単語の出題パターン（設計書 6.11 節）。 */
export type EnglishChoicePattern = 'englishMeaningChoice' | 'englishWordChoice';
export type EnglishPattern = EnglishChoicePattern | 'englishSpelling';
const ENGLISH_PATTERN_KEYS: Record<EnglishPattern, true> = {
  englishMeaningChoice: true,
  englishWordChoice: true,
  englishSpelling: true,
};
export const ENGLISH_PATTERNS: readonly EnglishPattern[] = Object.keys(
  ENGLISH_PATTERN_KEYS,
) as EnglishPattern[];
export type EnglishPatternMode = EnglishPattern | 'mixed';

/** 全種類の教材の出題パターン。回答の記録と書き出しの検証で使う。 */
export type Pattern = TimelinePattern | VocabularyPattern | EnglishPattern;

/** 全種類の教材の出題パターン（書き出しファイルの検証で使う）。 */
export const PATTERNS: readonly Pattern[] = [
  ...TIMELINE_PATTERNS,
  ...VOCABULARY_PATTERNS,
  ...ENGLISH_PATTERNS,
];

/** 学習段階。CSV の `level` 列が空なら `中学`。 */
export type Level = '中学' | '高校';

/**
 * 項目の区分。`core.csv` の行は基本データ（年表では基本の年表 = 初期データ）、`pool.csv` の行は追加データ。
 * どちらも `level` が `中学` なら出題の母集団に入り、4 択の誤答の候補には両方を使う。
 */
export type Role = 'core' | 'pool';

/**
 * 項目（教材の 1 行）の共通の部分（設計書 5 章の冒頭）。記録はこの `id` に紐づく。
 * 復習と成績の集計は、項目のうちこの部分だけを直接使い、残りは教材の種類ごとの差分（`decks.ts` の `KindRules`）を
 * 通して扱う。
 */
export interface Item {
  id: string;
  level: Level;
  role: Role;
}

/** 出来事（年表の教材の項目。設計書 5.1 節）。 */
export interface Event extends Item {
  /** 代表年。紀元前は負数。0 は使わない。 */
  year: number;
  title: string;
  /** 確定した時代（CSV の `era` による上書きを反映したもの）。 */
  era: Era;
  /** 「ごろ」の出来事か。 */
  approx: boolean;
  /** 追加で正解とみなす年。 */
  altYears: number[];
  /** 年の表示の上書き。無ければ null。 */
  yearLabel: string | null;
}

/** 教材の種類（設計書 5 章の冒頭）。`timeline` = 年表、`vocabulary` = 語彙、`english` = 英単語。 */
export type DeckKind = 'timeline' | 'vocabulary' | 'english';

/** 年表の教材。 */
export interface TimelineDeck {
  id: string;
  kind: 'timeline';
  name: string;
  /** core.csv と pool.csv の全行（`高校` の行も含む）。 */
  items: Event[];
}

/** 言葉（語彙の教材の項目。設計書 5.7 節）。 */
export interface Word extends Item {
  word: string;
  meaning: string;
  category: string;
  reading: string | null;
  similar: string[];
}

/** 語彙の教材（設計書 5 章の冒頭・5.7 節）。 */
export interface VocabularyDeck {
  id: string;
  kind: 'vocabulary';
  name: string;
  /** core.csv と pool.csv の全行（高校の行も含む）。 */
  items: Word[];
}

/** 英単語（設計書 5.8 節）。全行が中学・基本データ。 */
export interface EnglishWord extends Item {
  word: string;
  meaning: string;
  pos: string | null;
  book: string;
  lesson: number;
  level: '中学';
  role: 'core';
  similar: string[];
}

/** 英単語の教材。追加データは持たない。 */
export interface EnglishDeck {
  id: string;
  kind: 'english';
  name: string;
  items: EnglishWord[];
}

/** 教材（生成物 `decks.json` の 1 要素）。`kind` で項目の型が決まる。 */
export type Deck = TimelineDeck | VocabularyDeck | EnglishDeck;

/**
 * セッション開始時に選ぶ出題パターン（設計書 6.1 節の 3）。
 * `mixed` は 1 問ごとに、その項目に適格なパターンから等確率で選ぶ。
 */
export type PatternMode = Pattern | 'mixed';

/** 年表の出題設定で選ぶ出題パターン。 */
export type TimelinePatternMode = TimelinePattern | 'mixed';

/**
 * 出題範囲（設計書 6.1 節の 2）。
 * 年号の範囲の `from`・`to` は 1〜4 桁の正の整数で、空の側は `null`（開いた範囲）。
 */
export type TimelineRange =
  | { kind: 'all' }
  | { kind: 'years'; from: number | null; to: number | null }
  | { kind: 'eras'; eras: Era[] };

/** 語彙の出題範囲（設計書 6.8 節の 2）。 */
export type VocabularyRange = { kind: 'all' } | { kind: 'categories'; categories: string[] };
/** 英単語の出題範囲。categories の値は「STAGE2 Lesson 4」の形。 */
export type EnglishRange = { kind: 'all' } | { kind: 'categories'; categories: string[] };

/** 全種類の教材の出題範囲（設計書 5.4・5.6 節）。履歴と書き出しに保存する。 */
export type Range = TimelineRange | VocabularyRange | EnglishRange;

/** 1 セッションの問題数（設計書 6.1 節の 4）。`all` は適格な全件。 */
export type QuestionCount = 10 | 20 | 'all';

/** 年表の 1 問。 */
export type TimelineQuestion =
  | { item: Event; pattern: 'yearInput' }
  | {
      item: Event;
      pattern: 'yearChoice';
      /** 正解（`item.year`）と誤答 3 つの 4 つの年。小さい順。 */
      years: number[];
    }
  | {
      item: Event;
      pattern: 'choice';
      /** 正解（`item`）と誤答 3 件の 4 件。並びはシャッフル済み。 */
      choices: Event[];
    };

/** 語彙の出題設定で選ぶ出題パターン（設計書 6.8 節）。 */
export type VocabularyPatternMode = VocabularyPattern | 'mixed';

/** 語彙の 1 問（設計書 6.8 節）。パターンで問いと選択肢の表示を決める。 */
export type VocabularyQuestion = {
  [P in VocabularyPattern]: {
    item: Word;
    pattern: P;
    /** 正解と誤答 3 件。並びはセッション開始時にシャッフルする。 */
    choices: Word[];
  };
}[VocabularyPattern];

/** 英単語の 1 問（設計書 6.11 節）。 */
export type EnglishQuestion =
  | {
      [P in EnglishChoicePattern]: {
        item: EnglishWord;
        pattern: P;
        choices: EnglishWord[];
      };
    }[EnglishChoicePattern]
  | { item: EnglishWord; pattern: 'englishSpelling'; answers: EnglishWord[] };

/**
 * 1 問（全種類の教材のもの）。どれも出題した項目 `item` とパターン `pattern` を持つ。
 * 問題列と選択肢はセッション開始時に確定し、画面では変えない（設計書 6.1 節の 6）。
 */
export type Question = TimelineQuestion | VocabularyQuestion | EnglishQuestion;

/** 回答の記録（IndexedDB の `attempts`。追記のみで、成績の正本）。 */
export interface Attempt {
  /** IndexedDB の自動採番のキー。追記する前は無い。 */
  id?: number;
  eventId: string;
  pattern: Pattern;
  correct: boolean;
  /** 回答した時刻（UTC の ISO 8601 文字列）。 */
  answeredAt: string;
  sessionId: string;
}

/** セッションの種類。`review` は復習モード（設計書 7 章）。 */
export type SessionMode = 'normal' | 'review';

/** セッション（IndexedDB の `sessions`。設計書 5.4 節）。 */
export interface Session {
  /** UUID。 */
  id: string;
  /** 教材の id。1.0 の記録には無いので、読むときに `japanese-history` を補う。 */
  deckId: string;
  mode: SessionMode;
  /** 選んだ出題パターン。復習は `null`。 */
  pattern: PatternMode | null;
  /** 選んだ出題範囲。復習は範囲を選ばないので `null`。 */
  range: Range | null;
  /** 開始時刻（UTC の ISO 8601 文字列）。 */
  startedAt: string;
  /** 終了時刻（UTC の ISO 8601 文字列）。未終了は `null`。 */
  endedAt: string | null;
  /** 生成した問題数。 */
  total: number;
  /** 回答済みの問題数。 */
  answered: number;
  /** 正解した問題数。 */
  correct: number;
}

/**
 * 項目 × パターンの集計（IndexedDB の `eventStats`。キーは `[eventId, pattern]`）。
 * `eventId` は項目の id（名前は 1.0 の記録を引き継ぐため変えない）。
 */
export interface EventStats {
  eventId: string;
  pattern: Pattern;
  /** 回答数。 */
  attempts: number;
  /** 正解数。 */
  correct: number;
  /** 最後に回答した時刻（UTC の ISO 8601 文字列）。 */
  lastAnsweredAt: string;
  /** 最後の回答が正解だったか。 */
  lastCorrect: boolean;
  /** 最後に不正解だった時刻（UTC の ISO 8601 文字列）。不正解が無ければ `null`。 */
  lastWrongAt: string | null;
  /** 最後に間違えた後に続けて正解した回数。最後の回答が不正解なら 0（設計書 5.4・7 章）。 */
  consecutiveCorrect: number;
}

/**
 * 出題設定の「出題する出来事」（設計書 6.1 節の 1）。
 * `core` = 基本の年表のみ（`core.csv` の行。既定）、`all` = すべて（追加データを含む）。
 */
export type EventScope = 'core' | 'all';

/** 年表の出題設定（IndexedDB の `meta` の `settings:<教材の id>`）。最後に選んだものを次回の初期値にする。 */
export interface Settings {
  scope: EventScope;
  pattern: TimelinePatternMode;
  count: QuestionCount;
  range: TimelineRange;
}

/** 語彙の出題設定（設計書 5.4・6.8 節。`meta` の `settings:<教材の id>`）。 */
export interface VocabularySettings {
  scope: EventScope;
  pattern: VocabularyPatternMode;
  count: QuestionCount;
  range: VocabularyRange;
}

/** 英単語の出題設定。scope は持たない。 */
export interface EnglishSettings {
  pattern: EnglishPatternMode;
  count: QuestionCount;
  range: EnglishRange;
}

/** 教材ごとに保存する出題設定（設計書 5.4 節）。 */
export type DeckSettings = Settings | VocabularySettings | EnglishSettings;
