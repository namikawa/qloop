/**
 * 教材の定義の一覧（src/core/decks.ts）を回し、各教材の data/decks/<dir>/ の core.csv（追加データがある教材は pool.csv も）を検証して、
 * src/generated/decks.json（教材の配列）を書く。
 * 検証に失敗したら全教材の全エラーを教材名・ファイル名・行番号付きで出し、終了コード 1 で終わる（ビルドを止める）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeckFromCsv, DECK_DEFINITIONS, deckModel } from '../src/core/decks';
import type { Deck } from '../src/core/models';

const root = fileURLToPath(new URL('..', import.meta.url));
const outFile = new URL('../src/generated/decks.json', import.meta.url);

const decks: Deck[] = [];
const errors: string[] = [];
for (const definition of DECK_DEFINITIONS) {
  const deckDir = new URL(`../data/decks/${definition.dir}/`, import.meta.url);
  const result = buildDeckFromCsv(definition, {
    core: readFileSync(new URL('core.csv', deckDir), 'utf8'),
    ...(definition.hasPool !== false
      ? { pool: readFileSync(new URL('pool.csv', deckDir), 'utf8') }
      : {}),
  });
  if (result.ok) {
    decks.push(result.deck);
  } else {
    errors.push(...result.errors.map((error) => `${definition.name} ${error}`));
  }
}

if (errors.length > 0) {
  console.error(`データの検証に失敗しました（${errors.length} 件）`);
  for (const error of errors) {
    console.error(`  ${error}`);
  }
  process.exit(1);
}

const outPath = fileURLToPath(outFile);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(decks, null, 2)}\n`);

console.log(`${relative(root, outPath)} を書きました`);
for (const deck of decks) {
  const { labels } = deckModel(deck).rules;
  const core = deck.items.filter((item) => item.role === 'core').length;
  const pool = deck.items.filter((item) => item.role === 'pool').length;
  const highSchool = deck.items.filter((item) => item.level === '高校').length;
  const targets = deck.items.filter((item) => item.level === '中学').length;
  if (labels.core === null) {
    console.log(`  ${deck.name}: ${targets} 件`);
    continue;
  }
  console.log(
    `  ${deck.name}: ${labels.core} ${core} 件、追加データ ${pool} 件（うち高校 ${highSchool} 件）、出題対象 ${targets} 件`,
  );
}
