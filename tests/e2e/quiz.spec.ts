import { expect, test, type Page } from '@playwright/test';
import {
  collectCspViolations,
  expectNoHorizontalScroll,
  isYearInputEligible,
  openSetup,
  populationOf,
  radio,
  readDeckEvents,
} from './helpers';

interface SavedProgress {
  attempts: number;
  sessions: { answered: number; correct: number; total: number; ended: boolean }[];
}

/** ブラウザの中で IndexedDB を直接読み、保存された記録の件数を返す。 */
function readSavedProgress(page: Page): Promise<SavedProgress> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('qloop');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getAll = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    const attempts = await getAll<unknown>('attempts');
    const sessions = await getAll<{
      answered: number;
      correct: number;
      total: number;
      endedAt: string | null;
    }>('sessions');
    db.close();
    return {
      attempts: attempts.length,
      sessions: sessions.map((session) => ({
        answered: session.answered,
        correct: session.correct,
        total: session.total,
        ended: session.endedAt !== null,
      })),
    };
  });
}

test('出題設定の出題パターンは 年号入力・年号 4 択・出来事 4 択・ミックス の 4 つで、既定は年号入力', async ({
  page,
}) => {
  await openSetup(page);
  const group = page.getByRole('group', { name: '出題パターン' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await expect(group.locator('label')).toHaveText([
    '年号入力',
    '年号 4 択',
    '出来事 4 択',
    'ミックス',
  ]);
  await expect(radio(page, '年号入力')).toBeChecked();
  await expectNoHorizontalScroll(page);
  // どのパターンを選んでも対象の件数が出て、開始できる
  for (const name of ['年号 4 択', '出来事 4 択', 'ミックス', '年号入力']) {
    await radio(page, name).check();
    await expect(page.getByTestId('eligible-count')).toHaveText(/^対象 [1-9]\d* 件$/);
    await expect(page.getByRole('button', { name: '開始' })).toBeEnabled();
  }
});

test('出来事 4 択で 10 問を最後まで回答すると結果画面に着き、ホームへ戻れる', async ({ page }) => {
  const cspViolations = collectCspViolations(page);
  await openSetup(page);
  await radio(page, '出来事 4 択').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await expect(page.getByTestId('eligible-count')).toHaveText(/^対象 \d+ 件$/);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '開始' }).click();

  for (let i = 1; i <= 10; i++) {
    await expect(page.getByTestId('progress')).toHaveText(`${i} / 10`);
    const choices = page.getByTestId('choice');
    await expect(choices).toHaveCount(4);
    await expect(page.locator('.question-text')).toHaveText(/の出来事は？$/);
    if (i === 1) {
      await expectNoHorizontalScroll(page);
    }
    await choices.first().click();

    await expect(page.getByTestId('judgement')).toHaveText(/^(正解|不正解)$/);
    // 正解の選択肢を強調し、判定後は選び直せない
    await expect(page.locator('.choice.correct')).toHaveCount(1);
    for (const choice of await choices.all()) {
      await expect(choice).toBeDisabled();
    }
    if (i === 10) {
      await expect(page.getByRole('button', { name: '次へ' })).toHaveCount(0);
      await page.getByRole('button', { name: '結果を見る' }).click();
    } else {
      await page.getByRole('button', { name: '次へ' }).click();
    }
  }

  await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
  await expect(page.getByTestId('result-score')).toHaveText(/^\d+ \/ 10$/);
  await expect(page.getByTestId('result-total')).toHaveText('予定の問題数 10 問');
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'ホームへ' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'QLoop' })).toBeVisible();
  expect(cspViolations).toEqual([]);
});

