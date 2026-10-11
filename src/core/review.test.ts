import { describe, expect, it } from 'vitest';
import type { DateKeyFn } from './date';
import type { Event, EventStats, Pattern } from './models';
import { distractorCandidates, population } from './quiz';
import { mulberry32, type Rng } from './random';
import {
  generateReviewSession,
  needsReview,
  reviewCandidates,
  reviewWeight,
  weightedSample,
  type ReviewCandidate,
} from './review';

const HOUR = 60 * 60 * 1000;

/** 端末のタイムゾーンを UTC+9 とみなす暦。 */
const JST: DateKeyFn = (date) => new Date(date.getTime() + 9 * HOUR).toISOString().slice(0, 10);

/** 現在時刻: JST の 2026-10-25 9:00。 */
const NOW = new Date('2026-10-25T00:00:00.000Z');

/** JST の `YYYY-MM-DD` の `HH:MM` を UTC の ISO 8601 にする。 */
function jst(day: string, time = '12:00'): string {
  return new Date(new Date(`${day}T${time}:00.000Z`).getTime() - 9 * HOUR).toISOString();
}

function ev(id: string, year: number, extra: Partial<Event> = {}): Event {
  return {
    id,
    year,
    title: `出来事 ${id}`,
    era: '江戸',
    approx: false,
    altYears: [],
    yearLabel: null,
    level: '中学',
    role: 'core',
    ...extra,
  };
}

/** 復習の条件をどれも満たさない集計（全問正解・不正解の記録なし）を元に、一部を書き換えたもの。 */
function st(eventId: string, pattern: Pattern, extra: Partial<EventStats> = {}): EventStats {
  return {
    eventId,
    pattern,
    attempts: 3,
    correct: 3,
    lastAnsweredAt: jst('2026-10-20'),
    lastCorrect: true,
    lastWrongAt: null,
    ...extra,
  };
}

