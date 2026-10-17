import { describe, expect, it } from 'vitest';
import { browseGroups } from './browse';
import { GEOGRAPHY_RULES } from './decks';
import {
  buildGeographyDeck,
  buildQuestion,
  distractorCandidates,
  eligibleQuestions,
  filterByRange,
  formatGeographyRange,
  generateChoices,
  generateSession,
  GEOGRAPHY_CSV_COLUMNS,
  geographyGroup,
  isCorrectName,
  isEligibleFor,
  normalizeGeographyInput,
  normalizeGeographySettings,
} from './geography';
import type { GeoPlace, GeographySettings } from './models';

const place = (id: string, overrides: Partial<GeoPlace> = {}): GeoPlace => ({
  id,
  name: `川${id}`,
  reading: `かわ${id}`,
  category: '河川',
  regions: ['中部'],
  question: '川の名前は？',
  note: null,
  altNames: [],
  similar: [],
  level: '中学',
  role: 'core',
  ...overrides,
});
const header = GEOGRAPHY_CSV_COLUMNS.join(',');
const row = ['jg-0001', '信濃川', 'しなのがわ', '河川', '中部', '川の名前は？', '', '', ''];
function build(rows: string[][], pool: string[][] = []) {
  return buildGeographyDeck({
    id: 'japanese-geography',
    name: '日本地理',
    idPrefix: 'jg-',
    core: [header, ...rows.map((row) => row.join(','))].join('\n'),
    pool: [header, ...pool.map((row) => row.join(','))].join('\n'),
  });
}
function errors(rows: string[][], pool: string[][] = []): string[] {
  const result = build(rows, pool);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe('日本地理の CSV', () => {
  it('列を変換し、ファイルによる role と全行の中学を設定する。不適格な地名も受け付ける', () => {
    const second = [...row];
    second[0] = 'jg-0002';
    second[1] = '別の川';
    second[4] = '東北／関東';
    second[6] = '注記';
    second[7] = '別名;べつめい';
    second[8] = 'jg-0001';
    const result = build([row], [second]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.items[0]).toMatchObject({
      level: '中学',
      role: 'core',
      note: null,
      altNames: [],
      regions: ['中部'],
    });
    expect(result.deck.items[1]).toMatchObject({
      role: 'pool',
      note: '注記',
      altNames: ['別名', 'べつめい'],
      similar: ['jg-0001'],
      regions: ['東北', '関東'],
    });
  });
  it.each(['id', 'name', 'reading', 'category', 'question'] as const)('%s は必須', (column) => {
    const invalid = [...row];
    invalid[GEOGRAPHY_CSV_COLUMNS.indexOf(column)] = '';
    expect(errors([invalid]).join('\n')).toContain(`core.csv 2 行目 ${column}: 必須`);
  });
  it.each([
    ['id', 'jh-0001', 'jg-'],
    ['id', 'jg-', 'jg-'],
    ['category', '未知', '分類の一覧'],
    ['regions', '全国沿岸', '地方の一覧'],
    ['regions', '中部／', '地方の一覧'],
    ['question', 'あ'.repeat(31), '30 字'],
    ['note', 'あ'.repeat(51), '50 字'],
    ['alt_names', '別名;', '空の値'],
    ['alt_names', '信濃川', '重複'],
    ['alt_names', 'しなのがわ', '重複'],
    ['similar', 'jg-9999', '存在しません'],
    ['similar', 'jg-0001', '自分自身'],
  ] as const)('%s の不正値を検出: %s', (column, value, message) => {
    const invalid = [...row];
    invalid[GEOGRAPHY_CSV_COLUMNS.indexOf(column)] = value;
    expect(errors([invalid]).join('\n')).toContain(` ${column}:`);
    expect(errors([invalid]).join('\n')).toContain(message);
  });
  it('ファイルをまたぐ id と名前の重複を全件返す', () => {
    const found = errors([row], [row]);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('pool.csv 2 行目 id:');
    expect(found[1]).toContain('pool.csv 2 行目 name:');
  });
  it('CSV の形式の誤りもファイルと行番号を付ける', () => {
    const result = buildGeographyDeck({
      id: 'x',
      name: 'x',
      idPrefix: 'jg-',
      core: 'invalid',
      pool: `${header}\nshort`,
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [
        expect.stringContaining('core.csv 1 行目:'),
        expect.stringContaining('pool.csv 2 行目:'),
      ],
    });
  });
  it('コードポイントで長さを数える', () => {
    const valid = [...row];
    valid[5] = '𠮷'.repeat(30);
    valid[6] = '𠮷'.repeat(50);
    expect(build([valid]).ok).toBe(true);
  });
});

describe('名前入力', () => {
  it.each([
    ['　 １３５ 度　', '135度'],
    ['黒 潮\t\n', '黒潮'],
    ['霞ヶ浦', '霞け浦'],
    ['槍ケ岳', '槍け岳'],
    ['サロマ湖', 'さろま湖'],
    ['クローシオ（日本）！', 'くろーしお(日本)!'],
  ])('正規化 %s', (input, expected) => expect(normalizeGeographyInput(input)).toBe(expected));
  it.each([
    ['霞ヶ浦', '霞ケ浦'],
    ['槍ヶ岳', '槍ケ岳'],
    ['サロマ湖', 'さろま湖'],
  ])('%s と %s は一致', (name, input) => {
    expect(isCorrectName(input, place('jg-1', { name }))).toBe(true);
  });
  it('名前・読み・別解で正解。空と誤答は不正解', () => {
    const target = place('jg-1', {
      name: '黒潮（日本海流）',
      reading: 'くろしお（にほんかいりゅう）',
      altNames: ['黒潮', 'くろしお', '日本海流', 'にほんかいりゅう'],
    });
    for (const input of [target.name, target.reading, ...target.altNames])
      expect(isCorrectName(input, target)).toBe(true);
    for (const input of ['', '　 ', '親潮']) expect(isCorrectName(input, target)).toBe(false);
  });
  it('県庁所在地の市・しは省略できる。東京に都は足せない', () => {
    const capital = place('jg-1', {
      name: '札幌市',
      reading: 'さっぽろし',
      category: '都道府県庁所在地',
    });
    for (const input of ['札幌市', 'さっぽろし', '札幌', 'さっぽろ'])
      expect(isCorrectName(input, capital)).toBe(true);
    const tokyo = { ...capital, name: '東京', reading: 'とうきょう' };
    for (const input of ['東京', 'とうきょう']) expect(isCorrectName(input, tokyo)).toBe(true);
    for (const input of ['東京都', '新宿区', 'とうきょうと'])
      expect(isCorrectName(input, tokyo)).toBe(false);
    expect(isCorrectName('札幌', { ...capital, category: '河川' })).toBe(false);
  });
});

describe('適格条件と選択肢', () => {
  const all = Array.from({ length: 8 }, (_, i) =>
    place(`jg-${i}`, { regions: i < 4 ? ['中部'] : ['東北'] }),
  );
  it('候補数と同じ問いの文の候補の両方を要する。入力は全件適格', () => {
    expect(isEligibleFor(all[0], 'geoNameChoice', all.slice(0, 3))).toBe(false);
    const special = { ...all[0], question: '特殊な問い？' };
    expect(isEligibleFor(special, 'geoNameChoice', [special, ...all.slice(1)])).toBe(false);
    expect(isEligibleFor(all[0], 'geoNameChoice', all)).toBe(true);
    expect(isEligibleFor(special, 'geoNameInput', [special])).toBe(true);
    expect(() => generateChoices(special, [special], Math.random)).toThrow();
  });
  it('同じ分類から選び、similar は両方向に除外する', () => {
    const target = { ...all[0], similar: [all[1].id] };
    const candidates = [
      target,
      all[1],
      { ...all[2], similar: [target.id] },
      { ...all[3], category: '湖' },
      all[4],
    ];
    expect(distractorCandidates(target, candidates).map((item) => item.id)).toEqual([all[4].id]);
  });
  it('地方の重なる候補を優先し、足りないときは同じ分類から補う', () => {
    for (let seed = 0; seed < 10; seed++) {
      const choices = generateChoices(all[0], all, () => seed / 10);
      expect(new Set(choices.map((item) => item.id))).toEqual(
        new Set(all.slice(0, 4).map((item) => item.id)),
      );
    }
    const reduced = [all[0], all[1], ...all.slice(4)];
    const choices = generateChoices(all[0], reduced, () => 0.5);
    expect(choices).toHaveLength(4);
    expect(choices).toContain(all[1]);
    const empty = { ...all[0], regions: [] };
    expect(generateChoices(empty, [empty, ...all.slice(1)], () => 0.5)).toHaveLength(4);
  });
  it('セッションは重複を除き、適格なパターンだけから作る', () => {
    const onlyInput = place('jg-other', { category: '標準時子午線' });
    const candidates = [...all, all[0], onlyInput];
    expect(eligibleQuestions(candidates, candidates, 'geoNameChoice')).toHaveLength(8);
    const session = generateSession({
      candidates,
      allPlaces: candidates,
      mode: 'mixed',
      count: 'all',
      rng: () => 0.5,
    });
    expect(session).toHaveLength(9);
    expect(session.find((question) => question.item.id === onlyInput.id)?.pattern).toBe(
      'geoNameInput',
    );
    expect(
      generateSession({
        candidates,
        allPlaces: candidates,
        mode: 'geoNameInput',
        count: 10,
        rng: () => 0.5,
      }),
    ).toHaveLength(9);
    expect(buildQuestion(all[0], 'geoNameChoice', all, 0, () => 0.5)).toMatchObject({
      pattern: 'geoNameChoice',
      choices: expect.any(Array),
    });
  });
});

describe('範囲・保存・一覧', () => {
  const mountain = place('jg-0001', { category: '山脈' });
  const river = place('jg-0002');
  const lake = place('jg-0003', { category: '湖' });
  it('まとめを使って絞り、表の順に読点で表示する', () => {
    expect(geographyGroup(mountain)).toBe('山地・山脈');
    expect(
      filterByRange([mountain, river, lake], { kind: 'categories', categories: ['川・湖'] }),
    ).toEqual([river, lake]);
    expect(filterByRange([river], { kind: 'all' })).toEqual([river]);
    expect(filterByRange([river], { kind: 'categories', categories: [] })).toEqual([]);
    expect(formatGeographyRange({ kind: 'categories', categories: ['川・湖', '山地・山脈'] })).toBe(
      '山地・山脈、川・湖',
    );
    expect(formatGeographyRange(null)).toBe('');
    expect(formatGeographyRange({ kind: 'all' })).toBe('全範囲');
    expect(GEOGRAPHY_RULES.browseRangeText?.([])).toBe('すべての分類');
    expect(GEOGRAPHY_RULES.browseRangeText?.(['川・湖', '山地・山脈'])).toBe('山地・山脈、川・湖');
  });
  it('保存した範囲の未知のまとめを除き、空なら全範囲に戻す', () => {
    const settings: GeographySettings = {
      scope: 'all',
      pattern: 'mixed',
      count: 20,
      range: { kind: 'categories', categories: ['川・湖', '未知', '山地・山脈', '川・湖'] },
    };
    expect(normalizeGeographySettings(settings)).toEqual({
      ...settings,
      range: { kind: 'categories', categories: ['山地・山脈', '川・湖'] },
    });
    expect(
      normalizeGeographySettings({
        ...settings,
        range: { kind: 'categories', categories: ['未知'] },
      }).range,
    ).toEqual({ kind: 'all' });
  });
  it('一覧はまとめ順・id 順。元の配列は変えない', () => {
    const input = [lake, river, mountain];
    expect(
      browseGroups(input, GEOGRAPHY_RULES, 'all', []).map((group) => [
        group.name,
        group.items.map((item) => item.id),
      ]),
    ).toEqual([
      ['山地・山脈', [mountain.id]],
      ['川・湖', [river.id, lake.id]],
    ]);
    expect(input).toEqual([lake, river, mountain]);
    expect(GEOGRAPHY_RULES.itemDetail(river)).toBe('かわjg-0002 · 河川 · 中部');
    expect(GEOGRAPHY_RULES.answerText({ ...river, regions: [] })).toBe('河川');
  });
});
