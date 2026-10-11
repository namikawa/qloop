import { describe, expect, it } from 'vitest';
import {
  exportFileName,
  ImportFormatError,
  parseProgressExport,
  parseProgressJson,
  type ProgressExport,
} from './transfer';

const VALID: ProgressExport = {
  schemaVersion: 1,
  exportedAt: '2026-10-11T01:00:00.000Z',
  attempts: [
    {
      id: 1,
      eventId: 'jh-0001',
      pattern: 'yearInput',
      correct: false,
      answeredAt: '2026-10-11T01:00:01.000Z',
      sessionId: 's1',
    },
  ],
  sessions: [
    {
      id: 's1',
      mode: 'normal',
      pattern: 'mixed',
      range: { kind: 'eras', eras: ['奈良', '江戸'] },
      startedAt: '2026-10-11T01:00:00.000Z',
      endedAt: null,
      total: 10,
      answered: 1,
      correct: 0,
    },
    {
      id: 's2',
      mode: 'review',
      pattern: null,
      range: null,
      startedAt: '2026-10-11T02:00:00.000Z',
      endedAt: '2026-10-11T02:05:00.000Z',
      total: 5,
      answered: 0,
      correct: 0,
    },
  ],
};

/** VALID を複製し、`edit` で一部を書き換えたもの。 */
function variant(edit: (data: Record<string, unknown>) => void): unknown {
  const data = structuredClone(VALID) as unknown as Record<string, unknown>;
  edit(data);
  return data;
}

function firstAttempt(data: Record<string, unknown>): Record<string, unknown> {
  return (data.attempts as Record<string, unknown>[])[0];
}

function firstSession(data: Record<string, unknown>): Record<string, unknown> {
  return (data.sessions as Record<string, unknown>[])[0];
}

