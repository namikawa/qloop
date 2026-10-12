import { describe, expect, it } from 'vitest';
import { buildDeck, CSV_COLUMNS } from './deck';

const HEADER = CSV_COLUMNS.join(',');

/** 8 列の行（id, year, title, era, approx, alt_years, year_label, level）から CSV を作る。 */
function csv(...rows: string[][]): string {
  return [HEADER, ...rows.map((row) => row.join(','))].join('\n') + '\n';
}

function row(
  id: string,
  year: string,
  title: string,
  rest: {
    era?: string;
    approx?: string;
    altYears?: string;
    yearLabel?: string;
    level?: string;
  } = {},
): string[] {
  return [
    id,
    year,
    title,
    rest.era ?? '',
    rest.approx ?? '',
    rest.altYears ?? '',
    rest.yearLabel ?? '',
    rest.level ?? '',
  ];
}

/** どの core 行にも誤答候補が 3 件以上そろうよう、年の離れた出来事を pool に置く。 */
const FILLER = [
  row('jh-0901', '100', '誤答用の出来事 1'),
  row('jh-0902', '900', '誤答用の出来事 2'),
  row('jh-0903', '1700', '誤答用の出来事 3'),
];

function build(core: string[][], pool: string[][] = FILLER) {
  return buildDeck({
    id: 'test',
    name: 'テスト',
    idPrefix: 'jh-',
    core: csv(...core),
    pool: csv(...pool),
  });
}

function errorsOf(result: ReturnType<typeof buildDeck>): string[] {
  return result.ok ? [] : result.errors;
}

