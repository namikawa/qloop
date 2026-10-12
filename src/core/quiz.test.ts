import { describe, expect, it } from 'vitest';
import type { Event, Pattern, PatternMode, Question } from './models';
import {
  buildQuestion,
  distractorCandidates,
  eligibleQuestions,
  filterByScope,
  generateChoices,
  generateSession,
  generateYearChoices,
  isChoiceEligible,
  isCorrectYear,
  isEligibleFor,
  isYearChoiceEligible,
  isYearInputEligible,
  pickDistractors,
  population,
} from './quiz';
import { mulberry32, type Rng } from './random';
import { filterByRange } from './range';

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
    role: 'pool',
    ...extra,
  };
}

const ids = (events: Event[]) => events.map((event) => event.id);

/** テストで使う今年。 */
const CURRENT_YEAR = 2026;

describe('distractorCandidates', () => {
  it('規則 1: 出題した出来事自身を除く', () => {
    const target = ev('a', 1600, { role: 'core' });
    expect(ids(distractorCandidates(target, [target, ev('b', 1603)]))).toEqual(['b']);
  });

  it('規則 2: year が出題年と一致するものを除く', () => {
    const target = ev('a', 1185, { role: 'core' });
    const all = [target, ev('same', 1185), ev('other', 1192)];
    expect(ids(distractorCandidates(target, all))).toEqual(['other']);
  });

  it('規則 2: alt_years のいずれかが出題年と一致するものを除く', () => {
    const target = ev('a', 1192, { role: 'core' });
    const all = [target, ev('alt', 1185, { altYears: [1190, 1192] }), ev('other', 1221)];
    expect(ids(distractorCandidates(target, all))).toEqual(['other']);
  });

  it('規則 3: 出題した出来事が approx なら year の差が 50 年以内のものを除く', () => {
    const target = ev('a', 250, { approx: true, role: 'core' });
    const all = [
      target,
      ev('m50', 200),
      ev('m51', 199),
      ev('p50', 300),
      ev('p51', 301),
      ev('in', 239),
    ];
    expect(ids(distractorCandidates(target, all))).toEqual(['m51', 'p51']);
  });

  it('規則 3: 候補が approx なら year の差が 50 年以内のものを除く', () => {
    const target = ev('a', 239, { role: 'core' });
    const all = [target, ev('near', 250, { approx: true }), ev('far', 290, { approx: true })];
    expect(ids(distractorCandidates(target, all))).toEqual(['far']);
  });

  it('どちらも approx でなければ年が近くても候補に残す', () => {
    const target = ev('a', 1600, { role: 'core' });
    expect(ids(distractorCandidates(target, [target, ev('b', 1601), ev('c', 1599)]))).toEqual([
      'b',
      'c',
    ]);
  });

  it('紀元前の approx でも年の差で判定する', () => {
    const target = ev('a', -350, { approx: true, role: 'core' });
    const all = [target, ev('near', -300), ev('far', -299), ev('ad', 57)];
    expect(ids(distractorCandidates(target, all))).toEqual(['far', 'ad']);
  });
});

describe('isChoiceEligible', () => {
  it('除外後の候補が 3 件以上なら出来事 4 択に出せる', () => {
    const target = ev('a', 1600, { role: 'core' });
    expect(isChoiceEligible(target, [target, ev('b', 1603), ev('c', 1615), ev('d', 1637)])).toBe(
      true,
    );
  });

  it('除外後の候補が 2 件なら出来事 4 択に出せない', () => {
    const target = ev('a', 1600, { role: 'core' });
    expect(isChoiceEligible(target, [target, ev('b', 1603), ev('c', 1615), ev('d', 1600)])).toBe(
      false,
    );
  });
});

/** 年の離れた core の出来事を `count` 件作る（どれも 3 つのパターンすべてに適格）。 */
function spread(count: number, prefix = 'e'): Event[] {
  return Array.from({ length: count }, (_, i) =>
    ev(`${prefix}${i + 1}`, 1000 + i * 10, { role: 'core' }),
  );
}