/** 年の離れた出来事を `count` 件作る（どれも 3 つのパターンすべてに適格）。 */
function spread(count: number, prefix = 'e'): Event[] {
  return Array.from({ length: count }, (_, i) => ev(`${prefix}${i + 1}`, 1000 + i * 10));
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** テストで使う今年。 */
const CURRENT_YEAR = 2026;

describe('needsReview', () => {
  /** 条件 1 だけを確かめるための集計（最後は正解、正答率 90%）。 */
  const recentOnly = (lastWrongAt: string | null) =>
    st('a', 'yearInput', { attempts: 10, correct: 9, lastWrongAt });

  it('条件 1: 14 日前の 0 時以降に不正解があれば候補（境界を含む）', () => {
    expect(needsReview(recentOnly(jst('2026-10-11', '00:00')), NOW, JST)).toBe(true);
    expect(needsReview(recentOnly(jst('2026-10-24', '23:00')), NOW, JST)).toBe(true);
    // 15 日前の 23:59（14 日前の 0 時の直前）
    expect(needsReview(recentOnly(jst('2026-10-10', '23:59')), NOW, JST)).toBe(false);
  });

  it('条件 1 は注入した暦で判定する', () => {
    const wrongAt = jst('2026-10-11', '00:30'); // UTC では 10 月 10 日 15:30
    const UTC: DateKeyFn = (date) => date.toISOString().slice(0, 10);
    expect(needsReview(recentOnly(wrongAt), NOW, JST)).toBe(true);
    expect(needsReview(recentOnly(wrongAt), NOW, UTC)).toBe(false);
  });

  it('条件 2: 最後の回答が不正解なら、不正解が 14 日より前でも候補', () => {
    const stats = st('a', 'yearInput', {
      attempts: 10,
      correct: 9,
      lastCorrect: false,
      lastWrongAt: jst('2026-09-01'),
    });
    expect(needsReview(stats, NOW, JST)).toBe(true);
  });

  it('条件 3: 回答数 2 以上で正答率 60% 未満なら、最後が正解で不正解が古くても候補', () => {
    const old = jst('2026-09-01');
    expect(
      needsReview(st('a', 'choice', { attempts: 5, correct: 2, lastWrongAt: old }), NOW, JST),
    ).toBe(true);
    expect(
      needsReview(st('a', 'choice', { attempts: 2, correct: 1, lastWrongAt: old }), NOW, JST),
    ).toBe(true);
    // ちょうど 60% は候補にしない
    expect(
      needsReview(st('a', 'choice', { attempts: 5, correct: 3, lastWrongAt: old }), NOW, JST),
    ).toBe(false);
    // 回答数が 1 なら正答率では選ばない
    expect(
      needsReview(st('a', 'choice', { attempts: 1, correct: 0, lastWrongAt: old }), NOW, JST),
    ).toBe(false);
  });

  it('どの条件も満たさなければ候補にしない（正解した後も条件を満たす間は候補に残る）', () => {
    expect(needsReview(st('a', 'yearInput'), NOW, JST)).toBe(false);
    expect(
      needsReview(
        st('a', 'yearInput', { attempts: 2, correct: 1, lastWrongAt: jst('2026-10-24') }),
        NOW,
        JST,
      ),
    ).toBe(true);
  });
});

describe('reviewWeight', () => {
  const weightAt = (day: string, time?: string) =>
    reviewWeight({ lastWrongAt: jst(day, time) }, NOW, JST);

  it('最後に間違えた日からの経過日数が 3 日以内なら 3、7 日以内なら 2、それ以外は 1（境界を含む）', () => {
    expect(weightAt('2026-10-25')).toBe(3); // 0 日
    expect(weightAt('2026-10-22')).toBe(3); // 3 日
    expect(weightAt('2026-10-21')).toBe(2); // 4 日
    expect(weightAt('2026-10-18')).toBe(2); // 7 日
    expect(weightAt('2026-10-17')).toBe(1); // 8 日
    expect(weightAt('2026-10-11')).toBe(1); // 14 日
  });

  it('経過日数は暦日の差で数える（深夜をまたいだ 2 分の差で重みが変わる）', () => {
    expect(weightAt('2026-10-21', '23:59')).toBe(2);
    expect(weightAt('2026-10-22', '00:01')).toBe(3);
    expect(weightAt('2026-10-17', '23:59')).toBe(1);
    expect(weightAt('2026-10-18', '00:00')).toBe(2);
  });

  it('不正解の記録が無ければ 1', () => {
    expect(reviewWeight({ lastWrongAt: null }, NOW, JST)).toBe(1);
  });
});

describe('reviewCandidates', () => {
  const filler = spread(10, 'f');
  const target = ev('target', 1600);
  const pooled = ev('pooled', 1700, { role: 'pool' });
  const high = ev('high', 1650, { level: '高校' });
  const approx = ev('approx', 1500, { approx: true });
  // 誤答の候補が 2 件しかない（出来事 4 択に適格でない）出来事。年号入力と年号 4 択には適格
  const lonelyAll = [ev('lonely', 1800), ev('x1', 1801), ev('x2', 1802)];
  const deck = { events: [target, pooled, high, approx, ...filler] };
  const wrong = { lastCorrect: false, lastWrongAt: jst('2026-10-24') };

  const run = (stats: EventStats[], events = deck.events) =>
    reviewCandidates({
      population: population({ events }),
      allEvents: events,
      stats,
      now: NOW,
      dateKey: JST,
    }).map(({ event, pattern, weight }) => [event.id, pattern, weight]);

  it('条件を満たす（出来事, パターン）の組を、重みと一緒に返す', () => {
    expect(
      run([
        st('target', 'yearInput', wrong),
        st('f1', 'choice', { ...wrong, lastWrongAt: jst('2026-10-18') }),
        st('f2', 'choice'),
      ]),
    ).toEqual([
      ['target', 'yearInput', 3],
      ['f1', 'choice', 2],
    ]);
  });

  it('同じ出来事が複数のパターンで条件を満たせば、それぞれ候補（母集団の順、年号入力・年号 4 択・出来事 4 択の順）', () => {
    expect(
      run([
        st('f3', 'choice', wrong),
        st('target', 'choice', wrong),
        st('target', 'yearChoice', wrong),
        st('target', 'yearInput', wrong),
      ]),
    ).toEqual([
      ['target', 'yearInput', 3],
      ['target', 'yearChoice', 3],
      ['target', 'choice', 3],
      ['f3', 'choice', 3],
    ]);
  });

  it('年号 4 択の記録も（出来事, パターン）の組として候補になる', () => {
    expect(
      run([
        st('f1', 'yearChoice', { ...wrong, lastWrongAt: jst('2026-10-18') }),
        st('f2', 'yearChoice'),
      ]),
    ).toEqual([['f1', 'yearChoice', 2]]);
  });

  it('現在のデータに無い eventId と、母集団に入らない高校の出来事の集計は候補にしない', () => {
    expect(run([st('demo-0001', 'yearInput', wrong), st('high', 'choice', wrong)])).toEqual([]);
  });

  it('追加データ（pool）の中学の出来事も候補にする（出題する出来事の設定によらない）', () => {
    expect(run([st('pooled', 'yearInput', wrong)])).toEqual([['pooled', 'yearInput', 3]]);
  });

  it('記録されたパターンに今は適格でなければ候補にしない', () => {
    // approx の出来事は年号入力と年号 4 択に適格でない（出来事 4 択には適格）
    expect(
      run([
        st('approx', 'yearInput', wrong),
        st('approx', 'yearChoice', wrong),
        st('approx', 'choice', wrong),
      ]),
    ).toEqual([['approx', 'choice', 3]]);
    // 誤答の候補が 3 件に満たない出来事は出来事 4 択に適格でない（年号入力と年号 4 択には適格）
    expect(
      run(
        [
          st('lonely', 'choice', wrong),
          st('lonely', 'yearInput', wrong),
          st('lonely', 'yearChoice', wrong),
        ],
        lonelyAll,
      ),
    ).toEqual([
      ['lonely', 'yearInput', 3],
      ['lonely', 'yearChoice', 3],
    ]);
  });
});

/** 決まった値を順に返す乱数（抽選の手順を確かめる）。 */
function sequence(...values: number[]): Rng {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('weightedSample', () => {
  const items = [
    { id: 'a', weight: 3 },
    { id: 'b', weight: 1 },
    { id: 'c', weight: 2 },
  ];
  const pickIds = (count: number, rng: Rng) => weightedSample(items, count, rng).map((i) => i.id);

  it('残りの重みの合計に対する割合で 1 件ずつ選び、選んだものは外す', () => {
    // 合計 6: [0, 3) が a、[3, 4) が b、[4, 6) が c
    expect(pickIds(1, sequence(0))).toEqual(['a']);
    expect(pickIds(1, sequence(2.99 / 6))).toEqual(['a']);
    expect(pickIds(1, sequence(3 / 6))).toEqual(['b']);
    expect(pickIds(1, sequence(4.5 / 6))).toEqual(['c']);
    expect(pickIds(1, sequence(0.9999))).toEqual(['c']);
    // c を選んだ後は合計 4: [0, 3) が a、[3, 4) が b
    expect(pickIds(3, sequence(5 / 6, 3.5 / 4, 0))).toEqual(['c', 'b', 'a']);
  });

  it('重複なく選び、件数が足りなければ全件を返す', () => {
    for (const seed of SEEDS) {
      const picked = pickIds(10, mulberry32(seed));
      expect([...picked].sort()).toEqual(['a', 'b', 'c']);
    }
    expect(pickIds(2, mulberry32(1))).toHaveLength(2);
    expect(pickIds(0, mulberry32(1))).toEqual([]);
  });

  it('重みの大きいものほど選ばれやすい', () => {
    const many = [
      { id: 'heavy', weight: 3 },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `light${i}`, weight: 1 })),
    ];
    let heavy = 0;
    const trials = 3000;
    const rng = mulberry32(2026);
    for (let i = 0; i < trials; i++) {
      if (weightedSample(many, 1, rng)[0].id === 'heavy') {
        heavy++;
      }
    }
    // 期待値は 3 / 12 = 0.25（重み 1 なら 0.1）
    expect(heavy / trials).toBeGreaterThan(0.21);
    expect(heavy / trials).toBeLessThan(0.29);
  });
});

