import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, openRecords, openSetup, radio, readDeckEvents } from './helpers';

/** 判定と区切りの色（app.css のトークン）。 */
const COLORS = {
  correct: 'rgb(14, 115, 64)',
  wrong: 'rgb(179, 38, 30)',
  gaveUp: 'rgb(139, 143, 152)',
  current: 'rgb(31, 79, 160)',
  upcoming: 'rgb(221, 214, 201)',
  primary: 'rgb(31, 79, 160)',
  destructive: 'rgb(179, 38, 30)',
};

function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function expectStep(steps: Locator, index: number, state: keyof typeof COLORS) {
  const step = steps.locator('.progress-step').nth(index);
  await expect(step).toHaveAttribute('data-state', state);
  expect(await backgroundOf(step)).toBe(COLORS[state]);
}

/** 年号入力・全範囲で出題を始める。 */
async function startYearInput(page: Page, count: '10 問' | '全問' = '10 問'): Promise<void> {
  await openSetup(page);
  await radio(page, '年号入力').check();
  await radio(page, count).check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.getByTestId('progress')).toHaveText(/^1 \/ \d+$/);
}

/** 年号入力の問題に、正解・不正解（どの出来事にも当たらない年）・わからない で答える。 */
async function answerYearInput(page: Page, kind: 'correct' | 'wrong' | 'gaveUp'): Promise<void> {
  if (kind === 'gaveUp') {
    await page.getByRole('button', { name: 'わからない' }).click();
    return;
  }
  const title = await page.locator('.question-text').textContent();
  const event = readDeckEvents().find((candidate) => candidate.title === title);
  expect(event).toBeDefined();
  await page
    .getByRole('textbox', { name: '年号' })
    .fill(kind === 'correct' ? String(event?.year) : '9999');
  await page.getByRole('button', { name: '回答' }).click();
}

function judgementBar(page: Page) {
  return page.locator('.judgement-bar');
}

/** 帯が画面の下端に付いているか（判定の帯は、下から上がる動きが終わってから測る）。 */
async function expectAtViewportBottom(page: Page, locator: Locator): Promise<void> {
  await locator.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = await locator.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box).not.toBeNull();
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - height)).toBeLessThanOrEqual(1);
}

/** 画面の最後まで送ったとき、`last` が下に固定した帯 `bar` に隠れないか。 */
async function expectNotHiddenByBar(page: Page, last: Locator, bar: Locator): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const lastBox = await last.boundingBox();
  const barBox = await bar.boundingBox();
  expect(lastBox).not.toBeNull();
  expect(barBox).not.toBeNull();
  expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(barBox?.y ?? 0);
}

