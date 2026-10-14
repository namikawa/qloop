import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deckModel } from '../core/decks';
import type {
  EnglishSettings,
  Attempt,
  Era,
  Event,
  Pattern,
  Session,
  Settings,
} from '../core/models';
import { generateReviewSession, needsReview, reviewCandidates } from '../core/review';
import { summarizeStats } from '../core/stats';
import { openDb, type QLoopDb, type StoredEventStats, type StoredSession } from './db';
import { ProgressStore, type StartSessionInput } from './progress-store';
import { ImportFormatError, parseProgressExport, type ProgressExport } from './transfer';

let dbCount = 0;
let dbName: string;
let openedDbs: QLoopDb[];
/** セッションの id の通し番号（同じテストの中で作り直したストアでも重ならないようにする）。 */
let idCount: number;
/** テストの現在時刻。`advance` で進める。 */
let current: Date;

beforeEach(() => {
  dbName = `qloop-test-${++dbCount}`;
  openedDbs = [];
  idCount = 0;
  current = new Date('2026-10-11T01:00:00.000Z');
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of openedDbs) {
    db.close();
  }
});

function advance(ms: number): void {
  current = new Date(current.getTime() + ms);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function open(): Promise<QLoopDb> {
  const db = await openDb(dbName);
  openedDbs.push(db);
  return db;
}

/** 固定の時刻と暦（UTC の暦日）を使う ProgressStore を作り、読み込む。 */
async function createStore(db?: QLoopDb): Promise<{ store: ProgressStore; db: QLoopDb }> {
  const database = db ?? (await open());
  const store = new ProgressStore({
    db: database,
    now: () => current,
    dateKey: (date) => date.toISOString().slice(0, 10),
    newId: () => `session-${++idCount}`,
  });
  await store.load();
  return { store, db: database };
}

/** 日本史年表の教材の id（1.0 の記録はこの教材のものとして読む）。 */
const HISTORY = 'japanese-history';

const NORMAL: StartSessionInput = {
  deckId: HISTORY,
  mode: 'normal',
  pattern: 'mixed',
  range: { kind: 'all' },
  total: 10,
};

describe('ProgressStore.startSession', () => {
  it('sessions に未終了のレコードを作る', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    expect(session).toEqual({
      id: session.id,
      deckId: HISTORY,
      mode: 'normal',
      pattern: 'mixed',
      range: { kind: 'all' },
      startedAt: '2026-10-11T01:00:00.000Z',
      endedAt: null,
      total: 10,
      answered: 0,
      correct: 0,
    });
    expect(await db.get('sessions', session.id)).toEqual(session);
    expect(store.getSession(session.id)).toEqual(session);
  });

  it('既定の id は UUID', async () => {
    const db = await open();
    const store = new ProgressStore({ db });
    await store.load();
    const session = await store.startSession(NORMAL);
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('ProgressStore.recordAnswer', () => {
  it('連続正解数は項目 × パターンごとに数え、通常と復習を通算し、不正解（わからないを含む）で 0 に戻す', async () => {
    const { store, db } = await createStore();
    const normal = await store.startSession({ ...NORMAL, deckId: 'japanese-vocabulary' });
    await answer(store, normal.id, 'jv-0001', 'meaningChoice', false);
    expect(store.getEventStats('jv-0001', 'meaningChoice')?.consecutiveCorrect).toBe(0);
    await answer(store, normal.id, 'jv-0001', 'meaningChoice', true);
    expect(store.getEventStats('jv-0001', 'meaningChoice')?.consecutiveCorrect).toBe(1);
    await answer(store, normal.id, 'jv-0001', 'wordChoice', true);
    await answer(store, normal.id, 'jv-0002', 'meaningChoice', true, true);
    expect(store.getEventStats('jv-0001', 'meaningChoice')?.consecutiveCorrect).toBe(1);

    const review = await store.startSession({
      deckId: 'japanese-vocabulary',
      mode: 'review',
      pattern: null,
      range: null,
      total: 3,
    });
    await answer(store, review.id, 'jv-0001', 'meaningChoice', true);
    expect(store.getEventStats('jv-0001', 'meaningChoice')?.consecutiveCorrect).toBe(2);
    // 「わからない」も correct: false として保存する
    await answer(store, review.id, 'jv-0001', 'meaningChoice', false);
    expect(store.getEventStats('jv-0001', 'meaningChoice')?.consecutiveCorrect).toBe(0);
    await answer(store, review.id, 'jv-0001', 'meaningChoice', true, true);
    expect(store.getEventStats('jv-0001', 'meaningChoice')?.consecutiveCorrect).toBe(1);
    expect(store.getEventStats('jv-0001', 'wordChoice')?.consecutiveCorrect).toBe(1);
    expect(store.getEventStats('jv-0002', 'meaningChoice')?.consecutiveCorrect).toBe(1);
    expect(byKey(await db.getAll('eventStats'))).toEqual(byKey(store.listEventStats()));
  });

  it('復習から外れた組もまた間違えると連続正解数が 0 に戻り、候補に戻る', async () => {
    const { store } = await createStore();
    const session = await store.startSession(NORMAL);
    await answer(store, session.id, 'jh-0001', 'yearInput', false);
    advance(DAY);
    await answer(store, session.id, 'jh-0001', 'yearInput', true);
    await answer(store, session.id, 'jh-0001', 'yearInput', true);
    const dateKey = (date: Date) => date.toISOString().slice(0, 10);
    expect(needsReview(store.getEventStats('jh-0001', 'yearInput')!, current, dateKey)).toBe(false);
    await answer(store, session.id, 'jh-0001', 'yearInput', false);
    expect(store.getEventStats('jh-0001', 'yearInput')?.consecutiveCorrect).toBe(0);
    expect(needsReview(store.getEventStats('jh-0001', 'yearInput')!, current, dateKey)).toBe(true);
  });

  it('直前の集計に連続正解数が無ければ 0 とみなして加算する', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    await answer(store, session.id, 'jh-0001', 'yearInput', true);
    await answer(store, session.id, 'jh-0001', 'yearInput', true);
    const legacy: StoredEventStats = { ...store.getEventStats('jh-0001', 'yearInput')! };
    delete legacy.consecutiveCorrect;
    await db.put('eventStats', legacy);
    await answer(store, session.id, 'jh-0001', 'yearInput', true);
    expect(store.getEventStats('jh-0001', 'yearInput')?.consecutiveCorrect).toBe(1);
    expect((await db.get('eventStats', ['jh-0001', 'yearInput']))?.consecutiveCorrect).toBe(1);
  });

  it('1 回の呼び出しで attempts・eventStats・sessions・meta を更新する', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    advance(1000);
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0005',
      pattern: 'yearInput',
      correct: false,
      endSession: false,
    });

    const answeredAt = '2026-10-11T01:00:01.000Z';
    expect(await db.getAll('attempts')).toEqual([
      {
        id: 1,
        eventId: 'demo-0005',
        pattern: 'yearInput',
        correct: false,
        answeredAt,
        sessionId: session.id,
      },
    ]);
    expect(await db.get('eventStats', ['demo-0005', 'yearInput'])).toEqual({
      eventId: 'demo-0005',
      pattern: 'yearInput',
      attempts: 1,
      correct: 0,
      lastAnsweredAt: answeredAt,
      lastCorrect: false,
      lastWrongAt: answeredAt,
      consecutiveCorrect: 0,
    });
    expect(await db.get('sessions', session.id)).toMatchObject({
      answered: 1,
      correct: 0,
      endedAt: null,
    });
    expect(await db.get('meta', 'studyDays')).toEqual({ key: 'studyDays', value: ['2026-10-11'] });
  });

  it('メモリ上の状態も保存した内容と同じになる', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0005',
      pattern: 'choice',
      correct: true,
      endSession: false,
    });
    expect(store.getEventStats('demo-0005', 'choice')).toEqual(
      await db.get('eventStats', ['demo-0005', 'choice']),
    );
    expect(store.listEventStats()).toEqual(await db.getAll('eventStats'));
    expect(store.getSession(session.id)).toEqual(await db.get('sessions', session.id));
    expect(store.getStudyDays()).toEqual(['2026-10-11']);
  });

  it('eventStats は出来事 × パターンごとに回答数・正解数・最終回答・最終不正解を集計する', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession({ ...NORMAL, total: 20 });
    const answer = async (pattern: 'yearInput' | 'choice', correct: boolean) => {
      advance(HOUR);
      await store.recordAnswer({
        sessionId: session.id,
        eventId: 'demo-0007',
        pattern,
        correct,
        endSession: false,
      });
    };
    await answer('yearInput', true); // 02:00
    await answer('yearInput', false); // 03:00
    await answer('yearInput', true); // 04:00
    await answer('choice', true); // 05:00

    const yearInput = {
      eventId: 'demo-0007',
      pattern: 'yearInput',
      attempts: 3,
      correct: 2,
      lastAnsweredAt: '2026-10-11T04:00:00.000Z',
      lastCorrect: true,
      lastWrongAt: '2026-10-11T03:00:00.000Z',
      consecutiveCorrect: 1,
    };
    expect(await db.get('eventStats', ['demo-0007', 'yearInput'])).toEqual(yearInput);
    expect(store.getEventStats('demo-0007', 'yearInput')).toEqual(yearInput);

    const choice = {
      eventId: 'demo-0007',
      pattern: 'choice',
      attempts: 1,
      correct: 1,
      lastAnsweredAt: '2026-10-11T05:00:00.000Z',
      lastCorrect: true,
      lastWrongAt: null,
      consecutiveCorrect: 1,
    };
    expect(await db.get('eventStats', ['demo-0007', 'choice'])).toEqual(choice);
    expect(store.getEventStats('demo-0007', 'choice')).toEqual(choice);
    expect(await db.count('attempts')).toBe(4);
  });

  it('sessions の answered・correct を数え、最後の問題の回答で endedAt を記録する', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession({ ...NORMAL, total: 3 });
    const results = [true, false, true];
    for (const [index, correct] of results.entries()) {
      advance(1000);
      await store.recordAnswer({
        sessionId: session.id,
        eventId: `demo-000${index + 1}`,
        pattern: 'choice',
        correct,
        endSession: index === results.length - 1,
      });
      const saved = await db.get('sessions', session.id);
      expect(saved?.answered).toBe(index + 1);
      expect(saved?.endedAt).toBe(index === results.length - 1 ? '2026-10-11T01:00:03.000Z' : null);
    }
    const expected = { ...session, answered: 3, correct: 2, endedAt: '2026-10-11T01:00:03.000Z' };
    expect(await db.get('sessions', session.id)).toEqual(expected);
    expect(store.getSession(session.id)).toEqual(expected);
    // 最後の回答と endedAt は同じトランザクションで書く（attempts の時刻と一致する）
    const attempts = await db.getAllFromIndex('attempts', 'bySession', session.id);
    expect(attempts.at(-1)?.answeredAt).toBe(expected.endedAt);
  });

  it('studyDays には回答のあった暦日を重複なく昇順で入れる', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession({ ...NORMAL, total: 20 });
    const answer = () =>
      store.recordAnswer({
        sessionId: session.id,
        eventId: 'demo-0001',
        pattern: 'choice',
        correct: true,
        endSession: false,
      });
    await answer(); // 2026-10-11
    advance(HOUR);
    await answer(); // 同じ日
    advance(2 * DAY);
    await answer(); // 2026-10-13
    expect(store.getStudyDays()).toEqual(['2026-10-11', '2026-10-13']);
    expect(await db.get('meta', 'studyDays')).toEqual({
      key: 'studyDays',
      value: ['2026-10-11', '2026-10-13'],
    });
  });

  it('学習日は注入した暦（dateKey）で決める', async () => {
    const db = await open();
    // 端末のタイムゾーンを UTC+9 とみなす暦
    const store = new ProgressStore({
      db,
      now: () => current,
      dateKey: (date) => new Date(date.getTime() + 9 * HOUR).toISOString().slice(0, 10),
    });
    await store.load();
    const session = await store.startSession(NORMAL);
    current = new Date('2026-10-11T15:30:00.000Z'); // UTC+9 では 10 月 12 日 0:30
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0001',
      pattern: 'choice',
      correct: true,
      endSession: false,
    });
    expect(store.getStudyDays()).toEqual(['2026-10-12']);
    // 時刻は UTC で保存する
    expect((await db.getAll('attempts'))[0].answeredAt).toBe('2026-10-11T15:30:00.000Z');
  });

  it('セッションが見つからなければ例外を投げ、どのストアにも書かない', async () => {
    const { store, db } = await createStore();
    await expect(
      store.recordAnswer({
        sessionId: 'missing',
        eventId: 'demo-0001',
        pattern: 'choice',
        correct: false,
        endSession: false,
      }),
    ).rejects.toThrow();
    expect(await db.count('attempts')).toBe(0);
    expect(await db.count('eventStats')).toBe(0);
    expect(await db.get('meta', 'studyDays')).toBeUndefined();
    expect(store.listEventStats()).toEqual([]);
    expect(store.getStudyDays()).toEqual([]);
  });

  it('書き込みに失敗したら例外を投げ、メモリ上の状態は変えない', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    db.close();
    await expect(
      store.recordAnswer({
        sessionId: session.id,
        eventId: 'demo-0001',
        pattern: 'choice',
        correct: true,
        endSession: false,
      }),
    ).rejects.toThrow();
    expect(store.getSession(session.id)).toEqual(session);
    expect(store.listEventStats()).toEqual([]);
  });
});

