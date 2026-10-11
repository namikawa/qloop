import { addDaysToKey, localDateKey, type DateKeyFn } from './date';
import { ERAS } from './era';
import {
  PATTERNS,
  type Era,
  type Event,
  type EventStats,
  type Pattern,
  type PatternMode,
  type Range,
  type Session,
  type SessionMode,
} from './models';

/**
 * 成績の集計（設計書 8 章）。入力は ProgressStore が持つ状態（`eventStats`・`sessions`・`studyDays`）と母集団。
 *
 * 全体・時代別・出来事別の成績は、母集団の出来事の `eventStats` だけから作る（現在のデータに無い `eventId` の
 * 集計は除外する）。セッション履歴と `studyDays` は活動の記録としてそのまま使う（設計書 5.4 節）。
 * 正答率は正解数 ÷ 回答数で、通常と復習を合算する。回答数 0 は「未回答」（正答率は `null`）。
 */

/** 回答数と正解数。 */
export interface Tally {
  attempts: number;
  correct: number;
}

/** 正答率（0〜1）。回答数 0 なら `null`（未回答）。 */
export function accuracyOf({ attempts, correct }: Tally): number | null {
  return attempts === 0 ? null : correct / attempts;
}

/** 正答率の表示（例: `67%`）。回答数 0 なら `未回答`。 */
export function formatAccuracy(tally: Tally): string {
  const accuracy = accuracyOf(tally);
  return accuracy === null ? '未回答' : `${Math.round(accuracy * 100)}%`;
}

/** 全体の成績。 */
interface OverallStats extends Tally {
  /** 連続学習日数。 */
  streakDays: number;
}

/** 時代ごとの成績。 */
export interface EraStats extends Tally {
  era: Era;
}

/** 出来事 × パターンの成績（出来事別の内訳）。 */
interface PatternRow extends Tally {
  pattern: Pattern;
  lastAnsweredAt: string;
}

/** 出来事ごとの成績。 */
export interface EventRow extends Tally {
  event: Event;
  /** 最後に回答した時刻（UTC の ISO 8601 文字列）。未回答は `null`。 */
  lastAnsweredAt: string | null;
  /** パターン別の内訳（回答のあるパターンだけ。年号入力・年号 4 択・出来事 4 択の順）。 */
  patterns: PatternRow[];
}

/** 出来事別の並べ替え。 */
export type EventSortOrder = 'accuracy' | 'attempts' | 'recent';

export interface StatsInput {
  /** 母集団（`population(deck)`）。出題設定の「出題する出来事」では絞り込まない。 */
  population: readonly Event[];
  stats: readonly EventStats[];
  sessions: readonly Session[];
  studyDays: readonly string[];
  now: Date;
  /** 暦。既定は端末ローカルの暦。 */
  dateKey?: DateKeyFn;
}

export interface StatsSummary {
  overall: OverallStats;
  /** 時代区分表の順。 */
  eras: EraStats[];
  /** 母集団の順（並べ替えは `sortEventRows`）。 */
  events: EventRow[];
  /** 履歴に出すセッション（`sessionHistory`）。 */
  history: Session[];
}

/** 成績画面の 4 区分をまとめて集計する。 */
export function summarizeStats({
  population,
  stats,
  sessions,
  studyDays,
  now,
  dateKey = localDateKey,
}: StatsInput): StatsSummary {
  const events = eventRows(population, stats);
  const total = sumTallies(events);
  return {
    overall: { ...total, streakDays: streakDays(studyDays, dateKey(now)) },
    eras: eraStats(events),
    events,
    history: sessionHistory(sessions),
  };
}

/**
 * 出来事ごとの成績を作る。母集団の出来事だけを対象にし、並びは母集団の順（同じ id は最初の 1 件だけ）。
 * 現在のデータに無い `eventId` の集計は使わない。
 */
export function eventRows(population: readonly Event[], stats: readonly EventStats[]): EventRow[] {
  const byEvent = new Map<string, EventStats[]>();
  for (const record of stats) {
    const list = byEvent.get(record.eventId);
    if (list === undefined) {
      byEvent.set(record.eventId, [record]);
    } else {
      list.push(record);
    }
  }
  const rows: EventRow[] = [];
  const seen = new Set<string>();
  for (const event of population) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    const records = byEvent.get(event.id) ?? [];
    const patterns: PatternRow[] = [];
    for (const pattern of PATTERNS) {
      const record = records.find((candidate) => candidate.pattern === pattern);
      if (record !== undefined && record.attempts > 0) {
        patterns.push({
          pattern,
          attempts: record.attempts,
          correct: record.correct,
          lastAnsweredAt: record.lastAnsweredAt,
        });
      }
    }
    let lastAnsweredAt: string | null = null;
    for (const row of patterns) {
      if (lastAnsweredAt === null || compareTime(row.lastAnsweredAt, lastAnsweredAt) > 0) {
        lastAnsweredAt = row.lastAnsweredAt;
      }
    }
    rows.push({ event, ...sumTallies(patterns), lastAnsweredAt, patterns });
  }
  return rows;
}

/**
 * 時代ごとの成績。母集団に出来事がある時代だけを、時代区分表の順に並べる（回答数 0 の時代は未回答）。
 */
