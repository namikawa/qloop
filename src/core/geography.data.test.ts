import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildGeographyDeck, generateChoices, isEligibleFor } from './geography';

const root = new URL('../../', import.meta.url);
const result = buildGeographyDeck({
  id: 'japanese-geography',
  name: '日本地理',
  idPrefix: 'jg-',
  core: readFileSync(new URL('data/decks/japanese-geography/core.csv', root), 'utf8'),
  pool: readFileSync(new URL('data/decks/japanese-geography/pool.csv', root), 'utf8'),
});
if (!result.ok) throw new Error(result.errors.join('\n'));
const items = result.deck.items;
describe('日本地理の実データ', () => {
  it('310 件を重複なく持つ。基本142・追加168', () => {
    expect(items).toHaveLength(310);
    expect(items.filter((item) => item.role === 'core')).toHaveLength(142);
    expect(items.filter((item) => item.role === 'pool')).toHaveLength(168);
    expect(items.map((item) => item.id).sort()).toEqual(
      Array.from({ length: 310 }, (_, i) => `jg-${String(i + 1).padStart(4, '0')}`),
    );
  });
  it('名前4択に不適格なのは指定の9件だけ。適格な全行で重複のない4択を生成する', () => {
    expect(
      items
        .filter((item) => !isEligibleFor(item, 'geoNameChoice', items))
        .map((item) => item.id)
        .sort(),
    ).toEqual(
      [29, 105, 106, 107, 253, 254, 255, 262, 263].map((n) => `jg-${String(n).padStart(4, '0')}`),
    );
    for (const item of items) {
      expect(isEligibleFor(item, 'geoNameInput', items)).toBe(true);
      if (!isEligibleFor(item, 'geoNameChoice', items)) continue;
      for (let i = 0; i < 4; i++) {
        const choices = generateChoices(item, items, Math.random);
        expect(choices).toContain(item);
        expect(new Set(choices.map((choice) => choice.name)).size).toBe(4);
      }
    }
  });
  it('全行の画像が1000×648のWebPで、メタデータを持たない', async () => {
    expect(readdirSync(new URL('public/geography/', root))).toHaveLength(310);
    await Promise.all(
      items.map(async (item) => {
        const metadata = await sharp(
          readFileSync(new URL(`public/geography/${item.id}.webp`, root)),
        ).metadata();
        expect(metadata).toMatchObject({ width: 1000, height: 648, format: 'webp' });
        expect(metadata.exif).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
      }),
    );
  });
  it('問いは30字以内の疑問文、注記は指定の13文または空', () => {
    const notes = new Set([
      '帯は山地・山脈のおおよその範囲です。',
      '網掛けは地形のおおよその範囲です。',
      '▲は山の位置を表します。',
      '流路は簡略化して示しています。',
      '湖岸は簡略化して示しています。',
      '網掛けは半島のおおよその範囲です。',
      '●・○は都道府県庁所在地を表します。',
      '小さな島は位置記号で示すことがあります。',
      '破線の囲みは主な島のまとまりを示します。小島は位置記号の場合があります。',
      '太線は海岸・砂丘のおおよその範囲です。',
      '矢印は海流の主な流れる向きを表します。',
      '海流とその出合う範囲は概略です。',
      '破線は日本の標準時子午線を表します。',
      null,
    ]);
    for (const item of items) {
      expect(item.question.endsWith('？')).toBe(true);
      expect([...item.question].length).toBeLessThanOrEqual(30);
      expect(notes.has(item.note)).toBe(true);
    }
  });
  it('別解とsimilarは指定の行に指定の値だけを持つ', () => {
    expect(
      Object.fromEntries(
        items.filter((item) => item.altNames.length).map((item) => [item.id, item.altNames]),
      ),
    ).toEqual({
      'jg-0216': ['錦江湾', 'きんこうわん'],
      'jg-0260': ['日本海流', 'にほんかいりゅう', '黒潮', 'くろしお'],
      'jg-0261': ['千島海流', 'ちしまかいりゅう', '親潮', 'おやしお'],
      'jg-0262': ['潮境', 'しおざかい'],
      'jg-0263': ['135', '135度'],
    });
    expect(
      Object.fromEntries(
        items.filter((item) => item.similar.length).map((item) => [item.id, item.similar]),
      ),
    ).toEqual({
      'jg-0128': ['jg-0140'],
      'jg-0114': ['jg-0119'],
      'jg-0141': ['jg-0145', 'jg-0146'],
      'jg-0146': ['jg-0145'],
    });
  });
});
