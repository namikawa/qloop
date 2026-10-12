import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  collectCspViolations,
  expectNoHorizontalScroll,
  isYearInputEligible,
  openSetup,
  populationOf,
  radio,
  readDeckEvents,
  type DeckEvent,
} from './helpers';

function findByTitle(events: readonly DeckEvent[], title: string | null): DeckEvent {
  const event = events.find((candidate) => candidate.title === title);
  expect(event, `「${title}」が decks.json に無い`).toBeDefined();
  return event!;
}

/**
 * 年号入力・全範囲で出題を始め、`results` の順に正解（true）か不正解（false）で答えてから終了する。
 * 答えた出来事を順に返す。終了後は結果画面からホームへ戻る。
 */
async function answerYearInputs(page: Page, results: boolean[]): Promise<DeckEvent[]> {
  const events = readDeckEvents();
  await openSetup(page);
  await radio(page, '年号入力').check();
  await radio(page, '10 問').check();
  await radio(page, '全範囲').check();
  await page.getByRole('button', { name: '開始' }).click();

  const answered: DeckEvent[] = [];
  for (const [index, correct] of results.entries()) {
    await expect(page.getByTestId('progress')).toHaveText(`${index + 1} / 10`);
    const event = findByTitle(events, await page.locator('.question-text').textContent());
    answered.push(event);
    // 不正解はどの出来事にも当たらない年で答える
    await page.getByRole('textbox', { name: '年号' }).fill(correct ? String(event.year) : '9999');
    await page.getByRole('button', { name: '回答' }).click();
    await expect(page.getByTestId('judgement')).toHaveText(correct ? '正解' : '不正解');
    if (index < results.length - 1) {
      await page.getByRole('button', { name: '次へ' }).click();
    }
  }
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '終了する' }).click();
  await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'QLoop' })).toBeVisible();
  return answered;
}

async function openStats(page: Page): Promise<void> {
  await page.getByRole('button', { name: '成績', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '成績' })).toBeVisible();
}

async function openReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: '復習', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '復習' })).toBeVisible();
}

function eventRowTitles(page: Page) {
  return page.getByTestId('event-row').locator('.event-row-title');
}

/** 成績の画面の表示（全体・出来事別・履歴）を切り替える。 */
async function showStatsView(page: Page, name: '全体' | '出来事別' | '履歴'): Promise<void> {
  await radio(page, name).check();
  await expect(radio(page, name)).toBeChecked();
}

function sortSelect(page: Page) {
  return page.getByRole('combobox', { name: '並べ替え' });
}

test('年号入力で不正解を作ると復習に候補が出て、復習を進めると結果に着く', async ({ page }) => {
  // 記録が無いときは候補が無く、開始できない
  await page.goto('/');
  await openReview(page);
  await expect(page.getByTestId('review-count')).toHaveText('復習する問題はありません');
  await expect(page.getByRole('button', { name: '開始' })).toBeDisabled();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '戻る', exact: true }).click();

  const [wrong] = await answerYearInputs(page, [false]);

  await openReview(page);
  await expect(page.getByTestId('review-count')).toHaveText('1 件');
  await expect(radio(page, '10 問')).toBeChecked();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '開始' }).click();

  // 間違えた出来事を、間違えたパターン（年号入力）で出す
  await expect(page.getByTestId('progress')).toHaveText('1 / 1');
  await expect(page.locator('.question-text')).toHaveText(wrong.title);
  await expectNoHorizontalScroll(page);
  await page.getByRole('textbox', { name: '年号' }).fill(String(wrong.year));
  await page.getByRole('button', { name: '回答' }).click();
  await expect(page.getByTestId('judgement')).toHaveText('正解');
  await page.getByRole('button', { name: '結果を見る' }).click();
  await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
  await expect(page.getByTestId('result-score')).toHaveText('1 / 1');
  await expect(page.getByTestId('result-total')).toHaveText('予定の問題数 1 問');

  // 正解した後も、直近 14 日以内に不正解があるので候補に残る
  await page.getByRole('button', { name: 'ホームへ' }).click();
  await openReview(page);
  await expect(page.getByTestId('review-count')).toHaveText('1 件');

  // 復習のセッションも履歴に残る
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await openStats(page);
  await expect(page.getByTestId('overall-attempts')).toHaveText('2 回');
  await showStatsView(page, '履歴');
  await expect(page.getByTestId('history-item')).toHaveCount(2);
  await expect(page.getByTestId('history-item').first()).toContainText('復習');
  await expect(page.getByTestId('history-item').first()).toContainText('1 / 1');
});