test('年号入力で正解と不正解を 1 問ずつ答えて終了すると、結果画面に回答済みの分が出て記録が残る', async ({
  page,
}) => {
  const cspViolations = collectCspViolations(page);
  const events = readDeckEvents();
  await openSetup(page);
  await radio(page, '年号入力').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();

  const input = page.getByRole('textbox', { name: '年号' });
  const answerButton = page.getByRole('button', { name: '回答' });

  // 1 問目: 表示された出来事の正解の年を答える
  await expect(page.getByTestId('progress')).toHaveText('1 / 10');
  await expectNoHorizontalScroll(page);
  await expect(answerButton).toBeDisabled();
  await input.fill('abc');
  await expect(answerButton).toBeDisabled();
  await input.fill('12345');
  await expect(answerButton).toBeDisabled();
  const title = await page.locator('.question-text').textContent();
  const event = events.find((candidate) => candidate.title === title);
  expect(event).toBeDefined();
  await input.fill(String(event?.year));
  await answerButton.click();
  await expect(page.getByTestId('judgement')).toHaveText('正解');
  await expect(input).toBeDisabled();
  await expect(answerButton).toBeDisabled();
  await page.getByRole('button', { name: '次へ' }).click();

  // 2 問目: どの出来事にも当たらない年を全角数字で答える
  await expect(page.getByTestId('progress')).toHaveText('2 / 10');
  await input.fill('９９９９');
  await answerButton.click();
  await expect(page.getByTestId('judgement')).toHaveText('不正解');
  await expect(page.getByText(/^正解の年 /)).toBeVisible();

  // 終了 → 確認 → 結果
  await page.getByRole('button', { name: '終了', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ここで終了しますか？' });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: '終了する' }).click();

  await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
  await expect(page.getByTestId('result-score')).toHaveText('1 / 2');
  await expect(page.getByTestId('result-total')).toHaveText('予定の問題数 10 問（途中で終了）');
  await expect(page.getByTestId('wrong-list').getByRole('listitem')).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  // 再読み込み（再起動）しても記録が残る
  await page.reload();
  await expect(page.getByRole('button', { name: '出題', exact: true })).toBeEnabled();
  expect(await readSavedProgress(page)).toEqual({
    attempts: 2,
    sessions: [{ answered: 2, correct: 1, total: 10, ended: true }],
  });
  expect(cspViolations).toEqual([]);
});

test('出題する出来事は既定が基本の年表のみで、すべてを選ぶと追加データも対象になる', async ({
  page,
}) => {
  // pool.csv の行の有無によらないよう、件数は decks.json から数える
  const targets = populationOf(readDeckEvents()).filter(isYearInputEligible);
  const coreCount = targets.filter((event) => event.role === 'core').length;
  await openSetup(page);
  await expect(radio(page, '基本の年表のみ')).toBeChecked();
  await radio(page, '年号入力').check();
  await radio(page, '全範囲').check();
  await expect(page.getByTestId('eligible-count')).toHaveText(`対象 ${coreCount} 件`);
  await radio(page, 'すべて').check();
  await expect(page.getByTestId('eligible-count')).toHaveText(`対象 ${targets.length} 件`);
  await radio(page, '基本の年表のみ').check();
  await expect(page.getByTestId('eligible-count')).toHaveText(`対象 ${coreCount} 件`);
  await expectNoHorizontalScroll(page);
});

test('再読み込みすると、出題設定の初期値が前回開始したときの設定になる', async ({ page }) => {
  await openSetup(page);
  // 保存した設定が無いときの初期値
  await expect(radio(page, '基本の年表のみ')).toBeChecked();
  await expect(radio(page, '年号入力')).toBeChecked();
  await expect(radio(page, '10 問')).toBeChecked();
  await expect(radio(page, '全範囲')).toBeChecked();

  await radio(page, 'すべて').check();
  await radio(page, 'ミックス').check();
  await radio(page, '20 問').check();
  await radio(page, '年号の範囲').check();
  const from = page.getByRole('textbox', { name: '開始年' });
  const to = page.getByRole('textbox', { name: '終了年' });
  const start = page.getByRole('button', { name: '開始' });

  // 開始年が終了年より大きいときは理由を出して開始できない
  await from.fill('1600');
  await to.fill('700');
  await expect(page.getByText('開始年が終了年より後になっています')).toBeVisible();
  await expect(start).toBeDisabled();
  // 正の整数でない入力も開始できない
  await from.fill('0');
  await expect(page.getByText('年は 1〜4 桁の正の整数で入力してください')).toBeVisible();
  await expect(start).toBeDisabled();

  await from.fill('700');
  await to.fill('1600');
  await expect(page.getByTestId('eligible-count')).toHaveText(/^対象 \d+ 件$/);
  await expectNoHorizontalScroll(page);
  await start.click();
  await expect(page.getByTestId('progress')).toHaveText(/^1 \/ \d+$/);

  await page.reload();
  await page.getByRole('button', { name: '出題', exact: true }).click();
  await expect(radio(page, 'すべて')).toBeChecked();
  await expect(radio(page, 'ミックス')).toBeChecked();
  await expect(radio(page, '20 問')).toBeChecked();
  await expect(radio(page, '年号の範囲')).toBeChecked();
  await expect(from).toHaveValue('700');
  await expect(to).toHaveValue('1600');
  // 回答せずに閉じたセッションは、次の起動時に削除される
  expect((await readSavedProgress(page)).sessions).toEqual([]);

  // 時代の範囲は 1 つも選んでいなければ開始できない
  await radio(page, '時代').check();
  await expect(page.getByText('時代を 1 つ以上選んでください')).toBeVisible();
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: '奈良', exact: true }).check();
  await page.getByRole('checkbox', { name: '江戸', exact: true }).check();
  await expect(page.getByTestId('eligible-count')).toHaveText(/^対象 \d+ 件$/);
  await expect(start).toBeEnabled();
  await expectNoHorizontalScroll(page);
});

