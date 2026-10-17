import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { collectCspViolations, expectNoHorizontalScroll } from './helpers';

interface Entry {
  url: string;
  revision: string | null;
}
interface UpdateServer {
  url: string;
  entries: Entry[];
  switchToVersion2: (fail?: boolean) => void;
}
const INITIAL_FILES = Array.from({ length: 5 }, (_, i) => `e2e-initial-${i + 1}.txt`);
const EXTRA_FILES = Array.from({ length: 5 }, (_, i) => `e2e-extra-${i + 1}.txt`);
const FAILED = '確認できませんでした。通信できる場所でもう一度押してください';
const LOADING = '新しい版を読み込んでいます';
const PREPARING = 'オフラインで使えるように準備しています';

/** テストごとに dist のコピーと空きポートを使い、ほかの spec の配信を変えない。 */
const test = base.extend<{ updateServer: UpdateServer }>({
  updateServer: async ({ browserName }, runFixture, testInfo) => {
    expect(browserName).toBe('webkit');
    const directory = testInfo.outputPath('update-server');
    await mkdir(directory, { recursive: true });
    const root = resolve(directory, 'dist');
    let version = 1;
    let fail = false;
    const server = createServer();
    try {
      await cp(resolve('dist'), root, { recursive: true });
      const script = await readFile(resolve(root, 'sw.js'), 'utf8');
      const match = script.match(/\.addToCacheList\((\[[\s\S]*?\])\)/);
      if (!match) throw new Error('sw.js に事前キャッシュの一覧がありません');
      const entries = JSON.parse(match[1]) as Entry[];
      const headersText = (await readFile(resolve('public/_headers'), 'utf8')).trimEnd();
      const [scope, ...headerLines] = headersText.split(/\r?\n/);
      if (scope !== '/*') throw new Error('_headers の先頭が /* ではありません');
      const headers = Object.fromEntries(
        headerLines.map((line) => {
          if (!/^[ \t]+[A-Za-z0-9-]+: \S.*$/.test(line)) throw new Error('_headers の行が不正です');
          const colon = line.indexOf(': ');
          return [line.slice(0, colon).trim(), line.slice(colon + 2)];
        }),
      );
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
        '.txt': 'text/plain',
      };
      server.on('request', (request, response) => {
        void (async () => {
          const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
          const selectedVersion = version;
          response.setHeader('Cache-Control', 'no-store');
          for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
          response.setHeader(
            'Content-Type',
            contentTypes[extname(pathname)] ?? 'text/html; charset=utf-8',
          );
          const file = pathname.slice(1);
          if (INITIAL_FILES.includes(file) || EXTRA_FILES.includes(file)) {
            await delay(450);
            if (fail && file === EXTRA_FILES[2]) {
              response.writeHead(500).end('取得失敗');
            } else {
              response.end(`version-${EXTRA_FILES.includes(file) ? 2 : 1}`);
            }
            return;
          }
          if (pathname === '/sw.js') {
            const extra = [...INITIAL_FILES, ...(selectedVersion === 2 ? EXTRA_FILES : [])];
            const manifest = entries.map((entry) =>
              entry.url === 'index.html' && selectedVersion === 2
                ? { ...entry, revision: 'e2e-version-2' }
                : entry,
            );
            manifest.push(...extra.map((url) => ({ url, revision: `e2e-${url}` })));
            response.end(script.replace(match[1], JSON.stringify(manifest)));
            return;
          }
          const path = resolve(root, pathname === '/' ? 'index.html' : file);
          if (!path.startsWith(root + sep)) {
            response.writeHead(403).end();
            return;
          }
          try {
            const body = await readFile(path);
            response.end(body);
          } catch {
            if (extname(pathname)) response.writeHead(404).end();
            else response.end(await readFile(resolve(root, 'index.html')));
          }
        })().catch(() => {
          response.writeHead(500).end();
        });
      });
      await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
      });
      await runFixture({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        entries,
        switchToVersion2(shouldFail = false) {
          version = 2;
          fail = shouldFail;
        },
      });
    } finally {
      if (server.listening) {
        const closed = new Promise<void>((resolveClose, reject) => {
          server.close((error) => (error ? reject(error) : resolveClose()));
        });
        server.closeAllConnections();
        await closed;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
});

const updateButton = (page: Page) =>
  page.getByRole('button', { name: 'アプリを更新', exact: true });
const topProgress = (page: Page, message: string) =>
  page.locator('.banner').filter({ hasText: message });

async function controlledHome(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
}

