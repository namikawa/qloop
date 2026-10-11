import { describe, expect, it } from 'vitest';
import type { DateKeyFn } from './date';
import type { Era, Event, EventStats, Pattern, Session } from './models';
import { population } from './quiz';
import {
  accuracyOf,
  describeSession,
  eraStats,
  eventRows,
  formatAccuracy,
  formatRange,
  isInterrupted,
  sessionHistory,
  sortEventRows,
  streakDays,
  summarizeStats,
  type EventRow,
} from './stats';

const HOUR = 60 * 60 * 1000;
const JST: DateKeyFn = (date) => new Date(date.getTime() + 9 * HOUR).toISOString().slice(0, 10);

function ev(id: string, era: Era, extra: Partial<Event> = {}): Event {
  return {
    id,
    year: 1600,
    title: `出来事 ${id}`,
    era,
    approx: false,
    altYears: [],
    yearLabel: null,
    level: '中学',
    role: 'core',
    ...extra,
  };
}

function st(
  eventId: string,
  pattern: Pattern,
  attempts: number,
  correct: number,
  lastAnsweredAt = '2026-10-11T00:00:00.000Z',
): EventStats {
  return {
    eventId,
    pattern,
    attempts,
    correct,
    lastAnsweredAt,
    lastCorrect: true,
    lastWrongAt: null,
  };
}

function session(id: string, startedAt: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    mode: 'normal',
    pattern: 'yearInput',
    range: { kind: 'all' },
    startedAt,
    endedAt: startedAt,
    total: 10,
    answered: 10,
    correct: 5,
    ...extra,
  };
}

const ids = (rows: readonly EventRow[]) => rows.map((row) => row.event.id);

describe('accuracyOf と formatAccuracy', () => {
  it('正答率は正解数 ÷ 回答数。回答数 0 は未回答', () => {
    expect(accuracyOf({ attempts: 4, correct: 1 })).toBe(0.25);
    expect(accuracyOf({ attempts: 0, correct: 0 })).toBeNull();
    expect(formatAccuracy({ attempts: 3, correct: 2 })).toBe('67%');
    expect(formatAccuracy({ attempts: 2, correct: 2 })).toBe('100%');
    expect(formatAccuracy({ attempts: 0, correct: 0 })).toBe('未回答');
  });
});

