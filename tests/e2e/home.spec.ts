import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

const INSTALL_MESSAGE = 'Safari の共有メニューから『ホーム画面に追加』して使ってください';

test('ホーム画面に教材名・件数・版が表示され、横スクロールしない', async ({ page }) => {
  // deck.json は webServer のビルドで生成されるので、テストの中で読む
  const { version } = readJson<{ version: string }>('../../package.json');
  const deck = readJson<{ events: { role: string; level: string }[] }>(
    '../../src/generated/deck.json',
  );
  // 出題対象は母集団（core.csv の中学の出来事）の件数
  const targetCount = deck.events.filter(
    (event) => event.role === 'core' && event.level === '中学',
  ).length;
  const poolCount = deck.events.filter((event) => event.role === 'pool').length;

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'QLoop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '日本史年表' })).toBeVisible();
  await expect(page.getByTestId('target-count')).toHaveText(`${targetCount} 件`);
  await expect(page.getByTestId('pool-count')).toHaveText(`${poolCount} 件`);
  await expect(page.getByTestId('version')).toHaveText(`バージョン ${version}`);
  // 学習の記録を読み込んだら「出題」を押せる。復習と成績は準備中
  await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '復習（準備中）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '成績（準備中）' })).toBeDisabled();
  // iOS 以外の UA では「ホーム画面に追加」の帯を出さない
  await expect(page.getByText(INSTALL_MESSAGE)).toHaveCount(0);

  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});

test.describe('iPhone の Safari のタブで開いたとき', () => {
  test.use({ userAgent: devices['iPhone SE'].userAgent });

  test('「ホーム画面に追加」の帯を出し、閉じられる', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(INSTALL_MESSAGE)).toBeVisible();
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByText(INSTALL_MESSAGE)).toHaveCount(0);
  });

  test('ホーム画面から起動したとき（navigator.standalone が true）は帯を出さない', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
    });
    await page.goto('/');
    await expect(page.getByTestId('version')).toBeVisible();
    await expect(page.getByText(INSTALL_MESSAGE)).toHaveCount(0);
  });
});
