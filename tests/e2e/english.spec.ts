import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  englishLessons,
  lessonName,
  meaningWithPos,
  spellingAnswers,
} from '../../src/core/english';
import type { EnglishWord } from '../../src/core/models';
import { collectCspViolations, expectNoHorizontalScroll, radio } from './helpers';

function words(): EnglishWord[] {
  const decks = JSON.parse(
    readFileSync(new URL('../../src/generated/decks.json', import.meta.url), 'utf8'),
  ) as { id: string; items: EnglishWord[] }[];
  return decks.find((deck) => deck.id === 'english-words')!.items;
}

async function openEnglish(page: Page): Promise<void> {
  await page.goto('/');
  await radio(page, '英単語').check();
  await expect(page.getByTestId('target-count')).toHaveText(
    `出題できる英単語 ${words().length} 件`,
  );
  await expect(page.getByTestId('target-count')).not.toContainText('基本');
}

async function start(page: Page, pattern: string, lessons = false): Promise<void> {
  await openEnglish(page);
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await radio(page, pattern).check();
  if (lessons) {
    await radio(page, 'レッスン').check();
    await page.getByRole('checkbox', { name: 'Lesson 4', exact: true }).check();
  }
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect(page.getByTestId('progress')).toHaveText('1 / 10');
}

async function currentWord(page: Page, meaningChoice: boolean): Promise<EnglishWord> {
  const text = await page.locator('.question-card .question-text').textContent();
  const displayed = await page
    .getByTestId('english-choice')
    .locator('.choice-title')
    .allTextContents();
  // 同じ意味の行が複数あるときは、実際に出ている正解の英単語を選ぶ。
  const item = words().find((word) =>
    meaningChoice
      ? word.word === text
      : meaningWithPos(word) === text && displayed.includes(word.word),
  );
  expect(item).toBeDefined();
  return item!;
}

