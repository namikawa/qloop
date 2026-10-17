import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseCsv } from '../src/core/csv';
import { GEOGRAPHY_CSV_COLUMNS } from '../src/core/geography';

const root = fileURLToPath(new URL('..', import.meta.url));
function readRows(path: string, header?: readonly string[]) {
  const text = readFileSync(path, 'utf8');
  const columns =
    header ??
    text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)[0]
      .split(',');
  const parsed = parseCsv(text, columns);
  if (parsed.errors.length)
    throw new Error(
      `${path}: ${parsed.errors.map((error) => `${error.line}: ${error.message}`).join('\n')}`,
    );
  return parsed.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row.cells[index]])),
  );
}
function sameName(left: string, right: string): boolean {
  const parts = /^(.*?)（(.*?)）$/.exec(left);
  return left === right || (parts !== null && `${parts[2]}（${parts[1]}）` === right);
}
async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('使い方: npm run geography:images -- <素材のディレクトリ>');
  const questions = readRows(join(source, 'questions.csv'));
  const places = ['core.csv', 'pool.csv'].flatMap((file) =>
    readRows(join(root, 'data/decks/japanese-geography', file), GEOGRAPHY_CSV_COLUMNS),
  );
  const byId = new Map(places.map((place) => [place.id, place]));
  if (byId.size !== places.length || questions.length !== places.length)
    throw new Error('素材と教材の件数または id が一致しません');
  // 対応と寸法を全件確認してから書き込む。
  const inputs = [];
  for (const [index, question] of questions.entries()) {
    const id = `jg-${String(index + 1).padStart(4, '0')}`;
    const place = byId.get(id);
    if (!place || !sameName(question['名称'], place.name))
      throw new Error(`${id}: 素材の名称と name が一致しません`);
    const path = join(source, question['画像ファイル']);
    const metadata = await sharp(path).metadata();
    if (metadata.format !== 'png' || metadata.width !== 1440 || metadata.height !== 1260)
      throw new Error(`${id}: 1440×1260 の PNG が必要です`);
    inputs.push({ id, path });
  }
  const output = join(root, 'public/geography');
  mkdirSync(output, { recursive: true });
  for (const { id, path } of inputs) {
    await sharp(path)
      .extract({ left: 80, top: 215, width: 1280, height: 830 })
      .resize(1000, 648)
      .webp({ quality: 85 })
      .toFile(join(output, `${id}.webp`));
  }
  console.log(`${inputs.length} 枚を public/geography/ に書きました`);
  const extra = readdirSync(output).filter(
    (file) => !byId.has(file.replace(/\.webp$/, '')) || !file.endsWith('.webp'),
  );
  console.log(`教材に無いファイル: ${extra.length ? extra.join('、') : 'なし'}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