/** 何度も試す用のシード。 */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('population', () => {
  it('core.csv と pool.csv の中学の出来事を母集団にする（高校の行は外す）', () => {
    const events = [
      ev('core', 1600, { role: 'core' }),
      ev('core-high', 1601, { role: 'core', level: '高校' }),
      ev('pool', 1602, { role: 'pool' }),
      ev('pool-high', 1603, { role: 'pool', level: '高校' }),
    ];
    expect(ids(population(events))).toEqual(['core', 'pool']);
  });
});

describe('filterByScope', () => {
  const events = [
    ev('core1', 1600, { role: 'core' }),
    ev('pool1', 1602, { role: 'pool' }),
    ev('core2', 1604, { role: 'core' }),
  ];

  it('基本の年表のみ（core）は core.csv の行に絞る', () => {
    expect(ids(filterByScope(events, 'core'))).toEqual(['core1', 'core2']);
  });

  it('すべて（all）は絞り込まない', () => {
    expect(ids(filterByScope(events, 'all'))).toEqual(['core1', 'pool1', 'core2']);
  });

  it('範囲の指定と組み合わせると、絞り込んだ後の出来事に範囲を適用する', () => {
    const range = { kind: 'years', from: 1601, to: null } as const;
    expect(ids(filterByRange(filterByScope(events, 'core'), range))).toEqual(['core2']);
    expect(ids(filterByRange(filterByScope(events, 'all'), range))).toEqual(['pool1', 'core2']);
  });
});

describe('isYearInputEligible と isYearChoiceEligible', () => {
  it('approx でなく year が正の出来事は年号入力と年号 4 択に出せる', () => {
    for (const event of [ev('a', 710), ev('a', 1)]) {
      expect(isYearInputEligible(event)).toBe(true);
      expect(isYearChoiceEligible(event)).toBe(true);
    }
  });

  it('approx の出来事は出せない', () => {
    expect(isYearInputEligible(ev('a', 250, { approx: true }))).toBe(false);
    expect(isYearChoiceEligible(ev('a', 250, { approx: true }))).toBe(false);
  });

  it('紀元前（year が負）の出来事は出せない', () => {
    expect(isYearInputEligible(ev('a', -57))).toBe(false);
    expect(isYearChoiceEligible(ev('a', -57))).toBe(false);
  });
});

describe('isEligibleFor', () => {
  it('パターンごとの適格判定を返す', () => {
    const target = ev('target', 1600, { role: 'core' });
    const approx = ev('approx', 250, { role: 'core', approx: true });
    const all = [target, approx, ev('x', 900), ev('y', 1700), ev('z', 1800)];
    const of = (event: Event) =>
      (['yearInput', 'yearChoice', 'choice'] as const).filter((pattern) =>
        isEligibleFor(event, pattern, all),
      );
    expect(of(target)).toEqual(['yearInput', 'yearChoice', 'choice']);
    expect(of(approx)).toEqual(['choice']);
  });
});

