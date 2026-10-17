import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import {
  collectCspViolations,
  expectNoHorizontalScroll,
  openRecords,
  radio,
  waitForOfflineReady,
} from './helpers';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

const INSTALL_MESSAGE = 'Safari の共有メニューから『ホーム画面に追加』して使ってください';

for (const width of [375, 402]) {
  test.describe(`ホームの教材のカード（幅 ${width}px）`, () => {
    test.use({ viewport: { width, height: 667 } });

    test('全教材で切り替えから成績までがカードに入り、連続学習日数はロゴの右にあり、1 画面に収まる', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
      });
      await page.goto('/');
      await waitForOfflineReady(page);
      await expect(page.locator('.banner')).toHaveCount(0);
      const deck = page.locator('section.deck');
      const streak = page.getByTestId('home-streak');
      await expect(streak).toBeVisible();
      for (const name of ['日本史年表', '語彙', '英単語']) {
        await radio(page, name).check();
        await expect(deck.getByRole('group', { name: '教材', exact: true })).toBeVisible();
        await expect(deck.getByRole('radio')).toHaveCount(3);
        await expect(deck.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
        await expect(deck.getByTestId('target-count')).toContainText(
          name === '英単語' ? '英単語' : name === '語彙' ? '言葉' : '出来事',
        );
        for (const action of [
          '出題',
          name === '英単語' ? '英単語を覚える' : name === '語彙' ? '言葉を覚える' : '年表を覚える',
          '復習',
          '成績',
        ]) {
          await expect(deck.getByRole('button', { name: action, exact: true })).toBeEnabled();
        }
        await expect(deck.getByTestId('home-streak')).toHaveCount(0);
        expect(await streak.evaluate((element) => element.closest('section.deck'))).toBeNull();
        await expect(page.locator('.home-heading').getByTestId('home-streak')).toBeVisible();
        const logoBox = await page.locator('.home-logo').boundingBox();
        const streakBox = await streak.boundingBox();
        expect(logoBox).not.toBeNull();
        expect(streakBox).not.toBeNull();
        expect(streakBox!.x).toBeGreaterThanOrEqual(logoBox!.x + logoBox!.width);
        expect(
          Math.abs(streakBox!.y + streakBox!.height / 2 - logoBox!.y - logoBox!.height / 2),
        ).toBeLessThanOrEqual(1);
        await expectNoHorizontalScroll(page);
        const deckBox = await deck.boundingBox();
        expect(deckBox).not.toBeNull();
        expect(deckBox!.y + deckBox!.height).toBeLessThanOrEqual(667);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      }
    });

    test('ホームの下部で「アプリを更新」の右に「記録の管理」が同じ行に並び、横スクロールしない', async ({
      page,
    }) => {
      await page.goto('/');
      await waitForOfflineReady(page);
      const footer = page.locator('.footer-row');
      const update = footer.getByRole('button', { name: 'アプリを更新', exact: true });
      const records = footer.getByRole('button', { name: '記録の管理', exact: true });
      await expect(records).toBeEnabled();
      await records.scrollIntoViewIfNeeded();
      const updateBox = await update.boundingBox();
      const recordsBox = await records.boundingBox();
      expect(updateBox).not.toBeNull();
      expect(recordsBox).not.toBeNull();
      expect(recordsBox!.x).toBeGreaterThanOrEqual(updateBox!.x + updateBox!.width);
      expect(Math.abs(recordsBox!.y - updateBox!.y)).toBeLessThanOrEqual(1);
      expect(recordsBox!.height).toBeGreaterThanOrEqual(44);
      for (const property of ['color', 'fontSize', 'fontWeight', 'backgroundColor'] as const) {
        expect(
          await records.evaluate((element, key) => getComputedStyle(element)[key], property),
        ).toBe(await update.evaluate((element, key) => getComputedStyle(element)[key], property));
      }
      await expectNoHorizontalScroll(page);
      await openRecords(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await expectNoHorizontalScroll(page);
    });
  });
}

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

test('ホームから全教材の記録の管理を開き、説明と 3 つの操作を表示し、戻るとホームになる', async ({
  page,
}) => {
  await page.goto('/');
  // ホームで選ぶ教材によらず、全教材の画面を開く
  await radio(page, '英単語').check();
  await openRecords(page);
  await expect(page.getByTestId('screen-deck')).toHaveCount(0);
  await expect(page.locator('.hint')).toHaveText(
    '日本史年表・語彙・英単語の学習の記録を、まとめて書き出し・読み込み・リセットします。',
  );
  await expect(page.getByRole('heading', { name: '記録の管理', exact: true })).toHaveCount(1);
  await expect(page.locator('.records .record-row')).toHaveText([
    '書き出し',
    '読み込み',
    'リセット',
  ]);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'QLoop' })).toBeVisible();
  await expect(radio(page, '英単語')).toBeChecked();
});

test('3 つの教材の成績には記録の管理と全教材の操作の注意書きが無い', async ({ page }) => {
  await page.goto('/');
  for (const name of ['日本史年表', '語彙', '英単語']) {
    await radio(page, name).check();
    await page.getByRole('button', { name: '成績', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: '成績' })).toBeVisible();
    await expect(page.getByTestId('screen-deck')).toHaveText(name);
    await expect(page.getByText('記録の管理', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('書き出し・読み込み・リセットは、すべての教材の記録をまとめて扱います。'),
    ).toHaveCount(0);
    for (const action of ['書き出し', '読み込み', 'リセット']) {
      await expect(page.getByRole('button', { name: action, exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: '戻る', exact: true }).click();
  }
});
