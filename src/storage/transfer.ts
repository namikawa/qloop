import { compactLocalDate } from '../core/date';
import { isEra } from '../core/era';
import {
  PATTERNS,
  type Attempt,
  type Era,
  type Pattern,
  type PatternMode,
  type Range,
  type Session,
  type SessionMode,
} from '../core/models';
import { LEGACY_DECK_ID } from './db';

/**
 * 成績の書き出しと読み込みの形式（設計書 5.6 節）。全教材の記録を 1 つのファイルに入れる。
 * `attempts` が正本で、読み込んだ後に `eventStats`・セッションの件数・`studyDays` を再計算する。
 * 版 2 で `sessions` の各項目に `deckId` を足した。読み込みは版 1 と 2 を受け付ける。
 */
export const EXPORT_SCHEMA_VERSION = 2;

export interface ProgressExport {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  /** 書き出した時刻（UTC の ISO 8601 文字列）。 */
  exportedAt: string;
  /** 回答の記録の全件（`id` は読み込むときに捨てて、自動採番に任せる）。 */
  attempts: Attempt[];
  /** セッションの全件（全教材の分。各項目に `deckId` を持つ）。 */
  sessions: Session[];
}

/** 書き出しのファイル名（例: `qloop-progress-20261011.json`。日付は端末ローカル）。 */
export function exportFileName(date: Date): string {
  return `qloop-progress-${compactLocalDate(date)}.json`;
}

/** 読み込んだ内容が形式に合わないときの例外。`message` に理由を入れる。 */
export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

/** JSON の文字列を読み、`parseProgressExport` で検証する。JSON として読めなければ `ImportFormatError`。 */
export function parseProgressJson(text: string): ProgressExport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportFormatError('JSON として読めません');
  }
  return parseProgressExport(value);
}

const PATTERN_MODES: readonly PatternMode[] = [...PATTERNS, 'mixed'];
const SESSION_MODE_KEYS: Record<SessionMode, true> = { normal: true, review: true };
const SESSION_MODES: readonly SessionMode[] = Object.keys(SESSION_MODE_KEYS) as SessionMode[];

/**
 * 読み込んだ値の形式を検証し、知らない項目を除いて版 2 の形にそろえた新しいオブジェクトにして返す（設計書 5.6 節）。
 * `schemaVersion` が 1 か 2 で、`attempts` と `sessions` が配列で各項目の型が合うこと。
 * セッションの `deckId` は、版 1 では無いので `LEGACY_DECK_ID`（日本史年表）を補い、版 2 では空でない文字列なら
 * 今の教材に無い id もそのまま保つ。
 * 時刻は UTC の ISO 8601 文字列（`toISOString()` の形）にそろえる。合わなければ理由を入れた `ImportFormatError`。
 */
export function parseProgressExport(value: unknown): ProgressExport {
  if (!isRecord(value)) {
    throw new ImportFormatError('成績の書き出しファイルの形式ではありません');
  }
  // 版 1 は 1.0 の書き出しで、`sessions` に `deckId` が無い
  const legacy = value.schemaVersion === 1;
  if (!legacy && value.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new ImportFormatError(
      `schemaVersion が 1 か ${EXPORT_SCHEMA_VERSION} ではありません（${describe(value.schemaVersion)}）`,
    );
  }
  if (!Array.isArray(value.attempts)) {
    throw new ImportFormatError('attempts が配列ではありません');
  }
  if (!Array.isArray(value.sessions)) {
    throw new ImportFormatError('sessions が配列ではありません');
  }
  const exportedAt = normalizeTime(value.exportedAt);
  if (exportedAt === null) {
    throw new ImportFormatError(`exportedAt が日時ではありません（${describe(value.exportedAt)}）`);
  }
  const attempts = value.attempts.map((item: unknown, index) => parseAttempt(item, index));
  const sessions = value.sessions.map((item: unknown, index) => parseSession(item, index, legacy));
  const ids = new Set<string>();
  sessions.forEach((session, index) => {
    if (ids.has(session.id)) {
      throw new ImportFormatError(
        `sessions の ${index + 1} 件目: id「${session.id}」が重複しています`,
      );
    }
    ids.add(session.id);
  });
  return { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt, attempts, sessions };
}

