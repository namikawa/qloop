/**
 * data/decks/japanese-history/ の core.csv と pool.csv を検証し、src/generated/deck.json を書く。
 * 検証に失敗したら全エラーを出して終了コード 1 で終わる（ビルドを止める）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeck } from '../src/core/deck';

const root = fileURLToPath(new URL('..', import.meta.url));
const deckDir = new URL('../data/decks/japanese-history/', import.meta.url);
const outFile = new URL('../src/generated/deck.json', import.meta.url);

const result = buildDeck({
  id: 'japanese-history',
  name: '日本史年表',
  core: readFileSync(new URL('core.csv', deckDir), 'utf8'),
  pool: readFileSync(new URL('pool.csv', deckDir), 'utf8'),
});

if (!result.ok) {
  console.error(`データの検証に失敗しました（${result.errors.length} 件）`);
  for (const error of result.errors) {
    console.error(`  ${error}`);
  }
  process.exit(1);
}

const outPath = fileURLToPath(outFile);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result.deck, null, 2)}\n`);

const core = result.deck.events.filter((event) => event.role === 'core').length;
const pool = result.deck.events.filter((event) => event.role === 'pool').length;
const highSchool = result.deck.events.filter((event) => event.level === '高校').length;
const targets = result.deck.events.filter((event) => event.level === '中学').length;
console.log(
  `${relative(root, outPath)} を書きました: 基本の年表 ${core} 件、追加データ ${pool} 件（うち高校 ${highSchool} 件）、出題対象 ${targets} 件`,
);
