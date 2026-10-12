import { describe, expect, it } from 'vitest';
import type { Era, Event } from './models';
import { filterByRange, formatRange, parseRangeYear, validateRange } from './range';

function ev(id: string, year: number, era: Era, extra: Partial<Event> = {}): Event {
  return {
    id,
    year,
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

const EVENTS = [
  ev('bc', -350, '弥生', { approx: true }),
  ev('y239', 239, '弥生'),
  ev('y710', 710, '奈良'),
  ev('y1185', 1185, '鎌倉', { altYears: [1192] }),
  // 境界の年で時代を上書きした出来事（年から決めると鎌倉）
  ev('dan', 1185, '平安'),
  ev('y1600', 1600, '安土桃山'),
  ev('y1945', 1945, '昭和'),
];

const ids = (events: Event[]) => events.map((event) => event.id);

describe('filterByRange', () => {
  it('全範囲は絞り込まない', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'all' }))).toEqual(ids(EVENTS));
  });

  it('年号の範囲は両端を含む', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'years', from: 710, to: 1600 }))).toEqual([
      'y710',
      'y1185',
      'dan',
      'y1600',
    ]);
  });

  it('開始年が空なら下側が開いた範囲になり、紀元前の出来事も含む', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'years', from: null, to: 710 }))).toEqual([
      'bc',
      'y239',
      'y710',
    ]);
  });

  it('終了年が空なら上側が開いた範囲になる', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'years', from: 1600, to: null }))).toEqual([
      'y1600',
      'y1945',
    ]);
  });

  it('両方空なら全範囲と同じ', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'years', from: null, to: null }))).toEqual(
      ids(EVENTS),
    );
  });

  it('開始年があれば紀元前の出来事は含まない（開始年が 1 でも）', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'years', from: 1, to: 300 }))).toEqual(['y239']);
  });

  it('判定には代表年だけを使い、altYears は使わない', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'years', from: 1190, to: 1199 }))).toEqual([]);
  });

  it('時代は複数選択でき、確定した時代（上書きを反映したもの）で絞り込む', () => {
    expect(ids(filterByRange(EVENTS, { kind: 'eras', eras: ['平安', '昭和'] }))).toEqual([
      'dan',
      'y1945',
    ]);
    expect(ids(filterByRange(EVENTS, { kind: 'eras', eras: ['鎌倉'] }))).toEqual(['y1185']);
  });
});

describe('validateRange', () => {
  it('開始できる範囲なら null', () => {
    expect(validateRange({ kind: 'all' })).toBeNull();
    expect(validateRange({ kind: 'years', from: 710, to: 710 })).toBeNull();
    expect(validateRange({ kind: 'years', from: null, to: null })).toBeNull();
    expect(validateRange({ kind: 'years', from: 1600, to: null })).toBeNull();
    expect(validateRange({ kind: 'eras', eras: ['江戸'] })).toBeNull();
  });

  it('開始年が終了年より大きいときは理由を返す', () => {
    expect(validateRange({ kind: 'years', from: 1601, to: 1600 })).toBe(
      '開始年が終了年より後になっています',
    );
  });

  it('時代を 1 つも選んでいないときは理由を返す', () => {
    expect(validateRange({ kind: 'eras', eras: [] })).toBe('時代を 1 つ以上選んでください');
  });
});

describe('parseRangeYear', () => {
  it('空（空白だけを含む）は null（開いた範囲）', () => {
    expect(parseRangeYear('')).toBeNull();
    expect(parseRangeYear('  ')).toBeNull();
  });

  it('1〜4 桁の正の整数を受け付ける（全角も可）', () => {
    expect(parseRangeYear('1')).toBe(1);
    expect(parseRangeYear('1600')).toBe(1600);
    expect(parseRangeYear('０７１０')).toBe(710);
  });

  it('0、5 桁、負数、小数、文字は無効（undefined）', () => {
    expect(parseRangeYear('0')).toBeUndefined();
    expect(parseRangeYear('0000')).toBeUndefined();
    expect(parseRangeYear('12345')).toBeUndefined();
    expect(parseRangeYear('-350')).toBeUndefined();
    expect(parseRangeYear('1.5')).toBeUndefined();
    expect(parseRangeYear('abc')).toBeUndefined();
  });
});

describe('formatRange', () => {
  it('範囲を表示用の文字列にする', () => {
    expect(formatRange({ kind: 'all' })).toBe('全範囲');
    expect(formatRange({ kind: 'years', from: 700, to: 1600 })).toBe('700年〜1600年');
    expect(formatRange({ kind: 'years', from: 700, to: null })).toBe('700年〜');
    expect(formatRange({ kind: 'years', from: null, to: 1600 })).toBe('〜1600年');
    expect(formatRange({ kind: 'years', from: null, to: null })).toBe('全範囲');
    expect(formatRange({ kind: 'eras', eras: ['奈良', '江戸'] })).toBe('奈良・江戸');
  });
});
