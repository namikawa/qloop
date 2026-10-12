# QLoop

1 問 1 答で勉強する PWA（ホーム画面に追加して使う Web アプリ）。最初の教材は日本史の年表。

- 公開 URL: https://qloop.na3.workers.dev
- iPhone の Safari で URL を開き、共有メニューの「ホーム画面に追加」で導入する。
- 学習の記録は端末の中だけに保存する（ログインや端末間の同期はしない）。
- 配信は Cloudflare Workers の静的アセット配信。

## ドキュメント

- [`docs/design.md`](docs/design.md): 設計書（要件、データ形式、出題・復習・成績の仕様、配布）
- [`docs/data.md`](docs/data.md): 教材データの手引き（年表と語彙。正誤の基準、列の使い分け、データを足す手順）
- [`docs/operations.md`](docs/operations.md): 運用手順（リリースとデプロイ、端末への導入、更新、成績のバックアップ、動作確認）
- [`docs/visual-design.md`](docs/visual-design.md): 見た目のデザインの決まりと前提（配色・文字・ロゴ・アイコンの値と、見直すときに渡すもの）
- [`docs/BACKLOG.md`](docs/BACKLOG.md): 新機能と改良の候補（採用して未着手のもの、保留中の候補、見送り）
- [`CHANGELOG.md`](CHANGELOG.md): 版ごとの変更履歴

## 前提

- Node.js 22 以上と npm
- e2e テストを動かす場合は Playwright の WebKit（初回のみ `npx playwright install webkit`）

## コマンド

| コマンド           | 内容                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm install`      | 依存パッケージを入れる                                                                                     |
| `npm run dev`      | 開発用サーバーを起動する                                                                                   |
| `npm run build`    | データを検証して `dist/` にビルドする                                                                      |
| `npm run preview`  | ビルドした `dist/` を手元で配信する                                                                        |
| `npm test`         | 単体テスト（vitest）                                                                                       |
| `npm run test:e2e` | 画面のテスト（Playwright の WebKit。ビルドしてから `vite preview` で確認する）                             |
| `npm run lint`     | 型検査（`tsc --noEmit`）と ESLint                                                                          |
| `npm run format`   | Prettier で整形する                                                                                        |
| `npm run data`     | 全教材の CSV を検証して `src/generated/decks.json` を作る（`dev`・`build`・`lint` の前に自動で実行される） |
| `npm run deploy`   | ビルドして Cloudflare に配信する                                                                           |

## データ

- 教材データは `data/decks/japanese-history/` の `core.csv`（基本の年表）と `pool.csv`（追加データ）。
- 年表データの「正しさ」は、歴史的な史実ではなく、現代の中学受験・高校受験で出題される問題での正解とする。基準の詳細とデータを足す手順は `docs/data.md`、列の形式と検証の規則は `docs/design.md` の 5 章を参照。

## デプロイ

- `npm run deploy` を実行する。初回だけ `npx wrangler login` で Cloudflare にログインしておく。
- リリースの手順（版の上げ方、`CHANGELOG.md` の書き方、タグと GitHub Release、配信後の確認）は `docs/operations.md` の 2 章を参照。

## ライセンス

[MIT ライセンス](LICENSE)。コードと年表データ（`data/`）の両方が対象。
