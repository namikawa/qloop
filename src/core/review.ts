import { calendarDaysBetween, isWithinDays, localDateKey, type DateKeyFn } from './date';
import {
  PATTERNS,
  type Event,
  type EventStats,
  type Pattern,
  type Question,
  type QuestionCount,
} from './models';
import { buildQuestion, isEligibleFor } from './quiz';
import type { Rng } from './random';

/** 「直近 N 日以内に不正解がある」の日数（設計書 7 章の条件 1。境界を含む）。 */
const REVIEW_RECENT_WRONG_DAYS = 14;

/** 「正答率が 60% 未満」の判定に使う回答数の下限（設計書 7 章の条件 3）。 */
const LOW_ACCURACY_MIN_ATTEMPTS = 2;

/** 復習の候補（出来事, パターン）と、その重み。 */
export interface ReviewCandidate {
  event: Event;
  pattern: Pattern;
  /** 抽選の重み（3・2・1）。 */
  weight: number;
}

/**
 * 集計が復習の条件を満たすか（設計書 7 章）。次のいずれかを満たせば候補にする。
 *
 * 1. `lastWrongAt` が、端末の現在のタイムゾーンで 14 日前の 0 時以降（境界を含む）。
 * 2. 最後の回答が不正解。
 * 3. 回答数が 2 以上で、正答率が 60% 未満。
 */
export function needsReview(
  stats: EventStats,
  now: Date,
  dateKey: DateKeyFn = localDateKey,
): boolean {
  if (
    stats.lastWrongAt !== null &&
    isWithinDays(new Date(stats.lastWrongAt), now, REVIEW_RECENT_WRONG_DAYS, dateKey)
  ) {
    return true;
  }
  if (!stats.lastCorrect) {
    return true;
  }
  // correct / attempts < 0.6 を、小数の誤差が出ないよう整数で比べる
  return stats.attempts >= LOW_ACCURACY_MIN_ATTEMPTS && stats.correct * 5 < stats.attempts * 3;
}

/**
 * 復習の重み（設計書 7 章）。最後に間違えた日からの経過日数（暦日の差）が 3 日以内なら 3、7 日以内なら 2、
 * それ以外（不正解の記録が無い場合も）1。境界を含む。
 */
export function reviewWeight(
  stats: Pick<EventStats, 'lastWrongAt'>,
  now: Date,
  dateKey: DateKeyFn = localDateKey,
): number {
  if (stats.lastWrongAt === null) {
    return 1;
  }
  const elapsed = calendarDaysBetween(new Date(stats.lastWrongAt), now, dateKey);
  if (elapsed <= 3) {
    return 3;
  }
  if (elapsed <= 7) {
    return 2;
  }
  return 1;
}

export interface ReviewCandidatesInput {
  /** 現在の母集団（`population(deck)`）。出題設定の「出題する出来事」では絞り込まない。 */
  population: readonly Event[];
  /** 出来事 4 択の適格判定と誤答の候補に使う全出来事。 */
  allEvents: readonly Event[];
  /** `eventStats` の一覧。 */
  stats: readonly EventStats[];
  now: Date;
  /** 暦。既定は端末ローカルの暦。 */
  dateKey?: DateKeyFn;
}

/**
 * 復習の候補を選ぶ（設計書 7 章）。現在の母集団に存在し、記録されたパターンに今も適格で（`isEligibleFor`）、
 * `needsReview` を満たす（出来事, パターン）の組。現在のデータに無い `eventId` の集計は候補にしない。
 * 並びは母集団の順で、同じ出来事は年号入力・年号 4 択・出来事 4 択の順。
 */
export function reviewCandidates({
  population,
  allEvents,
  stats,
  now,
  dateKey = localDateKey,
}: ReviewCandidatesInput): ReviewCandidate[] {
  const byKey = new Map<string, EventStats>();
  for (const record of stats) {
    byKey.set(`${record.pattern}:${record.eventId}`, record);
  }
  const result: ReviewCandidate[] = [];
  const seen = new Set<string>();
  for (const event of population) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    for (const pattern of PATTERNS) {
      const record = byKey.get(`${pattern}:${event.id}`);
      if (record === undefined || !isEligibleFor(event, pattern, allEvents)) {
        continue;
      }
      if (needsReview(record, now, dateKey)) {
        result.push({ event, pattern, weight: reviewWeight(record, now, dateKey) });
      }
    }
  }
  return result;
}

/**
 * 重み付きで重複なく `count` 件を選ぶ（足りなければ全件）。選んだ順に返す。
 * 1 件ずつ、残りの候補の重みの合計に対する割合の確率で選び、選んだものを候補から外す。
 */
export function weightedSample<T extends { weight: number }>(
  items: readonly T[],
  count: number,
  rng: Rng,
): T[] {
  const rest = [...items];
  const picked: T[] = [];
  while (picked.length < count && rest.length > 0) {
    const total = rest.reduce((sum, item) => sum + item.weight, 0);
    let target = rng() * total;
    let index = rest.length - 1;
    for (let i = 0; i < rest.length; i++) {
      target -= rest[i].weight;
      if (target < 0) {
        index = i;
        break;
      }
    }
    picked.push(rest[index]);
    rest.splice(index, 1);
  }
  return picked;
}

export interface GenerateReviewSessionInput {
  /** セッション開始時に確定した候補と重み（`reviewCandidates` の結果）。 */
  candidates: readonly ReviewCandidate[];
  /** 出来事 4 択の誤答の候補に使う全出来事。 */
  allEvents: readonly Event[];
  count: QuestionCount;
  /** 今年（端末の現在の暦年）。年号 4 択の誤答から、これより後の年を除く。 */
  currentYear: number;
  rng: Rng;
}

/**
 * 復習の問題列を作る（設計書 7 章）。候補から重み付きで重複なく問題数（足りなければ全件）を選び、
 * 選んだ順に出題する。出題パターンは記録されたパターンをそのまま使い、年号 4 択と出来事 4 択の選択肢は
 * ここで作り直して確定する。同じ出来事が複数のパターンで候補なら、パターンごとに 1 問ずつ出ることがある。
 */
export function generateReviewSession({
  candidates,
  allEvents,
  count,
  currentYear,
  rng,
}: GenerateReviewSessionInput): Question[] {
  const size = count === 'all' ? candidates.length : count;
  return weightedSample(candidates, size, rng).map(({ event, pattern }) =>
    buildQuestion(event, pattern, allEvents, currentYear, rng),
  );
}
