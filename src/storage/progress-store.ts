import type { IDBPTransaction } from 'idb';
import { localDateKey } from '../core/date';
import type {
  Attempt,
  DeckSettings,
  VocabularySettings,
  EventStats,
  Pattern,
  PatternMode,
  Range,
  Session,
  SessionMode,
  Settings,
} from '../core/models';
import { normalizeVocabularySettings } from '../core/vocabulary';
import { uuidFromRng } from '../core/random';
import {
  LEGACY_DECK_ID,
  type QLoopDb,
  type QLoopSchema,
  type SettingsKey,
  type StoredSession,
  type StoredDeckSettings,
} from './db';
import { EXPORT_SCHEMA_VERSION, parseProgressExport, type ProgressExport } from './transfer';

export interface ProgressStoreOptions {
  db: QLoopDb;
  /** 現在時刻。既定は `new Date()`。テストでは固定の時刻を返す関数を渡す。 */
  now?: () => Date;
  /** 学習日（`meta.studyDays` に入れる暦日 `YYYY-MM-DD`）の求め方。既定は端末ローカルの暦日。 */
  dateKey?: (date: Date) => string;
  /** セッションの id の作り方。既定は UUID。 */
  newId?: () => string;
}

export interface StartSessionInput {
  /** 教材の id。 */
  deckId: string;
  mode: SessionMode;
  /** 復習は `null`。 */
  pattern: PatternMode | null;
  /** 復習は `null`。 */
  range: Range | null;
  /** 生成した問題数。 */
  total: number;
}

export interface RecordAnswerInput {
  sessionId: string;
  eventId: string;
  pattern: Pattern;
  correct: boolean;
  /** 最後の問題の回答なら true。同じトランザクションで `endedAt` も記録する（設計書 6.4 節の 4）。 */
  endSession: boolean;
}

function defaultNewId(): string {
  // randomUUID は HTTPS（安全な配信元）でしか使えないので、無ければ乱数から作る
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidFromRng(Math.random);
}

function statsKey(eventId: string, pattern: Pattern): string {
  return `${pattern}:${eventId}`;
}

/**
 * 成績の状態を持つ唯一のオブジェクト（設計書 5.4 節）。全教材の記録をまとめて持つ。
 * IndexedDB への保存と、メモリ上の集計（`eventStats`・`sessions`・`meta`）の更新を同じ内容で行う。
 * 起動時の `load()` では `attempts` の全件は読まない。書き込みに失敗したら例外を投げ、メモリ上の状態は変えない。
 *
 * `attempts`・`eventStats` に教材の id は持たない（教材ごとの成績と復習は、教材の母集団で絞る）。教材を持つのは
 * セッションの `deckId` と、`meta` の教材ごとの出題設定（`settings:<教材の id>`）・`lastDeck` だけ。
 * 1.0 の記録（`deckId` の無いセッション、`meta` の `settings`）は日本史年表（`LEGACY_DECK_ID`）のものとして読む。
 */
export class ProgressStore {
  private readonly db: QLoopDb;
  private readonly now: () => Date;
  private readonly dateKey: (date: Date) => string;
  private readonly newId: () => string;

  private readonly stats = new Map<string, EventStats>();
  private readonly sessions = new Map<string, Session>();
  private studyDays: string[] = [];
  /** 教材ごとの出題設定（`meta` の `settings:<教材の id>`）。キーは教材の id。 */
  private readonly settings = new Map<string, DeckSettings>();
  /** 1.0 の出題設定（`meta` の `settings`）。日本史年表の設定が無いときの初期値にだけ使う。 */
  private legacySettings: Settings | null = null;
  /** ホームで最後に選んだ教材の id（`meta` の `lastDeck`）。 */
  private lastDeck: string | null = null;

  constructor({
    db,
    now = () => new Date(),
    dateKey = localDateKey,
    newId = defaultNewId,
  }: ProgressStoreOptions) {
    this.db = db;
    this.now = now;
    this.dateKey = dateKey;
    this.newId = newId;
  }