describe('eligibleQuestions', () => {
  const filler = [ev('f1', 100), ev('f2', 900), ev('f3', 1700)];
  const both = ev('both', 1600, { role: 'core' });
  const approx = ev('approx', 250, { role: 'core', approx: true });
  const bc = ev('bc', -57, { role: 'core' });
  const all = [both, approx, bc, ...filler];
  const patternsOf = (mode: PatternMode, candidates = [both, approx, bc]) =>
    eligibleQuestions(candidates, all, mode).map(({ event, patterns }) => [event.id, patterns]);

  it('年号入力は年号入力に適格な出来事だけ', () => {
    expect(patternsOf('yearInput')).toEqual([['both', ['yearInput']]]);
  });

  it('年号 4 択は年号入力と同じく、approx と紀元前の出来事を除く', () => {
    expect(patternsOf('yearChoice')).toEqual([['both', ['yearChoice']]]);
  });

  it('出来事 4 択は誤答の候補が 3 件以上ある出来事', () => {
    expect(patternsOf('choice')).toEqual([
      ['both', ['choice']],
      ['approx', ['choice']],
      ['bc', ['choice']],
    ]);
  });

  it('ミックスは 3 つのパターンのうち適格なものすべて（年号入力・年号 4 択・出来事 4 択の順）', () => {
    expect(patternsOf('mixed')).toEqual([
      ['both', ['yearInput', 'yearChoice', 'choice']],
      ['approx', ['choice']],
      ['bc', ['choice']],
    ]);
  });

  it('どのパターンにも適格でない出来事はミックスでも除外する', () => {
    // 誤答の候補が 2 件しかない approx の出来事
    const lonely = ev('lonely', 250, { role: 'core', approx: true });
    const events = [lonely, ev('x', 900), ev('y', 1700)];
    expect(eligibleQuestions([lonely], events, 'mixed')).toEqual([]);
  });

  it('出来事 4 択に適格でない出来事はミックスで年号入力と年号 4 択だけになる', () => {
    const target = ev('target', 1600, { role: 'core' });
    const events = [target, ev('x', 900), ev('y', 1700)];
    expect(eligibleQuestions([target], events, 'mixed').map(({ patterns }) => patterns)).toEqual([
      ['yearInput', 'yearChoice'],
    ]);
  });

  it('同じ出来事が重複して渡されても 1 件にする', () => {
    expect(ids(eligibleQuestions([both, both], all, 'choice').map(({ event }) => event))).toEqual([
      'both',
    ]);
  });
});

