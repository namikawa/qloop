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
