import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Attempt, EventStats, Pattern, Session, Settings } from '../core/models';

/** データベース名と版（設計書 5.4 節）。スキーマを変えるときは版を上げ、`upgrade` に移行を書く。 */
export const DB_NAME = 'qloop';
export const DB_VERSION = 1;

/**
 * 保存された出題設定。PR 3 より前に保存したものには `scope` が無い（読み込むときに `core` とみなす）。
 */
export type StoredSettings = Omit<Settings, 'scope'> & Partial<Pick<Settings, 'scope'>>;

/** `meta` ストアのレコード。`key` で種類を分ける。 */
export type MetaRecord =
  | { key: 'settings'; value: StoredSettings }
  /** 回答のあった端末ローカルの暦日（`YYYY-MM-DD`）。昇順で重複なし。 */
  | { key: 'studyDays'; value: string[] };

export interface QLoopSchema extends DBSchema {
  /** 回答の記録。追記のみで、成績の正本。 */
  attempts: {
    key: number;
    value: Attempt;
    indexes: { byEvent: string; byAnsweredAt: string; bySession: string };
  };
  /** 出来事 × パターンの集計。`attempts` から再計算できる派生データ。 */
  eventStats: {
    key: [string, Pattern];
    value: EventStats;
  };
  sessions: {
    key: string;
    value: Session;
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