describe('ProgressStore.endSession', () => {
  it('途中終了で endedAt を記録する（回答済みの分は残る）', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0001',
      pattern: 'choice',
      correct: true,
      endSession: false,
    });
    advance(60_000);
    await store.endSession(session.id);
    const expected = { ...session, answered: 1, correct: 1, endedAt: '2026-10-11T01:01:00.000Z' };
    expect(await db.get('sessions', session.id)).toEqual(expected);
    expect(store.getSession(session.id)).toEqual(expected);
    expect(await db.count('attempts')).toBe(1);
  });

  it('終了済みのセッションでは endedAt を変えない', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession({ ...NORMAL, total: 1 });
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0001',
      pattern: 'choice',
      correct: true,
      endSession: true,
    });
    advance(60_000);
    await store.endSession(session.id);
    expect((await db.get('sessions', session.id))?.endedAt).toBe('2026-10-11T01:00:00.000Z');
  });
});

describe('別の画面の起動で回答前のセッションが削除されたとき', () => {
  it('recordAnswer はメモリ上のセッションを書き戻してから記録する', async () => {
    const first = await createStore();
    const session = await first.store.startSession(NORMAL);
    // 別の画面（同じデータベースを開く 2 つ目のストア）の起動時の掃除で、回答前のセッションが消える
    await createStore(first.db);
    expect(await first.db.get('sessions', session.id)).toBeUndefined();

    advance(1000);
    await first.store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0001',
      pattern: 'choice',
      correct: true,
      endSession: false,
    });
    const expected = { ...session, answered: 1, correct: 1 };
    expect(await first.db.get('sessions', session.id)).toEqual(expected);
    expect(first.store.getSession(session.id)).toEqual(expected);
    expect(await first.db.count('attempts')).toBe(1);
  });

  it('endSession はメモリ上のセッションを書き戻して endedAt を記録する', async () => {
    const first = await createStore();
    const session = await first.store.startSession(NORMAL);
    await createStore(first.db);
    expect(await first.db.get('sessions', session.id)).toBeUndefined();

    advance(1000);
    await first.store.endSession(session.id);
    const expected = { ...session, endedAt: '2026-10-11T01:00:01.000Z' };
    expect(await first.db.get('sessions', session.id)).toEqual(expected);
    expect(first.store.getSession(session.id)).toEqual(expected);
  });
});

