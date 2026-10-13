import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Deck, Word } from '../../src/core/models';
import {
  collectCspViolations,
  expectNoHorizontalScroll,
  populationOf,
  radio,
  readDeckEvents,
} from './helpers';

function readWords(): Word[] {
  const decks = JSON.parse(
    readFileSync(new URL('../../src/generated/decks.json', import.meta.url), 'utf8'),
  ) as Deck[];
  const deck = decks.find((candidate) => candidate.kind === 'vocabulary');
  if (!deck || deck.kind !== 'vocabulary') throw new Error('語彙の教材がありません');
  return deck.items;
}
/**
 * 出題の母集団（中学の言葉）と、そのうち基本の語彙（core.csv）の件数。
 * 追加データ（pool.csv）に行を足しても期待値が追従するよう、decks.json から数える。
 */
function vocabularyCounts(): { targets: number; core: number } {
  const targets = readWords().filter((item) => item.level === '中学');
  return { targets: targets.length, core: targets.filter((item) => item.role === 'core').length };
}
async function openVocabulary(page: Page): Promise<void> {
  const { targets, core } = vocabularyCounts();
  await page.goto('/');
  await radio(page, '語彙').check();
  await expect(page.getByTestId('target-count')).toHaveText(
    `出題できる言葉 ${targets} 件（基本の語彙 ${core} 件）`,
  );
}
async function start(page: Page, pattern: string, count = '10 問'): Promise<void> {
  await openVocabulary(page);
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await radio(page, pattern).check();
  await radio(page, count).check();
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect(page.getByTestId('progress')).toHaveText(/^1 \/ \d+$/);
}
async function currentWord(page: Page, meaningChoice: boolean): Promise<Word> {
  const text = await page.locator('.question-text').textContent();
  const item = readWords().find((word) => (meaningChoice ? word.word : word.meaning) === text);
  expect(item).toBeDefined();
  return item!;
}
async function expectJudgementReading(page: Page, item: Word): Promise<void> {
  if (item.reading === null) {
    await expect(page.locator('.judgement-detail')).toHaveCount(0);
  } else {
    await expect(page.locator('.judgement-detail')).toHaveText(`読み ${item.reading}`);
  }
}
async function expectResultReadings(page: Page): Promise<void> {
  const words = readWords();
  for (const row of await page.getByTestId('wrong-list').locator('li').all()) {
    const title = await row.locator('.wrong-title').textContent();
    const item = words.find((word) => word.word === title);
    expect(item).toBeDefined();
    await expect(row.locator('.wrong-year')).toHaveText(item!.meaning);
    if (item!.reading === null) {
      await expect(row.locator('.wrong-reading')).toHaveCount(0);
    } else {
      await expect(row.locator('.wrong-reading')).toHaveText(item!.reading);
    }
  }
}
async function expectStatsReadings(page: Page): Promise<void> {
  // 成績の対象は母集団（中学の言葉）で、高校の言葉は出さない。
  const words = readWords().filter((item) => item.level === '中学');
  const rows = page.getByTestId('event-row');
  await expect(rows).toHaveCount(words.length);
  for (const row of await rows.all()) {
    const title = await row.locator('.event-row-title').textContent();
    const item = words.find((word) => word.word === title);
    expect(item).toBeDefined();
    const prefix = item!.reading === null ? [item!.category] : [item!.reading, item!.category];
    const parts = (await row.locator('.event-row-sub').textContent())!.split(' · ');
    expect(parts.slice(0, prefix.length)).toEqual(prefix);
    expect([prefix.length, prefix.length + 2]).toContain(parts.length);
    expect(parts).not.toContain('');
  }
}
async function expectChoicesFit(page: Page, judged = false): Promise<void> {
  await expectNoHorizontalScroll(page);
  const choices = page.getByTestId('vocabulary-choice');
  await expect(choices).toHaveCount(4);
  let limit = page.viewportSize()!.height;
  if (judged) {
    const bar = page.locator('.judgement-bar');
    await bar.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(limit + 1);
    limit = box!.y;
  }
  for (const choice of await choices.all()) {
    const box = await choice.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(limit);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
}

test('語彙への切り替え・教材名・初期設定・種類の選択・lastDeck を保つ', async ({ page }) => {
  await openVocabulary(page);
  // 保存のトランザクションが終わったことを確かめてから再読み込みする。
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | null>((resolve, reject) => {
            const request = indexedDB.open('qloop');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const saved = db.transaction('meta').objectStore('meta').get('lastDeck');
              saved.onerror = () => {
                db.close();
                reject(saved.error);
              };
              saved.onsuccess = () => {
                db.close();
                resolve(saved.result?.value ?? null);
              };
            };
          }),
      ),
    )
    .toBe('japanese-vocabulary');
  await page.reload();
  await expect(radio(page, '語彙')).toBeChecked();
  await expect(page.getByTestId('target-count')).toContainText(
    `言葉 ${vocabularyCounts().targets} 件`,
  );
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(page.locator('.screen-deck')).toHaveText('語彙');
  await expect(radio(page, '基本の語彙のみ')).toBeChecked();
  await expect(radio(page, '意味 4 択')).toBeChecked();
  await expect(radio(page, '10 問')).toBeChecked();
  await expect(radio(page, '全範囲')).toBeChecked();
  const cards = page.locator('.pattern-option');
  await expect(cards).toHaveCount(3);
  for (const [pattern, description] of [
    ['意味 4 択', '4 つの意味から選ぶ'],
    ['言葉 4 択', '4 つの言葉から選ぶ'],
    ['ミックス', '2 つの形式をまぜる'],
  ]) {
    await expect(radio(page, pattern)).toHaveAccessibleDescription(description);
  }
  await radio(page, '種類').check();
  await expect(page.getByRole('button', { name: '開始' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '慣用句', exact: true }).check();
  // 出題する言葉は既定の「基本の語彙のみ」。基本の語彙の全行は検証で 4 択が成立するので、慣用句の基本の語彙がすべて対象
  const idioms = readWords().filter(
    (item) => item.level === '中学' && item.role === 'core' && item.category === '慣用句',
  );
  await expect(page.getByTestId('eligible-count')).toHaveText(`対象 ${idioms.length} 件`);
  await expect(page.getByRole('button', { name: '開始' })).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  for (const name of ['復習', '成績']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.screen-deck')).toHaveText('語彙');
    await page.getByRole('button', { name: '戻る', exact: true }).click();
  }
  await radio(page, '日本史年表').check();
  const events = populationOf(readDeckEvents());
  const coreEvents = events.filter((event) => event.role === 'core').length;
  await expect(page.getByTestId('target-count')).toHaveText(
    `出題できる出来事 ${events.length} 件（基本の年表 ${coreEvents} 件）`,
  );
});