test('年号入力で「わからない」を押すと、不正解として記録し、答えを見せて先へ進める', async ({
  page,
}) => {
  const events = readDeckEvents();
  await openSetup(page);
  await radio(page, '年号入力').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();

  // 何も入力していなくても押せる
  await expect(page.getByTestId('progress')).toHaveText('1 / 10');
  const title = await page.locator('.question-text').textContent();
  const event = events.find((candidate) => candidate.title === title);
  expect(event).toBeDefined();
  await expect(page.getByRole('button', { name: '回答' })).toBeDisabled();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'わからない' }).click();

  await expect(page.getByTestId('judgement')).toHaveText('わからない');
  await expect(page.getByText(/^正解の年 /)).toContainText(`${event?.year}年`);
  await expect(page.getByRole('textbox', { name: '年号' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'わからない' })).toHaveCount(0);
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.getByTestId('progress')).toHaveText('2 / 10');
  await expect(page.getByRole('button', { name: 'わからない' })).toBeVisible();

  // 終了すると、わからなかった問題は間違えた出来事に入り、不正解として残る
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await expect(page.getByTestId('result-score')).toHaveText('0 / 1');
  await expect(page.getByTestId('wrong-list').getByRole('listitem')).toHaveCount(1);
  expect(await readSavedProgress(page)).toEqual({
    attempts: 1,
    sessions: [{ answered: 1, correct: 0, total: 10, ended: true }],
  });

  // 復習の候補にもなる
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await page.getByRole('button', { name: '復習', exact: true }).click();
  await expect(page.getByTestId('review-count')).toHaveText('1 件');
});

test('出来事 4 択で「わからない」を押すと、正解の選択肢を示して先へ進める', async ({ page }) => {
  await openSetup(page);
  await radio(page, '出来事 4 択').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();

  await expect(page.getByTestId('progress')).toHaveText('1 / 10');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'わからない' }).click();

  await expect(page.getByTestId('judgement')).toHaveText('わからない');
  // 正解だけを強調し、「選んだ答え」は出さない
  await expect(page.locator('.choice.correct')).toHaveCount(1);
  await expect(page.locator('.choice.wrong')).toHaveCount(0);
  for (const choice of await page.getByTestId('choice').all()) {
    await expect(choice).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'わからない' })).toHaveCount(0);
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.getByTestId('progress')).toHaveText('2 / 10');
});