describe('ProgressStore.load', () => {
  it('連続正解数の無い集計が 1 件でもあれば attempts から数え直し、保存して次の load では数え直さない', async () => {
    const first = await createStore();
    const { second } = await seed(first.store);
    await answer(first.store, second.id, 'jh-0001', 'yearInput', true, true);
    const expected = byKey(first.store.listEventStats());
    const legacy: StoredEventStats = { ...first.store.getEventStats('jh-0001', 'yearInput')! };
    delete legacy.consecutiveCorrect;
    await first.db.put('eventStats', legacy);
    const store = new ProgressStore({
      db: first.db,
      dateKey: (date) => date.toISOString().slice(0, 10),
    });
    const rebuild = vi.spyOn(store, 'rebuild');

    await store.load();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(store.getEventStats('jh-0001', 'yearInput')?.consecutiveCorrect).toBe(2);
    expect(byKey(store.listEventStats())).toEqual(expected);
    expect(byKey(await first.db.getAll('eventStats'))).toEqual(expected);

    await store.load();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(byKey(store.listEventStats())).toEqual(expected);
    const reloaded = await createStore(first.db);
    expect(byKey(reloaded.store.listEventStats())).toEqual(expected);
  });

  it('数え直しに失敗しても load は成功し、メモリだけで無い値を 0 とみなし、次の起動で再試行する', async () => {
    const first = await createStore();
    await seed(first.store);
    const legacy: StoredEventStats = { ...first.store.getEventStats('jh-0001', 'yearInput')! };
    delete legacy.consecutiveCorrect;
    await first.db.put('eventStats', legacy);
    const before = await first.db.getAll('eventStats');
    const store = new ProgressStore({
      db: first.db,
      dateKey: () => {
        throw new Error('暦の計算に失敗');
      },
    });

    await expect(store.load()).resolves.toBeUndefined();
    expect(store.getEventStats('jh-0001', 'yearInput')).toEqual({
      ...legacy,
      consecutiveCorrect: 0,
    });
    expect(store.getEventStats('jh-0001', 'choice')?.consecutiveCorrect).toBe(1);
    expect(store.listSessions()).toEqual(first.store.listSessions());
    expect(store.getStudyDays()).toEqual(first.store.getStudyDays());
    expect(await first.db.getAll('eventStats')).toEqual(before);

    const retried = await createStore(first.db);
    expect(retried.store.getEventStats('jh-0001', 'yearInput')?.consecutiveCorrect).toBe(1);
    expect((await first.db.get('eventStats', ['jh-0001', 'yearInput']))?.consecutiveCorrect).toBe(
      1,
    );
  });

  it('未終了で回答が 0 件のセッションを削除し、中断（回答あり）と終了済みは残す', async () => {
    const first = await createStore();
    const empty = await first.store.startSession(NORMAL);
    const interrupted = await first.store.startSession(NORMAL);
    await first.store.recordAnswer({
      sessionId: interrupted.id,
      eventId: 'demo-0001',
      pattern: 'choice',
      correct: true,
      endSession: false,
    });
    const endedEmpty = await first.store.startSession(NORMAL);
    await first.store.endSession(endedEmpty.id);

    const { store, db } = await createStore(first.db);
    expect(await db.get('sessions', empty.id)).toBeUndefined();
    expect(store.getSession(empty.id)).toBeUndefined();
    expect(store.getSession(interrupted.id)).toMatchObject({ answered: 1, endedAt: null });
    expect(store.getSession(endedEmpty.id)).toMatchObject({ answered: 0 });
    expect(store.listSessions().map((session) => session.id)).toEqual([
      interrupted.id,
      endedEmpty.id,
    ]);
  });

  it('attempts は読まず、eventStats・sessions・meta をメモリに持つ', async () => {
    const first = await createStore();
    const session = await first.store.startSession(NORMAL);
    await first.store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0003',
      pattern: 'choice',
      correct: false,
      endSession: true,
    });
    const { store } = await createStore(first.db);
    expect(store.listEventStats()).toEqual(first.store.listEventStats());
    expect(store.listSessions()).toEqual(first.store.listSessions());
    expect(store.getStudyDays()).toEqual(['2026-10-11']);
  });
});

describe('ProgressStore の設定', () => {
  const settings: Settings = {
    scope: 'all',
    pattern: 'choice',
    count: 20,
    range: { kind: 'years', from: 700, to: null },
  };

  it('保存した設定を読み込み直しても同じ内容で返す', async () => {
    const first = await createStore();
    expect(first.store.getSettings(HISTORY)).toBeNull();
    await first.store.saveSettings(HISTORY, settings);
    expect(first.store.getSettings(HISTORY)).toEqual(settings);

    const { store } = await createStore(first.db);
    expect(store.getSettings(HISTORY)).toEqual(settings);

    const next: Settings = {
      scope: 'core',
      pattern: 'mixed',
      count: 'all',
      range: { kind: 'eras', eras: ['江戸'] },
    };
    await store.saveSettings(HISTORY, next);
    const again = await createStore(first.db);
    expect(again.store.getSettings(HISTORY)).toEqual(next);
  });

  it('scope の無い（PR 3 より前の）設定は、基本の年表のみ（core）として読む', async () => {
    const db = await open();
    await db.put('meta', {
      key: 'settings',
      value: { pattern: 'choice', count: 20, range: { kind: 'all' } },
    });
    const { store } = await createStore(db);
    expect(store.getSettings(HISTORY)).toEqual({
      scope: 'core',
      pattern: 'choice',
      count: 20,
      range: { kind: 'all' },
    });
  });
});

describe('データベースの開き直し', () => {
  it('閉じて開き直しても記録が残る', async () => {
    const first = await createStore();
    const session = await first.store.startSession({ ...NORMAL, total: 2 });
    await first.store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0001',
      pattern: 'yearInput',
      correct: true,
      endSession: false,
    });
    await first.store.recordAnswer({
      sessionId: session.id,
      eventId: 'demo-0002',
      pattern: 'choice',
      correct: false,
      endSession: true,
    });
    await first.store.saveSettings(HISTORY, {
      scope: 'core',
      pattern: 'yearInput',
      count: 10,
      range: { kind: 'all' },
    });
    first.db.close();

    const reopened = await open();
    const { store } = await createStore(reopened);
    expect(await reopened.count('attempts')).toBe(2);
    expect(store.getSession(session.id)).toMatchObject({ answered: 2, correct: 1 });
    expect(store.getEventStats('demo-0001', 'yearInput')).toMatchObject({
      attempts: 1,
      correct: 1,
    });
    expect(store.getEventStats('demo-0002', 'choice')).toMatchObject({ attempts: 1, correct: 0 });
    expect(store.getStudyDays()).toEqual(['2026-10-11']);
    expect(store.getSettings(HISTORY)).toEqual({
      scope: 'core',
      pattern: 'yearInput',
      count: 10,
      range: { kind: 'all' },
    });
    // 自動採番は続きから振られる
    const next = await store.startSession(NORMAL);
    await store.recordAnswer({
      sessionId: next.id,
      eventId: 'demo-0003',
      pattern: 'choice',
      correct: true,
      endSession: false,
    });
    expect((await reopened.getAll('attempts')).map((attempt) => attempt.id)).toEqual([1, 2, 3]);
  });
});