function parseAttempt(item: unknown, index: number): Attempt {
  const where = `attempts の ${index + 1} 件目`;
  if (!isRecord(item)) {
    throw new ImportFormatError(`${where}がオブジェクトではありません`);
  }
  const fail = (field: string) =>
    new ImportFormatError(`${where}: ${field} が不正です（${describe(item[field])}）`);
  if (item.id !== undefined && typeof item.id !== 'number') {
    throw fail('id');
  }
  if (typeof item.eventId !== 'string' || item.eventId === '') {
    throw fail('eventId');
  }
  if (!PATTERNS.includes(item.pattern as Pattern)) {
    throw fail('pattern');
  }
  if (typeof item.correct !== 'boolean') {
    throw fail('correct');
  }
  if (typeof item.sessionId !== 'string' || item.sessionId === '') {
    throw fail('sessionId');
  }
  const answeredAt = normalizeTime(item.answeredAt);
  if (answeredAt === null) {
    throw fail('answeredAt');
  }
  return {
    eventId: item.eventId,
    pattern: item.pattern as Pattern,
    correct: item.correct,
    answeredAt,
    sessionId: item.sessionId,
  };
}

/** セッションを検証する。`legacy`（版 1）なら `deckId` を読まずに `LEGACY_DECK_ID` を補う。 */
function parseSession(item: unknown, index: number, legacy: boolean): Session {
  const where = `sessions の ${index + 1} 件目`;
  if (!isRecord(item)) {
    throw new ImportFormatError(`${where}がオブジェクトではありません`);
  }
  const fail = (field: string) =>
    new ImportFormatError(`${where}: ${field} が不正です（${describe(item[field])}）`);
  if (typeof item.id !== 'string' || item.id === '') {
    throw fail('id');
  }
  let deckId = LEGACY_DECK_ID;
  if (!legacy) {
    if (typeof item.deckId !== 'string' || item.deckId === '') {
      throw fail('deckId');
    }
    deckId = item.deckId;
  }
  if (!SESSION_MODES.includes(item.mode as SessionMode)) {
    throw fail('mode');
  }
  if (item.pattern !== null && !PATTERN_MODES.includes(item.pattern as PatternMode)) {
    throw fail('pattern');
  }
  let range: Range | null = null;
  if (item.range !== null) {
    const parsed = parseRange(item.range);
    if (parsed === null) {
      throw fail('range');
    }
    range = parsed;
  }
  const startedAt = normalizeTime(item.startedAt);
  if (startedAt === null) {
    throw fail('startedAt');
  }
  const endedAt = item.endedAt === null ? null : normalizeTime(item.endedAt);
  if (item.endedAt !== null && endedAt === null) {
    throw fail('endedAt');
  }
  for (const field of ['total', 'answered', 'correct']) {
    if (!isCount(item[field])) {
      throw fail(field);
    }
  }
  return {
    id: item.id,
    deckId,
    mode: item.mode as SessionMode,
    pattern: item.pattern as PatternMode | null,
    range,
    startedAt,
    endedAt,
    total: item.total as number,
    answered: item.answered as number,
    correct: item.correct as number,
  };
}

/** 出題範囲（`Range`）の形か調べ、合えば知らない項目を除いたものを返す。合わなければ `null`。 */
function parseRange(value: unknown): Range | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.kind) {
    case 'all':
      return { kind: 'all' };
    case 'years': {
      const { from, to } = value;
      if (!isRangeYear(from) || !isRangeYear(to)) {
        return null;
      }
      return { kind: 'years', from, to };
    }
    case 'eras': {
      const { eras } = value;
      if (!Array.isArray(eras) || !eras.every((era) => typeof era === 'string' && isEra(era))) {
        return null;
      }
      return { kind: 'eras', eras: [...(eras as Era[])] };
    }
    default:
      return null;
  }
}

/** 年号の範囲の端（`null` か 1〜4 桁の正の整数。設計書 6.1 節の 2）。 */
function isRangeYear(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 9999)
  );
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** ISO 8601 の日時の先頭（日付と時刻）。ブラウザごとに受け付ける形が違う書き方は通さない。 */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** 日時の文字列を UTC の ISO 8601（`toISOString()` の形）にそろえる。日時として読めなければ `null`。 */
function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** エラーの理由に添える値の表示（長いものは切る）。 */
function describe(value: unknown): string {
  if (value === undefined) {
    return '項目がありません';
  }
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