describe('summarizeStats', () => {
  const events = [
    ev('jh-0001', '奈良'),
    ev('jh-0002', '江戸', { role: 'pool' }),
    ev('jh-0003', '平安', { level: '高校' }),
    ev('jh-0004', '奈良'),
  ];
  const stats = [
    st('jh-0001', 'yearInput', 4, 1),
    st('jh-0001', 'choice', 2, 2),
    st('jh-0002', 'choice', 4, 3),
    // 母集団に入らない高校の出来事と、現在のデータに無い出来事の集計は除外する
    st('jh-0003', 'choice', 10, 0),
    st('demo-0001', 'yearInput', 10, 0),
  ];
  const sessions = [
    session('a', '2026-10-10T00:00:00.000Z', { answered: 30, correct: 5 }),
    session('b', '2026-10-11T00:00:00.000Z', { answered: 0, correct: 0 }),
  ];
  const summary = summarizeStats({
    population: population({ events }),
    stats,
    sessions,
    studyDays: ['2026-10-10', '2026-10-11'],
    now: new Date('2026-10-11T03:00:00.000Z'),
    dateKey: JST,
  });

  it('全体は母集団の出来事の集計だけを合算する（パターンと通常・復習を合算した正解数 ÷ 回答数）', () => {
    expect(summary.overall).toEqual({ attempts: 10, correct: 6, streakDays: 2 });
    expect(formatAccuracy(summary.overall)).toBe('60%');
  });

  it('時代別は母集団に出来事がある時代を時代区分表の順に並べ、回答数 0 の時代は未回答', () => {
    const eventsWithEmptyEra = [...events, ev('jh-0005', '明治'), ev('jh-0006', '飛鳥')];
    const eras = eraStats(eventRows(population({ events: eventsWithEmptyEra }), stats));
    expect(eras).toEqual([
      { era: '飛鳥', attempts: 0, correct: 0 },
      { era: '奈良', attempts: 6, correct: 3 },
      { era: '江戸', attempts: 4, correct: 3 },
      { era: '明治', attempts: 0, correct: 0 },
    ]);
    expect(formatAccuracy(eras[0])).toBe('未回答');
    expect(summary.eras.map((era) => era.era)).toEqual(['奈良', '江戸']);
  });

  it('出来事別は母集団の出来事ごとに、回答数・正解数・最終回答日・パターン別の内訳を持つ', () => {
    expect(summary.events).toEqual([
      {
        event: events[0],
        attempts: 6,
        correct: 3,
        lastAnsweredAt: '2026-10-11T00:00:00.000Z',
        patterns: [
          {
            pattern: 'yearInput',
            attempts: 4,
            correct: 1,
            lastAnsweredAt: '2026-10-11T00:00:00.000Z',
          },
          {
            pattern: 'choice',
            attempts: 2,
            correct: 2,
            lastAnsweredAt: '2026-10-11T00:00:00.000Z',
          },
        ],
      },
      {
        event: events[1],
        attempts: 4,
        correct: 3,
        lastAnsweredAt: '2026-10-11T00:00:00.000Z',
        patterns: [
          {
            pattern: 'choice',
            attempts: 4,
            correct: 3,
            lastAnsweredAt: '2026-10-11T00:00:00.000Z',
          },
        ],
      },
      { event: events[3], attempts: 0, correct: 0, lastAnsweredAt: null, patterns: [] },
    ]);
  });

  it('履歴は現在のデータに無い出来事の回答も含むセッションの記録をそのまま使う', () => {
    expect(summary.history.map((s) => [s.id, s.answered])).toEqual([['a', 30]]);
  });
});