test('成績画面は 全体・出来事別・履歴 を切り替えて出し、出来事別の並べ替えと内訳の開閉が動く', async ({
  page,
}) => {
  const population = populationOf(readDeckEvents());
  const [wrong, right] = await answerYearInputs(page, [false, true]);
  await openStats(page);

  // 初めは「全体」。全体・時代別・記録の管理を出し、出来事別と履歴は出さない
  const views = page.getByRole('group', { name: '成績の表示' });
  await expect(views.getByRole('radio')).toHaveCount(3);
  await expect(views.locator('label')).toHaveText(['全体', '出来事別', '履歴']);
  await expect(radio(page, '全体')).toBeChecked();
  for (const name of ['時代別', '記録の管理']) {
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('event-row')).toHaveCount(0);
  await expect(page.getByTestId('history-item')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // 全体
  await expect(page.getByTestId('overall-attempts')).toHaveText('2 回');
  await expect(page.getByTestId('overall-accuracy')).toHaveText('50%');
  await expect(page.getByTestId('overall-streak')).toHaveText('1 日');

  // 時代別: 母集団に出来事がある時代ごとに 1 行
  const eras = new Set(population.map((event) => event.era));
  await expect(page.getByTestId('era-row')).toHaveCount(eras.size);
  if (wrong.era !== right.era) {
    await expect(page.getByTestId('era-row').filter({ hasText: wrong.era }).first()).toContainText(
      '0%（1 回）',
    );
  }

  // 出来事別: 母集団の出来事ごとに 1 行。既定は正答率の低い順
  await showStatsView(page, '出来事別');
  await expect(page.getByTestId('era-row')).toHaveCount(0);
  await expect(page.getByTestId('event-row')).toHaveCount(population.length);
  await expect(sortSelect(page)).toHaveValue('accuracy');
  await expect(sortSelect(page).locator('option')).toHaveText([
    '正答率の低い順',
    '回答数の多い順',
    '最終回答日の新しい順',
  ]);
  await expect(eventRowTitles(page).nth(0)).toHaveText(wrong.title);
  await expect(eventRowTitles(page).nth(1)).toHaveText(right.title);
  await expectNoHorizontalScroll(page);

  await sortSelect(page).selectOption('recent');
  await expect(eventRowTitles(page).nth(0)).toHaveText(right.title);
  await expect(eventRowTitles(page).nth(1)).toHaveText(wrong.title);

  // 回答数はどちらも 1 回なので id 順
  await sortSelect(page).selectOption('attempts');
  const [first, second] = [wrong, right].sort((a, b) => (a.id < b.id ? -1 : 1));
  await expect(eventRowTitles(page).nth(0)).toHaveText(first.title);
  await expect(eventRowTitles(page).nth(1)).toHaveText(second.title);
  await expectNoHorizontalScroll(page);

  // 行を押すとパターン別の内訳を開閉する
  const row = page.getByTestId('event-row').filter({ hasText: wrong.title });
  const toggle = row.getByRole('button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByTestId('breakdown')).toContainText('年号入力');
  await expect(row.getByTestId('breakdown')).toContainText('0%（0 / 1）');
  await expectNoHorizontalScroll(page);
  await toggle.click();
  await expect(row.getByTestId('breakdown')).toHaveCount(0);

  // 履歴
  await showStatsView(page, '履歴');
  await expect(page.getByTestId('event-row')).toHaveCount(0);
  const history = page.getByTestId('history-item');
  await expect(history).toHaveCount(1);
  await expect(history).toContainText('通常 · 全範囲 · 年号入力');
  await expect(history).toContainText('1 / 2');
  await expect(history).not.toContainText('中断');
  await expectNoHorizontalScroll(page);

  // 全体に戻すと、全体の数字をまた出す
  await showStatsView(page, '全体');
  await expect(page.getByTestId('overall-attempts')).toHaveText('2 回');
});

/** 母集団のうち、年号入力に出せる最初の出来事。 */
function firstYearInputEvent(): DeckEvent {
  const event = populationOf(readDeckEvents()).find(isYearInputEligible);
  expect(event).toBeDefined();
  return event!;
}

function progressFile(content: unknown, name = 'qloop-progress-20261011.json') {
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)),
  };
}