/** 1 回答を記録する（テストを短く書くための補助）。 */
function answer(
  store: ProgressStore,
  sessionId: string,
  eventId: string,
  pattern: Pattern,
  correct: boolean,
  endSession = false,
): Promise<void> {
  return store.recordAnswer({ sessionId, eventId, pattern, correct, endSession });
}

/** 2 つのセッション・2 日にまたがる記録を作る。 */
async function seed(store: ProgressStore): Promise<{ first: Session; second: Session }> {
  const first = await store.startSession({ ...NORMAL, total: 3 });
  advance(1000);
  await answer(store, first.id, 'jh-0001', 'yearInput', false);
  advance(1000);
  await answer(store, first.id, 'jh-0001', 'choice', true);
  advance(1000);
  await answer(store, first.id, 'jh-0002', 'yearInput', true, true);
  advance(DAY);
  const second = await store.startSession({
    deckId: HISTORY,
    mode: 'review',
    pattern: null,
    range: null,
    total: 2,
  });
  advance(1000);
  await answer(store, second.id, 'jh-0001', 'yearInput', true);
  advance(1000);
  await answer(store, second.id, 'jh-0002', 'yearInput', false);
  return { first, second };
}

const byKey = <T extends { eventId: string; pattern: string }>(records: T[]) =>
  [...records].sort((a, b) =>
    `${a.eventId}:${a.pattern}`.localeCompare(`${b.eventId}:${b.pattern}`),
  );
const byId = <T extends { id: string }>(sessions: T[]) =>
  [...sessions].sort((a, b) => a.id.localeCompare(b.id));

describe('ProgressStore.rebuild', () => {
  it('連続正解数は時刻順でなく attempts の記録した順に数え、パターンごとに不正解で 0 に戻す', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    for (const [index, correct] of [true, true, false, true, true, true].entries()) {
      // 時計が戻っても自動採番の順で数える
      current = new Date(`2026-10-${20 - index}T01:00:00.000Z`);
      await answer(store, session.id, 'jh-0001', 'yearInput', correct);
    }
    await answer(store, session.id, 'jh-0001', 'choice', true);
    await answer(store, session.id, 'jh-0001', 'choice', false, true);
    await db.clear('eventStats');
    await store.rebuild();
    expect(store.getEventStats('jh-0001', 'yearInput')).toMatchObject({
      consecutiveCorrect: 3,
      lastAnsweredAt: '2026-10-15T01:00:00.000Z',
      lastWrongAt: '2026-10-18T01:00:00.000Z',
    });
    expect(store.getEventStats('jh-0001', 'choice')?.consecutiveCorrect).toBe(0);
    expect(byKey(await db.getAll('eventStats'))).toEqual(byKey(store.listEventStats()));
  });

  it('attempts から eventStats・sessions の件数・studyDays を復元する（他の項目と設定はそのまま）', async () => {
    const { store, db } = await createStore();
    await seed(store);
    const settings: Settings = {
      scope: 'all',
      pattern: 'choice',
      count: 20,
      range: { kind: 'all' },
    };
    await store.saveSettings(HISTORY, settings);
    await store.saveLastDeck(HISTORY);
    const expectedStats = byKey(await db.getAll('eventStats'));
    const expectedSessions = byId(await db.getAll('sessions'));
    expect(expectedSessions).toHaveLength(2);

    // 派生データを壊す
    await db.clear('eventStats');
    for (const session of expectedSessions) {
      await db.put('sessions', { ...session, answered: 99, correct: 99 });
    }
    await db.put('meta', { key: 'studyDays', value: [] });

    await store.rebuild();
    expect(byKey(await db.getAll('eventStats'))).toEqual(expectedStats);
    expect(byId(await db.getAll('sessions'))).toEqual(expectedSessions);
    expect(await db.get('meta', 'studyDays')).toEqual({
      key: 'studyDays',
      value: ['2026-10-11', '2026-10-12'],
    });
    expect(byKey(store.listEventStats())).toEqual(expectedStats);
    expect(byId(store.listSessions())).toEqual(expectedSessions);
    expect(store.getStudyDays()).toEqual(['2026-10-11', '2026-10-12']);
    expect(store.getSettings(HISTORY)).toEqual(settings);
    expect(store.getLastDeck()).toBe(HISTORY);
  });

  it('最後の回答・最後の不正解は記録した順で決め、回答の無いセッションは 0 件にする', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    const empty = await store.startSession(NORMAL);
    await store.endSession(empty.id);
    await db.put('sessions', { ...(await db.get('sessions', empty.id))!, answered: 3 });
    advance(HOUR);
    await answer(store, session.id, 'jh-0003', 'yearInput', false); // 02:00
    advance(HOUR);
    await answer(store, session.id, 'jh-0003', 'yearInput', true); // 03:00
    await db.clear('eventStats');

    await store.rebuild();
    expect(store.getEventStats('jh-0003', 'yearInput')).toEqual({
      eventId: 'jh-0003',
      pattern: 'yearInput',
      attempts: 2,
      correct: 1,
      lastAnsweredAt: '2026-10-11T03:00:00.000Z',
      lastCorrect: true,
      lastWrongAt: '2026-10-11T02:00:00.000Z',
      consecutiveCorrect: 1,
    });
    expect(store.getSession(empty.id)).toMatchObject({ answered: 0, correct: 0 });
    expect((await db.get('sessions', empty.id))?.answered).toBe(0);
  });

  it('現在のデータに無い eventId の回答も再計算に含める', async () => {
    const { store, db } = await createStore();
    const session = await store.startSession(NORMAL);
    await answer(store, session.id, 'demo-0001', 'choice', false);
    await db.clear('eventStats');
    await store.rebuild();
    expect(store.getEventStats('demo-0001', 'choice')).toMatchObject({ attempts: 1, correct: 0 });
    expect(store.getSession(session.id)).toMatchObject({ answered: 1, correct: 0 });
  });

  it('学習日は注入した暦（dateKey）で数え直す', async () => {
    const db = await open();
    const store = new ProgressStore({
      db,
      now: () => current,
      // 端末のタイムゾーンを UTC+9 とみなす暦
      dateKey: (date) => new Date(date.getTime() + 9 * HOUR).toISOString().slice(0, 10),
      newId: () => `session-${++idCount}`,
    });
    await store.load();
    const session = await store.startSession(NORMAL);
    current = new Date('2026-10-11T14:59:00.000Z'); // UTC+9 では 10 月 11 日 23:59
    await answer(store, session.id, 'jh-0001', 'choice', true);
    current = new Date('2026-10-11T15:01:00.000Z'); // UTC+9 では 10 月 12 日 0:01
    await answer(store, session.id, 'jh-0001', 'choice', true);
    await db.put('meta', { key: 'studyDays', value: [] });
    await store.rebuild();
    expect(store.getStudyDays()).toEqual(['2026-10-11', '2026-10-12']);
  });
});