export function eraStats(rows: readonly EventRow[]): EraStats[] {
  const byEra = new Map<Era, Tally>();
  for (const row of rows) {
    const tally = byEra.get(row.event.era) ?? { attempts: 0, correct: 0 };
    byEra.set(row.event.era, {
      attempts: tally.attempts + row.attempts,
      correct: tally.correct + row.correct,
    });
  }
  const result: EraStats[] = [];
  for (const { name } of ERAS) {
    const tally = byEra.get(name);
    if (tally !== undefined) {
      result.push({ era: name, ...tally });
    }
  }
  return result;
}

/**
 * 出来事別の並べ替え。同順位は id 順。元の配列は変えない。
 *
 * - `accuracy`: 正答率の低い順（既定）。未回答は回答済みの後ろ。
 * - `attempts`: 回答数の多い順。
 * - `recent`: 最終回答日の新しい順。未回答は後ろ。
 */
export function sortEventRows(rows: readonly EventRow[], order: EventSortOrder): EventRow[] {
  const compare = (a: EventRow, b: EventRow): number => {
    switch (order) {
      case 'accuracy':
        if (a.attempts === 0 || b.attempts === 0) {
          return (a.attempts === 0 ? 1 : 0) - (b.attempts === 0 ? 1 : 0);
        }
        // a.correct / a.attempts と b.correct / b.attempts を、小数の誤差が出ないよう整数で比べる
        return a.correct * b.attempts - b.correct * a.attempts;
      case 'attempts':
        return b.attempts - a.attempts;
      case 'recent':
        if (a.lastAnsweredAt === null || b.lastAnsweredAt === null) {
          return (a.lastAnsweredAt === null ? 1 : 0) - (b.lastAnsweredAt === null ? 1 : 0);
        }
        return compareTime(b.lastAnsweredAt, a.lastAnsweredAt);
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || compareId(a.event.id, b.event.id));
}

/**
 * 連続学習日数（設計書 8 章の 1）。今日に回答があれば今日、なければ昨日を起点に、
 * 連続して回答のあった暦日を数える。どちらにも無ければ 0。`today` は端末の暦での今日（`YYYY-MM-DD`）。
 */
export function streakDays(studyDays: readonly string[], today: string): number {
  const days = new Set(studyDays);
  let cursor = days.has(today) ? today : addDaysToKey(today, -1);
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = addDaysToKey(cursor, -1);
  }
  return count;
}

/**
 * 履歴に出すセッション（設計書 8 章の 4）。開始時刻の新しい順（同時刻は id 順）。
 * 回答が 0 件のもの（回答せずに終了したもの）は出さない。`endedAt` が `null` のものは中断として出す。
 */
export function sessionHistory(sessions: readonly Session[]): Session[] {
  return sessions
    .filter((session) => session.answered > 0)
    .sort((a, b) => compareTime(b.startedAt, a.startedAt) || compareId(a.id, b.id));
}

/** 中断したセッションか（未終了のまま残っているもの。設計書 6.4 節の 7）。 */
export function isInterrupted(session: Pick<Session, 'endedAt'>): boolean {
  return session.endedAt === null;
}

/** 出題範囲の表示（例: `全範囲`、`700年〜1600年`、`700年〜`、`〜1600年`、`奈良・江戸`）。 */
export function formatRange(range: Range): string {
  switch (range.kind) {
    case 'all':
      return '全範囲';
    case 'years':
      if (range.from === null && range.to === null) {
        return '全範囲';
      }
      return `${range.from === null ? '' : `${range.from}年`}〜${range.to === null ? '' : `${range.to}年`}`;
    case 'eras':
      return range.eras.join('・');
  }
}

/** 出題パターンの表示名（出題設定・成績の内訳・履歴で共通に使う正本）。 */
export const PATTERN_LABELS: Readonly<Record<PatternMode, string>> = {
  yearInput: '年号入力',
  yearChoice: '年号 4 択',
  choice: '出来事 4 択',
  mixed: 'ミックス',
};

/** セッションの種類の表示名。 */
const SESSION_MODE_LABELS: Readonly<Record<SessionMode, string>> = {
  normal: '通常',
  review: '復習',
};

/**
 * 履歴に出すセッションの内容（モード・範囲・パターン。例: `通常 · 全範囲 · 年号入力`）。
 * 復習は範囲とパターンを選ばないので `復習` だけ。
 */
export function describeSession(session: Pick<Session, 'mode' | 'range' | 'pattern'>): string {
  const parts = [SESSION_MODE_LABELS[session.mode]];
  if (session.range !== null) {
    parts.push(formatRange(session.range));
  }
  if (session.pattern !== null) {
    parts.push(PATTERN_LABELS[session.pattern]);
  }
  return parts.join(' · ');
}

function sumTallies(tallies: readonly Tally[]): Tally {
  let attempts = 0;
  let correct = 0;
  for (const tally of tallies) {
    attempts += tally.attempts;
    correct += tally.correct;
  }
  return { attempts, correct };
}

/** ISO 8601 の時刻を比べる（`a` が後なら正）。 */
function compareTime(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

function compareId(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