  /**
   * `eventStats`・`sessions`・`meta`（出題設定・最後に選んだ教材・学習日）を読んでメモリに持つ。
   * 同じトランザクションで、`endedAt` が `null` で回答が 0 件のセッションを削除する（設計書 6.4 節の 7）。
   * 回答が 1 件以上ある未終了のセッションは中断として残す。`deckId` の無いセッションには `LEGACY_DECK_ID` を補う。
   */
  async load(): Promise<void> {
    const tx = this.db.transaction(['eventStats', 'sessions', 'meta'], 'readwrite');
    const { stats, sessions, meta } = await inTransaction(tx, async () => {
      const sessionStore = tx.objectStore('sessions');
      const [stats, allSessions, meta] = await Promise.all([
        tx.objectStore('eventStats').getAll(),
        sessionStore.getAll(),
        tx.objectStore('meta').getAll(),
      ]);
      const sessions: Session[] = [];
      const deletions: Promise<void>[] = [];
      for (const session of allSessions) {
        if (session.endedAt === null && session.answered === 0) {
          deletions.push(sessionStore.delete(session.id));
        } else {
          sessions.push(normalizeSession(session));
        }
      }
      await Promise.all(deletions);
      return { stats, sessions, meta };
    });

    let studyDays: string[] = [];
    this.settings.clear();
    this.legacySettings = null;
    this.lastDeck = null;
    for (const record of meta) {
      if (record.key === 'studyDays') {
        studyDays = record.value;
      } else if (record.key === 'settings') {
        this.legacySettings = normalizeSettings(record.value);
      } else if (record.key === 'lastDeck') {
        this.lastDeck = record.value;
      } else if (record.key.startsWith(SETTINGS_KEY_PREFIX)) {
        this.settings.set(
          record.key.slice(SETTINGS_KEY_PREFIX.length),
          normalizeSettings(record.value),
        );
      }
    }
    this.applyState({ stats, sessions, studyDays });
  }