test('ホームに連続学習日数の行が出て、間違えた問題を作ると復習の件数の札が出る', async ({
  page,
}) => {
  await page.goto('/');
  // 記録が無くても 0 日の行を出し、復習の件数の札は出さない
  await expect(page.getByTestId('home-streak')).toHaveText('連続学習日数 0 日');
  await expect(page.getByTestId('home-review-count')).toHaveCount(0);
  const review = page.getByRole('button', { name: '復習', exact: true });
  await expect(review).toBeEnabled();
  await expect(page.getByRole('heading', { level: 1, name: 'QLoop' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QLoop' })).toHaveAttribute('src', '/qloop-logo.svg');

  // 年号入力で 1 問間違えて終了する
  await startYearInput(page);
  await answerYearInput(page, 'wrong');
  await expect(page.getByTestId('judgement')).toHaveText('不正解');
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await page.getByRole('button', { name: 'ホームへ' }).click();

  await expect(page.getByTestId('home-streak')).toHaveText('連続学習日数 1 日');
  await expect(page.getByTestId('home-review-count')).toHaveText('1 件');
  // ボタンの名前は「復習」のまま、件数は説明として読み上げる
  await expect(review).toHaveAccessibleDescription('1 件');
  await expectNoHorizontalScroll(page);

  // 復習の画面と同じ数
  await review.click();
  await expect(page.getByTestId('review-count')).toHaveText('1 件');
});

test('出題では判定の帯に正解・不正解・わからないが出て「次へ」で進み、区切りが判定の色になる', async ({
  page,
}) => {
  await startYearInput(page);
  const steps = page.getByTestId('progress-steps');
  await expect(steps.locator('.progress-step')).toHaveCount(10);
  await expectStep(steps, 0, 'current');
  await expectStep(steps, 1, 'upcoming');
  await expect(judgementBar(page)).toHaveCount(0);

  // 正解
  await answerYearInput(page, 'correct');
  await expect(page.getByTestId('judgement')).toHaveText('正解');
  await expect(judgementBar(page)).toHaveClass(/\bcorrect\b/);
  await expect(judgementBar(page)).toHaveAttribute('aria-live', 'polite');
  await expect(judgementBar(page).getByText(/^正解の年 /)).toBeVisible();
  await expectAtViewportBottom(page, judgementBar(page));
  await expectStep(steps, 0, 'correct');
  await expectNoHorizontalScroll(page);
  await judgementBar(page).getByRole('button', { name: '次へ' }).click();

  // 次の問題へ進むと判定の帯は消え、2 つ目の区切りが今の問題になる
  await expect(page.getByTestId('progress')).toHaveText('2 / 10');
  await expect(judgementBar(page)).toHaveCount(0);
  await expectStep(steps, 1, 'current');

  // 不正解
  await answerYearInput(page, 'wrong');
  await expect(page.getByTestId('judgement')).toHaveText('不正解');
  await expect(judgementBar(page)).toHaveClass(/\bwrong\b/);
  await expectStep(steps, 1, 'wrong');
  await judgementBar(page).getByRole('button', { name: '次へ' }).click();

  // わからない（記録は不正解だが、区切りは灰色で分ける）。途中まで入れた数字は消して空欄にする
  await expect(page.getByTestId('progress')).toHaveText('3 / 10');
  await page.getByRole('textbox', { name: '年号' }).fill('15');
  await answerYearInput(page, 'gaveUp');
  await expect(page.getByTestId('judgement')).toHaveText('わからない');
  await expect(page.getByRole('textbox', { name: '年号' })).toHaveValue('');
  await expect(judgementBar(page)).toHaveClass(/\bgave-up\b/);
  await expectStep(steps, 2, 'gaveUp');
  await judgementBar(page).getByRole('button', { name: '次へ' }).click();

  await expect(page.getByTestId('progress')).toHaveText('4 / 10');
  await expectStep(steps, 0, 'correct');
  await expectStep(steps, 1, 'wrong');
  await expectStep(steps, 2, 'gaveUp');
  await expectStep(steps, 3, 'current');
  await expectStep(steps, 4, 'upcoming');

  // 結果の画面にも同じ判定の区切りを出す（答えていない問題はまだの色）
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await expect(page.getByTestId('result-score')).toHaveText('1 / 3');
  const resultSteps = page.getByTestId('progress-steps');
  await expect(resultSteps.locator('.progress-step')).toHaveCount(10);
  await expectStep(resultSteps, 0, 'correct');
  await expectStep(resultSteps, 1, 'wrong');
  await expectStep(resultSteps, 2, 'gaveUp');
  await expectStep(resultSteps, 3, 'upcoming');
});

test('判定の帯は下から短く出し、動きを減らす設定では動かさない', async ({ page }) => {
  await startYearInput(page);
  await answerYearInput(page, 'correct');
  const animationName = () =>
    judgementBar(page).evaluate((element) => getComputedStyle(element).animationName);
  expect(await animationName()).toBe('judgement-in');
  expect(
    await judgementBar(page).evaluate((element) => getComputedStyle(element).animationDuration),
  ).toBe('0.15s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animationName()).toBe('none');
});

test('出来事 4 択では、判定の帯が出ても選択肢 4 つが帯に隠れない', async ({ page }) => {
  await openSetup(page);
  await radio(page, '出来事 4 択').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();
  await page.getByTestId('choice').first().click();
  await expect(page.getByTestId('judgement')).toHaveText(/^(正解|不正解)$/);
  await expectAtViewportBottom(page, judgementBar(page));
  // 正解の選択肢には枠の上に札を出す
  await expect(page.locator('.choice.correct .choice-badge')).toHaveText('◯ 正解');
  await expectNotHiddenByBar(page, page.getByTestId('choice').last(), judgementBar(page));
});

test('問題数が 20 を超えると、区切りにせず 1 本の帯で進み具合を示す（結果には出さない）', async ({
  page,
}) => {
  await startYearInput(page, '全問');
  const total = Number((await page.getByTestId('progress').textContent())?.split(' / ')[1]);
  expect(total).toBeGreaterThan(20);
  await expect(page.getByTestId('progress-steps')).toHaveCount(0);
  const track = page.getByTestId('progress-track');
  const fill = track.locator('.progress-fill');
  /** 帯の幅に対する、瑠璃で塗った部分の幅の割合。 */
  const filledRatio = () =>
    fill.evaluate(
      (element) =>
        element.getBoundingClientRect().width /
        (element.parentElement?.getBoundingClientRect().width ?? 1),
    );
  expect(await filledRatio()).toBe(0);
  await answerYearInput(page, 'correct');
  await expect.poll(filledRatio).toBeCloseTo(1 / total, 3);
  expect(await backgroundOf(fill)).toBe(COLORS.primary);

  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await expect(page.getByTestId('result-score')).toHaveText('1 / 1');
  await expect(page.getByTestId('progress-steps')).toHaveCount(0);
});

test('確認ダイアログは、リセットの実行だけを赤にし、終了と読み込みは主なボタンの色のまま', async ({
  page,
}) => {
  // リセット
  await page.goto('/');
  await openRecords(page);
  await page.getByRole('button', { name: 'リセット' }).click();
  const reset = page.getByRole('dialog', { name: '成績をリセットしますか？' });
  await expect(reset).toContainText('すべての教材の');
  const resetButton = reset.getByRole('button', { name: 'リセットする' });
  await expect(resetButton).toHaveClass(/\bbutton-destructive\b/);
  expect(await backgroundOf(resetButton)).toBe(COLORS.destructive);
  // 開いたときは取り消しのボタンに焦点を置く
  await expect(reset.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('Escape');
  await expect(reset).toHaveCount(0);

  // 読み込みの確認
  await page.getByTestId('import-file').setInputFiles({
    name: 'qloop-progress-20261011.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        attempts: [],
        sessions: [],
      }),
    ),
  });
  const importing = page.getByRole('dialog', { name: '記録を読み込みますか？' });
  await expect(importing).toContainText('すべての教材の');
  await expect(importing.getByRole('button', { name: 'やめる' })).toBeFocused();
  const importButton = importing.getByRole('button', { name: '読み込む' });
  await expect(importButton).not.toHaveClass(/\bbutton-destructive\b/);
  expect(await backgroundOf(importButton)).toBe(COLORS.primary);
  await importing.getByRole('button', { name: 'やめる' }).click();
  await expect(importing).toHaveCount(0);

  // 終了の確認
  await startYearInput(page);
  await page.getByRole('button', { name: '終了', exact: true }).click();
  const end = page.getByRole('dialog', { name: 'ここで終了しますか？' });
  const endButton = end.getByRole('button', { name: '終了する' });
  await expect(endButton).not.toHaveClass(/\bbutton-destructive\b/);
  expect(await backgroundOf(endButton)).toBe(COLORS.primary);
});

test('出題設定の出題パターンのカードに、名前と説明が出る', async ({ page }) => {
  await openSetup(page);
  const expected: [string, string][] = [
    ['年号入力', '年を数字で入れる'],
    ['年号 4 択', '4 つの年から選ぶ'],
    ['出来事 4 択', '4 つの出来事から選ぶ'],
    ['ミックス', '3 つの形式をまぜる'],
  ];
  const cards = page.locator('.pattern-option');
  await expect(cards).toHaveCount(expected.length);
  for (const [index, [name, description]] of expected.entries()) {
    await expect(cards.nth(index).locator('.pattern-name')).toHaveText(name);
    await expect(cards.nth(index).locator('.pattern-desc')).toHaveText(description);
    await expect(radio(page, name)).toHaveAccessibleDescription(description);
  }
});

test('幅 375px で、各画面に横スクロールが出ず、下に固定した帯で本文が隠れない', async ({
  page,
}) => {
  // ホーム
  await page.goto('/');
  await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
  await expectNoHorizontalScroll(page);

  // 出題設定（範囲の 3 つ）。時代を開いて長くしても、最後のチップが帯に隠れない
  await openSetup(page);
  await expectNoHorizontalScroll(page);
  const bar = page.locator('.bottom-bar');
  await expectAtViewportBottom(page, bar);
  await radio(page, '年号の範囲').check();
  await expectNoHorizontalScroll(page);
  await expectNotHiddenByBar(page, page.locator('.hint'), bar);
  await radio(page, '時代').check();
  await expectNoHorizontalScroll(page);
  await expectNotHiddenByBar(
    page,
    page.getByRole('checkbox', { name: '令和', exact: true }).locator('..'),
    bar,
  );
  await expectAtViewportBottom(page, bar);
  await page.getByRole('button', { name: '戻る', exact: true }).click();

  // 復習
  await page.getByRole('button', { name: '復習', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '復習' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '戻る', exact: true }).click();

  // 出題（3 つのパターンの回答前と判定の後）
  for (const pattern of ['年号入力', '年号 4 択', '出来事 4 択']) {
    await openSetup(page);
    await radio(page, pattern).check();
    await radio(page, '10 問').check();
    await radio(page, '全範囲').check();
    await page.getByRole('button', { name: '開始' }).click();
    await expect(page.getByTestId('progress')).toHaveText('1 / 10');
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'わからない' }).click();
    await expect(page.getByTestId('judgement')).toHaveText('わからない');
    await expectNoHorizontalScroll(page);
  }

  // 結果。間違えた出来事の一覧が「ホームへ」の帯に隠れない
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNotHiddenByBar(page, page.getByTestId('wrong-list'), page.locator('.bottom-bar'));
  await page.getByRole('button', { name: 'ホームへ' }).click();

  // 成績（全体・出来事別・履歴）
  await page.getByRole('button', { name: '成績', exact: true }).click();
  for (const view of ['全体', '出来事別', '履歴']) {
    await radio(page, view).check();
    await expectNoHorizontalScroll(page);
  }
});
