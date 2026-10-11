import { expect, test, type Page } from '@playwright/test';
import {
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

test('4 択で 10 問を最後まで回答すると結果画面に着き、ホームへ戻れる', async ({ page }) => {
  await openSetup(page);
  await radio(page, '4 択').check();
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
});

test('年号入力で正解と不正解を 1 問ずつ答えて終了すると、結果画面に回答済みの分が出て記録が残る', async ({
  page,
}) => {
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
  await expect(page.getByText(/^正解の年: /)).toBeVisible();

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
});

test('出題する出来事は既定が基本の年表のみで、すべてを選ぶと追加データも対象になる', async ({
  page,
}) => {
  // pool.csv の行の有無によらないよう、件数は deck.json から数える
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
