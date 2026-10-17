import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export interface DeckEvent {
  id: string;
  year: number;
  title: string;
  era: string;
  approx: boolean;
  altYears: number[];
  level: string;
  role: string;
}

/**
 * 日本史年表の教材の全出来事。decks.json は webServer のビルドで生成されるので、テストの中で読む。
 */
export function readDeckEvents(): DeckEvent[] {
  const path = new URL('../../src/generated/decks.json', import.meta.url);
  const decks = JSON.parse(readFileSync(path, 'utf8')) as { id: string; items: DeckEvent[] }[];
  const deck = decks.find((candidate) => candidate.id === 'japanese-history');
  expect(deck, 'decks.json に日本史年表が無い').toBeDefined();
  return deck!.items;
}

/** 出題の母集団（core.csv と pool.csv の中学の出来事）。 */
export function populationOf(events: readonly DeckEvent[]): DeckEvent[] {
  return events.filter((event) => event.level === '中学');
}

/** 年号入力に出せる出来事か（approx でなく、year が正）。 */
export function isYearInputEligible(event: DeckEvent): boolean {
  return !event.approx && event.year > 0;
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

/** 初回の準備の帯の出入りで下の要素の位置が動くので、位置を測る前に呼ぶ。 */
export async function waitForOfflineReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(
    page.locator('.banner').filter({ hasText: 'オフラインで使えるように準備しています' }),
  ).toHaveCount(0);
}

export function radio(page: Page, name: string) {
  return page.getByRole('radio', { name, exact: true });
}

/** 画面を開く前に呼び、コンソールのエラーから CSP 違反を集める（設計書 9.2 節）。 */
export function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

/** ホームを開き、学習の記録を読み込み終えてから出題設定へ進む。 */
export async function openSetup(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(page.getByRole('heading', { name: '出題設定' })).toBeVisible();
}

/** ホームの下部から全教材の記録の管理を開く。 */
export async function openRecords(page: Page): Promise<void> {
  await page
    .locator('.footer-row')
    .getByRole('button', { name: '記録の管理', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '記録の管理' })).toBeVisible();
}