describe('generateSession', () => {
  const summarize = (questions: Question[]) =>
    questions.map((question) => ({
      id: question.item.id,
      pattern: question.pattern,
      choices: question.pattern === 'choice' ? ids(question.choices) : null,
      years: question.pattern === 'yearChoice' ? question.years : null,
    }));

  it('問題数が上限になり、同じ出来事は 1 回だけ出す', () => {
    const events = spread(25);
    for (const count of [10, 20] as const) {
      const questions = generateSession({
        candidates: events,
        allEvents: events,
        mode: 'mixed',
        count,
        currentYear: CURRENT_YEAR,
        rng: mulberry32(1),
      });
      expect(questions).toHaveLength(count);
      expect(new Set(questions.map((question) => question.item.id)).size).toBe(count);
    }
  });

  it('適格な出来事が問題数に満たなければ全件を出す', () => {
    const events = spread(7);
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'choice',
      count: 10,
      currentYear: CURRENT_YEAR,
      rng: mulberry32(1),
    });
    expect(ids(questions.map((question) => question.item)).sort()).toEqual(ids(events).sort());
  });

  it('全問は適格な全件を出し、適格でない出来事は出さない', () => {
    const events = [...spread(12), ev('approx', 1500, { role: 'core', approx: true })];
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'yearInput',
      count: 'all',
      currentYear: CURRENT_YEAR,
      rng: mulberry32(1),
    });
    expect(questions).toHaveLength(12);
    expect(ids(questions.map((question) => question.item))).not.toContain('approx');
    expect(questions.every((question) => question.pattern === 'yearInput')).toBe(true);
  });

  it('出題順はランダム（シードによって変わる）', () => {
    const events = spread(20);
    const orders = new Set(
      SEEDS.map((seed) =>
        generateSession({
          candidates: events,
          allEvents: events,
          mode: 'yearInput',
          count: 'all',
          currentYear: CURRENT_YEAR,
          rng: mulberry32(seed),
        })
          .map((question) => question.item.id)
          .join(','),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('固定シードなら問題列・パターン・選択肢が同じになる', () => {
    const events = [...spread(30), ev('approx', 1500, { role: 'core', approx: true })];
    const run = () =>
      summarize(
        generateSession({
          candidates: events,
          allEvents: events,
          mode: 'mixed',
          count: 20,
          currentYear: CURRENT_YEAR,
          rng: mulberry32(2026),
        }),
      );
    expect(run()).toEqual(run());
  });

  it('ミックスでは 3 つのパターンに適格な出来事のパターンを 1 問ごとにほぼ等確率で選ぶ', () => {
    const events = spread(20);
    const counts: Record<Pattern, number> = { yearInput: 0, yearChoice: 0, choice: 0 };
    let total = 0;
    for (const seed of SEEDS) {
      for (const question of generateSession({
        candidates: events,
        allEvents: events,
        mode: 'mixed',
        count: 'all',
        currentYear: CURRENT_YEAR,
        rng: mulberry32(seed),
      })) {
        total++;
        counts[question.pattern]++;
      }
    }
    expect(total).toBe(SEEDS.length * events.length);
    // 期待値は 1/3（800 問）
    for (const count of Object.values(counts)) {
      expect(count / total).toBeGreaterThan(0.28);
      expect(count / total).toBeLessThan(0.39);
    }
  });

  it('ミックスでは片方だけに適格な出来事はその形式で出す', () => {
    const events = [...spread(10), ev('approx', 1500, { role: 'core', approx: true })];
    for (const seed of SEEDS) {
      const question = generateSession({
        candidates: events,
        allEvents: events,
        mode: 'mixed',
        count: 'all',
        currentYear: CURRENT_YEAR,
        rng: mulberry32(seed),
      }).find((q) => q.item.id === 'approx');
      expect(question?.pattern).toBe('choice');
    }
  });

  it('出来事 4 択は正解を含む 4 件の選択肢、年号 4 択は正解を含む 4 つの年を持ち、年号入力は選択肢を持たない', () => {
    const events = spread(20);
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'mixed',
      count: 'all',
      currentYear: CURRENT_YEAR,
      rng: mulberry32(5),
    });
    expect(new Set(questions.map((question) => question.pattern))).toEqual(
      new Set(['yearInput', 'yearChoice', 'choice']),
    );
    for (const question of questions) {
      if (question.pattern === 'choice') {
        expect(question.choices).toHaveLength(4);
        expect(new Set(ids(question.choices)).size).toBe(4);
        expect(question.choices).toContain(question.item);
        expect(question).not.toHaveProperty('years');
      } else if (question.pattern === 'yearChoice') {
        expect(question.years).toHaveLength(4);
        expect(question.years).toContain(question.item.year);
        expect(question).not.toHaveProperty('choices');
      } else {
        expect(question).not.toHaveProperty('choices');
        expect(question).not.toHaveProperty('years');
      }
    }
  });

  it('年号 4 択は年号 4 択に適格な出来事だけを、年号の選択肢付きで出す', () => {
    const events = [...spread(12), ev('approx', 1500, { role: 'core', approx: true })];
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'yearChoice',
      count: 'all',
      currentYear: CURRENT_YEAR,
      rng: mulberry32(3),
    });
    expect(questions).toHaveLength(12);
    expect(ids(questions.map((question) => question.item))).not.toContain('approx');
    for (const question of questions) {
      expect(question.pattern).toBe('yearChoice');
      if (question.pattern === 'yearChoice') {
        expect(question.years).toHaveLength(4);
        expect(question.years).toContain(question.item.year);
      }
    }
  });

  it('年号 4 択の誤答から今年より後の年を除く（今年は引数で受け取る）', () => {
    const recent = ev('recent', 2020, { role: 'core' });
    for (const seed of SEEDS) {
      const [question] = generateSession({
        candidates: [recent],
        allEvents: [recent],
        mode: 'yearChoice',
        count: 10,
        currentYear: 2021,
        rng: mulberry32(seed),
      });
      expect(question.pattern === 'yearChoice' && question.years.every((y) => y <= 2021)).toBe(
        true,
      );
    }
  });
});

describe('buildQuestion', () => {
  const events = spread(20);
  const target = events[10];

  it('パターンに合わせて選択肢を作る', () => {
    expect(buildQuestion(target, 'yearInput', events, CURRENT_YEAR, mulberry32(1))).toEqual({
      item: target,
      pattern: 'yearInput',
    });
    const yearChoice = buildQuestion(target, 'yearChoice', events, CURRENT_YEAR, mulberry32(1));
    expect(yearChoice.pattern === 'yearChoice' && yearChoice.years).toContain(target.year);
    const choice = buildQuestion(target, 'choice', events, CURRENT_YEAR, mulberry32(1));
    expect(choice.pattern === 'choice' && choice.choices).toContain(target);
  });
});