/** 旧 worker は追加ファイルをルーティングしない。オフラインの取得で制御中の版を判別する。 */
async function expectVersion(page: Page, context: BrowserContext, version: 1 | 2) {
  await context.setOffline(true);
  try {
    const extra = await page.evaluate(async () => {
      try {
        return await (await fetch('/e2e-extra-1.txt')).text();
      } catch {
        return null;
      }
    });
    expect(extra).toBe(version === 2 ? 'version-2' : null);
    await page.reload();
    await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
}

async function expectProgress(page: Page, container: ReturnType<typeof topProgress>) {
  await expect(container).toBeVisible();
  await expect(container.getByRole('progressbar')).toBeVisible();
  await expect(container.locator('.update-progress-percent')).toHaveText(/^\d+%$/);
  await expectNoHorizontalScroll(page);
  const dimensions = await container.locator('.update-progress-row').evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
}

// 追加項目を含む実際の worker を使い、message の偽装は行わない。
test('初回の準備に横棒が出て完了すると消え、オフラインでも起動できる', async ({
  page,
  context,
  updateServer,
}) => {
  const csp = collectCspViolations(page);
  const urls = updateServer.entries.map((entry) => entry.url);
  expect(new Set(urls).size).toBe(urls.length);
  for (const url of [
    'index.html',
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png',
    'qloop-logo.svg',
    'manifest.webmanifest',
  ])
    expect(urls).toContain(url);
  expect(urls.some((url) => /^assets\/index-.*\.js$/.test(url))).toBe(true);
  expect(urls.some((url) => /^assets\/decks-.*\.js$/.test(url))).toBe(true);
  expect(urls.some((url) => /^assets\/.*\.css$/.test(url))).toBe(true);
  expect(urls).not.toContain('_headers');
  await page.goto(updateServer.url);
  await expectProgress(page, topProgress(page, PREPARING));
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(topProgress(page, PREPARING)).toHaveCount(0);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expectVersion(page, context, 1);
  expect(csp).toEqual([]);
});

test('起動時の取り込みを表示し、完了後は帯の「更新」で新しい版になる', async ({
  page,
  context,
  updateServer,
}) => {
  const csp = collectCspViolations(page);
  await controlledHome(page, updateServer.url);
  updateServer.switchToVersion2();
  await page.reload();
  await expectProgress(page, topProgress(page, LOADING));
  await expect(topProgress(page, LOADING)).toHaveCount(0);
  await expect(
    page.locator('.banner').filter({ hasText: '新しいバージョンがあります' }),
  ).toBeVisible();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: '更新', exact: true }).click(),
  ]);
  await expectVersion(page, context, 2);
  expect(csp).toEqual([]);
});

test('手動の更新はボタンの下だけに進捗を出し、新しい版に切り替わる', async ({
  page,
  context,
  updateServer,
}) => {
  const csp = collectCspViolations(page);
  await controlledHome(page, updateServer.url);
  updateServer.switchToVersion2();
  await updateButton(page).click();
  await expectProgress(page, page.locator('.footer').filter({ hasText: LOADING }));
  await expect(topProgress(page, LOADING)).toHaveCount(0);
  await expect(
    page.locator('.banner').filter({ hasText: '新しいバージョンがあります' }),
  ).toHaveCount(0);
  await page.waitForEvent('load');
  await expectVersion(page, context, 2);
  expect(csp).toEqual([]);
});

test('手動の取り込みが 500 で失敗したら横棒を消し、失敗の文を出す', async ({
  page,
  updateServer,
}) => {
  await controlledHome(page, updateServer.url);
  updateServer.switchToVersion2(true);
  const origin = await page.evaluate(() => performance.timeOrigin);
  await updateButton(page).click();
  await expectProgress(page, page.locator('.footer').filter({ hasText: LOADING }));
  await expect(topProgress(page, LOADING)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: FAILED })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(updateButton(page)).toBeEnabled();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
});

test('起動時の取り込みが 500 で失敗したら横棒の帯だけを消す', async ({ page, updateServer }) => {
  await controlledHome(page, updateServer.url);
  updateServer.switchToVersion2(true);
  await page.reload();
  await expectProgress(page, topProgress(page, LOADING));
  await expect(topProgress(page, LOADING)).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText(FAILED, { exact: true })).toHaveCount(0);
  await expect(
    page.locator('.banner').filter({ hasText: '新しいバージョンがあります' }),
  ).toHaveCount(0);
});

test('手動の取り込み中にホームを離れると完了しても切り替えない', async ({
  page,
  context,
  updateServer,
}) => {
  await controlledHome(page, updateServer.url);
  updateServer.switchToVersion2();
  const origin = await page.evaluate(() => performance.timeOrigin);
  await updateButton(page).click();
  await expectProgress(page, page.locator('.footer').filter({ hasText: LOADING }));
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(page.getByRole('heading', { name: '出題設定' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    )
    .toBe(true);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(
    page.locator('.banner').filter({ hasText: '新しいバージョンがあります' }),
  ).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  await expectVersion(page, context, 1);
});
