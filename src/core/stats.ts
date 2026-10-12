import { addDaysToKey, localDateKey, type DateKeyFn } from './date';
import type { EventStats, Item, Pattern, PatternMode, Range, Session, SessionMode } from './models';

/**
 * 成績の集計（設計書 8 章）。入力は ProgressStore が持つ状態（`eventStats`・`sessions`・`studyDays`）と、
 * 選んだ教材の母集団と種類ごとの差分（`StatsRules`）。
 *
 * 全体・まとめる単位ごと（年表は時代別）・項目別の成績は、母集団の項目の `eventStats` だけから作る（現在のデータに
 * 無い `eventId` や別の教材の項目の集計は除外する）。セッション履歴は選んだ教材のセッション（`deckId`）だけを、
 * `studyDays` は全教材で共通の活動の記録として、そのまま使う（設計書 5.4 節）。
 * 正答率は正解数 ÷ 回答数で、通常と復習を合算する。回答数 0 は「未回答」（正答率は `null`）。
 */

/**
 * 成績の集計が使う、教材の種類ごとの差分（設計書 5 章の冒頭）。成績は項目の中身をこれを通してだけ扱う。
 * 種類ごとの実装は `decks.ts` にある。
 */
export interface StatsRules<I extends Item, P extends Pattern> {
  /** その種類の出題パターン（項目別の内訳の順）。 */
  readonly patterns: readonly P[];
  /** まとめる単位（年表は時代）の並び。 */
  readonly groups: readonly string[];
  /** 項目のまとめる単位。 */
  groupOf(item: I): string;
}

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

/** まとめる単位（年表は時代）ごとの成績。 */
export interface GroupStats extends Tally {
  group: string;
}

/** 項目 × パターンの成績（項目別の内訳）。 */
interface PatternRow<P extends Pattern> extends Tally {
  pattern: P;
  lastAnsweredAt: string;
}

/** 項目ごとの成績。 */
export interface ItemRow<I extends Item = Item, P extends Pattern = Pattern> extends Tally {
  item: I;
  /** 最後に回答した時刻（UTC の ISO 8601 文字列）。未回答は `null`。 */
  lastAnsweredAt: string | null;
  /** パターン別の内訳（回答のあるパターンだけ。その種類のパターンの順）。 */
  patterns: PatternRow<P>[];
}

/** 項目別の並べ替え。 */
export type ItemSortOrder = 'accuracy' | 'attempts' | 'recent';

export interface StatsInput<I extends Item, P extends Pattern> {
  /** 選んだ教材の id。履歴をこの教材のセッションに絞る。 */
  deckId: string;
  /** 選んだ教材の母集団（`population(deck.items)`）。出題設定の「出題する項目」では絞り込まない。 */
  population: readonly I[];
  /** `eventStats` の一覧（全教材の分）。 */
  stats: readonly EventStats[];
  /** セッションの一覧（全教材の分）。 */
  sessions: readonly Session[];
  /** 回答のあった暦日（全教材で共通）。 */
  studyDays: readonly string[];
  now: Date;
  /** 暦。既定は端末ローカルの暦。 */
  dateKey?: DateKeyFn;
  /** その教材の種類の差分。 */
  rules: StatsRules<I, P>;
}

export interface StatsSummary<I extends Item, P extends Pattern> {
  overall: OverallStats;
  /** まとめる単位ごとの成績（`rules.groups` の順）。 */
  groups: GroupStats[];
  /** 母集団の順（並べ替えは `sortItemRows`）。 */
  items: ItemRow<I, P>[];
  /** 履歴に出すセッション（`sessionHistory`）。 */
  history: Session[];
}

/** 成績画面の区分をまとめて集計する。 */
export function summarizeStats<I extends Item, P extends Pattern>({
  deckId,
  population,
  stats,
  sessions,
  studyDays,
  now,
  dateKey = localDateKey,
  rules,
}: StatsInput<I, P>): StatsSummary<I, P> {
  const items = itemRows(population, stats, rules.patterns);
  const total = sumTallies(items);
  return {
    overall: { ...total, streakDays: streakDays(studyDays, dateKey(now)) },
    groups: groupStats(items, rules),
    items,
    history: sessionHistory(sessions, deckId),
  };
}

/**
 * 項目ごとの成績を作る。母集団の項目だけを対象にし、並びは母集団の順（同じ id は最初の 1 件だけ）。
 * 母集団に無い `eventId` の集計は使わない。内訳は `patterns`（その種類のパターン）の順。
 */
