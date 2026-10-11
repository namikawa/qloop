import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export interface DeckEvent {
  id: string;
  year: number;
  title: string;
  era: string;
  approx: boolean;
  level: string;
  role: string;
}

/** deck.json は webServer のビルドで生成されるので、テストの中で読む。 */
export function readDeckEvents(): DeckEvent[] {
  const path = new URL('../../src/generated/deck.json', import.meta.url);
  return (JSON.parse(readFileSync(path, 'utf8')) as { events: DeckEvent[] }).events;
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

export function radio(page: Page, name: string) {
  return page.getByRole('radio', { name, exact: true });
}

/** ホームを開き、学習の記録を読み込み終えてから出題設定へ進む。 */
export async function openSetup(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(page.getByRole('heading', { name: '出題設定' })).toBeVisible();
}
