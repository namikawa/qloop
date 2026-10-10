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

/** 出題パターン。`yearInput` = 年号入力（パターン A）、`choice` = 4 択（パターン B）。 */
export type Pattern = 'yearInput' | 'choice';

/** 学習段階。CSV の `level` 列が空なら `中学`。 */
export type Level = '中学' | '高校';

/** 出来事の役割。`core.csv` の行は出題対象、`pool.csv` の行は誤答専用。 */
export type Role = 'core' | 'pool';

/** 出来事（年表の 1 行）。 */
export interface Event {
  id: string;
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
  level: Level;
  role: Role;
}

/** 問題集。 */
export interface Deck {
  id: string;
  name: string;
  events: Event[];
}

/** セッション開始時に選ぶ出題パターン（設計書 6.1 節の 3）。`mixed` は 1 問ごとに年号入力か 4 択。 */
export type PatternMode = Pattern | 'mixed';

/**
 * 出題範囲（設計書 6.1 節の 2）。
 * 年号の範囲の `from`・`to` は 1〜4 桁の正の整数で、空の側は `null`（開いた範囲）。
 */
export type Range =
  | { kind: 'all' }
  | { kind: 'years'; from: number | null; to: number | null }
  | { kind: 'eras'; eras: Era[] };

/** 1 セッションの問題数（設計書 6.1 節の 4）。`all` は適格な全件。 */
export type QuestionCount = 10 | 20 | 'all';

/** 1 問。問題列と選択肢はセッション開始時に確定し、画面では変えない（設計書 6.1 節の 6）。 */
export type Question =
  | { event: Event; pattern: 'yearInput' }
  | {
      event: Event;
      pattern: 'choice';
      /** 正解（`event`）と誤答 3 件の 4 件。並びはシャッフル済み。 */
      choices: Event[];
    };

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

/** セッションの種類。`review` は復習モード（PR 3）。 */
export type SessionMode = 'normal' | 'review';

/** セッション（IndexedDB の `sessions`。設計書 5.4 節）。 */
export interface Session {
  /** UUID。 */
  id: string;
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

/** 出来事 × パターンの集計（IndexedDB の `eventStats`。キーは `[eventId, pattern]`）。 */
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
}

/** 出題設定（IndexedDB の `meta.settings`）。最後に選んだものを次回の初期値にする。 */
export interface Settings {
  pattern: PatternMode;
  count: QuestionCount;
  range: Range;
}