describe('ProgressStore.exportData と importData', () => {
  it.each([1, 2])(
    '版 %i の書き出しファイルを復元すると、連続正解数も組ごとに作り直す',
    async (version) => {
      const source = await createStore();
      const { second } = await seed(source.store);
      await answer(source.store, second.id, 'jh-0001', 'yearInput', true, true);
      const data = await source.store.exportData();
      const sessions =
        version === 1
          ? data.sessions.map((session) => {
              const legacy: StoredSession = { ...session };
              delete legacy.deckId;
              return legacy;
            })
          : data.sessions;
      dbName = `${dbName}-target`;
      const target = await createStore();
      await target.store.importData({ ...data, schemaVersion: version, sessions });
      expect(target.store.getEventStats('jh-0001', 'yearInput')?.consecutiveCorrect).toBe(2);
      expect(target.store.getEventStats('jh-0002', 'yearInput')?.consecutiveCorrect).toBe(0);
      expect(byKey(target.store.listEventStats())).toEqual(byKey(source.store.listEventStats()));
      expect(byKey(await target.db.getAll('eventStats'))).toEqual(
        byKey(source.store.listEventStats()),
      );
    },
  );

  it('書き出しは schemaVersion・書き出した時刻・attempts の全件・sessions を返す', async () => {
    const { store, db } = await createStore();
    const { first, second } = await seed(store);
    const data = await store.exportData();
    expect(data.schemaVersion).toBe(2);
    expect(data.exportedAt).toBe(current.toISOString());
    expect(data.attempts).toEqual(await db.getAll('attempts'));
    expect(data.attempts.map((attempt) => attempt.id)).toEqual([1, 2, 3, 4, 5]);
    expect(byId(data.sessions)).toEqual(
      byId([store.getSession(first.id)!, store.getSession(second.id)!]),
    );
  });

  it('書き出した JSON を別の端末で読み込むと、同じ記録と集計になる', async () => {
    const source = await createStore();
    await seed(source.store);
    const json = JSON.stringify(await source.store.exportData());

    dbName = `${dbName}-target`;
    const target = await createStore();
    await target.store.importData(JSON.parse(json));

    const stripId = (attempts: Attempt[]) =>
      attempts.map(({ eventId, pattern, correct, answeredAt, sessionId }) => ({
        eventId,
        pattern,
        correct,
        answeredAt,
        sessionId,
      }));
    expect(stripId(await target.db.getAll('attempts'))).toEqual(
      stripId(await source.db.getAll('attempts')),
    );
    expect(byKey(await target.db.getAll('eventStats'))).toEqual(
      byKey(await source.db.getAll('eventStats')),
    );
    expect(byId(await target.db.getAll('sessions'))).toEqual(
      byId(await source.db.getAll('sessions')),
    );
    expect(await target.db.get('meta', 'studyDays')).toEqual(
      await source.db.get('meta', 'studyDays'),
    );
    expect(byKey(target.store.listEventStats())).toEqual(byKey(source.store.listEventStats()));
    expect(target.store.listSessions()).toEqual(source.store.listSessions());
    expect(target.store.getStudyDays()).toEqual(source.store.getStudyDays());
  });

  it('年号 4 択の回答は出来事 4 択と別に集計し、書き出して読み込んでも同じ集計になる', async () => {
    const source = await createStore();
    const session = await source.store.startSession({ ...NORMAL, pattern: 'yearChoice', total: 3 });
    await answer(source.store, session.id, 'jh-0001', 'yearChoice', false);
    await answer(source.store, session.id, 'jh-0001', 'choice', true);
    await answer(source.store, session.id, 'jh-0001', 'yearChoice', true, true);
    expect(source.store.getEventStats('jh-0001', 'yearChoice')).toMatchObject({
      attempts: 2,
      correct: 1,
    });
    expect(source.store.getEventStats('jh-0001', 'choice')).toMatchObject({
      attempts: 1,
      correct: 1,
    });
    const json = JSON.stringify(await source.store.exportData());

    dbName = `${dbName}-target`;
    const target = await createStore();
    await target.store.importData(JSON.parse(json));
    expect(byKey(target.store.listEventStats())).toEqual(byKey(source.store.listEventStats()));
    expect(target.store.listSessions()).toEqual(source.store.listSessions());
    expect(target.store.getSession(session.id)?.pattern).toBe('yearChoice');
  });

  it('読み込みは既存の記録と設定を消して全置換し、attempts の id は捨てて自動採番する', async () => {
    const { store, db } = await createStore();
    const old = await store.startSession(NORMAL);
    await answer(store, old.id, 'jh-0009', 'choice', true);
    await store.saveSettings(HISTORY, {
      scope: 'all',
      pattern: 'choice',
      count: 20,
      range: { kind: 'all' },
    });
    await store.saveLastDeck(HISTORY);

    const imported: ProgressExport = {
      schemaVersion: 2,
      exportedAt: '2026-10-01T00:00:00.000Z',
      attempts: [
        {
          id: 500,
          eventId: 'jh-0001',
          pattern: 'yearInput',
          correct: false,
          answeredAt: '2026-10-01T00:00:01.000Z',
          sessionId: 'imported',
        },
        {
          id: 7,
          eventId: 'jh-0001',
          pattern: 'yearInput',
          correct: true,
          answeredAt: '2026-10-01T00:00:02.000Z',
          sessionId: 'imported',
        },
      ],
      sessions: [
        {
          id: 'imported',
          deckId: HISTORY,
          mode: 'normal',
          pattern: 'yearInput',
          range: { kind: 'years', from: 700, to: 1600 },
          startedAt: '2026-10-01T00:00:00.000Z',
          endedAt: null,
          total: 10,
          // 件数は attempts から数え直す
          answered: 0,
          correct: 0,
        },
      ],
    };
    await store.importData(imported);

    const attempts = await db.getAll('attempts');
    expect(attempts.map((attempt) => [attempt.id, attempt.correct])).toEqual([
      [2, false],
      [3, true],
    ]);
    expect(await db.getAll('sessions')).toEqual([
      { ...imported.sessions[0], answered: 2, correct: 1 },
    ]);
    expect(await db.getAll('eventStats')).toEqual([
      {
        eventId: 'jh-0001',
        pattern: 'yearInput',
        attempts: 2,
        correct: 1,
        lastAnsweredAt: '2026-10-01T00:00:02.000Z',
        lastCorrect: true,
        lastWrongAt: '2026-10-01T00:00:01.000Z',
        consecutiveCorrect: 1,
      },
    ]);
    expect(await db.get('meta', 'settings')).toBeUndefined();
    expect(await db.get('meta', `settings:${HISTORY}`)).toBeUndefined();
    expect(await db.get('meta', 'lastDeck')).toBeUndefined();
    expect(await db.get('meta', 'studyDays')).toEqual({ key: 'studyDays', value: ['2026-10-01'] });

    // メモリ上の状態も読み込んだ内容になる
    expect(store.getEventStats('jh-0009', 'choice')).toBeUndefined();
    expect(store.getEventStats('jh-0001', 'yearInput')).toMatchObject({ attempts: 2, correct: 1 });
    expect(store.getSession(old.id)).toBeUndefined();
    expect(store.listSessions()).toEqual([{ ...imported.sessions[0], answered: 2, correct: 1 }]);
    expect(store.getStudyDays()).toEqual(['2026-10-01']);
    expect(store.getSettings(HISTORY)).toBeNull();
    expect(store.getLastDeck()).toBeNull();
  });

  it.each([
    [
      'schemaVersion が違う',
      { schemaVersion: 3, exportedAt: '2026-10-01T00:00:00.000Z', attempts: [], sessions: [] },
      /schemaVersion/,
    ],
    [
      'attempts が配列でない',
      { schemaVersion: 1, exportedAt: '2026-10-01T00:00:00.000Z', attempts: {}, sessions: [] },
      /attempts/,
    ],
    [
      'attempts の項目の型が合わない',
      {
        schemaVersion: 1,
        exportedAt: '2026-10-01T00:00:00.000Z',
        attempts: [
          {
            eventId: 'jh-0001',
            pattern: 'yearInput',
            correct: 'yes',
            answeredAt: '2026-10-01T00:00:01.000Z',
            sessionId: 's',
          },
        ],
        sessions: [],
      },
      /attempts の 1 件目: correct/,
    ],
    ['オブジェクトでない', 'hello', /形式ではありません/],
  ])('形式が不正（%s）なら理由を含む例外を投げ、何も変えない', async (_label, data, reason) => {
    const { store, db } = await createStore();
    await seed(store);
    await store.saveSettings(HISTORY, {
      scope: 'all',
      pattern: 'choice',
      count: 20,
      range: { kind: 'all' },
    });
    const before = {
      attempts: await db.getAll('attempts'),
      stats: await db.getAll('eventStats'),
      sessions: await db.getAll('sessions'),
      meta: await db.getAll('meta'),
      memoryStats: store.listEventStats(),
      memorySessions: store.listSessions(),
    };

    const result = store.importData(data);
    await expect(result).rejects.toBeInstanceOf(ImportFormatError);
    await expect(result).rejects.toThrow(reason);

    expect(await db.getAll('attempts')).toEqual(before.attempts);
    expect(await db.getAll('eventStats')).toEqual(before.stats);
    expect(await db.getAll('sessions')).toEqual(before.sessions);
    expect(await db.getAll('meta')).toEqual(before.meta);
    expect(store.listEventStats()).toEqual(before.memoryStats);
    expect(store.listSessions()).toEqual(before.memorySessions);
    expect(store.getSettings(HISTORY)).toMatchObject({ scope: 'all' });
  });

  it('全置換の途中（再計算）で失敗したら、読み込み前の状態に戻る', async () => {
    const db = await open();
    let failDateKey = false;
    const store = new ProgressStore({
      db,
      now: () => current,
      dateKey: (date) => {
        if (failDateKey) {
          throw new Error('暦の計算に失敗');
        }
        return date.toISOString().slice(0, 10);
      },
      newId: () => `session-${++idCount}`,
    });
    await store.load();
    await seed(store);
    const data = await store.exportData();
    const before = {
      attempts: await db.getAll('attempts'),
      stats: await db.getAll('eventStats'),
      sessions: await db.getAll('sessions'),
      meta: await db.getAll('meta'),
    };

    failDateKey = true;
    await expect(store.importData(data)).rejects.toThrow('暦の計算に失敗');
    expect(await db.getAll('attempts')).toEqual(before.attempts);
    expect(await db.getAll('eventStats')).toEqual(before.stats);
    expect(await db.getAll('sessions')).toEqual(before.sessions);
    expect(await db.getAll('meta')).toEqual(before.meta);
    expect(byKey(store.listEventStats())).toEqual(byKey(before.stats));
  });
});