test('JSON を読み込むと確認の後に記録が置き換わり、形式が不正なら理由を出して何も変えない', async ({
  page,
}) => {
  const target = firstYearInputEvent();
  const base = Date.now() - 60_000;
  const at = (offset: number) => new Date(base + offset).toISOString();
  const attempt = (correct: boolean, offset: number) => ({
    eventId: target.id,
    pattern: 'yearInput',
    correct,
    answeredAt: at(offset),
    sessionId: 'imported-session',
  });
  const data = {
    schemaVersion: 1,
    exportedAt: at(10_000),
    attempts: [attempt(false, 1000), attempt(false, 2000), attempt(true, 3000)],
    sessions: [
      {
        id: 'imported-session',
        mode: 'normal',
        pattern: 'yearInput',
        range: { kind: 'years', from: 700, to: 1600 },
        startedAt: at(0),
        endedAt: at(3000),
        total: 10,
        // 件数は読み込んだ後に attempts から数え直す
        answered: 0,
        correct: 0,
      },
    ],
  };

  await page.goto('/');
  await openStats(page);
  const fileInput = page.getByTestId('import-file');
  const notice = page.getByTestId('stats-notice');

  // JSON として読めないファイル
  await fileInput.setInputFiles(progressFile('{ broken', 'broken.json'));
  await expect(notice).toHaveText('読み込めませんでした（JSON として読めません）');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 形式が合わないファイル
  await fileInput.setInputFiles(progressFile({ ...data, schemaVersion: 3 }));
  await expect(notice).toContainText('schemaVersion が 1 か 2 ではありません');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('overall-attempts')).toHaveText('0 回');

  // 確認ダイアログで取り消すと何も変えない
  await fileInput.setInputFiles(progressFile(data));
  const dialog = page.getByRole('dialog', { name: '記録を読み込みますか？' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('回答 3 件・セッション 1 件');
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'やめる' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('overall-attempts')).toHaveText('0 回');

  // 読み込むと全置換して集計し直す
  await fileInput.setInputFiles(progressFile(data));
  await dialog.getByRole('button', { name: '読み込む' }).click();
  await expect(notice).toHaveText('読み込みました（回答 3 件・セッション 1 件）');
  await expect(page.getByTestId('overall-attempts')).toHaveText('3 回');
  await expect(page.getByTestId('overall-accuracy')).toHaveText('33%');
  await expect(page.getByTestId('overall-streak')).toHaveText('1 日');
  await showStatsView(page, '履歴');
  const history = page.getByTestId('history-item');
  await expect(history).toHaveCount(1);
  await expect(history).toContainText('通常 · 700年〜1600年 · 年号入力');
  await expect(history).toContainText('1 / 3');
  await showStatsView(page, '出来事別');
  await expect(eventRowTitles(page).first()).toHaveText(target.title);

  // 再起動しても読み込んだ記録が残り、復習の候補にもなる
  await page.reload();
  await openReview(page);
  await expect(page.getByTestId('review-count')).toHaveText('1 件');
});

