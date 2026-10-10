import { describe, expect, it } from 'vitest';
import type { Event } from './models';
import { distractorCandidates, isChoiceEligible } from './quiz';

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