describe('ProgressStore.reset', () => {
  it('全ストアを空にし、メモリ上の状態も初期化する', async () => {
    const { store, db } = await createStore();
    await seed(store);
    await store.saveSettings(HISTORY, {
      scope: 'all',
      pattern: 'choice',
      count: 20,
      range: { kind: 'all' },
    });
    await store.saveLastDeck(HISTORY);

    await store.reset();
    expect(await db.count('attempts')).toBe(0);
    expect(await db.count('eventStats')).toBe(0);
    expect(await db.count('sessions')).toBe(0);
    expect(await db.count('meta')).toBe(0);
    expect(store.listEventStats()).toEqual([]);
    expect(store.listSessions()).toEqual([]);
    expect(store.getStudyDays()).toEqual([]);
    expect(store.getSettings(HISTORY)).toBeNull();
    expect(store.getLastDeck()).toBeNull();

    // リセットの後も記録を続けられる
    const session = await store.startSession(NORMAL);
    await answer(store, session.id, 'jh-0001', 'choice', true);
    expect(store.listEventStats()).toHaveLength(1);
    expect(await db.count('attempts')).toBe(1);
  });
});

/** データベースのセッションから `deckId` を消して、1.0 の記録と同じ形にする。 */
async function stripDeckIds(db: QLoopDb): Promise<void> {
  for (const session of await db.getAll('sessions')) {
    const legacy: StoredSession = { ...session };
    delete legacy.deckId;
    await db.put('sessions', legacy);
  }
}

/** 1.0 の形のセッション（`deckId` が無い）。 */
function legacySession(id: string, extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    mode: 'normal',
    pattern: 'yearInput',
    range: { kind: 'all' },
    startedAt: '2026-10-01T00:00:00.000Z',
    endedAt: '2026-10-01T00:05:00.000Z',
    total: 10,
    answered: 1,
    correct: 1,
    ...extra,
  };
}

describe('1.0 の記録（deckId の無いセッション）', () => {
  it('IndexedDB から読むと、deckId は日本史年表（japanese-history）になる', async () => {
    const db = await open();
    await db.put('sessions', legacySession('legacy'));
    const { store } = await createStore(db);
    expect(store.getSession('legacy')).toEqual({ ...legacySession('legacy'), deckId: HISTORY });
    expect(store.listSessions().map((session) => session.deckId)).toEqual([HISTORY]);
  });

  it('回答・途中終了で書き戻すときに deckId を補う', async () => {
    const db = await open();
    await db.put('sessions', legacySession('answering', { endedAt: null, total: 3 }));
    await db.put('sessions', legacySession('ending', { endedAt: null }));
    const { store } = await createStore(db);

    await answer(store, 'answering', 'jh-0001', 'choice', true);
    expect(await db.get('sessions', 'answering')).toMatchObject({ deckId: HISTORY, answered: 2 });
    expect(store.getSession('answering')).toMatchObject({ deckId: HISTORY, answered: 2 });

    await store.endSession('ending');
    expect(await db.get('sessions', 'ending')).toMatchObject({
      deckId: HISTORY,
      endedAt: current.toISOString(),
    });
    expect(store.getSession('ending')?.deckId).toBe(HISTORY);
  });

  it('再計算でも deckId を補い、書き出しは版 2 で各セッションに deckId を入れる', async () => {
    const { store, db } = await createStore();
    await seed(store);
    await stripDeckIds(db);
    const reloaded = await createStore(db);

    const data = await reloaded.store.exportData();
    expect(data.schemaVersion).toBe(2);
    expect(data.sessions.map((session) => session.deckId)).toEqual([HISTORY, HISTORY]);

    await reloaded.store.rebuild();
    expect((await db.getAll('sessions')).map((session) => session.deckId)).toEqual([
      HISTORY,
      HISTORY,
    ]);
    expect(reloaded.store.listSessions().map((session) => session.deckId)).toEqual([
      HISTORY,
      HISTORY,
    ]);
  });

  it('1.0 の記録を版 2 で書き出し、空のデータベースに読み込むと、回答・セッション・集計が一致する', async () => {
    // 1.0 のアプリが残した記録（deckId の無いセッションと、その回答・集計・学習日・出題設定）
    const source = await createStore();
    const { first, second } = await seed(source.store);
    await stripDeckIds(source.db);
    await source.db.put('meta', {
      key: 'settings',
      value: { scope: 'all', pattern: 'choice', count: 20, range: { kind: 'all' } },
    });
    const legacy = await createStore(source.db);
    const json = JSON.stringify(await legacy.store.exportData());

    dbName = `${dbName}-target`;
    const target = await createStore();
    await target.store.importData(JSON.parse(json));

    const stripId = (attempts: Attempt[]) =>
      attempts.map(({ eventId, pattern, correct, answeredAt, sessionId }) => ({
        eventId,
        pattern,
        correct,
        answeredAt,
        sessionId,
      }));
    expect(stripId(await target.db.getAll('attempts'))).toEqual(
      stripId(await source.db.getAll('attempts')),
    );
    expect(byKey(await target.db.getAll('eventStats'))).toEqual(
      byKey(await source.db.getAll('eventStats')),
    );
    // セッションは deckId（日本史年表）が補われる以外は同じ
    const legacySessions = byId(await source.db.getAll('sessions'));
    expect(legacySessions.every((session) => session.deckId === undefined)).toBe(true);
    expect(byId(await target.db.getAll('sessions'))).toEqual(
      legacySessions.map((session) => ({ ...session, deckId: HISTORY })),
    );
    expect(await target.db.get('meta', 'studyDays')).toEqual(
      await source.db.get('meta', 'studyDays'),
    );
    expect(byKey(target.store.listEventStats())).toEqual(byKey(legacy.store.listEventStats()));
    expect(target.store.listSessions()).toEqual(legacy.store.listSessions());
    expect(target.store.getStudyDays()).toEqual(legacy.store.getStudyDays());
    expect(target.store.getSession(first.id)).toMatchObject({ deckId: HISTORY, answered: 3 });
    expect(target.store.getSession(second.id)).toMatchObject({ deckId: HISTORY, answered: 2 });
  });
});