  /** セッションを始める（設計書 6.4 節の 2）。`sessions` にレコードを作り、そのセッションを返す。 */
  async startSession(input: StartSessionInput): Promise<Session> {
    const session: Session = {
      id: this.newId(),
      deckId: input.deckId,
      mode: input.mode,
      pattern: input.pattern,
      range: input.range,
      startedAt: this.now().toISOString(),
      endedAt: null,
      total: input.total,
      answered: 0,
      correct: 0,
    };
    const tx = this.db.transaction('sessions', 'readwrite');
    await inTransaction(tx, async () => {
      await tx.objectStore('sessions').add(session);
    });
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * 1 回答を保存する（設計書 5.4 節）。1 つのトランザクションで、`attempts` への追記、`eventStats` の更新、
   * `sessions` の `answered`・`correct`（最後の問題なら `endedAt` も）の更新、`meta.studyDays` への当日の追加を行う。
   * 完了した後に、メモリ上の状態も同じ内容に更新する。
   *
   * 保存先のセッションが無ければ、このストアがメモリに持つ同じセッションを書き戻してから記録する
   * （別の画面の起動時の掃除で、回答前のセッションが削除されることがあるため）。
   */
  async recordAnswer(input: RecordAnswerInput): Promise<void> {
    const date = this.now();
    const answeredAt = date.toISOString();
    const day = this.dateKey(date);
    const tx = this.db.transaction(['attempts', 'eventStats', 'sessions', 'meta'], 'readwrite');
    const written = await inTransaction(tx, async () => {
      const statsStore = tx.objectStore('eventStats');
      const sessionStore = tx.objectStore('sessions');
      const metaStore = tx.objectStore('meta');
      const [previous, stored, daysRecord] = await Promise.all([
        statsStore.get([input.eventId, input.pattern]),
        sessionStore.get(input.sessionId),
        metaStore.get('studyDays'),
      ]);
      const session =
        stored === undefined ? this.sessions.get(input.sessionId) : normalizeSession(stored);
      if (session === undefined) {
        throw new Error(`セッション ${input.sessionId} が見つかりません`);
      }

      const attempt: Attempt = {
        eventId: input.eventId,
        pattern: input.pattern,
        correct: input.correct,
        answeredAt,
        sessionId: input.sessionId,
      };
      const stats: EventStats = {
        eventId: input.eventId,
        pattern: input.pattern,
        attempts: (previous?.attempts ?? 0) + 1,
        correct: (previous?.correct ?? 0) + (input.correct ? 1 : 0),
        lastAnsweredAt: answeredAt,
        lastCorrect: input.correct,
        lastWrongAt: input.correct ? (previous?.lastWrongAt ?? null) : answeredAt,
      };
      const nextSession: Session = {
        ...session,
        answered: session.answered + 1,
        correct: session.correct + (input.correct ? 1 : 0),
        endedAt: input.endSession ? (session.endedAt ?? answeredAt) : session.endedAt,
      };
      const days = daysRecord?.key === 'studyDays' ? daysRecord.value : [];
      const studyDays = days.includes(day) ? days : [...days, day].sort();

      const writes: Promise<unknown>[] = [
        tx.objectStore('attempts').add(attempt),
        statsStore.put(stats),
        sessionStore.put(nextSession),
      ];
      if (studyDays !== days) {
        writes.push(metaStore.put({ key: 'studyDays', value: studyDays }));
      }
      await Promise.all(writes);
      return { stats, session: nextSession, studyDays };
    });

    this.stats.set(statsKey(written.stats.eventId, written.stats.pattern), written.stats);
    this.sessions.set(written.session.id, written.session);
    this.studyDays = [...written.studyDays];
  }

  /**
   * 途中で終了したセッションの `endedAt` を記録する（設計書 6.4 節の 5）。終了済みなら何もしない。
   * 保存先のセッションが無ければ、`recordAnswer` と同じくメモリ上のセッションを書き戻す。
   */
  async endSession(sessionId: string): Promise<void> {
    const endedAt = this.now().toISOString();
    const tx = this.db.transaction('sessions', 'readwrite');
    const session = await inTransaction(tx, async () => {
      const store = tx.objectStore('sessions');
      const stored = await store.get(sessionId);
      const current =
        stored === undefined ? this.sessions.get(sessionId) : normalizeSession(stored);
      if (current === undefined) {
        throw new Error(`セッション ${sessionId} が見つかりません`);
      }
      if (current.endedAt !== null) {
        return current;
      }
      const next: Session = { ...current, endedAt };
      await store.put(next);
      return next;
    });
    this.sessions.set(session.id, session);
  }

  /**
   * 教材 `deckId` の、最後に保存した出題設定。まだ無ければ `null`。`kind` は既定で年表、語彙では明示する。
   * 語彙の設定は現在の種類の一覧にそろえて返す。
   * 日本史年表（`LEGACY_DECK_ID`）は、教材ごとの設定が無ければ 1.0 の設定（`meta` の `settings`）を返す。
   */
  getSettings(deckId: string, kind?: 'timeline'): Settings | null;
  getSettings(deckId: string, kind: 'vocabulary'): VocabularySettings | null;
  getSettings(deckId: string, kind: 'timeline' | 'vocabulary' = 'timeline'): DeckSettings | null {
    const settings =
      this.settings.get(deckId) ?? (deckId === LEGACY_DECK_ID ? this.legacySettings : null);
    if (settings === null) return null;
    if (kind === 'vocabulary') {
      if (
        (settings.pattern === 'meaningChoice' ||
          settings.pattern === 'wordChoice' ||
          settings.pattern === 'mixed') &&
        (settings.range.kind === 'all' || settings.range.kind === 'categories')
      ) {
        return normalizeVocabularySettings(settings as VocabularySettings);
      }
      return null;
    }
    if (
      (settings.pattern === 'yearInput' ||
        settings.pattern === 'yearChoice' ||
        settings.pattern === 'choice' ||
        settings.pattern === 'mixed') &&
      settings.range.kind !== 'categories'
    )
      return settings as Settings;
    return null;
  }

  /** 教材 `deckId` の出題設定を `meta` の `settings:<教材の id>` に保存する。 */
  async saveSettings(deckId: string, settings: DeckSettings): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    await inTransaction(tx, async () => {
      await tx.objectStore('meta').put({ key: settingsKey(deckId), value: settings });
    });
    this.settings.set(deckId, settings);
  }

  /** ホームで最後に選んだ教材の id。まだ無ければ `null`（今の教材に無い id のこともある）。 */
  getLastDeck(): string | null {
    return this.lastDeck;
  }