describe('generateReviewSession', () => {
  const events = spread(30);
  const PATTERN_CYCLE: readonly Pattern[] = ['yearInput', 'yearChoice', 'choice'];
  const candidatesOf = (count: number): ReviewCandidate[] =>
    events.slice(0, count).map((event, i) => ({
      event,
      pattern: PATTERN_CYCLE[i % 3],
      weight: (i % 3) + 1,
    }));
  const summarize = (candidates: ReviewCandidate[], seed: number, count: 10 | 20 | 'all') =>
    generateReviewSession({
      candidates,
      allEvents: events,
      count,
      currentYear: CURRENT_YEAR,
      rng: mulberry32(seed),
    }).map((question) => ({
      id: question.event.id,
      pattern: question.pattern,
      choices: question.pattern === 'choice' ? question.choices.map((c) => c.id) : null,
      years: question.pattern === 'yearChoice' ? question.years : null,
    }));

  it('問題数（10・20・全問）だけ選び、候補が足りなければ全件を出す', () => {
    const candidates = candidatesOf(25);
    expect(summarize(candidates, 1, 10)).toHaveLength(10);
    expect(summarize(candidates, 1, 20)).toHaveLength(20);
    expect(summarize(candidates, 1, 'all')).toHaveLength(25);
    const few = candidatesOf(7);
    expect(
      summarize(few, 1, 10)
        .map((q) => q.id)
        .sort(),
    ).toEqual(few.map((c) => c.event.id).sort());
  });

  it('固定シードなら問題列・パターン・選択肢が同じになる', () => {
    const candidates = candidatesOf(25);
    expect(summarize(candidates, 2026, 20)).toEqual(summarize(candidates, 2026, 20));
    const orders = new Set(SEEDS.map((seed) => JSON.stringify(summarize(candidates, seed, 10))));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('記録されたパターンで出し、出来事 4 択と年号 4 択はそれぞれの決まりを満たす選択肢を持つ', () => {
    const candidates = candidatesOf(20);
    const questions = generateReviewSession({
      candidates,
      allEvents: events,
      count: 'all',
      currentYear: CURRENT_YEAR,
      rng: mulberry32(5),
    });
    expect(new Set(questions.map((q) => q.pattern))).toEqual(new Set(PATTERN_CYCLE));
    for (const question of questions) {
      const candidate = candidates.find((c) => c.event === question.event);
      expect(question.pattern).toBe(candidate?.pattern);
      if (question.pattern === 'choice') {
        expect(question.choices).toHaveLength(4);
        expect(question.choices).toContain(question.event);
        const allowed = distractorCandidates(question.event, events);
        expect(
          question.choices.filter((c) => c !== question.event).every((c) => allowed.includes(c)),
        ).toBe(true);
      } else if (question.pattern === 'yearChoice') {
        const { year } = question.event;
        expect(question.years).toHaveLength(4);
        expect(question.years).toContain(year);
        expect(question.years).toEqual([...question.years].sort((a, b) => a - b));
        expect(question.years.every((y) => Math.abs(y - year) <= 10)).toBe(true);
      } else {
        expect(question).not.toHaveProperty('choices');
        expect(question).not.toHaveProperty('years');
      }
    }
  });

  it('年号 4 択の誤答から今年より後の年を除く（今年は引数で受け取る）', () => {
    const recent = ev('recent', 2020);
    for (const seed of SEEDS) {
      const [question] = generateReviewSession({
        candidates: [{ event: recent, pattern: 'yearChoice', weight: 1 }],
        allEvents: [recent],
        count: 10,
        currentYear: 2021,
        rng: mulberry32(seed),
      });
      expect(question.pattern === 'yearChoice' && question.years.every((y) => y <= 2021)).toBe(
        true,
      );
    }
  });

  it('同じ出来事が 3 つのパターンで候補なら、パターンごとに 1 問ずつ 3 問出る', () => {
    const target = events[0];
    const candidates: ReviewCandidate[] = PATTERN_CYCLE.map((pattern) => ({
      event: target,
      pattern,
      weight: 3,
    }));
    for (const seed of SEEDS) {
      const questions = generateReviewSession({
        candidates,
        allEvents: events,
        count: 10,
        currentYear: CURRENT_YEAR,
        rng: mulberry32(seed),
      });
      expect(questions.map((q) => [q.event.id, q.pattern]).sort()).toEqual([
        [target.id, 'choice'],
        [target.id, 'yearChoice'],
        [target.id, 'yearInput'],
      ]);
    }
  });

  it('候補が 0 件なら問題は 0 問', () => {
    expect(
      generateReviewSession({
        candidates: [],
        allEvents: events,
        count: 10,
        currentYear: CURRENT_YEAR,
        rng: mulberry32(1),
      }),
    ).toEqual([]);
  });
});