describe('教材ごとの出題設定と最後に選んだ教材', () => {
  const legacySettings: Settings = {
    scope: 'all',
    pattern: 'choice',
    count: 20,
    range: { kind: 'all' },
  };
  const historySettings: Settings = {
    scope: 'core',
    pattern: 'yearChoice',
    count: 'all',
    range: { kind: 'eras', eras: ['江戸'] },
  };
  const otherSettings: Settings = {
    scope: 'all',
    pattern: 'mixed',
    count: 10,
    range: { kind: 'years', from: 1600, to: null },
  };

  it('1.0 の settings は日本史年表の設定として読み、他の教材には使わない', async () => {
    const db = await open();
    await db.put('meta', { key: 'settings', value: legacySettings });
    const { store } = await createStore(db);
    expect(store.getSettings(HISTORY)).toEqual(legacySettings);
    expect(store.getSettings('other-deck')).toBeNull();
  });

  it('settings:japanese-history があれば、1.0 の settings より優先する', async () => {
    const db = await open();
    await db.put('meta', { key: 'settings', value: legacySettings });
    await db.put('meta', { key: `settings:${HISTORY}`, value: historySettings });
    const { store } = await createStore(db);
    expect(store.getSettings(HISTORY)).toEqual(historySettings);
  });

  it('保存すると settings:<教材の id> に書き、1.0 の settings より優先して読む', async () => {
    const db = await open();
    await db.put('meta', { key: 'settings', value: legacySettings });
    const first = await createStore(db);
    await first.store.saveSettings(HISTORY, historySettings);
    expect(await db.get('meta', `settings:${HISTORY}`)).toEqual({
      key: `settings:${HISTORY}`,
      value: historySettings,
    });
    expect(first.store.getSettings(HISTORY)).toEqual(historySettings);
    const { store } = await createStore(db);
    expect(store.getSettings(HISTORY)).toEqual(historySettings);
  });

  it('教材ごとの設定を別々に保存・読込する', async () => {
    const first = await createStore();
    await first.store.saveSettings(HISTORY, historySettings);
    await first.store.saveSettings('other-deck', otherSettings);
    expect(first.store.getSettings(HISTORY)).toEqual(historySettings);
    expect(first.store.getSettings('other-deck')).toEqual(otherSettings);

    const { store } = await createStore(first.db);
    expect(store.getSettings(HISTORY)).toEqual(historySettings);
    expect(store.getSettings('other-deck')).toEqual(otherSettings);
    expect(store.getSettings('unknown-deck')).toBeNull();
    // 片方を保存し直しても、もう片方は変わらない
    await store.saveSettings('other-deck', { ...otherSettings, count: 20 });
    const again = await createStore(first.db);
    expect(again.store.getSettings(HISTORY)).toEqual(historySettings);
    expect(again.store.getSettings('other-deck')).toEqual({ ...otherSettings, count: 20 });
  });

  it('lastDeck を保存し、読み込み直しても同じ id を返す（保存が無ければ null）', async () => {
    const first = await createStore();
    expect(first.store.getLastDeck()).toBeNull();
    await first.store.saveLastDeck('other-deck');
    expect(first.store.getLastDeck()).toBe('other-deck');
    expect(await first.db.get('meta', 'lastDeck')).toEqual({
      key: 'lastDeck',
      value: 'other-deck',
    });

    const { store } = await createStore(first.db);
    expect(store.getLastDeck()).toBe('other-deck');
    await store.saveLastDeck(HISTORY);
    const again = await createStore(first.db);
    expect(again.store.getLastDeck()).toBe(HISTORY);
  });
});

describe('2 つの教材の記録', () => {
  /** 年の離れた出来事を 6 件作る（どれも 3 つのパターンに適格）。 */
  const eventsOf = (prefix: string, era: Era): Event[] =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `${prefix}${i + 1}`,
      year: 1000 + i * 100,
      title: `${prefix}${i + 1} の出来事`,
      era,
      approx: false,
      altYears: [],
      yearLabel: null,
      level: '中学',
      role: 'core',
    }));
  // 2 つ目の教材はテスト用の定義（年表の種類で、id の接頭辞は th-）
  const history = deckModel({
    id: HISTORY,
    kind: 'timeline',
    name: '日本史年表',
    items: eventsOf('jh-', '平安'),
  });
  const other = deckModel({
    id: 'test-history',
    kind: 'timeline',
    name: 'テスト年表',
    items: eventsOf('th-', '江戸'),
  });
  const UTC = (date: Date) => date.toISOString().slice(0, 10);

  it('復習の候補・成績・履歴・出題設定は教材ごとに分かれ、連続学習日数は共通になる', async () => {
    const { store, db } = await createStore();
    // 1 日目: 日本史年表
    const historySession = await store.startSession({ ...NORMAL, deckId: history.deck.id });
    await answer(store, historySession.id, 'jh-1', 'yearInput', false);
    await answer(store, historySession.id, 'jh-2', 'choice', true, true);
    await store.saveSettings(history.deck.id, {
      scope: 'core',
      pattern: 'yearInput',
      count: 10,
      range: { kind: 'all' },
    });
    // 2 日目: テスト年表
    advance(DAY);
    const otherSession = await store.startSession({ ...NORMAL, deckId: other.deck.id });
    await answer(store, otherSession.id, 'th-1', 'yearInput', false);
    await answer(store, otherSession.id, 'th-2', 'yearChoice', false);
    await answer(store, otherSession.id, 'th-3', 'choice', true, true);
    await store.saveSettings(other.deck.id, {
      scope: 'all',
      pattern: 'mixed',
      count: 20,
      range: { kind: 'eras', eras: ['江戸'] },
    });

    const candidatesOf = (model: typeof history) =>
      reviewCandidates({
        population: model.population,
        allItems: model.deck.items,
        stats: store.listEventStats(),
        now: current,
        dateKey: UTC,
        rules: model.rules,
      });
    const statsOf = (model: typeof history) =>
      summarizeStats({
        deckId: model.deck.id,
        population: model.population,
        stats: store.listEventStats(),
        sessions: store.listSessions(),
        studyDays: store.getStudyDays(),
        now: current,
        dateKey: UTC,
        rules: model.rules,
      });

    // 復習の候補はその教材の項目だけ
    expect(candidatesOf(history).map(({ item, pattern }) => [item.id, pattern])).toEqual([
      ['jh-1', 'yearInput'],
    ]);
    expect(candidatesOf(other).map(({ item, pattern }) => [item.id, pattern])).toEqual([
      ['th-1', 'yearInput'],
      ['th-2', 'yearChoice'],
    ]);
    const reviewQuestions = generateReviewSession({
      candidates: candidatesOf(other),
      allItems: other.deck.items,
      count: 'all',
      currentYear: 2026,
      rng: () => 0.5,
      rules: other.rules,
    });
    expect(reviewQuestions.map((question) => question.item.id).sort()).toEqual(['th-1', 'th-2']);

    // 成績（全体・時代別・出来事別）と履歴はその教材の分だけ。連続学習日数は共通
    const historyStats = statsOf(history);
    const otherStats = statsOf(other);
    expect(historyStats.overall).toEqual({ attempts: 2, correct: 1, streakDays: 2 });
    expect(otherStats.overall).toEqual({ attempts: 3, correct: 1, streakDays: 2 });
    expect(historyStats.groups).toEqual([{ group: '平安', attempts: 2, correct: 1 }]);
    expect(otherStats.groups).toEqual([{ group: '江戸', attempts: 3, correct: 1 }]);
    expect(historyStats.items.filter((row) => row.attempts > 0).map((row) => row.item.id)).toEqual([
      'jh-1',
      'jh-2',
    ]);
    expect(otherStats.items.filter((row) => row.attempts > 0).map((row) => row.item.id)).toEqual([
      'th-1',
      'th-2',
      'th-3',
    ]);
    expect(historyStats.history.map((session) => session.id)).toEqual([historySession.id]);
    expect(otherStats.history.map((session) => session.id)).toEqual([otherSession.id]);

    // 出題設定は教材ごと
    expect(store.getSettings(history.deck.id)).toMatchObject({ pattern: 'yearInput' });
    expect(store.getSettings(other.deck.id)).toMatchObject({ pattern: 'mixed' });

    // 読み込み直しても分かれたまま
    const reloaded = await createStore(db);
    expect(reloaded.store.getSession(historySession.id)?.deckId).toBe(history.deck.id);
    expect(reloaded.store.getSession(otherSession.id)?.deckId).toBe(other.deck.id);
    expect(reloaded.store.getSettings(history.deck.id)).toMatchObject({ pattern: 'yearInput' });
    expect(reloaded.store.getSettings(other.deck.id)).toMatchObject({ pattern: 'mixed' });
  });
});

