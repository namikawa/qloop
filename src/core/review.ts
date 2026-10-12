import { calendarDaysBetween, isWithinDays, localDateKey, type DateKeyFn } from './date';
import type { EventStats, Item, Pattern, Question, QuestionCount } from './models';
import type { Rng } from './random';

/** 「直近 N 日以内に不正解がある」の日数（設計書 7 章の条件 1。境界を含む）。 */
const REVIEW_RECENT_WRONG_DAYS = 14;

/** 「正答率が 60% 未満」の判定に使う回答数の下限（設計書 7 章の条件 3）。 */
const LOW_ACCURACY_MIN_ATTEMPTS = 2;

/** 復習から外す、最後に間違えた後の連続正解数の下限（設計書 7 章。間違えた日のうちは外さない）。 */
const REVIEW_CONSECUTIVE_CORRECT = 2;

/**
 * 復習が使う、教材の種類ごとの差分（設計書 5 章の冒頭）。復習は項目の中身をこれを通してだけ扱う。
 * 種類ごとの実装は `decks.ts` にある。
 */
export interface ReviewRules<I extends Item, P extends Pattern> {
  /** その種類の出題パターン（候補の並びの順）。 */
  readonly patterns: readonly P[];
  /** 項目がそのパターンに出題できるか。`allItems` は誤答の候補に使う全項目。 */
  isEligibleFor(item: I, pattern: P, allItems: readonly I[]): boolean;
  /** 項目とパターンから 1 問を作り、選択肢を確定する（項目はそのパターンに適格であること）。 */
  buildQuestion(
    item: I,
    pattern: P,
    allItems: readonly I[],
    currentYear: number,
    rng: Rng,
  ): Question;
}

/** 復習の候補（項目, パターン）と、その重み。 */
export interface ReviewCandidate<I extends Item = Item, P extends Pattern = Pattern> {
  item: I;
  pattern: P;
  /** 抽選の重み（3・2・1）。 */
  weight: number;
}

/**
 * 集計が復習の条件を満たすか（設計書 7 章）。続けて 2 回以上正解し、最後の回答の暦日が
 * 最後に間違えた暦日より後なら外す。それ以外は次のいずれかを満たせば候補にする。
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
    stats.consecutiveCorrect >= REVIEW_CONSECUTIVE_CORRECT &&
    stats.lastWrongAt !== null &&
    calendarDaysBetween(new Date(stats.lastWrongAt), new Date(stats.lastAnsweredAt), dateKey) > 0
  ) {
    return false;
  }
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

export interface ReviewCandidatesInput<I extends Item, P extends Pattern> {
  /** 選んだ教材の母集団（`population(deck.items)`）。出題設定の「出題する項目」では絞り込まない。 */
  population: readonly I[];
  /** 4 択の適格判定と誤答の候補に使う、その教材の全項目。 */
  allItems: readonly I[];
  /** `eventStats` の一覧（全教材の分。母集団に無い項目の集計は使わない）。 */
  stats: readonly EventStats[];
  now: Date;
  /** 暦。既定は端末ローカルの暦。 */
  dateKey?: DateKeyFn;
  /** その教材の種類の差分。 */
  rules: ReviewRules<I, P>;
}

/**
 * 復習の候補を選ぶ（設計書 7 章）。選んだ教材の母集団に存在し、記録されたパターン（その種類のパターンのいずれか）に
 * 今も適格で、`needsReview` を満たす（項目, パターン）の組。母集団に無い `eventId` の集計（現在のデータに無い項目や
 * 別の教材の項目）は候補にしない。並びは母集団の順で、同じ項目は `rules.patterns` の順（年表は年号入力・年号 4 択・
 * 出来事 4 択）。
 */
export function reviewCandidates<I extends Item, P extends Pattern>({
  population,
  allItems,
  stats,
  now,
  dateKey = localDateKey,
  rules,
}: ReviewCandidatesInput<I, P>): ReviewCandidate<I, P>[] {
  const byKey = new Map<string, EventStats>();
  for (const record of stats) {
    byKey.set(`${record.pattern}:${record.eventId}`, record);
  }
  const result: ReviewCandidate<I, P>[] = [];
  const seen = new Set<string>();
  for (const item of population) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    for (const pattern of rules.patterns) {
      const record = byKey.get(`${pattern}:${item.id}`);
      if (record === undefined || !rules.isEligibleFor(item, pattern, allItems)) {
        continue;
      }
      if (needsReview(record, now, dateKey)) {
        result.push({ item, pattern, weight: reviewWeight(record, now, dateKey) });
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

export interface GenerateReviewSessionInput<I extends Item, P extends Pattern> {
  /** セッション開始時に確定した候補と重み（`reviewCandidates` の結果）。 */
  candidates: readonly ReviewCandidate<I, P>[];
  /** 4 択の誤答の候補に使う、その教材の全項目。 */
  allItems: readonly I[];
  count: QuestionCount;
  /** 今年（端末の現在の暦年）。年号 4 択の誤答から、これより後の年を除く。 */
  currentYear: number;
  rng: Rng;
  /** その教材の種類の差分。 */
  rules: ReviewRules<I, P>;
}

/**
 * 復習の問題列を作る（設計書 7 章）。候補から重み付きで重複なく問題数（足りなければ全件）を選び、
 * 選んだ順に出題する。出題パターンは記録されたパターンをそのまま使い、4 択の選択肢は
 * ここで作り直して確定する。同じ項目が複数のパターンで候補なら、パターンごとに 1 問ずつ出ることがある。
 */
export function generateReviewSession<I extends Item, P extends Pattern>({
  candidates,
  allItems,
  count,
  currentYear,
  rng,
  rules,
}: GenerateReviewSessionInput<I, P>): Question[] {
  const size = count === 'all' ? candidates.length : count;
  return weightedSample(candidates, size, rng).map(({ item, pattern }) =>
    rules.buildQuestion(item, pattern, allItems, currentYear, rng),
  );
}