/** 決まった値を順に返す乱数（抽選の手順を確かめる）。 */
function sequence(...values: number[]): Rng {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('generateYearChoices', () => {
  /** 正解の位置（小さい順に並べたときの 0 始まりの位置）は、正解より小さい誤答の数 k と同じ。 */
  const positionOf = (years: number[], year: number) => years.indexOf(year);

  /** 選択肢の決まり（正解を含む異なる 4 つで小さい順、誤答は前後 1〜10 年で除外規則を満たす）を確かめる。 */
  function expectValid(
    years: number[],
    event: Pick<Event, 'year' | 'altYears'>,
    currentYear: number,
  ): void {
    expect(years).toHaveLength(4);
    expect(new Set(years).size).toBe(4);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(years).toContain(event.year);
    for (const year of years.filter((y) => y !== event.year)) {
      expect(Math.abs(year - event.year)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(year - event.year)).toBeLessThanOrEqual(10);
      expect(year).toBeGreaterThan(0);
      expect(year).toBeLessThanOrEqual(currentYear);
      expect(event.altYears).not.toContain(year);
    }
  }

  it('正解を含む異なる 4 つの年を小さい順に返し、誤答は前後 1〜10 年から選ぶ', () => {
    const event = ev('a', 1575);
    const seen = new Set<number>();
    const rng = mulberry32(2026);
    for (let i = 0; i < 2000; i++) {
      const years = generateYearChoices(event, CURRENT_YEAR, rng);
      expectValid(years, event, CURRENT_YEAR);
      for (const year of years) {
        seen.add(year);
      }
    }
    // 前後 1〜10 年の 20 個がどれも誤答に出て、11 年以上離れた年は出ない
    const expected = Array.from({ length: 21 }, (_, i) => 1565 + i);
    expect([...seen].sort((a, b) => a - b)).toEqual(expected);
  });

  it('alt_years の年は選択肢に出さない', () => {
    const event = ev('kamakura', 1185, { altYears: [1192, 1180] });
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const years = generateYearChoices(event, CURRENT_YEAR, mulberry32(seed));
      expectValid(years, event, CURRENT_YEAR);
      years.forEach((year) => seen.add(year));
    }
    expect(seen).not.toContain(1192);
    expect(seen).not.toContain(1180);
  });

  it('0 以下の年と今年より後の年は選択肢に出さない', () => {
    for (const seed of SEEDS) {
      expectValid(
        generateYearChoices(ev('a', 5), CURRENT_YEAR, mulberry32(seed)),
        ev('a', 5),
        CURRENT_YEAR,
      );
      expectValid(
        generateYearChoices(ev('b', 2020), CURRENT_YEAR, mulberry32(seed)),
        ev('b', 2020),
        CURRENT_YEAR,
      );
    }
  });

  it('両側の候補が十分な年では、正解の位置（正解より小さい誤答の数 k）の 0〜3 を等確率で選ぶ', () => {
    const event = ev('a', 1600);
    const counts = [0, 0, 0, 0];
    const trials = 4000;
    const rng = mulberry32(7);
    for (let i = 0; i < trials; i++) {
      counts[positionOf(generateYearChoices(event, CURRENT_YEAR, rng), event.year)]++;
    }
    // 期待値は各 1/4（1000 回）。20 個から一様に選ぶと 2・3 番目が約 8 割になるので、偏りがあれば外れる
    for (const count of counts) {
      expect(count / trials).toBeGreaterThan(0.22);
      expect(count / trials).toBeLessThan(0.28);
    }
  });

  it('k は最初の乱数の値で決まり、取りうる k を等分した区間に対応する', () => {
    const event = ev('a', 1600);
    // 取りうる k は 0〜3 の 4 通り: [0, 0.25) が 0、[0.25, 0.5) が 1、[0.5, 0.75) が 2、[0.75, 1) が 3
    for (const [first, k] of [
      [0, 0],
      [0.24, 0],
      [0.25, 1],
      [0.49, 1],
      [0.5, 2],
      [0.75, 3],
      [0.99, 3],
    ]) {
      const years = generateYearChoices(event, CURRENT_YEAR, sequence(first, 0.3, 0.7, 0.1, 0.9));
      expect(positionOf(years, event.year)).toBe(k);
      expectValid(years, event, CURRENT_YEAR);
    }
  });

  it('片側の候補が足りない年では、取りうる k だけから選ぶ', () => {
    const positions = (event: Event, currentYear = CURRENT_YEAR) => {
      const counts = new Map<number, number>();
      const rng = mulberry32(11);
      const trials = 3000;
      for (let i = 0; i < trials; i++) {
        const years = generateYearChoices(event, currentYear, rng);
        expectValid(years, event, currentYear);
        const position = positionOf(years, event.year);
        counts.set(position, (counts.get(position) ?? 0) + 1);
      }
      return new Map([...counts].map(([position, count]) => [position, count / trials]));
    };
    const expectUniform = (shares: Map<number, number>, expected: number[]) => {
      expect([...shares.keys()].sort()).toEqual(expected);
      for (const share of shares.values()) {
        expect(share).toBeGreaterThan(1 / expected.length - 0.04);
        expect(share).toBeLessThan(1 / expected.length + 0.04);
      }
    };
    // 1 年: 正解より小さい候補が無いので k は 0 だけ（正解はいつも 1 番目）
    expectUniform(positions(ev('a', 1)), [0]);
    // 2 年: 小さい候補は 1 年だけなので k は 0・1
    expectUniform(positions(ev('a', 2)), [0, 1]);
    // 3 年: 小さい候補は 1・2 年なので k は 0〜2
    expectUniform(positions(ev('a', 3)), [0, 1, 2]);
    // 今年の出来事: 大きい候補が無いので k は 3 だけ（正解はいつも 4 番目）
    expectUniform(positions(ev('a', CURRENT_YEAR)), [3]);
    // 今年の 2 年前: 大きい候補は 2 つなので k は 1〜3
    expectUniform(positions(ev('a', CURRENT_YEAR - 2)), [1, 2, 3]);
    // alt_years で大きい側がすべて除かれると k は 3 だけ
    const altAbove = Array.from({ length: 10 }, (_, i) => 1601 + i);
    expectUniform(positions(ev('a', 1600, { altYears: altAbove })), [3]);
  });

  it('端末の時計が出来事の年より前にずれていても、出来事の年を今年とみなして選択肢を作る', () => {
    // 今年が 2000 年と出る端末で 2022 年の出来事を出すと、大きい側の候補は無く、k は 3 だけになる
    const event = ev('a', 2022);
    for (const seed of SEEDS) {
      const years = generateYearChoices(event, 2000, mulberry32(seed));
      expectValid(years, event, event.year);
      expect(positionOf(years, event.year)).toBe(3);
    }
  });

  it('候補が 3 つに満たなければ例外を投げる', () => {
    // 1 年の出来事で今年が 1 年なら、0 以下と今年より後を除いて候補が残らない
    expect(() => generateYearChoices(ev('a', 1), 1, mulberry32(1))).toThrow();
    // 候補が 2 つ（1・2 年。3 年と 5〜14 年は alt_years）
    const altYears = [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    expect(() =>
      generateYearChoices(ev('a', 4, { altYears }), CURRENT_YEAR, mulberry32(1)),
    ).toThrow();
  });
});

describe('generateChoices', () => {
  const events = spread(20);
  const target = events[10];

  it('正解と、除外規則を満たす誤答 3 件の 4 件になる', () => {
    for (const seed of SEEDS) {
      const choices = generateChoices(target, events, mulberry32(seed));
      expect(choices).toHaveLength(4);
      expect(new Set(ids(choices)).size).toBe(4);
      expect(choices).toContain(target);
      const allowed = distractorCandidates(target, events);
      expect(choices.filter((choice) => choice !== target).every((c) => allowed.includes(c))).toBe(
        true,
      );
    }
  });

  it('出来事 4 択の 4 つの並びをシャッフルする（正解の位置がシードによって変わる）', () => {
    const positions = new Set(
      SEEDS.map((seed) => generateChoices(target, events, mulberry32(seed)).indexOf(target)),
    );
    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('pickDistractors', () => {
  const target = ev('target', 1600, { role: 'core', era: '江戸' });

  /** 何度も選ばせて、選ばれた出来事の id を集める。 */
  function pickedIds(all: Event[]): Set<string> {
    const picked = new Set<string>();
    for (const seed of SEEDS) {
      const distractors = pickDistractors(target, all, mulberry32(seed));
      expect(distractors).toHaveLength(3);
      for (const id of ids(distractors)) {
        picked.add(id);
      }
    }
    return picked;
  }

  it('前後 100 年以内（境界を含む）の候補が 3 件以上あればその中から選ぶ', () => {
    const all = [
      target,
      ev('m100', 1500, { era: '室町' }),
      ev('p50', 1650),
      ev('p100', 1700),
      ev('p80', 1680),
      ev('m101', 1499, { era: '室町' }),
      ev('p101', 1701),
      ev('far', 1900, { era: '明治' }),
    ];
    expect([...pickedIds(all)].sort()).toEqual(['m100', 'p100', 'p50', 'p80']);
  });

  it('前後 100 年以内で足りなければ同じ時代の候補で補う', () => {
    const all = [
      target,
      ev('near', 1650),
      ev('edo1', 1800),
      ev('edo2', 1850),
      ev('edo3', 1860),
      ev('heian1', 1000, { era: '平安' }),
      ev('heian2', 1100, { era: '平安' }),
    ];
    const picked = pickedIds(all);
    expect(picked).toContain('near');
    expect([...picked].sort()).toEqual(['edo1', 'edo2', 'edo3', 'near']);
    for (const seed of SEEDS) {
      expect(ids(pickDistractors(target, all, mulberry32(seed)))).toContain('near');
    }
  });

  it('同じ時代でも足りなければ全候補で補う', () => {
    const all = [
      target,
      ev('near', 1650),
      ev('edo', 1800),
      ev('heian1', 1000, { era: '平安' }),
      ev('heian2', 1100, { era: '平安' }),
    ];
    for (const seed of SEEDS) {
      const picked = ids(pickDistractors(target, all, mulberry32(seed)));
      expect(picked.slice(0, 2).sort()).toEqual(['edo', 'near']);
      expect(['heian1', 'heian2']).toContain(picked[2]);
    }
  });

  it('除外規則に当たる出来事は選ばない', () => {
    const all = [
      target,
      ev('same-year', 1600),
      ev('alt', 1590, { altYears: [1600] }),
      ev('a', 1610),
      ev('b', 1620),
      ev('c', 1630),
    ];
    expect([...pickedIds(all)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('誤答の候補が 3 件に満たなければ例外を投げる', () => {
    expect(() => pickDistractors(target, [target, ev('a', 1610)], mulberry32(1))).toThrow();
  });
});

describe('isCorrectYear', () => {
  const event = ev('kamakura', 1185, { altYears: [1192] });

  it('year に一致すれば正解', () => {
    expect(isCorrectYear(event, 1185)).toBe(true);
  });

  it('altYears のいずれかに一致すれば正解', () => {
    expect(isCorrectYear(event, 1192)).toBe(true);
    expect(isCorrectYear(ev('x', 1600, { altYears: [1601, 1602] }), 1602)).toBe(true);
  });

  it('どれにも一致しなければ不正解（近い年でも不正解）', () => {
    expect(isCorrectYear(event, 1184)).toBe(false);
    expect(isCorrectYear(event, 1193)).toBe(false);
  });
});
