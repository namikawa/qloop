import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Settings } from '../core/models';
import { openDb, type QLoopDb } from './db';
import { localDateKey, ProgressStore, type StartSessionInput } from './progress-store';

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

const NORMAL: StartSessionInput = {
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

describe('ProgressStore.load', () => {
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
    pattern: 'choice',
    count: 20,
    range: { kind: 'years', from: 700, to: null },
  };

  it('保存した設定を読み込み直しても同じ内容で返す', async () => {
    const first = await createStore();
    expect(first.store.getSettings()).toBeNull();
    await first.store.saveSettings(settings);
    expect(first.store.getSettings()).toEqual(settings);

    const { store } = await createStore(first.db);
    expect(store.getSettings()).toEqual(settings);

    const next: Settings = {
      pattern: 'mixed',
      count: 'all',
      range: { kind: 'eras', eras: ['江戸'] },
    };
    await store.saveSettings(next);
    const again = await createStore(first.db);
    expect(again.store.getSettings()).toEqual(next);
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
    await first.store.saveSettings({ pattern: 'yearInput', count: 10, range: { kind: 'all' } });
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
    expect(store.getSettings()).toEqual({
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

describe('localDateKey', () => {
  it('端末ローカルの暦日を YYYY-MM-DD にする', () => {
    expect(localDateKey(new Date(2026, 0, 2, 23, 59, 59))).toBe('2026-01-02');
    expect(localDateKey(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31');
  });
});