describe('語彙の出題設定と記録', () => {
  const vocabulary = 'japanese-vocabulary';
  it('年表と別の鍵に保存し、再読み込みしても双方を保つ', async () => {
    const { store, db } = await createStore();
    const timeline: Settings = {
      scope: 'all',
      pattern: 'yearChoice',
      count: 20,
      range: { kind: 'eras', eras: ['江戸'] },
    };
    const words = {
      scope: 'core' as const,
      pattern: 'wordChoice' as const,
      count: 10 as const,
      range: { kind: 'categories' as const, categories: ['慣用句'] },
    };
    expect(store.getSettings(vocabulary, 'vocabulary')).toBeNull();
    await store.saveSettings(HISTORY, timeline);
    await store.saveSettings(vocabulary, words);
    expect(await db.get('meta', `settings:${vocabulary}`)).toEqual({
      key: `settings:${vocabulary}`,
      value: words,
    });
    const reloaded = (await createStore(db)).store;
    expect(reloaded.getSettings(HISTORY)).toEqual(timeline);
    expect(reloaded.getSettings(vocabulary, 'vocabulary')).toEqual(words);
  });
  it.each([
    [['削除済み', '慣用句', '慣用句'], { kind: 'categories', categories: ['慣用句'] }],
    [['削除済み'], { kind: 'all' }],
    [[], { kind: 'all' }],
  ])('保存した種類 %j から現在の一覧に無いものを外す', async (categories, range) => {
    const { store, db } = await createStore();
    await store.saveSettings(vocabulary, {
      scope: 'all',
      pattern: 'mixed',
      count: 'all',
      range: { kind: 'categories', categories },
    });
    const reloaded = (await createStore(db)).store;
    expect(reloaded.getSettings(vocabulary, 'vocabulary')).toEqual({
      scope: 'all',
      pattern: 'mixed',
      count: 'all',
      range,
    });
  });
  it('1.0 の settings を語彙の初期値にしない', async () => {
    const db = await open();
    const legacy: Settings = { scope: 'all', pattern: 'choice', count: 20, range: { kind: 'all' } };
    await db.put('meta', { key: 'settings', value: legacy });
    const { store } = await createStore(db);
    expect(store.getSettings(HISTORY)).toEqual(legacy);
    expect(store.getSettings(vocabulary, 'vocabulary')).toBeNull();
  });
  it('両パターンの回答と種類の範囲を版 2 で書き出し・読み込みできる', async () => {
    const { store } = await createStore();
    const session = await store.startSession({
      deckId: vocabulary,
      mode: 'normal',
      pattern: 'mixed',
      range: { kind: 'categories', categories: ['慣用句'] },
      total: 2,
    });
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'jv-0001',
      pattern: 'meaningChoice',
      correct: true,
      endSession: false,
    });
    await store.recordAnswer({
      sessionId: session.id,
      eventId: 'jv-0002',
      pattern: 'wordChoice',
      correct: false,
      endSession: true,
    });
    const data = await store.exportData();
    expect(data.schemaVersion).toBe(2);
    await store.importData(data);
    expect(parseProgressExport(await store.exportData())).toEqual(parseProgressExport(data));
    expect(store.listEventStats()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: 'jv-0001', pattern: 'meaningChoice', correct: 1 }),
        expect.objectContaining({ eventId: 'jv-0002', pattern: 'wordChoice', correct: 0 }),
      ]),
    );
  });
});

describe('英単語の出題設定と記録', () => {
  it.each(['englishMeaningChoice', 'englishWordChoice', 'mixed'] as const)(
    '%s のscopeを持たない設定を保存し、再読み込みする',
    async (pattern) => {
      const { store, db } = await createStore();
      const settings: EnglishSettings = {
        pattern,
        count: 10,
        range: { kind: 'categories', categories: ['STAGE2 Lesson 4', '現在は無いレッスン'] },
      };
      await store.saveSettings('english-words', settings);
      expect(await db.get('meta', 'settings:english-words')).toEqual({
        key: 'settings:english-words',
        value: settings,
      });
      expect(store.getSettings('english-words', 'english')).toEqual(settings);
      const reloaded = await createStore(db);
      expect(reloaded.store.getSettings('english-words', 'english')).toEqual(settings);
      if (pattern !== 'mixed')
        expect(reloaded.store.getSettings('english-words', 'vocabulary')).toBeNull();
    },
  );
  it('全範囲の初期設定を保存してscopeなしで読み出し、別の種類のパターンや範囲は受け付けない', async () => {
    const { store, db } = await createStore();
    const settings: EnglishSettings = { pattern: 'mixed', count: 10, range: { kind: 'all' } };
    await store.saveSettings('english-words', settings);
    expect((await createStore(db)).store.getSettings('english-words', 'english')).toEqual(settings);
    expect(store.getSettings('unknown', 'english')).toBeNull();
    await store.saveSettings('english-words', {
      scope: 'all',
      pattern: 'meaningChoice',
      count: 10,
      range: { kind: 'all' },
    });
    expect(store.getSettings('english-words', 'english')).toBeNull();
    await store.saveSettings('english-words', {
      scope: 'all',
      pattern: 'mixed',
      count: 10,
      range: { kind: 'eras', eras: ['江戸'] },
    });
    expect(store.getSettings('english-words', 'english')).toBeNull();
  });
  it('両パターンの回答と範囲をIndexedDBから書き出して読み戻し、集計と履歴を保つ', async () => {
    const source = await createStore();
    const range = { kind: 'categories' as const, categories: ['STAGE2 Lesson 4'] };
    const session = await source.store.startSession({
      deckId: 'english-words',
      mode: 'normal',
      pattern: 'mixed',
      range,
      total: 2,
    });
    await answer(source.store, session.id, 'en-0001', 'englishMeaningChoice', false);
    await answer(source.store, session.id, 'en-0001', 'englishWordChoice', true, true);
    const exported = await source.store.exportData();
    const target = await createStore();
    await target.store.importData(JSON.parse(JSON.stringify(exported)));
    expect(target.store.listEventStats()).toEqual(source.store.listEventStats());
    expect(target.store.listSessions()).toEqual(source.store.listSessions());
    expect((await target.store.exportData()).attempts.map((attempt) => attempt.pattern)).toEqual([
      'englishMeaningChoice',
      'englishWordChoice',
    ]);
    expect(target.store.listSessions()[0]).toMatchObject({ deckId: 'english-words', range });
  });
});