for (const pattern of ['意味 4 択', '言葉 4 択']) {
  test(`${pattern} で正解・不正解・わからないを記録し、読み・結果・復習・成績を出す`, async ({
    page,
  }) => {
    const violations = collectCspViolations(page);
    await start(page, pattern);
    const meaningChoice = pattern === '意味 4 択';
    for (let index = 0; index < 10; index++) {
      await expect(page.getByTestId('progress')).toHaveText(`${index + 1} / 10`);
      const item = await currentWord(page, meaningChoice);
      await expect(page.locator('.question-prompt')).toHaveText(
        meaningChoice ? 'どんな意味？' : `この意味の${item.category}は？`,
      );
      const correctText = meaningChoice ? item.meaning : item.word;
      await expectChoicesFit(page);
      if (index === 0) await page.getByRole('button', { name: correctText, exact: true }).click();
      else if (index === 1) {
        const choices = page.getByTestId('vocabulary-choice');
        const texts = await choices.allTextContents();
        await choices.nth(texts.findIndex((text) => text !== correctText)).click();
      } else await page.getByRole('button', { name: 'わからない', exact: true }).click();
      await expect(page.getByTestId('judgement')).toHaveText(
        index === 0 ? '正解' : index === 1 ? '不正解' : 'わからない',
      );
      await expectJudgementReading(page, item);
      await expect(page.locator('.choice.correct .choice-title')).toHaveText(correctText);
      if (index === 1)
        await expect(page.locator('.choice.wrong .choice-badge')).toHaveText('✕ 選んだ答え');
      await expectChoicesFit(page, true);
      await page
        .getByRole('button', { name: index === 9 ? '結果を見る' : '次へ', exact: true })
        .click();
    }
    await expect(page.getByTestId('result-score')).toHaveText('1 / 10');
    await expect(page.getByRole('heading', { name: '間違えた言葉' })).toBeVisible();
    await expect(page.getByTestId('wrong-list').locator('li')).toHaveCount(9);
    await expectResultReadings(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await expect(page.getByTestId('home-review-count')).toHaveText('9 件');
    await page.getByRole('button', { name: '復習', exact: true }).click();
    await expect(page.getByTestId('review-count')).toHaveText('9 件');
    await page.getByRole('button', { name: '開始', exact: true }).click();
    await expect(page.getByTestId('progress')).toHaveText('1 / 9');
    const reviewItem = await currentWord(page, meaningChoice);
    await page.getByRole('button', { name: 'わからない', exact: true }).click();
    await expect(page.getByTestId('judgement')).toHaveText('わからない');
    await expectJudgementReading(page, reviewItem);
    await page.getByRole('button', { name: '終了', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await page.getByRole('button', { name: '成績', exact: true }).click();
    await expect(page.getByRole('heading', { name: '種類別' })).toBeVisible();
    await expect(page.getByTestId('era-row')).toContainText('慣用句');
    await expect(
      page.getByText('書き出し・読み込み・リセットは、すべての教材の記録をまとめて扱います。'),
    ).toBeVisible();
    // WebKit の select の内部スタイルによる既存の CSP 違反が混ざるため、言葉別を開く前に確認する。
    expect(violations).toEqual([]);
    await radio(page, '言葉別').check();
    await expectStatsReadings(page);
    const row = page
      .getByTestId('event-row')
      .filter({ has: page.locator('.event-row-sub', { hasText: /回/ }) })
      .first();
    await expect(row.locator('.event-row-sub')).toContainText('慣用句');
    await row.getByRole('button').click();
    await expect(row.getByTestId('breakdown')).toContainText(pattern);
    await radio(page, '履歴').check();
    await expect(page.getByTestId('history-item').filter({ hasText: '通常' })).toContainText(
      `全範囲 · ${pattern}`,
    );
    await expectNoHorizontalScroll(page);
  });
  test(`${pattern} の基本の語彙の全問で幅 375px に収まり、判定・結果・成績は読みの有無を反映する`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 667 });
    // 出題する言葉は既定の「基本の語彙のみ」なので、全問は基本の語彙の件数
    const total = vocabularyCounts().core;
    await start(page, pattern, '全問');
    for (let index = 0; index < total; index++) {
      await expect(page.getByTestId('progress')).toHaveText(`${index + 1} / ${total}`);
      const item = await currentWord(page, pattern === '意味 4 択');
      await expectChoicesFit(page);
      await page.getByRole('button', { name: 'わからない', exact: true }).click();
      await expect(page.getByTestId('judgement')).toHaveText('わからない');
      await expectJudgementReading(page, item);
      await expectChoicesFit(page, true);
      await page
        .getByRole('button', { name: index === total - 1 ? '結果を見る' : '次へ', exact: true })
        .click();
    }
    await expect(page.getByTestId('result-score')).toHaveText(`0 / ${total}`);
    await expect(page.getByTestId('wrong-list').locator('li')).toHaveCount(total);
    await expectResultReadings(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await page.getByRole('button', { name: '成績', exact: true }).click();
    await radio(page, '言葉別').check();
    await expectStatsReadings(page);
    await expectNoHorizontalScroll(page);
  });
}
