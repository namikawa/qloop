import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

const LATEST_MESSAGE = '最新の版です';
const FAILED_MESSAGE = '確認できませんでした。通信できる場所でもう一度押してください';

/** Service Worker の有効化を待ってから読み込み直し、ページを Service Worker の制御下にする。 */
async function openControlledHome(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

function updateButton(page: Page) {
  return page.getByRole('button', { name: 'アプリを更新', exact: true });
}

test('Service Worker の制御下のページで「アプリを更新」を押すと「最新の版です」と出る', async ({
  page,
}) => {
  await openControlledHome(page);
  await updateButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: LATEST_MESSAGE })).toBeVisible();
  await expect(updateButton(page)).toBeEnabled();
  await expectNoHorizontalScroll(page);
});

test('通信できないときは「確認できませんでした」と出る', async ({ page, context }) => {
  await openControlledHome(page);
  // WebKit では、オフラインにすると registration.update() の sw.js の取得も失敗する
  await context.setOffline(true);
  await updateButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: FAILED_MESSAGE })).toBeVisible();
  await expect(updateButton(page)).toBeEnabled();
  await expectNoHorizontalScroll(page);
});