describe('eventRows', () => {
  it('最終回答日はパターンのうち新しい方', () => {
    const [row] = eventRows(
      [ev('a', '江戸')],
      [
        st('a', 'yearInput', 1, 1, '2026-10-12T00:00:00.000Z'),
        st('a', 'choice', 1, 0, '2026-10-11T23:00:00.000Z'),
      ],
    );
    expect(row.lastAnsweredAt).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('sortEventRows', () => {
  const events = ['e5', 'e1', 'e4', 'e2', 'e3', 'e6', 'e7'].map((id) => ev(id, '江戸'));
  const stats = [
    st('e5', 'yearInput', 4, 1, '2026-10-05T00:00:00.000Z'), // 25%
    st('e1', 'yearInput', 2, 1, '2026-10-01T00:00:00.000Z'), // 50%
    st('e4', 'choice', 4, 2, '2026-10-09T00:00:00.000Z'), // 50%（e1 と同じ正答率）
    st('e2', 'yearInput', 3, 3, '2026-10-09T00:00:00.000Z'), // 100%
    st('e3', 'choice', 1, 0, '2026-10-02T00:00:00.000Z'), // 0%
  ];
  // e6・e7 は未回答
  const rows = eventRows(events, stats);

  it('既定は正答率の低い順。同じ正答率は id 順、未回答は回答済みの後ろに id 順', () => {
    expect(ids(sortEventRows(rows, 'accuracy'))).toEqual([
      'e3',
      'e5',
      'e1',
      'e4',
      'e2',
      'e6',
      'e7',
    ]);
  });

  it('回答数の多い順。同じ回答数は id 順', () => {
    expect(ids(sortEventRows(rows, 'attempts'))).toEqual([
      'e4',
      'e5',
      'e2',
      'e1',
      'e3',
      'e6',
      'e7',
    ]);
  });

  it('最終回答日の新しい順。同じ日時は id 順、未回答は後ろ', () => {
    expect(ids(sortEventRows(rows, 'recent'))).toEqual(['e2', 'e4', 'e5', 'e3', 'e1', 'e6', 'e7']);
  });

  it('元の配列の並びは変えない', () => {
    sortEventRows(rows, 'accuracy');
    expect(ids(rows)).toEqual(['e5', 'e1', 'e4', 'e2', 'e3', 'e6', 'e7']);
  });
});

describe('streakDays', () => {
  it('今日に回答があれば今日から、連続した日数を数える', () => {
    expect(streakDays(['2026-10-09', '2026-10-10', '2026-10-11'], '2026-10-11')).toBe(3);
    expect(streakDays(['2026-10-07', '2026-10-09', '2026-10-10', '2026-10-11'], '2026-10-11')).toBe(
      3,
    );
  });

  it('今日に回答が無ければ昨日から数える', () => {
    expect(streakDays(['2026-10-08', '2026-10-09', '2026-10-10'], '2026-10-11')).toBe(3);
  });

  it('今日にも昨日にも回答が無ければ 0', () => {
    expect(streakDays(['2026-10-08', '2026-10-09'], '2026-10-11')).toBe(0);
    expect(streakDays([], '2026-10-11')).toBe(0);
  });

  it('月・年の境目をまたいで数える', () => {
    expect(streakDays(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01')).toBe(3);
  });

  it('今日は注入した暦で決める（UTC では前日でも、JST では今日）', () => {
    const input = {
      population: [],
      stats: [],
      sessions: [],
      studyDays: ['2026-10-12'],
      // JST の 10 月 12 日 0:30（UTC では 10 月 11 日 15:30）
      now: new Date('2026-10-11T15:30:00.000Z'),
    };
    expect(summarizeStats({ ...input, dateKey: JST }).overall.streakDays).toBe(1);
    // UTC の暦では今日が 10 月 11 日で、10 月 12 日は数えない
    const UTC: DateKeyFn = (date) => date.toISOString().slice(0, 10);
    expect(summarizeStats({ ...input, dateKey: UTC }).overall.streakDays).toBe(0);
  });
});

describe('sessionHistory', () => {
  it('開始時刻の新しい順に並べ、回答 0 件のセッションは出さない', () => {
    const sessions = [
      session('old', '2026-10-01T00:00:00.000Z'),
      session('empty', '2026-10-05T00:00:00.000Z', { answered: 0, correct: 0 }),
      session('new', '2026-10-09T00:00:00.000Z'),
      session('interrupted', '2026-10-07T00:00:00.000Z', { endedAt: null, answered: 3 }),
      session('same-b', '2026-10-03T00:00:00.000Z'),
      session('same-a', '2026-10-03T00:00:00.000Z'),
    ];
    const history = sessionHistory(sessions);
    expect(history.map((s) => s.id)).toEqual(['new', 'interrupted', 'same-a', 'same-b', 'old']);
    expect(history.map(isInterrupted)).toEqual([false, true, false, false, false]);
  });
});

describe('formatRange と describeSession', () => {
  it('範囲を表示用の文字列にする', () => {
    expect(formatRange({ kind: 'all' })).toBe('全範囲');
    expect(formatRange({ kind: 'years', from: 700, to: 1600 })).toBe('700年〜1600年');
    expect(formatRange({ kind: 'years', from: 700, to: null })).toBe('700年〜');
    expect(formatRange({ kind: 'years', from: null, to: 1600 })).toBe('〜1600年');
    expect(formatRange({ kind: 'years', from: null, to: null })).toBe('全範囲');
    expect(formatRange({ kind: 'eras', eras: ['奈良', '江戸'] })).toBe('奈良・江戸');
  });

  it('履歴の内容はモード・範囲・パターン。復習はモードだけ', () => {
    expect(
      describeSession({
        mode: 'normal',
        range: { kind: 'years', from: 700, to: 1600 },
        pattern: 'mixed',
      }),
    ).toBe('通常 · 700年〜1600年 · ミックス');
    expect(describeSession({ mode: 'normal', range: { kind: 'all' }, pattern: 'choice' })).toBe(
      '通常 · 全範囲 · 4 択',
    );
    expect(describeSession({ mode: 'review', range: null, pattern: null })).toBe('復習');
  });
});