  /** ホームで選んだ教材の id を `meta` の `lastDeck` に保存する。 */
  async saveLastDeck(deckId: string): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    await inTransaction(tx, async () => {
      await tx.objectStore('meta').put({ key: 'lastDeck', value: deckId });
    });
    this.lastDeck = deckId;
  }

  /** 項目 × パターンの集計。回答が無ければ `undefined`。 */
  getEventStats(eventId: string, pattern: Pattern): EventStats | undefined {
    return this.stats.get(statsKey(eventId, pattern));
  }

  /** 全ての集計。 */
  listEventStats(): EventStats[] {
    return [...this.stats.values()];
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** 全教材のセッション（開始時刻の古い順）。 */
  listSessions(): Session[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  /** 回答のあった暦日（`YYYY-MM-DD`）の一覧（昇順）。 */
  getStudyDays(): string[] {
    return [...this.studyDays];
  }

  /**
   * `attempts` の全件から、`eventStats`・`sessions` の `answered`・`correct`・`meta.studyDays` を再計算して
   * 書き直す（設計書 5.4 節）。`sessions` の他の項目、出題設定、最後に選んだ教材はそのまま。
   * メモリ上の状態も同じ内容にする。
   */
  async rebuild(): Promise<void> {
    const tx = this.db.transaction(['attempts', 'eventStats', 'sessions', 'meta'], 'readwrite');
    const derived = await inTransaction(tx, () => rebuildInTransaction(tx, this.dateKey));
    this.applyState(derived);
  }

  /**
   * 書き出す内容（設計書 5.6 節。版 2）。全教材の記録を入れる。`attempts` は全件を読む。
   * `deckId` の無いセッション（1.0 の記録）には `LEGACY_DECK_ID` を補って書き出す。
   */
  async exportData(): Promise<ProgressExport> {
    const tx = this.db.transaction(['attempts', 'sessions'], 'readonly');
    const [attempts, sessions] = await inTransaction(tx, () =>
      Promise.all([tx.objectStore('attempts').getAll(), tx.objectStore('sessions').getAll()]),
    );
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: this.now().toISOString(),
      attempts,
      sessions: sessions.map(normalizeSession),
    };
  }

  /**
   * 書き出した内容で記録を全置換する（設計書 5.6 節）。形式を検証してから、1 つのトランザクションで
   * 全ストアを空にし、`sessions` と `attempts` を書き（`attempts` の `id` は捨てて自動採番に任せる）、
   * `rebuild()` と同じ再計算を行う。途中で失敗しても読み込み前の状態に戻るよう、再計算も同じトランザクションで行う。
   * 出題設定（教材ごと）と最後に選んだ教材も消える。メモリ上の状態も読み込んだ内容にする。
   * 形式が合わなければ何も変えずに、理由を入れた例外（`ImportFormatError`）を投げる。
   */
  async importData(data: unknown): Promise<void> {
    const parsed = parseProgressExport(data);
    const tx = this.db.transaction(['attempts', 'eventStats', 'sessions', 'meta'], 'readwrite');
    const derived = await inTransaction(tx, async () => {
      const attemptStore = tx.objectStore('attempts');
      const sessionStore = tx.objectStore('sessions');
      await Promise.all([
        attemptStore.clear(),
        tx.objectStore('eventStats').clear(),
        sessionStore.clear(),
        tx.objectStore('meta').clear(),
      ]);
      // 同じトランザクションの要求は出した順に処理されるので、attempts は配列の順に採番される
      await Promise.all([
        ...parsed.sessions.map((session) => sessionStore.add(session)),
        ...parsed.attempts.map(({ eventId, pattern, correct, answeredAt, sessionId }) =>
          attemptStore.add({ eventId, pattern, correct, answeredAt, sessionId }),
        ),
      ]);
      return rebuildInTransaction(tx, this.dateKey);
    });
    this.applyState(derived);
    this.clearPreferences();
  }

  /**
   * 全ストアを空にし、メモリ上の状態も初期化する（設計書 5.6 節）。全教材の記録が消える。
   * 出題設定（教材ごと）と最後に選んだ教材も消える。
   */
  async reset(): Promise<void> {
    const tx = this.db.transaction(['attempts', 'eventStats', 'sessions', 'meta'], 'readwrite');
    await inTransaction(tx, async () => {
      await Promise.all([
        tx.objectStore('attempts').clear(),
        tx.objectStore('eventStats').clear(),
        tx.objectStore('sessions').clear(),
        tx.objectStore('meta').clear(),
      ]);
    });
    this.applyState({ stats: [], sessions: [], studyDays: [] });
    this.clearPreferences();
  }

  private applyState(state: {
    stats: readonly EventStats[];
    sessions: readonly Session[];
    studyDays: readonly string[];
  }): void {
    this.stats.clear();
    for (const record of state.stats) {
      this.stats.set(statsKey(record.eventId, record.pattern), record);
    }
    this.sessions.clear();
    for (const session of state.sessions) {
      this.sessions.set(session.id, session);
    }
    this.studyDays = [...state.studyDays];
  }

  /** メモリ上の出題設定と最後に選んだ教材を消す（`meta` を空にしたとき）。 */
  private clearPreferences(): void {
    this.settings.clear();
    this.legacySettings = null;
    this.lastDeck = null;
  }
}

