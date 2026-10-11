import { describe, expect, it } from 'vitest';
import type { Event, Question } from './models';
import {
  distractorCandidates,
  eligibleQuestions,
  filterByScope,
  generateChoices,
  generateSession,
  isChoiceEligible,
  isCorrectYear,
  isYearInputEligible,
  pickDistractors,
  population,
} from './quiz';
import { mulberry32 } from './random';
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
  it('除外後の候補が 3 件以上なら 4 択に出せる', () => {
    const target = ev('a', 1600, { role: 'core' });
    expect(isChoiceEligible(target, [target, ev('b', 1603), ev('c', 1615), ev('d', 1637)])).toBe(
      true,
    );
  });

  it('除外後の候補が 2 件なら 4 択に出せない', () => {
    const target = ev('a', 1600, { role: 'core' });
    expect(isChoiceEligible(target, [target, ev('b', 1603), ev('c', 1615), ev('d', 1600)])).toBe(
      false,
    );
  });
});

/** 年の離れた core の出来事を `count` 件作る（どれも年号入力と 4 択の両方に適格）。 */
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
    expect(ids(population({ events }))).toEqual(['core', 'pool']);
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

describe('isYearInputEligible', () => {
  it('approx でなく year が正の出来事は年号入力に出せる', () => {
    expect(isYearInputEligible(ev('a', 710))).toBe(true);
    expect(isYearInputEligible(ev('a', 1))).toBe(true);
  });

  it('approx の出来事は出せない', () => {
    expect(isYearInputEligible(ev('a', 250, { approx: true }))).toBe(false);
  });

  it('紀元前（year が負）の出来事は出せない', () => {
    expect(isYearInputEligible(ev('a', -57))).toBe(false);
  });
});

describe('eligibleQuestions', () => {
  const filler = [ev('f1', 100), ev('f2', 900), ev('f3', 1700)];
  const both = ev('both', 1600, { role: 'core' });
  const approx = ev('approx', 250, { role: 'core', approx: true });
  const bc = ev('bc', -57, { role: 'core' });
  const all = [both, approx, bc, ...filler];
  const patternsOf = (mode: 'yearInput' | 'choice' | 'mixed', candidates = [both, approx, bc]) =>
    eligibleQuestions(candidates, all, mode).map(({ event, patterns }) => [event.id, patterns]);

  it('年号入力は年号入力に適格な出来事だけ', () => {
    expect(patternsOf('yearInput')).toEqual([['both', ['yearInput']]]);
  });

  it('4 択は誤答の候補が 3 件以上ある出来事', () => {
    expect(patternsOf('choice')).toEqual([
      ['both', ['choice']],
      ['approx', ['choice']],
      ['bc', ['choice']],
    ]);
  });

  it('ミックスは両方に適格なら両方、片方だけならその形式', () => {
    expect(patternsOf('mixed')).toEqual([
      ['both', ['yearInput', 'choice']],
      ['approx', ['choice']],
      ['bc', ['choice']],
    ]);
  });

  it('どちらにも適格でない出来事はミックスでも除外する', () => {
    // 誤答の候補が 2 件しかない approx の出来事
    const lonely = ev('lonely', 250, { role: 'core', approx: true });
    const events = [lonely, ev('x', 900), ev('y', 1700)];
    expect(eligibleQuestions([lonely], events, 'mixed')).toEqual([]);
  });

  it('4 択に適格でない出来事はミックスで年号入力だけになる', () => {
    const target = ev('target', 1600, { role: 'core' });
    const events = [target, ev('x', 900), ev('y', 1700)];
    expect(eligibleQuestions([target], events, 'mixed').map(({ patterns }) => patterns)).toEqual([
      ['yearInput'],
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
      id: question.event.id,
      pattern: question.pattern,
      choices: question.pattern === 'choice' ? ids(question.choices) : null,
    }));

  it('問題数が上限になり、同じ出来事は 1 回だけ出す', () => {
    const events = spread(25);
    for (const count of [10, 20] as const) {
      const questions = generateSession({
        candidates: events,
        allEvents: events,
        mode: 'mixed',
        count,
        rng: mulberry32(1),
      });
      expect(questions).toHaveLength(count);
      expect(new Set(questions.map((question) => question.event.id)).size).toBe(count);
    }
  });

  it('適格な出来事が問題数に満たなければ全件を出す', () => {
    const events = spread(7);
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'choice',
      count: 10,
      rng: mulberry32(1),
    });
    expect(ids(questions.map((question) => question.event)).sort()).toEqual(ids(events).sort());
  });

  it('全問は適格な全件を出し、適格でない出来事は出さない', () => {
    const events = [...spread(12), ev('approx', 1500, { role: 'core', approx: true })];
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'yearInput',
      count: 'all',
      rng: mulberry32(1),
    });
    expect(questions).toHaveLength(12);
    expect(ids(questions.map((question) => question.event))).not.toContain('approx');
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
          rng: mulberry32(seed),
        })
          .map((question) => question.event.id)
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
          rng: mulberry32(2026),
        }),
      );
    expect(run()).toEqual(run());
  });

  it('ミックスでは両方に適格な出来事のパターンを 1 問ごとにほぼ等確率で選ぶ', () => {
    const events = spread(20);
    let yearInput = 0;
    let total = 0;
    for (const seed of SEEDS) {
      for (const question of generateSession({
        candidates: events,
        allEvents: events,
        mode: 'mixed',
        count: 'all',
        rng: mulberry32(seed),
      })) {
        total++;
        if (question.pattern === 'yearInput') {
          yearInput++;
        }
      }
    }
    expect(total).toBe(SEEDS.length * events.length);
    expect(yearInput / total).toBeGreaterThan(0.4);
    expect(yearInput / total).toBeLessThan(0.6);
  });

  it('ミックスでは片方だけに適格な出来事はその形式で出す', () => {
    const events = [...spread(10), ev('approx', 1500, { role: 'core', approx: true })];
    for (const seed of SEEDS) {
      const question = generateSession({
        candidates: events,
        allEvents: events,
        mode: 'mixed',
        count: 'all',
        rng: mulberry32(seed),
      }).find((q) => q.event.id === 'approx');
      expect(question?.pattern).toBe('choice');
    }
  });

  it('4 択の問題は正解を含む 4 件の選択肢を持ち、年号入力の問題は選択肢を持たない', () => {
    const events = spread(20);
    const questions = generateSession({
      candidates: events,
      allEvents: events,
      mode: 'mixed',
      count: 'all',
      rng: mulberry32(5),
    });
    for (const question of questions) {
      if (question.pattern === 'choice') {
        expect(question.choices).toHaveLength(4);
        expect(new Set(ids(question.choices)).size).toBe(4);
        expect(question.choices).toContain(question.event);
      } else {
        expect(question).not.toHaveProperty('choices');
      }
    }
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

  it('4 つの並びをシャッフルする（正解の位置がシードによって変わる）', () => {
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