test('年号 4 択で正解・不正解・「わからない」を 1 問ずつ答えて終了すると、結果に回答済みの分が出る', async ({
  page,
}) => {
  const cspViolations = collectCspViolations(page);
  const events = readDeckEvents();
  await openSetup(page);
  await radio(page, '年号 4 択').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();

  const choices = page.getByTestId('year-choice');
  const yearButton = (year: number) => page.getByRole('button', { name: `${year}年`, exact: true });

  /** 表示中の出来事を探し、年号の選択肢の決まり（小さい順、正解を含む、前後 10 年以内、別解を含まない）を確かめる。 */
  async function currentQuestion(): Promise<{ year: number; years: number[] }> {
    const title = await page.locator('.question-text').textContent();
    const event = events.find((candidate) => candidate.title === title);
    expect(event).toBeDefined();
    const year = event?.year ?? NaN;
    await expect(page.getByText('何年の出来事？')).toBeVisible();
    await expect(choices).toHaveCount(4);
    const texts = await choices.allTextContents();
    expect(texts.every((text) => /^\d+年$/.test(text))).toBe(true);
    const years = texts.map((text) => Number(text.replace('年', '')));
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(4);
    expect(years).toContain(year);
    for (const choice of years.filter((candidate) => candidate !== year)) {
      expect(Math.abs(choice - year)).toBeLessThanOrEqual(10);
      expect(event?.altYears).not.toContain(choice);
    }
    return { year, years };
  }

  async function expectLocked(): Promise<void> {
    for (const choice of await choices.all()) {
      await expect(choice).toBeDisabled();
    }
    await expect(page.getByRole('button', { name: 'わからない' })).toHaveCount(0);
  }

  // 1 問目: 正解の年を選ぶ
  await expect(page.getByTestId('progress')).toHaveText('1 / 10');
  await expectNoHorizontalScroll(page);
  const first = await currentQuestion();
  await yearButton(first.year).click();
  await expect(page.getByTestId('judgement')).toHaveText('正解');
  await expect(page.getByText(/^正解の年 /)).toContainText(`${first.year}年`);
  await expect(page.locator('.choice.correct')).toHaveCount(1);
  await expect(page.locator('.choice.correct')).toContainText(`${first.year}年`);
  await expect(page.locator('.choice.wrong')).toHaveCount(0);
  await expectLocked();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '次へ' }).click();

  // 2 問目: 違う年を選ぶ
  await expect(page.getByTestId('progress')).toHaveText('2 / 10');
  const second = await currentQuestion();
  const wrongYear = second.years.find((year) => year !== second.year) ?? NaN;
  await yearButton(wrongYear).click();
  await expect(page.getByTestId('judgement')).toHaveText('不正解');
  await expect(page.getByText(/^正解の年 /)).toContainText(`${second.year}年`);
  await expect(page.locator('.choice.correct')).toContainText(`${second.year}年`);
  await expect(page.locator('.choice.wrong')).toHaveCount(1);
  await expect(page.locator('.choice.wrong')).toContainText(`${wrongYear}年`);
  await expect(page.locator('.choice.wrong')).toContainText('選んだ答え');
  await expectLocked();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '次へ' }).click();

  // 3 問目: 「わからない」を押す
  await expect(page.getByTestId('progress')).toHaveText('3 / 10');
  const third = await currentQuestion();
  await page.getByRole('button', { name: 'わからない' }).click();
  await expect(page.getByTestId('judgement')).toHaveText('わからない');
  await expect(page.getByText(/^正解の年 /)).toContainText(`${third.year}年`);
  await expect(page.locator('.choice.correct')).toContainText(`${third.year}年`);
  await expect(page.locator('.choice.wrong')).toHaveCount(0);
  await expectLocked();

  // 終了すると、結果に回答済みの 3 問が出て、記録が残る
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
  await expect(page.getByTestId('result-score')).toHaveText('1 / 3');
  await expect(page.getByTestId('result-total')).toHaveText('予定の問題数 10 問（途中で終了）');
  await expect(page.getByTestId('wrong-list').getByRole('listitem')).toHaveCount(2);
  expect(await readSavedProgress(page)).toEqual({
    attempts: 3,
    sessions: [{ answered: 3, correct: 1, total: 10, ended: true }],
  });
  expect(cspViolations).toEqual([]);
});
