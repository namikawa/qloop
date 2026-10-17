import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { GeographyDeck, GeoPlace } from '../../src/core/models';
import {
  collectCspViolations,
  expectNoHorizontalScroll,
  radio,
  waitForOfflineReady,
} from './helpers';

function places(): GeoPlace[] {
  const decks = JSON.parse(
    readFileSync(new URL('../../src/generated/decks.json', import.meta.url), 'utf8'),
  ) as GeographyDeck[];
  return decks.find((deck) => deck.kind === 'geography')!.items;
}
async function openGeography(page: Page) {
  await page.goto('/');
  await radio(page, '日本地理').check();
  await expect(page.getByTestId('target-count')).toHaveText(
    '出題できる地名 310 件（基本の地名 142 件）',
  );
}
async function currentPlace(page: Page): Promise<GeoPlace> {
  const src = await page.locator('.geography-card img').getAttribute('src');
  const item = places().find((item) => src === `/geography/${item.id}.webp`);
  expect(item).toBeDefined();
  return item!;
}
async function expectMap(page: Page) {
  const map = page.locator('.geography-card img');
  await expect(map).toBeVisible();
  await expect
    .poll(() => map.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(map).toHaveAttribute('width', '1000');
  await expect(map).toHaveAttribute('height', '648');
  await expect(page.locator('.geography-card')).not.toContainText(
    '地図: Natural Earth と国土地理院の資料をもとに作成',
  );
  await expect(page.locator('.geography-question > .geography-credit')).toHaveText(
    '地図: Natural Earth と国土地理院の資料をもとに作成',
  );
}
async function expectChoicesFit(page: Page, width: number) {
  const bar = page.locator('.judgement-bar');
  await bar.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  for (const choice of await page.getByTestId('geography-choice').all()) {
    const box = await choice.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(barBox!.y);
  }
  const creditBox = await page.locator('.geography-credit').boundingBox();
  expect(creditBox).not.toBeNull();
  expect(creditBox!.y + creditBox!.height).toBeLessThanOrEqual(barBox!.y);
  const next = await bar.getByRole('button').boundingBox();
  expect(next!.y + next!.height).toBeLessThanOrEqual(667);
}

async function expectTwoColumnChips(page: Page) {
  const options = page.locator('.chip-options');
  await expect(options).toHaveCount(1);
  expect(
    await options.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
    ),
  ).toBe(2);
  const labels = options.locator('.chip-label');
  await expect(labels).toHaveCount(8);
  for (const label of await labels.all()) {
    const lines = await label.evaluate((element) => {
      const text = [...element.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (!text || !text.textContent) throw new Error('チップの文字がありません');
      const range = document.createRange();
      const start = text.textContent.indexOf(text.textContent.trim());
      range.setStart(text, start);
      range.setEnd(text, start + text.textContent.trim().length);
      return range.getClientRects().length;
    });
    expect(lines, (await label.textContent()) ?? '分類チップ').toBe(1);
  }
  await expectNoHorizontalScroll(page);
}

async function expectCreditBeforeAnswer(page: Page, answerSelector: string) {
  const credit = page.locator('.geography-credit');
  await expect(credit).toBeVisible();
  await expect(credit).toHaveCSS('font-size', '12px');
  await expect(credit).toHaveCSS('text-align', 'center');
  const box = await credit.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  for (const element of await page.locator(answerSelector).all()) {
    const answerBox = await element.boundingBox();
    expect(answerBox).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(answerBox!.y + answerBox!.height);
  }
  const giveUpBox = await page
    .getByRole('button', { name: 'わからない', exact: true })
    .boundingBox();
  expect(giveUpBox).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(giveUpBox!.y + giveUpBox!.height);
}

for (const width of [375, 402]) {
  test(`分類チップは未選択・全選択で2列かつ1行に収まる（幅${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 667 });
    await openGeography(page);
    await page.getByRole('button', { name: '出題', exact: true }).click();
    await radio(page, '分類').check();
    await expectTwoColumnChips(page);
    const chips = page.locator('.chip-options').getByRole('checkbox');
    await expect(
      page.locator('.chip-options').getByRole('checkbox', { checked: true }),
    ).toHaveCount(0);
    for (const chip of await chips.all()) await chip.check();
    await expect(
      page.locator('.chip-options').getByRole('checkbox', { checked: true }),
    ).toHaveCount(8);
    await expectTwoColumnChips(page);
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await page.getByRole('button', { name: '地図で覚える', exact: true }).click();
    await expectTwoColumnChips(page);
    const browseChips = page.locator('.chip-options').getByRole('checkbox');
    await expect(
      page.locator('.chip-options').getByRole('checkbox', { checked: true }),
    ).toHaveCount(0);
    for (const chip of await browseChips.all()) await chip.check();
    await expect(
      page.locator('.chip-options').getByRole('checkbox', { checked: true }),
    ).toHaveCount(8);
    await expectTwoColumnChips(page);
  });

  test(`日本地理のホーム・名前4択・結果・復習・成績（幅${width}px）`, async ({ page }) => {
    const violations = collectCspViolations(page);
    await page.setViewportSize({ width, height: 667 });
    await openGeography(page);
    await waitForOfflineReady(page);
    await expectNoHorizontalScroll(page);
    const deck = page.locator('section.deck');
    const box = await deck.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
    const switches = deck.locator('.segment-label');
    const bounds = await Promise.all((await switches.all()).map((label) => label.boundingBox()));
    expect(bounds[0]!.y).toBe(bounds[1]!.y);
    expect(bounds[2]!.y).toBe(bounds[3]!.y);
    expect(bounds[2]!.y).toBeGreaterThan(bounds[0]!.y);
    for (const bound of bounds) expect(bound!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: '出題', exact: true }).click();
    await expect(radio(page, '基本の地名のみ')).toBeChecked();
    await expect(radio(page, '名前 4 択')).toBeChecked();
    await page.getByRole('button', { name: '開始', exact: true }).click();
    const wrong: GeoPlace[] = [];
    for (let i = 0; i < 10; i++) {
      await expect(page.getByTestId('progress')).toHaveText(`${i + 1} / 10`);
      await expectMap(page);
      const item = await currentPlace(page);
      await expect(page.locator('.question-prompt')).toHaveText(item.question);
      await expect(page.getByTestId('geography-choice')).toHaveCount(4);
      await expectCreditBeforeAnswer(page, '[data-testid="geography-choice"]');
      if (i === 0)
        await page.getByTestId('geography-choice').filter({ hasText: item.name }).click();
      else if (i === 1)
        await page
          .getByTestId('geography-choice')
          .filter({ hasNotText: item.name })
          .first()
          .click();
      else await page.getByRole('button', { name: 'わからない', exact: true }).click();
      if (i > 0) wrong.push(item);
      await expect(page.getByTestId('judgement')).toHaveText(
        i === 0 ? '正解' : i === 1 ? '不正解' : 'わからない',
      );
      await expect(page.locator('.judgement-detail')).toHaveText(`読み ${item.reading}`);
      await expectChoicesFit(page, width);
      await expectNoHorizontalScroll(page);
      await page
        .getByRole('button', { name: i === 9 ? '結果を見る' : '次へ', exact: true })
        .click();
    }
    await expect(page.getByTestId('result-score')).toHaveText('1 / 10');
    await expect(page.getByTestId('wrong-list').locator('li')).toHaveCount(9);
    const first = page.getByTestId('wrong-list').locator('li').first();
    await expect(first).toContainText(wrong[0].name);
    await expect(first).toContainText(wrong[0].reading);
    await expect(first).toContainText(wrong[0].category);
    await first.getByRole('button').click();
    await expect(page.locator('.browse-highlight')).toHaveAttribute('data-item-id', wrong[0].id);
    await page.getByRole('button', { name: '結果に戻る' }).click();
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await expect(page.getByTestId('home-review-count')).toHaveText('9 件');
    await page.getByRole('button', { name: '復習', exact: true }).click();
    await page.getByRole('button', { name: '開始', exact: true }).click();
    await expectMap(page);
    await page.getByRole('button', { name: 'わからない', exact: true }).click();
    await page.getByRole('button', { name: '終了', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await page.getByRole('button', { name: '成績', exact: true }).click();
    await expect(page.getByRole('heading', { name: '分類別', exact: true })).toBeVisible();
    expect(violations).toEqual([]);
    await radio(page, '地名別').check();
    await expect(page.getByTestId('event-row')).toHaveCount(310);
    await expectNoHorizontalScroll(page);
  });

  test(`地図で覚えるの分類・隠す・出典（幅${width}px）`, async ({ page }) => {
    const violations = collectCspViolations(page);
    await page.setViewportSize({ width, height: 667 });
    await openGeography(page);
    await page.getByRole('button', { name: '地図で覚える', exact: true }).click();
    await expect(page.locator('.browse-heading')).toHaveCount(8);
    const row = page.getByTestId('browse-row').first();
    await expect(row.locator('img')).toHaveAttribute('loading', 'lazy');
    await expect
      .poll(() => row.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const name = await row.locator('.browse-front').textContent();
    await radio(page, '地図').check();
    await expect(page.getByTestId('browse-row').locator('img')).toHaveCount(0);
    await expect(row.locator('.browse-back')).toHaveText('？');
    await row.click();
    await expect(row.locator('img')).toHaveCount(1);
    await row.click();
    await expect(row.locator('img')).toHaveCount(0);
    await radio(page, '名前').check();
    await expect(row.locator('.browse-front')).toHaveText('？');
    await expect(row.locator('.browse-reading')).toHaveCount(0);
    await row.click();
    await expect(row.locator('.browse-front')).toHaveText(name!);
    await expect(page.locator('.browse-credit')).toContainText('独自に作成した概略図');
    await expect(page.locator('.browse-credit')).toHaveCSS('font-size', '12px');
    const links = page.locator('.browse-credit a');
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveCSS('font-size', '12px');
    }
    await expectNoHorizontalScroll(page);
    expect(violations).toEqual([]);
  });
}

test('名前入力のひらがな・漢字・誤答・わからない、分類の選択と保存、復習', async ({ page }) => {
  const violations = collectCspViolations(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await openGeography(page);
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await radio(page, '名前入力').check();
  await radio(page, '分類').check();
  await expect(page.getByRole('button', { name: '開始', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '川・湖', exact: true }).check();
  await page.getByRole('button', { name: '開始', exact: true }).click();
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('progress')).toHaveText(`${i + 1} / 10`);
    await expectMap(page);
    const item = await currentPlace(page);
    const input = page.getByRole('textbox', { name: '名前', exact: true });
    const submit = page.getByRole('button', { name: '回答', exact: true });
    await expect(input).toHaveAttribute('placeholder', 'ひらがなでもよい');
    await expect(input).toHaveCSS('font-size', '20px');
    await expectCreditBeforeAnswer(page, '.year-answer');
    await input.fill('　 ');
    await expect(submit).toBeDisabled();
    if (i < 3) {
      await input.fill(i === 0 ? item.reading : i === 1 ? item.name : '誤答');
      await submit.click();
    } else await page.getByRole('button', { name: 'わからない', exact: true }).click();
    await expect(page.getByTestId('judgement')).toHaveText(
      i < 2 ? '正解' : i === 2 ? '不正解' : 'わからない',
    );
    await expect(page.locator('.judgement-detail p')).toHaveText([
      `正解 ${item.name}`,
      `読み ${item.reading}`,
    ]);
    await expect(input).toBeDisabled();
    await page.getByRole('button', { name: i === 9 ? '結果を見る' : '次へ', exact: true }).click();
  }
  await expect(page.getByTestId('result-score')).toHaveText('2 / 10');
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(radio(page, '名前入力')).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '川・湖', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await page.getByRole('button', { name: '復習', exact: true }).click();
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '名前', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(violations).toEqual([]);
});

test('地図の読み込みに失敗しても名前入力とわからないで進める', async ({ page }) => {
  await page.route('**/geography/*.webp', (route) => route.abort());
  await openGeography(page);
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await radio(page, '名前入力').check();
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect(page.getByText('地図を読み込めませんでした')).toBeVisible();
  await page.getByRole('textbox', { name: '名前', exact: true }).fill('誤答');
  await page.getByRole('button', { name: '回答', exact: true }).click();
  await expect(page.getByTestId('judgement')).toHaveText('不正解');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await expect(page.getByTestId('judgement')).toHaveText('わからない');
});
