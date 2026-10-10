import { describe, expect, it } from 'vitest';
import { formatEventYear, formatYear } from './year';

describe('formatEventYear', () => {
  it('通常の年は「○○年」', () => {
    expect(formatEventYear({ year: 710, approx: false, yearLabel: null })).toBe('710年');
  });

  it('紀元前は「紀元前○○年」', () => {
    expect(formatEventYear({ year: -57, approx: false, yearLabel: null })).toBe('紀元前57年');
  });

  it('approx は「○○年ごろ」「紀元前○○年ごろ」', () => {
    expect(formatEventYear({ year: 250, approx: true, yearLabel: null })).toBe('250年ごろ');
    expect(formatEventYear({ year: -350, approx: true, yearLabel: null })).toBe('紀元前350年ごろ');
  });

  it('year_label があればそれを使う', () => {
    expect(formatEventYear({ year: 250, approx: true, yearLabel: '3世紀' })).toBe('3世紀');
    expect(formatEventYear({ year: -350, approx: true, yearLabel: '紀元前4世紀ごろ' })).toBe(
      '紀元前4世紀ごろ',
    );
    expect(formatEventYear({ year: 1185, approx: false, yearLabel: '1185年（諸説あり）' })).toBe(
      '1185年（諸説あり）',
    );
  });
});

describe('formatYear', () => {
  it('approx を省略すると「ごろ」を付けない', () => {
    expect(formatYear(1192)).toBe('1192年');
    expect(formatYear(-1)).toBe('紀元前1年');
  });
});
