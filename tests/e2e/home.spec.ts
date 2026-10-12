import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import { collectCspViolations } from './helpers';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

const INSTALL_MESSAGE = 'Safari の共有メニューから『ホーム画面に追加』して使ってください';

test('ホーム画面に教材名・件数・版が表示され、横スクロールしない', async ({ page }) => {
  const cspViolations = collectCspViolations(page);
  // decks.json は webServer のビルドで生成されるので、テストの中で読む
  const { version } = readJson<{ version: string }>('../../package.json');
  const [deck] = readJson<{ items: { role: string; level: string }[] }[]>(
    '../../src/generated/decks.json',
  );
  // 出題できる出来事は母集団（core.csv と pool.csv の中学の出来事）、基本の年表はそのうち core.csv の行
  const targets = deck.items.filter((event) => event.level === '中学');
  const coreCount = targets.filter((event) => event.role === 'core').length;

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'QLoop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '日本史年表' })).toBeVisible();
  await expect(page.getByTestId('target-count')).toHaveText(
    `出題できる出来事 ${targets.length} 件（基本の年表 ${coreCount} 件）`,
  );
  await expect(page.getByText('誤答用')).toHaveCount(0);
  await expect(page.getByTestId('version')).toHaveText(`バージョン ${version}`);
  // 版の表示の横に「アプリを更新」があり、押せる部分の高さは 44px 以上
  const updateButton = page.getByRole('button', { name: 'アプリを更新', exact: true });
  await expect(updateButton).toBeEnabled();
  expect((await updateButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  // 学習の記録を読み込んだら「出題」「復習」「成績」を押せる
  await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '復習', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '成績', exact: true })).toBeEnabled();
  // iOS 以外の UA では「ホーム画面に追加」の帯を出さない
  await expect(page.getByText(INSTALL_MESSAGE)).toHaveCount(0);

  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  expect(cspViolations).toEqual([]);
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