describe('parseProgressExport', () => {
  it('形式に合う内容はそのまま受け付ける（attempts の id は取り除く）', () => {
    const attempt = { ...VALID.attempts[0] };
    delete attempt.id;
    expect(parseProgressExport(structuredClone(VALID))).toEqual({
      ...VALID,
      attempts: [attempt],
    });
  });

  it('知らない項目は取り除く', () => {
    const parsed = parseProgressExport(
      variant((data) => {
        data.extra = true;
        firstAttempt(data).note = 'x';
        firstSession(data).note = 'x';
        (firstSession(data).range as Record<string, unknown>).note = 'x';
      }),
    );
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.attempts[0]).not.toHaveProperty('note');
    expect(parsed.sessions[0]).not.toHaveProperty('note');
    expect(parsed.sessions[0].range).toEqual({ kind: 'eras', eras: ['奈良', '江戸'] });
  });

  it('時刻は UTC の ISO 8601（toISOString の形）にそろえる', () => {
    const parsed = parseProgressExport(
      variant((data) => {
        firstAttempt(data).answeredAt = '2026-10-11T10:00:01+09:00';
      }),
    );
    expect(parsed.attempts[0].answeredAt).toBe('2026-10-11T01:00:01.000Z');
  });

  it('回答と集計のパターン（年号入力・年号 4 択・出来事 4 択）とセッションのパターン（それとミックス）を受け付ける', () => {
    for (const pattern of ['yearInput', 'yearChoice', 'choice']) {
      const parsed = parseProgressExport(
        variant((data) => {
          firstAttempt(data).pattern = pattern;
          firstSession(data).pattern = pattern;
        }),
      );
      expect(parsed.attempts[0].pattern).toBe(pattern);
      expect(parsed.sessions[0].pattern).toBe(pattern);
    }
    expect(parseProgressExport(structuredClone(VALID)).sessions[0].pattern).toBe('mixed');
  });

  it('年号の範囲は端が null か 1〜4 桁の正の整数なら受け付ける', () => {
    for (const range of [
      { kind: 'all' },
      { kind: 'years', from: null, to: 1600 },
      { kind: 'years', from: 1, to: 9999 },
    ]) {
      const parsed = parseProgressExport(
        variant((data) => {
          firstSession(data).range = range;
        }),
      );
      expect(parsed.sessions[0].range).toEqual(range);
    }
  });

  it.each<[string, (data: Record<string, unknown>) => void, RegExp]>([
    [
      'schemaVersion が 1 でない',
      (data) => {
        data.schemaVersion = 2;
      },
      /schemaVersion が 1 ではありません（2）/,
    ],
    [
      'schemaVersion が無い',
      (data) => {
        delete data.schemaVersion;
      },
      /schemaVersion が 1 ではありません（項目がありません）/,
    ],
    [
      'exportedAt が日時でない',
      (data) => {
        data.exportedAt = 'yesterday';
      },
      /exportedAt が日時ではありません/,
    ],
    [
      'attempts が配列でない',
      (data) => {
        data.attempts = null;
      },
      /attempts が配列ではありません/,
    ],
    [
      'sessions が配列でない',
      (data) => {
        delete data.sessions;
      },
      /sessions が配列ではありません/,
    ],
    [
      'attempts の項目がオブジェクトでない',
      (data) => {
        data.attempts = [1];
      },
      /attempts の 1 件目がオブジェクトではありません/,
    ],
    [
      'attempts の eventId が空',
      (data) => {
        firstAttempt(data).eventId = '';
      },
      /attempts の 1 件目: eventId が不正です/,
    ],
    [
      'attempts の pattern が不明',
      (data) => {
        firstAttempt(data).pattern = 'mixed';
      },
      /attempts の 1 件目: pattern が不正です（"mixed"）/,
    ],
    [
      'attempts の correct が真偽値でない',
      (data) => {
        firstAttempt(data).correct = 1;
      },
      /attempts の 1 件目: correct が不正です/,
    ],
    [
      'attempts の answeredAt が日時でない',
      (data) => {
        firstAttempt(data).answeredAt = '10/11/2026';
      },
      /attempts の 1 件目: answeredAt が不正です/,
    ],
    [
      'attempts の sessionId が無い',
      (data) => {
        delete firstAttempt(data).sessionId;
      },
      /attempts の 1 件目: sessionId が不正です（項目がありません）/,
    ],
    [
      'attempts の id が数でない',
      (data) => {
        firstAttempt(data).id = 'a';
      },
      /attempts の 1 件目: id が不正です/,
    ],
    [
      'sessions の mode が不明',
      (data) => {
        firstSession(data).mode = 'test';
      },
      /sessions の 1 件目: mode が不正です/,
    ],
    [
      'attempts の pattern が知らない値',
      (data) => {
        firstAttempt(data).pattern = 'eventChoice';
      },
      /attempts の 1 件目: pattern が不正です（"eventChoice"）/,
    ],
    [
      'sessions の pattern が不明',
      (data) => {
        firstSession(data).pattern = 'choice4';
      },
      /sessions の 1 件目: pattern が不正です/,
    ],
    [
      'sessions の pattern が大文字小文字の違う値',
      (data) => {
        firstSession(data).pattern = 'YearChoice';
      },
      /sessions の 1 件目: pattern が不正です（"YearChoice"）/,
    ],
    [
      'sessions の range の時代が時代区分表に無い',
      (data) => {
        firstSession(data).range = { kind: 'eras', eras: ['戦国'] };
      },
      /sessions の 1 件目: range が不正です/,
    ],
    [
      'sessions の range の年が正の整数でない',
      (data) => {
        firstSession(data).range = { kind: 'years', from: 0, to: null };
      },
      /sessions の 1 件目: range が不正です/,
    ],
    [
      'sessions の startedAt が無い',
      (data) => {
        delete firstSession(data).startedAt;
      },
      /sessions の 1 件目: startedAt が不正です/,
    ],
    [
      'sessions の endedAt が日時でも null でもない',
      (data) => {
        firstSession(data).endedAt = '';
      },
      /sessions の 1 件目: endedAt が不正です/,
    ],
    [
      'sessions の件数が負',
      (data) => {
        firstSession(data).answered = -1;
      },
      /sessions の 1 件目: answered が不正です/,
    ],
    [
      'sessions の件数が整数でない',
      (data) => {
        firstSession(data).total = 1.5;
      },
      /sessions の 1 件目: total が不正です/,
    ],
    [
      'sessions の id が重複している',
      (data) => {
        (data.sessions as Record<string, unknown>[])[1].id = 's1';
      },
      /sessions の 2 件目: id「s1」が重複しています/,
    ],
  ])('%s なら理由を含む ImportFormatError を投げる', (_label, edit, reason) => {
    const run = () => parseProgressExport(variant(edit));
    expect(run).toThrow(ImportFormatError);
    expect(run).toThrow(reason);
  });

  it.each([null, [], 'text', 1])('オブジェクトでない値（%j）は受け付けない', (value) => {
    expect(() => parseProgressExport(value)).toThrow(/成績の書き出しファイルの形式ではありません/);
  });
});

describe('parseProgressJson', () => {
  it('JSON の文字列を読んで検証する', () => {
    expect(parseProgressJson(JSON.stringify(VALID)).sessions).toHaveLength(2);
  });

  it('JSON として読めなければ ImportFormatError を投げる', () => {
    expect(() => parseProgressJson('{ broken')).toThrow(ImportFormatError);
    expect(() => parseProgressJson('{ broken')).toThrow('JSON として読めません');
  });
});

describe('exportFileName', () => {
  it('端末ローカルの日付で qloop-progress-YYYYMMDD.json にする', () => {
    expect(exportFileName(new Date(2026, 9, 11, 23, 59))).toBe('qloop-progress-20261011.json');
    expect(exportFileName(new Date(2027, 0, 2, 0, 0))).toBe('qloop-progress-20270102.json');
  });
});