test('リセットは確認の後に記録を消す（取り消せば消さない）', async ({ page }) => {
  await answerYearInputs(page, [false]);
  await openStats(page);
  await expect(page.getByTestId('overall-attempts')).toHaveText('1 回');

  await page.getByRole('button', { name: 'リセット' }).click();
  const dialog = page.getByRole('dialog', { name: '成績をリセットしますか？' });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'やめる' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('overall-attempts')).toHaveText('1 回');

  await page.getByRole('button', { name: 'リセット' }).click();
  await dialog.getByRole('button', { name: 'リセットする' }).click();
  await expect(page.getByTestId('stats-notice')).toHaveText('成績をリセットしました');
  await expect(page.getByTestId('overall-attempts')).toHaveText('0 回');
  await expect(page.getByTestId('overall-accuracy')).toHaveText('未回答');
  await expect(page.getByTestId('overall-streak')).toHaveText('0 日');
  await showStatsView(page, '履歴');
  await expect(page.getByTestId('history-empty')).toBeVisible();

  // 再起動しても消えたまま
  await page.reload();
  await openStats(page);
  await expect(page.getByTestId('overall-attempts')).toHaveText('0 回');
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await openReview(page);
  await expect(page.getByTestId('review-count')).toHaveText('復習する問題はありません');
});

test('書き出しは、ファイル共有が使えなければダウンロードのリンクで JSON を保存する', async ({
  page,
}) => {
  const cspViolations = collectCspViolations(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: undefined,
      configurable: true,
    });
  });
  await answerYearInputs(page, [false]);
  await openStats(page);
  await page.getByRole('button', { name: '書き出し' }).click();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await expect(page.getByRole('button', { name: '共有して保存' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'ファイルを保存' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^qloop-progress-\d{8}\.json$/);
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    schemaVersion: number;
    attempts: unknown[];
    sessions: { answered: number }[];
  };
  expect(saved.schemaVersion).toBe(2);
  expect(saved.attempts).toHaveLength(1);
  expect(saved.sessions.map((session) => session.answered)).toEqual([1]);
  expect(cspViolations).toEqual([]);
});

test('書き出しをもう一度押すと準備した欄を閉じ、また押すと作り直して保存できる', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: undefined,
      configurable: true,
    });
  });
  await answerYearInputs(page, [false]);
  await openStats(page);
  const exportButton = page.getByRole('button', { name: '書き出し' });
  await expect(exportButton).toHaveAttribute('aria-expanded', 'false');
  await exportButton.click();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await expect(exportButton).toHaveAttribute('aria-expanded', 'true');

  // もう一度押すと閉じる
  await exportButton.click();
  await expect(page.getByTestId('export-ready')).toHaveCount(0);
  await expect(exportButton).toHaveAttribute('aria-expanded', 'false');

  // また押すと作り直し、閉じる前の URL を解放していても保存できる
  await exportButton.click();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'ファイルを保存' }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    attempts: unknown[];
  };
  expect(saved.attempts).toHaveLength(1);
});

test('書き出しは、共有に失敗したらダウンロードのリンクに切り替わり、そこから保存できる', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      value: () => Promise.reject(new DOMException('共有できない', 'NotAllowedError')),
      configurable: true,
    });
  });
  await answerYearInputs(page, [false]);
  await openStats(page);
  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('button', { name: '共有して保存' }).click();
  await expect(page.getByTestId('stats-notice')).toContainText('共有できませんでした');
  await expect(page.getByRole('button', { name: '共有して保存' })).toHaveCount(0);

  // 切り替わったリンクの URL は生きていて、保存できる
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'ファイルを保存' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^qloop-progress-\d{8}\.json$/);
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    attempts: unknown[];
  };
  expect(saved.attempts).toHaveLength(1);

  // 「書き出し」で欄を閉じると、「ファイルを保存」への案内も消える
  await page.getByRole('button', { name: '書き出し' }).click();
  await expect(page.getByTestId('export-ready')).toHaveCount(0);
  await expect(page.getByTestId('stats-notice')).toHaveCount(0);
});

test('書き出しは、ファイル共有が使えれば共有のシートで JSON を渡す', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: { name: string; type: string }[] = [];
    Object.defineProperty(window, '__shared', { value: shared });
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      value: (data: ShareData) => {
        for (const file of data.files ?? []) {
          shared.push({ name: file.name, type: file.type });
        }
        return Promise.resolve();
      },
      configurable: true,
    });
  });
  await page.goto('/');
  await openStats(page);
  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('button', { name: '共有して保存' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
    .toEqual([
      { name: expect.stringMatching(/^qloop-progress-\d{8}\.json$/), type: 'application/json' },
    ]);
});
