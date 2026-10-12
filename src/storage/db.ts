import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Attempt,
  EventStats,
  Pattern,
  Session,
  Settings,
  VocabularySettings,
} from '../core/models';

/** データベース名と版（設計書 5.4 節）。スキーマを変えるときは版を上げ、`upgrade` に移行を書く。 */
const DB_NAME = 'qloop';
export const DB_VERSION = 1;

/**
 * 1.0 の記録の教材の id。1.0 は日本史年表の 1 教材だけだったので、教材の id の無い記録（`deckId` の無いセッション、
 * `meta` の `settings`、版 1 の書き出しファイル）はこの教材のものとして読む（設計書 5.4・5.6 節）。
 */
export const LEGACY_DECK_ID = 'japanese-history';

/**
 * 保存された出題設定。PR 3 より前に保存したものには `scope` が無い（読み込むときに `core` とみなす）。
 */
export type StoredSettings = Omit<Settings, 'scope'> & Partial<Pick<Settings, 'scope'>>;

/** 全種類の教材で保存する出題設定。 */
export type StoredDeckSettings = StoredSettings | VocabularySettings;

/** 教材ごとの出題設定の `meta` の鍵（`settings:<教材の id>`）。 */
export type SettingsKey = `settings:${string}`;

/** `meta` ストアのレコード。`key` で種類を分ける。 */
type MetaRecord =
  /** 教材ごとの出題設定。 */
  | { key: SettingsKey; value: StoredDeckSettings }
  /** 1.0 の出題設定（年表のもの）。読むときだけ使う。 */
  | { key: 'settings'; value: StoredSettings }
  /** ホームで最後に選んだ教材の id。 */
  | { key: 'lastDeck'; value: string }
  /** 回答のあった端末ローカルの暦日（`YYYY-MM-DD`）。全教材で共通。昇順で重複なし。 */
  | { key: 'studyDays'; value: string[] };

/** 保存されたセッション。1.0 の記録には `deckId` が無い（読むときに `LEGACY_DECK_ID` を補う）。 */
export type StoredSession = Omit<Session, 'deckId'> & Partial<Pick<Session, 'deckId'>>;

export interface QLoopSchema extends DBSchema {
  /** 回答の記録。追記のみで、成績の正本。 */
  attempts: {
    key: number;
    value: Attempt;
    indexes: { byEvent: string; byAnsweredAt: string; bySession: string };
  };
  /** 項目 × パターンの集計。`attempts` から再計算できる派生データ。 */
  eventStats: {
    key: [string, Pattern];
    value: EventStats;
  };
  sessions: {
    key: string;
    value: StoredSession;
  };
  meta: {
    key: MetaRecord['key'];
    value: MetaRecord;
  };
}

export type QLoopDb = IDBPDatabase<QLoopSchema>;

/**
 * データベースを開く。無ければ作る。開けなければ例外を投げる（呼び出し側で理由を表示する）。
 * `name` はテストで別のデータベースを使うためのもの。
 */
export function openDb(name: string = DB_NAME): Promise<QLoopDb> {
  return openDB<QLoopSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const attempts = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
        attempts.createIndex('byEvent', 'eventId');
        attempts.createIndex('byAnsweredAt', 'answeredAt');
        attempts.createIndex('bySession', 'sessionId');
        db.createObjectStore('eventStats', { keyPath: ['eventId', 'pattern'] });
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    },
  });
}

/**
 * 保存データを消されにくくするよう、ブラウザに永続化を頼む（設計書 5.4 節）。
 * 使えない環境では何もしない。効果は保証されないので、結果は使わない。
 */
export function requestPersistentStorage(): void {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') {
    return;
  }
  navigator.storage.persist().catch(() => undefined);
}
