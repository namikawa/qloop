import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { browseGroups } from '../../src/core/browse';
import { deckModel, type KindRules } from '../../src/core/decks';
import type { Deck, Item, Pattern, Word } from '../../src/core/models';
import { formatAnswerYears } from '../../src/core/year';
import { expectNoHorizontalScroll, populationOf, radio, readDeckEvents } from './helpers';

function readDeck(kind: Deck['kind']): Deck {
  const decks = JSON.parse(
    readFileSync(new URL('../../src/generated/decks.json', import.meta.url), 'utf8'),
  ) as Deck[];
  const deck = decks.find((deck) => deck.kind === kind);
  if (!deck) throw new Error(`教材がありません: ${kind}`);
  return deck;
}

// 属性で項目を特定し、年や言葉が隠れていても行を操作できる。
function itemRow(page: Page, id: string) {
  return page.locator(`button[data-testid="browse-row"][data-item-id="${id}"]`);
}

/** 行が画面内にあり、上の見出しと下の帯にも隠れていないことを確かめる。 */
async function expectBrowseRowVisible(page: Page, row: Locator): Promise<void> {
  await expect(async () => {
    const box = await row.boundingBox();
    const headingBottom = await row.evaluate(
      (element) =>
        element
          .closest('.browse-section')
          ?.querySelector('.browse-heading')
          ?.getBoundingClientRect().bottom ?? null,
    );
    const bar = await page.locator('.bottom-bar').boundingBox();
    expect(box).not.toBeNull();
    expect(headingBottom).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(headingBottom! - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }).toPass({ timeout: 5000 });
}

for (const width of [375, 402]) {
  test.describe(`一覧（幅 ${width}px）`, () => {
    test.use({ viewport: { width, height: 667 } });

    test('年表の絞り込み・件数・暗記カード・初期化と出題設定の維持', async ({ page }) => {
      const events = populationOf(readDeckEvents());
      const core = events.filter((item) => item.role === 'core');
      await page.goto('/');
      await page.getByRole('button', { name: '年表', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: '年表', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.screen-deck')).toHaveText('日本史年表');
      await expect(radio(page, '基本の年表のみ')).toBeChecked();
      await expect(page.getByTestId('browse-count')).toHaveText(`すべての時代 ${core.length} 件`);
      await expect(page.getByTestId('browse-row')).toHaveCount(core.length);
      await expect(page.getByRole('checkbox', { name: '縄文', exact: true })).toHaveCount(0);
      await radio(page, 'すべて').check();
      await expect(page.getByTestId('browse-row')).toHaveCount(events.length);
      for (const era of ['平成', '昭和']) {
        await page.getByRole('checkbox', { name: era, exact: true }).check();
      }
      const filtered = events.filter((item) => ['昭和', '平成'].includes(item.era));
      await expect(page.getByTestId('browse-count')).toHaveText(`昭和・平成 ${filtered.length} 件`);
      await expect(page.locator('.browse-heading')).toHaveText([
        `昭和 ${filtered.filter((item) => item.era === '昭和').length} 件`,
        `平成 ${filtered.filter((item) => item.era === '平成').length} 件`,
      ]);
      const item = filtered[0];
      const row = itemRow(page, item.id);
      await radio(page, '年').check();
      await expect(row.locator('.browse-front')).toHaveText('？');
      expect(await row.textContent()).not.toContain(
        formatAnswerYears({ ...item, yearLabel: null }),
      );
      await row.click();
      await expect(row.locator('.browse-front')).toHaveText(
        formatAnswerYears({ ...item, yearLabel: null }),
      );
      await row.click();
      await expect(row.locator('.browse-front')).toHaveText('？');
      await row.click();
      await radio(page, '出来事').check();
      await expect(row.locator('.browse-back')).toHaveText('？');
      expect(await row.textContent()).not.toContain(item.title);
      await row.click();
      await expect(row.locator('.browse-back')).toHaveText(item.title);
      await radio(page, '年').check();
      await expect(row.locator('.browse-front')).toHaveText('？');
      await row.click();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalScroll(page);

      await page.getByRole('button', { name: '戻る', exact: true }).click();
      await page.getByRole('button', { name: '年表', exact: true }).click();
      await expect(radio(page, '基本の年表のみ')).toBeChecked();
      await expect(radio(page, '隠さない')).toBeChecked();
      await expect(page.locator('.chip input:checked')).toHaveCount(0);
      await expect(page.getByTestId('browse-count')).toHaveText(`すべての時代 ${core.length} 件`);
      await radio(page, '年').check();
      await expect(page.locator('.browse-front .browse-hidden')).toHaveCount(core.length);
      await page.getByRole('button', { name: '戻る', exact: true }).click();
      await page.getByRole('button', { name: '出題', exact: true }).click();
      await expect(page.getByRole('group', { name: '出題する出来事' })).toBeVisible();
      await expect(radio(page, '基本の年表のみ')).toBeChecked();
    });

    test('言葉の一覧で言葉と読みを隠し、押して出す・隠す・初期化する', async ({ page }) => {
      const deck = readDeck('vocabulary');
      if (deck.kind !== 'vocabulary') throw new Error('語彙の教材ではありません');
      const words = deck.items.filter((item) => item.level === '中学');
      const core = words.filter((item) => item.role === 'core');
      const item = core.find((item) => item.reading !== null)!;
      await page.goto('/');
      await radio(page, '語彙').check();
      await page.getByRole('button', { name: '言葉の一覧', exact: true }).click();
      await expect(page.getByRole('heading', { name: '言葉の一覧', exact: true })).toBeVisible();
      await expect(page.locator('.screen-deck')).toHaveText('語彙');
      await expect(page.getByTestId('browse-count')).toHaveText(`すべての種類 ${core.length} 件`);
      await radio(page, 'すべて').check();
      await page.getByRole('checkbox', { name: '慣用句', exact: true }).check();
      await expect(page.getByTestId('browse-count')).toHaveText(`慣用句 ${words.length} 件`);
      const row = itemRow(page, item.id);
      await radio(page, '言葉').check();
      await expect(row.locator('.browse-front')).toHaveText('？');
      await expect(row.locator('.browse-reading')).toHaveCount(0);
      expect(await row.textContent()).not.toContain(item.word);
      expect(await row.textContent()).not.toContain(item.reading!);
      await row.click();
      await expect(row.locator('.browse-front')).toContainText(item.word);
      await expect(row.locator('.browse-reading')).toHaveText(item.reading!);
      await row.click();
      await expect(row.locator('.browse-front')).toHaveText('？');
      await expect(row.locator('.browse-reading')).toHaveCount(0);
      await radio(page, '意味').check();
      await expect(row.locator('.browse-back')).toHaveText('？');
      await expect(row.locator('.browse-reading')).toHaveText(item.reading!);
      expect(await row.textContent()).not.toContain(item.meaning);
      await row.click();
      await expect(row.locator('.browse-back')).toHaveText(item.meaning);
      await expectNoHorizontalScroll(page);
      await page.getByRole('button', { name: '戻る', exact: true }).click();
      await page.getByRole('button', { name: '言葉の一覧', exact: true }).click();
      await expect(radio(page, '基本の語彙のみ')).toBeChecked();
      await expect(radio(page, '隠さない')).toBeChecked();
      await expect(page.locator('.chip input:checked')).toHaveCount(0);
      await expect(page.getByTestId('browse-row')).toHaveCount(core.length);
      await radio(page, '意味').check();
      await expect(page.locator('.browse-back .browse-hidden')).toHaveCount(core.length);
      await page.getByRole('button', { name: '戻る', exact: true }).click();
      await page.getByRole('button', { name: '出題', exact: true }).click();
      await expect(radio(page, '基本の語彙のみ')).toBeChecked();
    });
  });
}

/** 完了済みの通常セッションとその不正解を用意し、保存は基本のみのままで復習する。 */
async function seedReview(page: Page, deck: Deck, pairs: { item: Item; pattern: Pattern }[]) {
  await page.evaluate(
    async ({ deck, pairs }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('qloop');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['meta', 'sessions', 'attempts', 'eventStats'], 'readwrite');
      const now = new Date().toISOString();
      const sessionId = 'browse-seed';
      tx.objectStore('meta').put({
        key: `settings:${deck.id}`,
        value: {
          scope: 'core',
          pattern: deck.kind === 'timeline' ? 'yearInput' : 'meaningChoice',
          count: 10,
          range: { kind: 'all' },
        },
      });
      tx.objectStore('meta').put({ key: 'lastDeck', value: deck.id });
      tx.objectStore('sessions').put({
        id: sessionId,
        deckId: deck.id,
        mode: 'normal',
        pattern: 'mixed',
        range: { kind: 'all' },
        startedAt: now,
        endedAt: now,
        total: pairs.length,
        answered: pairs.length,
        correct: 0,
      });
      for (const { item, pattern } of pairs) {
        tx.objectStore('attempts').add({
          eventId: item.id,
          pattern,
          correct: false,
          answeredAt: now,
          sessionId,
        });
        tx.objectStore('eventStats').put({
          eventId: item.id,
          pattern,
          attempts: 1,
          correct: 0,
          lastAnsweredAt: now,
          lastCorrect: false,
          lastWrongAt: now,
          consecutiveCorrect: 0,
        });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { deck, pairs },
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '復習', exact: true })).toBeEnabled();
}

for (const kind of ['timeline', 'vocabulary'] as const) {
  test(`${kind}: 追加データと複数パターンの結果から移動し、復習の札・強調・得点・閲覧位置を保つ`, async ({
    page,
  }) => {
    const deck = readDeck(kind);
    const model = deckModel(deck);
    const rules: KindRules<Item, Pattern> = model.rules;
    const patterns: readonly Pattern[] =
      kind === 'timeline' ? ['yearInput', 'yearChoice'] : ['meaningChoice', 'wordChoice'];
    const eligible = model.population.filter(
      (item) =>
        item.role === 'pool' &&
        patterns.every((pattern) => rules.isEligibleFor(item, pattern, deck.items)),
    );
    const ordered = browseGroups<Item>(eligible, rules, 'all', []).flatMap(
      (section) => section.items,
    );
    const target = ordered.at(-1)!;
    const pairs = [
      ...patterns.map((pattern) => ({ item: target, pattern })),
      ...ordered.slice(0, 8).map((item) => ({ item, pattern: patterns[0] })),
    ];
    await page.goto('/');
    await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
    await seedReview(page, deck, pairs);
    await page.getByRole('button', { name: '出題', exact: true }).click();
    await expect(
      radio(page, kind === 'timeline' ? '基本の年表のみ' : '基本の語彙のみ'),
    ).toBeChecked();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await page.getByRole('button', { name: '復習', exact: true }).click();
    await expect(page.getByTestId('review-count')).toHaveText('10 件');
    await page.getByRole('button', { name: '開始', exact: true }).click();
    for (let index = 0; index < 10; index++) {
      await expect(page.getByTestId('progress')).toHaveText(`${index + 1} / 10`);
      await page.getByRole('button', { name: 'わからない', exact: true }).click();
      await expect(page.getByTestId('judgement')).toHaveText('わからない');
      await page
        .getByRole('button', { name: index === 9 ? '結果を見る' : '次へ', exact: true })
        .click();
    }
    await expect(page.getByTestId('result-score')).toHaveText('0 / 10');
    const last = page.getByTestId('wrong-list').getByRole('button').last();
    await last.scrollIntoViewIfNeeded();
    const title = await last.locator('.wrong-title').textContent();
    const item = pairs.find(({ item }) => rules.itemTitle(item) === title)!.item;
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);
    await last.click();
    await expect(radio(page, 'すべて')).toBeChecked();
    await expect(radio(page, '隠さない')).toBeChecked();
    await expect(page.locator('.chip input:checked')).toHaveCount(0);
    const highlighted = itemRow(page, item.id);
    await expect(highlighted).toHaveClass(/browse-highlight/);
    await expectBrowseRowVisible(page, highlighted);
    await expect(highlighted.locator('.browse-review')).toHaveText('復習');
    expect(await highlighted.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--color-primary-tint)';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }),
    );
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: '結果に戻る', exact: true }).click();
    await expect(page.getByTestId('result-score')).toHaveText('0 / 10');
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before))
      .toBeLessThanOrEqual(2);

    const targetTitle = rules.itemTitle(target);
    const duplicates = page
      .getByTestId('wrong-list')
      .getByRole('button')
      .filter({
        has: page.locator('.wrong-title', { hasText: targetTitle }),
      });
    await expect(duplicates).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      await duplicates.nth(index).scrollIntoViewIfNeeded();
      const scrollY = await page.evaluate(() => window.scrollY);
      await duplicates.nth(index).click();
      const row = itemRow(page, target.id);
      await expect(row).toHaveCount(1);
      await expectBrowseRowVisible(page, row);
      await expect(row).toHaveClass(/browse-highlight/);
      await expect(row.locator('.browse-review')).toHaveCount(1);
      if (kind === 'vocabulary' && (target as Word).reading !== null) {
        await expect(row.locator('.browse-reading')).toHaveText((target as Word).reading!);
      }
      if (index === 0) await page.getByRole('button', { name: '戻る', exact: true }).click();
      else await page.getByRole('button', { name: '結果に戻る', exact: true }).click();
      await expect(page.getByTestId('result-score')).toHaveText('0 / 10');
      await expect
        .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - scrollY))
        .toBeLessThanOrEqual(2);
    }
    await page.getByRole('button', { name: 'ホームへ', exact: true }).click();
    await page
      .getByRole('button', { name: kind === 'timeline' ? '年表' : '言葉の一覧', exact: true })
      .click();
    await expect(
      radio(page, kind === 'timeline' ? '基本の年表のみ' : '基本の語彙のみ'),
    ).toBeChecked();
    await expect(page.locator('.browse-highlight')).toHaveCount(0);
    await radio(page, 'すべて').check();
    await expect(itemRow(page, target.id).locator('.browse-review')).toHaveCount(1);
  });
}