test('英単語の件数・初期設定・本の見出しとレッスンの選択', async ({ page }) => {
  await openEnglish(page);
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(page.locator('.screen-deck')).toHaveText('英単語');
  await expect(page.getByText('出題する英単語', { exact: true })).toHaveCount(0);
  await expect(radio(page, '意味 4 択')).toBeChecked();
  await expect(radio(page, '10 問')).toBeChecked();
  await expect(radio(page, '全範囲')).toBeChecked();
  await expect(page.locator('.pattern-option')).toHaveCount(4);
  await expect(page.locator('.pattern-name')).toHaveText([
    '意味 4 択',
    '英単語 4 択',
    'つづり入力',
    'ミックス',
  ]);
  for (const [label, description] of [
    ['意味 4 択', '4 つの意味から選ぶ'],
    ['英単語 4 択', '4 つの英単語から選ぶ'],
    ['つづり入力', '英単語をつづる'],
    ['ミックス', '3 つの形式をまぜる'],
  ]) {
    await expect(radio(page, label)).toHaveAccessibleDescription(description);
  }
  await radio(page, 'レッスン').check();
  await expect(page.getByRole('button', { name: '開始', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText('レッスンを 1 つ以上選んでください');
  await expect(page.locator('.chip-heading')).toHaveText('STAGE2');
  await expect(page.getByRole('heading', { name: 'STAGE1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'STAGE3', exact: true })).toHaveCount(0);
  await page
    .locator('.chip-group')
    .filter({ has: page.getByRole('heading', { name: 'STAGE2', exact: true }) })
    .getByRole('checkbox', { name: 'Lesson 4', exact: true })
    .check();
  await expect(page.getByTestId('eligible-count')).toHaveText('対象 84 件');
  await expect(page.getByRole('button', { name: '開始', exact: true })).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(radio(page, 'レッスン')).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Lesson 4', exact: true })).toBeChecked();
});

for (const pattern of ['意味 4 択', '英単語 4 択']) {
  test(`${pattern} の正解・誤答・結果から一覧・復習・成績・履歴`, async ({ page }) => {
    const violations = collectCspViolations(page);
    await start(page, pattern, true);
    const meaningChoice = pattern === '意味 4 択';
    for (let index = 0; index < 10; index++) {
      await expect(page.getByTestId('progress')).toHaveText(`${index + 1} / 10`);
      const item = await currentWord(page, meaningChoice);
      await expect(page.locator('.question-prompt')).toHaveText(
        meaningChoice ? 'どんな意味？' : 'この意味の英単語は？',
      );
      const answer = meaningChoice ? item.meaning : item.word;
      const choices = page.getByTestId('english-choice');
      await expect(choices).toHaveCount(4);
      if (index === 0) await page.getByRole('button', { name: answer, exact: true }).click();
      else if (index === 1) {
        const texts = await choices.locator('.choice-title').allTextContents();
        await choices.nth(texts.findIndex((text) => text !== answer)).click();
      } else await page.getByRole('button', { name: 'わからない', exact: true }).click();
      await expect(page.getByTestId('judgement')).toHaveText(
        index === 0 ? '正解' : index === 1 ? '不正解' : 'わからない',
      );
      await expect(page.locator('.judgement-detail')).toHaveCount(0);
      await expect(page.locator('.choice.correct .choice-title')).toHaveText(answer);
      if (index === 1)
        await expect(page.locator('.choice.wrong .choice-badge')).toHaveText('✕ 選んだ答え');
      await expectNoHorizontalScroll(page);
      await page
        .getByRole('button', { name: index === 9 ? '結果を見る' : '次へ', exact: true })
        .click();
    }
    await expect(page.getByTestId('result-score')).toHaveText('1 / 10');
    const rows = page.getByTestId('wrong-list').locator('li');
    await expect(rows).toHaveCount(9);
    for (const row of await rows.all()) {
      const title = await row.locator('.wrong-title').textContent();
      const item = words().find((word) => word.word === title)!;
      expect(item).toBeDefined();
      await expect(row.getByRole('button')).toHaveClass(/wrong-item-stacked/);
      await expect(row.locator('.wrong-year')).toHaveText(meaningWithPos(item));
      await expect(row.locator('.wrong-reading')).toHaveCount(0);
    }
    const firstTitle = await rows.first().locator('.wrong-title').textContent();
    await rows.first().getByRole('button').click();
    await expect(page.locator('.browse-highlight .browse-front')).toHaveText(firstTitle!);
    await page.getByRole('button', { name: '結果に戻る', exact: true }).click();
    await expect(page.getByTestId('result-score')).toHaveText('1 / 10');
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await expect(page.getByTestId('home-review-count')).toHaveText('9 件');
    await page.getByRole('button', { name: '復習', exact: true }).click();
    await expect(page.getByTestId('review-count')).toHaveText('9 件');
    await page.getByRole('button', { name: '開始', exact: true }).click();
    await expect(page.locator('.question-prompt')).toHaveText(
      meaningChoice ? 'どんな意味？' : 'この意味の英単語は？',
    );
    await page.getByRole('button', { name: 'わからない', exact: true }).click();
    await page.getByRole('button', { name: '終了', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await page.getByRole('button', { name: '成績', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'レッスン別', exact: true })).toBeVisible();
    const lessonRows = page.getByTestId('era-row');
    await expect(lessonRows).toHaveCount(englishLessons(words()).length);
    await expect(
      lessonRows.filter({ has: page.getByText('STAGE2 Lesson 4', { exact: true }) }),
    ).toHaveCount(1);
    expect(violations).toEqual([]);
    await radio(page, '英単語別').check();
    const statsRows = page.getByTestId('event-row');
    await expect(statsRows).toHaveCount(words().length);
    for (const row of await statsRows.all()) {
      const title = await row.locator('.event-row-title').textContent();
      const item = words().find((word) => word.word === title)!;
      await expect(row.locator('.event-row-sub')).toContainText(
        `${meaningWithPos(item)} · ${lessonName(item)}`,
      );
    }
    const answered = statsRows
      .filter({ has: page.locator('.event-row-sub', { hasText: /回/ }) })
      .first();
    await answered.getByRole('button').click();
    await expect(answered.getByTestId('breakdown')).toContainText(pattern);
    await radio(page, '履歴').check();
    await expect(page.getByTestId('history-item').filter({ hasText: '通常' })).toContainText(
      `STAGE2 Lesson 4 · ${pattern}`,
    );
    await expectNoHorizontalScroll(page);
  });
}

async function spellingWord(page: Page): Promise<EnglishWord> {
  const text = await page.locator('.question-card .question-text').textContent();
  const item = words().find((word) => meaningWithPos(word) === text && !/\.\.\.|…/.test(word.word));
  expect(item).toBeDefined();
  return item!;
}

async function seedSpellingReview(page: Page, ids: string[]): Promise<void> {
  await page.evaluate(async (ids) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('qloop');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['meta', 'sessions', 'attempts', 'eventStats'], 'readwrite');
    const now = new Date().toISOString();
    const sessionId = 'spelling-seed';
    tx.objectStore('meta').put({ key: 'lastDeck', value: 'english-words' });
    tx.objectStore('sessions').put({
      id: sessionId,
      deckId: 'english-words',
      mode: 'normal',
      pattern: 'englishSpelling',
      range: { kind: 'all' },
      startedAt: now,
      endedAt: now,
      total: ids.length,
      answered: ids.length,
      correct: 0,
    });
    for (const eventId of ids) {
      tx.objectStore('attempts').add({
        eventId,
        pattern: 'englishSpelling',
        correct: false,
        answeredAt: now,
        sessionId,
      });
      tx.objectStore('eventStats').put({
        eventId,
        pattern: 'englishSpelling',
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
  }, ids);
  await page.reload();
  await expect(page.getByTestId('home-review-count')).toHaveText(`${ids.length} 件`);
  await page.getByRole('button', { name: '復習', exact: true }).click();
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'つづり', exact: true })).toBeVisible();
}

test('つづり入力の正解・誤答・わからない・結果・復習・成績・履歴', async ({ page }) => {
  const violations = collectCspViolations(page);
  await openEnglish(page);
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await radio(page, 'つづり入力').check();
  await expect(page.getByTestId('eligible-count')).toHaveText('対象 179 件');
  await radio(page, 'レッスン').check();
  await page.getByRole('checkbox', { name: 'Lesson 4', exact: true }).check();
  await expect(page.getByTestId('eligible-count')).toHaveText('対象 83 件');
  await page.getByRole('button', { name: '開始', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'つづり', exact: true });
  const submit = page.getByRole('button', { name: '回答', exact: true });
  const wrongWords: EnglishWord[] = [];
  for (let index = 0; index < 10; index++) {
    await expect(page.getByTestId('progress')).toHaveText(`${index + 1} / 10`);
    const item = await spellingWord(page);
    await expect(page.locator('.question-prompt')).toHaveText('この意味の英単語は？');
    await expect(page.locator('.question-card .question-text')).toHaveText(meaningWithPos(item));
    await expect(input).toBeFocused();
    for (const [attribute, value] of [
      ['type', 'text'],
      ['autocapitalize', 'none'],
      ['autocorrect', 'off'],
      ['spellcheck', 'false'],
      ['autocomplete', 'off'],
      ['lang', 'en'],
    ]) {
      await expect(input).toHaveAttribute(attribute, value);
    }
    await expect(submit).toBeDisabled();
    if (index === 0) {
      for (const empty of ['   ', '...', '?']) {
        await input.fill(empty);
        await expect(submit).toBeDisabled();
      }
      await input.fill(item.word.toUpperCase());
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(input).toHaveValue(item.word.toUpperCase());
      await expect(page.locator('.year-field')).toHaveClass(/is-correct/);
      await expect(page.locator('.year-field-mark.correct')).toHaveCount(1);
    } else if (index === 1) {
      await input.fill('wrong spelling');
      await input.press('Enter');
      await expect(input).toHaveValue('wrong spelling');
      await expect(page.locator('.year-field')).toHaveClass(/is-wrong/);
      await expect(page.locator('.year-field-mark.wrong')).toHaveCount(1);
    } else {
      await input.fill('unfinished');
      await page.getByRole('button', { name: 'わからない', exact: true }).click();
      await expect(input).toHaveValue('');
      await expect(page.locator('.year-field')).toHaveClass(/is-gaveup/);
      await expect(page.locator('.year-field-mark')).toHaveCount(0);
    }
    if (index > 0) wrongWords.push(item);
    await expect(page.getByTestId('judgement')).toHaveText(
      index === 0 ? '正解' : index === 1 ? '不正解' : 'わからない',
    );
    await expect(page.locator('.judgement-detail')).toHaveText(
      `正解のつづり ${spellingAnswers(item, words())
        .map((word) => word.word)
        .join(' / ')}`,
    );
    await expect(page.locator('.judgement-detail [lang="en"]')).toHaveCount(1);
    await expect(input).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(page.getByRole('button', { name: 'わからない', exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: index === 9 ? '結果を見る' : '次へ', exact: true })
      .click();
  }
  await expect(page.getByTestId('result-score')).toHaveText('1 / 10');
  const rows = page.getByTestId('wrong-list').locator('li');
  await expect(rows).toHaveCount(9);
  for (let index = 0; index < wrongWords.length; index++) {
    const title = await rows.nth(index).locator('.wrong-title').textContent();
    expect(
      words().some(
        (word) => word.word === title && meaningWithPos(word) === meaningWithPos(wrongWords[index]),
      ),
    ).toBe(true);
    await expect(rows.nth(index).locator('.wrong-year')).toHaveText(
      meaningWithPos(wrongWords[index]),
    );
  }
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await expect(page.getByTestId('home-review-count')).toHaveText('9 件');
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(radio(page, 'つづり入力')).toBeChecked();
  await expect(page.getByTestId('eligible-count')).toHaveText('対象 83 件');
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await page.getByRole('button', { name: '復習', exact: true }).click();
  await expect(page.getByTestId('review-count')).toHaveText('9 件');
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect(page.locator('.question-prompt')).toHaveText('この意味の英単語は？');
  await expect(input).toBeVisible();
  const reviewWord = await spellingWord(page);
  expect(wrongWords.some((word) => meaningWithPos(word) === meaningWithPos(reviewWord))).toBe(true);
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await expect(page.locator('.judgement-detail')).toContainText('正解のつづり');
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await page.getByRole('button', { name: '成績', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'レッスン別', exact: true })).toBeVisible();
  // WebKit の select の内部スタイルによる既存の CSP 違反が混ざるため、英単語別を開く前に確認する。
  expect(violations).toEqual([]);
  await radio(page, '英単語別').check();
  const row = page
    .getByTestId('event-row')
    .filter({ has: page.locator('.event-row-sub', { hasText: /回/ }) })
    .first();
  await row.getByRole('button').click();
  await expect(row.getByTestId('breakdown')).toContainText('つづり入力');
  await radio(page, '履歴').check();
  await expect(page.getByTestId('history-item').filter({ hasText: '通常' })).toContainText(
    'STAGE2 Lesson 4 · つづり入力',
  );
  await expectNoHorizontalScroll(page);
});

test('someoneのつづり入力を復習し、別解somebodyで正解になる', async ({ page }) => {
  await openEnglish(page);
  await seedSpellingReview(page, ['en-0037']);
  await expect(page.locator('.question-card .question-text')).toHaveText('(代) 誰か');
  await page.getByRole('textbox', { name: 'つづり', exact: true }).fill('somebody');
  await page.getByRole('button', { name: '回答', exact: true }).click();
  await expect(page.getByTestId('judgement')).toHaveText('正解');
  await expect(page.locator('.judgement-detail')).toHaveText('正解のつづり someone / somebody');
});

for (const width of [375, 402]) {
  test(`つづり入力と判定の帯は幅${width}pxで横に出ず次へが見える`, async ({ page }) => {
    await page.setViewportSize({ width, height: 667 });
    await openEnglish(page);
    await seedSpellingReview(page, ['en-0162', 'en-0037', 'en-0021']);
    const input = page.getByRole('textbox', { name: 'つづり', exact: true });
    for (let index = 0; index < 3; index++) {
      const item = await spellingWord(page);
      await expectNoHorizontalScroll(page);
      await expect(input).toHaveCSS('font-size', '20px');
      await input.fill(item.word);
      expect(await input.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: '回答', exact: true }).click();
      await expect(page.getByTestId('judgement')).toHaveText('正解');
      await expectNoHorizontalScroll(page);
      const bar = page.locator('.judgement-bar');
      await bar.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
      const next = page.getByRole('button', {
        name: index === 2 ? '結果を見る' : '次へ',
        exact: true,
      });
      const barBox = await bar.boundingBox();
      const nextBox = await next.boundingBox();
      const detailBox = await bar.locator('.judgement-detail').boundingBox();
      expect(barBox).not.toBeNull();
      expect(nextBox).not.toBeNull();
      expect(detailBox).not.toBeNull();
      expect(nextBox!.y).toBeGreaterThanOrEqual(barBox!.y);
      expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(667);
      expect(nextBox!.x + nextBox!.width).toBeLessThanOrEqual(width);
      expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(nextBox!.x);
      await next.click();
    }
  });
}

for (const width of [375, 402]) {
  test(`英単語の一覧と暗記カードは幅${width}pxで横に出ない`, async ({ page }) => {
    await page.setViewportSize({ width, height: 667 });
    await openEnglish(page);
    await expectNoHorizontalScroll(page);
    const box = await page.locator('section.deck').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
    await page.getByRole('button', { name: '英単語を覚える', exact: true }).click();
    await expect(page.getByText('表示する英単語', { exact: true })).toHaveCount(0);
    await expect(page.locator('.chip-heading')).toHaveText('STAGE2');
    await page.getByRole('checkbox', { name: 'Lesson 4', exact: true }).check();
    await expect(page.getByTestId('browse-count')).toHaveText('STAGE2 Lesson 4 84 件');
    await expect(page.locator('.browse-heading')).toHaveText('STAGE2 Lesson 4 84 件');
    await expect(page.getByTestId('browse-row')).toHaveCount(84);
    const row = page.getByTestId('browse-row').first();
    await expect(row.locator('.browse-front')).toHaveText('brass band');
    await expect(row.locator('.browse-back')).toHaveText('(名) 吹奏楽団、ブラスバンド');
    await radio(page, '意味').check();
    await expect(row.locator('.browse-back')).toHaveText('？');
    await expect(row).not.toContainText('吹奏楽団');
    await row.click();
    await expect(row.locator('.browse-back')).toHaveText('(名) 吹奏楽団、ブラスバンド');
    await row.click();
    await expect(row.locator('.browse-back')).toHaveText('？');
    await radio(page, '英単語').check();
    await expect(row.locator('.browse-front')).toHaveText('？');
    await expect(row).not.toContainText('brass band');
    await expect(row.locator('.browse-back')).toHaveText('(名) 吹奏楽団、ブラスバンド');
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await page.getByRole('button', { name: '出題', exact: true }).click();
    await radio(page, 'レッスン').check();
    await page.getByRole('checkbox', { name: 'Lesson 4', exact: true }).check();
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: '開始', exact: true }).click();
    await expect(page.getByTestId('english-choice')).toHaveCount(4);
    await expectNoHorizontalScroll(page);
  });
}

test('375×500で下へ送ってから次へを押すと次の問題は先頭から出る', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  await start(page, '意味 4 択');
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await expect(page.getByTestId('judgement')).toHaveText('わからない');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const next = page.getByRole('button', { name: '次へ', exact: true });
  await expect(next).toBeVisible();
  await page
    .locator('.judgement-bar')
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
  const box = await next.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(501);
  await next.click();
  await expect(page.getByTestId('progress')).toHaveText('2 / 10');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expectNoHorizontalScroll(page);
});
