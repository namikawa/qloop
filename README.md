# QLoop

1 問 1 答で勉強する PWA（ホーム画面に追加して使う Web アプリ）。最初の教材は日本史の年表。

- iPhone の Safari で URL を開き、共有メニューの「ホーム画面に追加」で導入する。
- 学習の記録は端末の中だけに保存する（ログインや端末間の同期はしない）。
- 配信は Cloudflare Workers の静的アセット配信。

設計は [`docs/design.md`](docs/design.md) を参照。

## 前提

- Node.js 22 以上と npm
- e2e テストを動かす場合は Playwright の WebKit（初回のみ `npx playwright install webkit`）

## コマンド

| コマンド           | 内容                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `npm install`      | 依存パッケージを入れる                                                                           |
| `npm run dev`      | 開発用サーバーを起動する                                                                         |
| `npm run build`    | データを検証して `dist/` にビルドする                                                            |
| `npm run preview`  | ビルドした `dist/` を手元で配信する                                                              |
| `npm test`         | 単体テスト（vitest）                                                                             |
| `npm run test:e2e` | 画面のテスト（Playwright の WebKit。ビルドしてから `vite preview` で確認する）                   |
| `npm run lint`     | 型検査（`tsc --noEmit`）と ESLint                                                                |
| `npm run format`   | Prettier で整形する                                                                              |
| `npm run data`     | CSV を検証して `src/generated/deck.json` を作る（`dev`・`build`・`lint` の前に自動で実行される） |
| `npm run deploy`   | ビルドして Cloudflare に配信する                                                                 |

## データ

- 教材データは `data/decks/japanese-history/` の `core.csv`（基本の年表）と `pool.csv`（追加データ）。
- 列の形式と検証の規則は `docs/design.md` の 5 章を参照。

## デプロイ

- `npm run deploy` を実行する。
- 初回だけ `npx wrangler login` で Cloudflare にログインしておく。