/** 教材ごとの出題設定の `meta` の鍵の接頭辞。 */
const SETTINGS_KEY_PREFIX = 'settings:';

function settingsKey(deckId: string): SettingsKey {
  return `${SETTINGS_KEY_PREFIX}${deckId}`;
}

/** 保存された出題設定を読む。`scope` が無い（PR 3 より前の）設定は `core` とみなす。 */
function normalizeSettings<T extends StoredDeckSettings>(stored: T): T & { scope: 'core' | 'all' } {
  return { ...stored, scope: stored.scope === 'all' ? 'all' : 'core' };
}

/** 保存されたセッションを読む。`deckId` が無い（1.0 の）セッションは日本史年表（`LEGACY_DECK_ID`）とみなす。 */
function normalizeSession(stored: StoredSession): Session {
  return { ...stored, deckId: stored.deckId ?? LEGACY_DECK_ID };
}

/** `attempts` から再計算した派生データ。 */
interface DerivedProgress {
  stats: EventStats[];
  sessions: Session[];
  studyDays: string[];
}

/**
 * `attempts` から派生データを計算する（設計書 5.4 節）。`attempts` は記録した順（自動採番の順）に並んでいること。
 * 集計の規則は `recordAnswer` と同じ（後に記録した回答を「最後の回答」とする）。
 * `sessions` は `answered`・`correct` だけを数え直し、他の項目はそのまま。回答の無いセッションは 0 件になる。
 */
function deriveProgress(
  attempts: readonly Attempt[],
  sessions: readonly Session[],
  dateKey: (date: Date) => string,
): DerivedProgress {
  const stats = new Map<string, EventStats>();
  const counts = new Map<string, { answered: number; correct: number }>();
  const days = new Set<string>();
  for (const attempt of attempts) {
    const key = statsKey(attempt.eventId, attempt.pattern);
    const previous = stats.get(key);
    stats.set(key, {
      eventId: attempt.eventId,
      pattern: attempt.pattern,
      attempts: (previous?.attempts ?? 0) + 1,
      correct: (previous?.correct ?? 0) + (attempt.correct ? 1 : 0),
      lastAnsweredAt: attempt.answeredAt,
      lastCorrect: attempt.correct,
      lastWrongAt: attempt.correct ? (previous?.lastWrongAt ?? null) : attempt.answeredAt,
    });
    const count = counts.get(attempt.sessionId) ?? { answered: 0, correct: 0 };
    counts.set(attempt.sessionId, {
      answered: count.answered + 1,
      correct: count.correct + (attempt.correct ? 1 : 0),
    });
    days.add(dateKey(new Date(attempt.answeredAt)));
  }
  return {
    stats: [...stats.values()],
    sessions: sessions.map((session) => ({
      ...session,
      ...(counts.get(session.id) ?? { answered: 0, correct: 0 }),
    })),
    studyDays: [...days].sort(),
  };
}

type RebuildTransaction = IDBPTransaction<
  QLoopSchema,
  ['attempts', 'eventStats', 'sessions', 'meta'],
  'readwrite'
>;

/** 開いているトランザクションの中で `attempts` を全件読み、派生データを計算して書き直す。 */
async function rebuildInTransaction(
  tx: RebuildTransaction,
  dateKey: (date: Date) => string,
): Promise<DerivedProgress> {
  const statsStore = tx.objectStore('eventStats');
  const sessionStore = tx.objectStore('sessions');
  const [attempts, sessions] = await Promise.all([
    tx.objectStore('attempts').getAll(),
    sessionStore.getAll(),
  ]);
  const derived = deriveProgress(attempts, sessions.map(normalizeSession), dateKey);
  await statsStore.clear();
  await Promise.all([
    ...derived.stats.map((record) => statsStore.put(record)),
    ...derived.sessions.map((session) => sessionStore.put(session)),
    tx.objectStore('meta').put({ key: 'studyDays', value: derived.studyDays }),
  ]);
  return derived;
}

interface TransactionLike {
  readonly done: Promise<void>;
  abort(): void;
}

/**
 * トランザクションの中で `body` を実行し、完了（コミット）まで待つ。
 * 途中で例外が出たらトランザクションを中止し、書きかけの内容を確定させずに例外を投げ直す。
 */
async function inTransaction<T>(tx: TransactionLike, body: () => Promise<T>): Promise<T> {
  try {
    const result = await body();
    await tx.done;
    return result;
  } catch (error) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // 既に中止または完了している
    }
    throw error;
  }
}
