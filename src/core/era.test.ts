import { describe, expect, it } from 'vitest';
import { ERAS, eraOfYear, isEra, resolveEra } from './era';

describe('時代区分表', () => {
  it('15 区分を開始年の昇順で持つ', () => {
    expect(ERAS).toHaveLength(15);
    const starts = ERAS.map((era) => era.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('eraOfYear', () => {
  it.each([
    [-401, '縄文'],
    [-400, '弥生'],
    [249, '弥生'],
    [250, '古墳'],
    [591, '古墳'],
    [592, '飛鳥'],
    [710, '奈良'],
    [794, '平安'],
    [1184, '平安'],
    [1185, '鎌倉'],
    [1333, '鎌倉'],
    [1334, '室町'],
    [1572, '室町'],
    [1573, '安土桃山'],
    [1603, '江戸'],
    [1867, '江戸'],
    [1868, '明治'],
    [1912, '大正'],
    [1926, '昭和'],
    [1989, '平成'],
    [2019, '令和'],
  ])('%i 年は %s', (year, era) => {
    expect(eraOfYear(year)).toBe(era);
  });
});

describe('resolveEra', () => {
  it('上書きが無ければ年から決める', () => {
    expect(resolveEra(1185, null)).toBe('鎌倉');
  });

  it('上書きがあればそれを使う（境界の年で表と感覚が合わない出来事）', () => {
    expect(resolveEra(1185, '平安')).toBe('平安');
    expect(resolveEra(1573, '室町')).toBe('室町');
  });
});

describe('isEra', () => {
  it('時代区分表にある名前だけを受け付ける', () => {
    expect(isEra('安土桃山')).toBe(true);
    expect(isEra('鎌倉時代')).toBe(false);
    expect(isEra('戦国')).toBe(false);
    expect(isEra('')).toBe(false);
  });
});