export function itemRows<I extends Item, P extends Pattern>(
  population: readonly I[],
  stats: readonly EventStats[],
  patterns: readonly P[],
): ItemRow<I, P>[] {
  const byItem = new Map<string, EventStats[]>();
  for (const record of stats) {
    const list = byItem.get(record.eventId);
    if (list === undefined) {
      byItem.set(record.eventId, [record]);
    } else {
      list.push(record);
    }
  }
  const rows: ItemRow<I, P>[] = [];
  const seen = new Set<string>();
  for (const item of population) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    const records = byItem.get(item.id) ?? [];
    const breakdown: PatternRow<P>[] = [];
    for (const pattern of patterns) {
      const record = records.find((candidate) => candidate.pattern === pattern);
      if (record !== undefined && record.attempts > 0) {
        breakdown.push({
          pattern,
          attempts: record.attempts,
          correct: record.correct,
          lastAnsweredAt: record.lastAnsweredAt,
        });
      }
    }
    let lastAnsweredAt: string | null = null;
    for (const row of breakdown) {
      if (lastAnsweredAt === null || compareTime(row.lastAnsweredAt, lastAnsweredAt) > 0) {
        lastAnsweredAt = row.lastAnsweredAt;
      }
    }
    rows.push({ item, ...sumTallies(breakdown), lastAnsweredAt, patterns: breakdown });
  }
  return rows;
}

/**
 * まとめる単位（年表は時代）ごとの成績。母集団に項目がある単位だけを、`rules.groups` の順に並べる
 * （回答数 0 の単位は未回答）。
 */
export function groupStats<I extends Item>(
  rows: readonly ItemRow<I>[],
  rules: Pick<StatsRules<I, Pattern>, 'groups' | 'groupOf'>,
): GroupStats[] {
  const byGroup = new Map<string, Tally>();
  for (const row of rows) {
    const group = rules.groupOf(row.item);
    const tally = byGroup.get(group) ?? { attempts: 0, correct: 0 };
    byGroup.set(group, {
      attempts: tally.attempts + row.attempts,
      correct: tally.correct + row.correct,
    });
  }
  const result: GroupStats[] = [];
  for (const group of rules.groups) {
    const tally = byGroup.get(group);
    if (tally !== undefined) {
      result.push({ group, ...tally });
    }
  }
  return result;
}

/**
 * 項目別の並べ替え。同順位は id 順。元の配列は変えない。
 *
 * - `accuracy`: 正答率の低い順（既定）。未回答は回答済みの後ろ。
 * - `attempts`: 回答数の多い順。
 * - `recent`: 最終回答日の新しい順。未回答は後ろ。
 */
export function sortItemRows<R extends ItemRow>(rows: readonly R[], order: ItemSortOrder): R[] {
  const compare = (a: R, b: R): number => {
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
  return [...rows].sort((a, b) => compare(a, b) || compareId(a.item.id, b.item.id));
}

/**
 * 連続学習日数（設計書 8 章の 1）。今日に回答があれば今日、なければ昨日を起点に、
 * 連続して回答のあった暦日を数える。どちらにも無ければ 0。`today` は端末の暦での今日（`YYYY-MM-DD`）。
 * `studyDays` は全教材で共通なので、教材によらず同じ値になる。
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
 * 履歴に出すセッション（設計書 8 章の 3）。教材 `deckId` のセッションだけを、開始時刻の新しい順（同時刻は id 順）に
 * 並べる。回答が 0 件のもの（回答せずに終了したもの）は出さない。`endedAt` が `null` のものは中断として出す。
 */
export function sessionHistory(sessions: readonly Session[], deckId: string): Session[] {
  return sessions
    .filter((session) => session.deckId === deckId && session.answered > 0)
    .sort((a, b) => compareTime(b.startedAt, a.startedAt) || compareId(a.id, b.id));
}

/** 中断したセッションか（未終了のまま残っているもの。設計書 6.4 節の 7）。 */
export function isInterrupted(session: Pick<Session, 'endedAt'>): boolean {
  return session.endedAt === null;
}

/** 履歴の表示に使う、教材の種類ごとの差分（パターンの表示名と範囲の表示）。 */
export interface SessionLabels {
  patternLabel(pattern: PatternMode): string;
  formatRange(range: Range): string;
}

/** セッションの種類の表示名。 */
const SESSION_MODE_LABELS: Readonly<Record<SessionMode, string>> = {
  normal: '通常',
  review: '復習',
};

/**
 * 履歴に出すセッションの内容（モード・範囲・パターン。例: `通常 · 全範囲 · 年号入力`）。
 * 復習は範囲とパターンを選ばないので `復習` だけ。範囲とパターンの表示は教材の種類の差分（`labels`）から取る。
 */
export function describeSession(
  session: Pick<Session, 'mode' | 'range' | 'pattern'>,
  labels: SessionLabels,
): string {
  const parts = [SESSION_MODE_LABELS[session.mode]];
  if (session.range !== null) {
    parts.push(labels.formatRange(session.range));
  }
  if (session.pattern !== null) {
    parts.push(labels.patternLabel(session.pattern));
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
