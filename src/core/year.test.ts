import { describe, expect, it } from 'vitest';
import {
  formatAnswerYears,
  formatEventYear,
  formatYear,
  normalizeYearInput,
  splitYearText,
} from './year';

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

describe('formatAnswerYears', () => {
  it('altYears が無ければ年の表示だけ', () => {
    expect(formatAnswerYears({ year: 710, approx: false, yearLabel: null, altYears: [] })).toBe(
      '710年',
    );
  });

  it('altYears があれば併記する', () => {
    expect(
      formatAnswerYears({ year: 1185, approx: false, yearLabel: null, altYears: [1192] }),
    ).toBe('1185年・1192年');
  });

  it('year_label があればそれを使う', () => {
    expect(formatAnswerYears({ year: 250, approx: true, yearLabel: '3世紀', altYears: [] })).toBe(
      '3世紀',
    );
  });
});

describe('normalizeYearInput', () => {
  it('1〜4 桁の数字を整数にする', () => {
    expect(normalizeYearInput('7')).toBe(7);
    expect(normalizeYearInput('710')).toBe(710);
    expect(normalizeYearInput('1185')).toBe(1185);
  });

  it('前後の空白を除く（全角の空白も）', () => {
    expect(normalizeYearInput(' 1185 ')).toBe(1185);
    expect(normalizeYearInput('　1185　')).toBe(1185);
  });

  it('全角数字を半角に直す（混在も可）', () => {
    expect(normalizeYearInput('１１８５')).toBe(1185);
    expect(normalizeYearInput('１1８5')).toBe(1185);
  });

  it('先頭の 0 は無視する', () => {
    expect(normalizeYearInput('0710')).toBe(710);
    expect(normalizeYearInput('０７１０')).toBe(710);
  });

  it('空は null', () => {
    expect(normalizeYearInput('')).toBeNull();
    expect(normalizeYearInput('   ')).toBeNull();
  });

  it('5 桁以上は null', () => {
    expect(normalizeYearInput('11850')).toBeNull();
    expect(normalizeYearInput('01185')).toBeNull();
  });

  it('数字以外を含むと null', () => {
    expect(normalizeYearInput('abc')).toBeNull();
    expect(normalizeYearInput('1185年')).toBeNull();
    expect(normalizeYearInput('-350')).toBeNull();
    expect(normalizeYearInput('+710')).toBeNull();
    expect(normalizeYearInput('7 10')).toBeNull();
    expect(normalizeYearInput('1.5')).toBeNull();
  });
});

describe('splitYearText', () => {
  it('数字とその後ろに分ける', () => {
    expect(splitYearText('1467年')).toEqual({ prefix: '', number: '1467', suffix: '年' });
    expect(splitYearText('250年ごろ')).toEqual({ prefix: '', number: '250', suffix: '年ごろ' });
    expect(splitYearText('11世紀初めごろ')).toEqual({
      prefix: '',
      number: '11',
      suffix: '世紀初めごろ',
    });
  });

  it('数字の前の文字も分ける', () => {
    expect(splitYearText('紀元前57年ごろ')).toEqual({
      prefix: '紀元前',
      number: '57',
      suffix: '年ごろ',
    });
  });

  it('数字が無ければ全体を prefix にする', () => {
    expect(splitYearText('不明')).toEqual({ prefix: '不明', number: '', suffix: '' });
  });
});