describe('buildDeck', () => {
  it('CSV の行を Event に変換する', () => {
    const result = build([
      row('jh-0001', '710', '平城京に都を移す'),
      row('jh-0042', '1185', '鎌倉幕府の成立', { era: '鎌倉', altYears: '1192' }),
      row('jh-0300', '-350', '稲作が伝わる', {
        era: '弥生',
        approx: '1',
        yearLabel: '紀元前4世紀ごろ',
      }),
      row('jh-0400', '1185', '壇ノ浦の戦い', { era: '平安', level: '高校' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.id).toBe('test');
    expect(result.deck.kind).toBe('timeline');
    expect(result.deck.name).toBe('テスト');
    expect(result.deck.items.slice(0, 4)).toEqual([
      {
        id: 'jh-0001',
        year: 710,
        title: '平城京に都を移す',
        era: '奈良',
        approx: false,
        altYears: [],
        yearLabel: null,
        level: '中学',
        role: 'core',
      },
      {
        id: 'jh-0042',
        year: 1185,
        title: '鎌倉幕府の成立',
        era: '鎌倉',
        approx: false,
        altYears: [1192],
        yearLabel: null,
        level: '中学',
        role: 'core',
      },
      {
        id: 'jh-0300',
        year: -350,
        title: '稲作が伝わる',
        era: '弥生',
        approx: true,
        altYears: [],
        yearLabel: '紀元前4世紀ごろ',
        level: '中学',
        role: 'core',
      },
      {
        id: 'jh-0400',
        year: 1185,
        title: '壇ノ浦の戦い',
        era: '平安',
        approx: false,
        altYears: [],
        yearLabel: null,
        level: '高校',
        role: 'core',
      },
    ]);
    expect(result.deck.items.slice(4).map((event) => event.role)).toEqual(['pool', 'pool', 'pool']);
  });

  it('alt_years は ; 区切りで複数書け、セルの前後の空白は無視する', () => {
    const result = build([
      row('jh-0001', ' 1185 ', ' 鎌倉幕府の成立 ', { altYears: '1183; 1192' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.items[0]).toMatchObject({
      year: 1185,
      title: '鎌倉幕府の成立',
      altYears: [1183, 1192],
    });
  });

  it('id の重複をファイルをまたいで検出する', () => {
    const result = build(
      [row('jh-0001', '710', '平城京に都を移す')],
      [...FILLER, row('jh-0001', '794', '平安京に都を移す')],
    );
    expect(errorsOf(result)).toEqual([
      'pool.csv 5 行目 id: 「jh-0001」は core.csv 2 行目と重複しています',
    ]);
  });

  it('title の重複をファイルをまたいで検出する', () => {
    const result = build(
      [row('jh-0001', '710', '平城京に都を移す')],
      [...FILLER, row('jh-0002', '711', '平城京に都を移す')],
    );
    expect(errorsOf(result)).toEqual([
      'pool.csv 5 行目 title: 「平城京に都を移す」は core.csv 2 行目と重複しています',
    ]);
  });

  it('id は jh- で始まり、必須', () => {
    const result = build([row('ab-0001', '710', '出来事 A'), row('', '794', '出来事 B')]);
    expect(errorsOf(result)).toEqual([
      expect.stringMatching(/^core\.csv 2 行目 id: 「ab-0001」は jh- で始めて/),
      'core.csv 3 行目 id: 必須です',
    ]);
  });

  it('仮データの demo- で始まる id は受け付けない', () => {
    const result = build([row('demo-0001', '710', '出来事 A')]);
    expect(errorsOf(result)).toEqual(['core.csv 2 行目 id: 「demo-0001」は jh- で始めてください']);
  });

  it('id の接頭辞は教材の定義から受け取る', () => {
    const result = buildDeck({
      id: 'other',
      name: '別の年表',
      idPrefix: 'th-',
      core: csv(row('th-0001', '710', '出来事 A'), row('jh-0002', '794', '出来事 B')),
      pool: csv(
        row('th-0901', '100', '誤答用の出来事 1'),
        row('th-0902', '900', '誤答用の出来事 2'),
        row('th-0903', '1700', '誤答用の出来事 3'),
      ),
    });
    expect(errorsOf(result)).toEqual(['core.csv 3 行目 id: 「jh-0002」は th- で始めてください']);
  });

  it('year は 0 以外の整数', () => {
    const result = build([
      row('jh-0001', '0', '出来事 A'),
      row('jh-0002', '71.5', '出来事 B'),
      row('jh-0003', '0710', '出来事 C'),
      row('jh-0004', '', '出来事 D'),
    ]);
    expect(errorsOf(result)).toEqual([
      expect.stringMatching(/^core\.csv 2 行目 year: 「0」は 0 以外の整数/),
      expect.stringMatching(/^core\.csv 3 行目 year: 「71\.5」は 0 以外の整数/),
      expect.stringMatching(/^core\.csv 4 行目 year: 「0710」は 0 以外の整数/),
      'core.csv 5 行目 year: 必須です',
    ]);
  });

  it('title は必須', () => {
    const result = build([row('jh-0001', '710', '')]);
    expect(errorsOf(result)).toEqual(['core.csv 2 行目 title: 必須です']);
  });

  it('era は時代区分表にある名前に限る', () => {
    const result = build([row('jh-0001', '1185', '出来事 A', { era: '鎌倉時代' })]);
    expect(errorsOf(result)).toEqual([
      expect.stringMatching(/^core\.csv 2 行目 era: 「鎌倉時代」は時代区分表にありません/),
    ]);
  });

  it('alt_years は year と異なる整数', () => {
    const result = build([
      row('jh-0001', '1185', '出来事 A', { altYears: '1185' }),
      row('jh-0002', '1185', '出来事 B', { altYears: '1192;x' }),
      row('jh-0003', '1185', '出来事 C', { altYears: '1192;' }),
    ]);
    expect(errorsOf(result)).toEqual([
      'core.csv 2 行目 alt_years: 「1185」は year と同じです',
      expect.stringMatching(/^core\.csv 3 行目 alt_years: 「x」は 0 以外の整数/),
      expect.stringMatching(/^core\.csv 4 行目 alt_years: 「」は 0 以外の整数/),
    ]);
  });

  it('approx は 1 か空', () => {
    const result = build([
      row('jh-0001', '710', '出来事 A', { approx: '1' }),
      row('jh-0002', '794', '出来事 B', { approx: '2' }),
      row('jh-0003', '894', '出来事 C', { approx: 'true' }),
    ]);
    expect(errorsOf(result)).toEqual([
      'core.csv 3 行目 approx: 「2」は 1 か空にしてください',
      'core.csv 4 行目 approx: 「true」は 1 か空にしてください',
    ]);
  });

  it('level は 中学・高校・空のいずれか', () => {
    const result = build([
      row('jh-0001', '710', '出来事 A', { level: '中学' }),
      row('jh-0002', '794', '出来事 B', { level: '高校' }),
      row('jh-0003', '894', '出来事 C', { level: '大学' }),
    ]);
    expect(errorsOf(result)).toEqual([
      'core.csv 4 行目 level: 「大学」は 中学・高校・空のいずれかにしてください',
    ]);
  });

  it('core の行で除外規則の適用後の誤答候補が 3 件未満ならエラーにする', () => {
    const result = build(
      [
        row('jh-0001', '250', '古墳がつくられはじめる', {
          approx: '1',
          yearLabel: '3世紀中ごろ',
        }),
      ],
      [
        row('jh-0101', '239', '卑弥呼が魏に使いを送る'),
        row('jh-0102', '250', '同じ年の出来事'),
        row('jh-0103', '538', '仏教が伝わる'),
        row('jh-0104', '57', '金印を授かる'),
      ],
    );
    expect(errorsOf(result)).toEqual([
      'core.csv 2 行目 year: 出来事 4 択の誤答候補が 2 件しかありません（除外規則の適用後に 3 件以上必要です）',
    ]);
  });

  it('pool の行は誤答候補が少なくてもエラーにしない', () => {
    const result = build([], [row('jh-0101', '239', '卑弥呼が魏に使いを送る')]);
    expect(result.ok).toBe(true);
  });

  it('CSV の形式の誤りもファイル名と行番号を付けて返す', () => {
    const result = buildDeck({
      id: 'test',
      name: 'テスト',
      idPrefix: 'jh-',
      core: 'jh-0001,710,出来事 A,,,,,\n',
      pool: csv(...FILLER) + 'jh-0904,1800\n',
    });
    expect(errorsOf(result)).toEqual([
      expect.stringMatching(/^core\.csv 1 行目: ヘッダー行が/),
      'pool.csv 5 行目: 列の数が 2 です（8 列必要です）',
    ]);
  });

  it('エラーはファイル順・行番号順に並べる', () => {
    const result = buildDeck({
      id: 'test',
      name: 'テスト',
      idPrefix: 'jh-',
      core: csv(row('jh-0001', '0', '出来事 A')) + 'jh-0002,"x\n' + 'jh-0003,1,2\n',
      pool: csv(row('jh-0101', 'x', '出来事 B')),
    });
    expect(errorsOf(result).map((error) => error.split(/[ :]/).slice(0, 2).join(' '))).toEqual([
      'core.csv 2',
      'core.csv 3',
      'core.csv 4',
      'pool.csv 2',
    ]);
  });

  it('エラーは全件をまとめて返す', () => {
    const result = build([
      row('xx-0001', '0', '', { era: '戦国', approx: 'y', altYears: 'a', level: '小学' }),
      row('jh-0002', '710', '出来事 B'),
      row('jh-0002', '710', '出来事 B'),
    ]);
    expect(errorsOf(result).map((error) => error.split(':')[0])).toEqual([
      'core.csv 2 行目 id',
      'core.csv 2 行目 year',
      'core.csv 2 行目 title',
      'core.csv 2 行目 era',
      'core.csv 2 行目 approx',
      'core.csv 2 行目 alt_years',
      'core.csv 2 行目 level',
      'core.csv 4 行目 id',
      'core.csv 4 行目 title',
    ]);
  });
});
