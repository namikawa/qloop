import type {
  Deck,
  Event,
  EventScope,
  Pattern,
  PatternMode,
  Question,
  QuestionCount,
} from './models';
import { randomInt, shuffle, type Rng } from './random';

/** 4 択に必要な誤答の数。 */
export const CHOICE_DISTRACTOR_COUNT = 3;

/** `approx` の出来事が絡むとき、誤答の候補から外す年の差（この年数以内は除外）。 */
const APPROX_EXCLUSION_YEARS = 50;

/** 誤答を優先して選ぶ年の差（出題年の前後この年数以内を優先する。境界を含む）。 */
export const CHOICE_NEAR_YEARS = 100;

/**
 * 出題の母集団（設計書 6.1 節の 1）: `level` が `中学` の出来事（`core.csv` と `pool.csv` の両方）。
 * `高校` の行は誤答の候補にだけ使う。復習と成績は出題設定によらずこの母集団全体を対象にする。
 */
export function population(deck: Pick<Deck, 'events'>): Event[] {
  return deck.events.filter((event) => event.level === '中学');
}

/**
 * 出題設定の「出題する出来事」で絞り込む（設計書 6.1 節の 1）。
 * `core` は基本の年表（`core.csv` の行）だけ、`all` は絞り込まない。範囲の指定より先に適用する。
 */
export function filterByScope(events: readonly Event[], scope: EventScope): Event[] {
  return scope === 'core' ? events.filter((event) => event.role === 'core') : [...events];
}

/** 年号入力に出せるか（設計書 6.1 節の 3）: `approx` でなく、`year` が正の出来事。 */
export function isYearInputEligible(event: Event): boolean {
  return !event.approx && event.year > 0;
}

/** 出題できる出来事と、その出来事に使えるパターン。 */
export interface EligibleEvent {
  event: Event;
  /**
   * 使えるパターン（1 件か 2 件）。2 件（ミックスで両方に適格）なら、問題を作るときに 1 問ごとに等確率で選ぶ。
   */
  patterns: Pattern[];
}

/**
 * 出題パターンごとに適格な出来事を選ぶ（設計書 6.1 節の 3）。
 * `candidates` は範囲で絞り込んだ母集団、`allEvents` は誤答の候補に使う core と pool の全出来事。
 * 並びは `candidates` の順を保ち、同じ id の出来事は最初の 1 件だけにする。
 *
 * - 年号入力: `isYearInputEligible` を満たす出来事。
 * - 4 択: 除外規則を適用した後の誤答の候補が 3 件以上ある出来事。
 * - ミックス: 両方に適格なら両方、片方だけならその形式。どちらにも適格でなければ除外する。
 */
export function eligibleQuestions(
  candidates: readonly Event[],
  allEvents: readonly Event[],
  mode: PatternMode,
): EligibleEvent[] {
  const result: EligibleEvent[] = [];
  const seen = new Set<string>();
  for (const event of candidates) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    const patterns: Pattern[] = [];
    if (mode !== 'choice' && isYearInputEligible(event)) {
      patterns.push('yearInput');
    }
    if (mode !== 'yearInput' && isChoiceEligibleCached(event, allEvents)) {
      patterns.push('choice');
    }
    if (patterns.length > 0) {
      result.push({ event, patterns });
    }
  }
  return result;
}

/**
 * 4 択の適格判定の結果を、全出来事の配列ごとに覚えておく。
 * 適格かどうかはデータだけで決まるので（設計書 6.1 節の 3）、出題設定の画面で範囲を変えるたびに計算し直さない。
 */
const choiceEligibilityCache = new WeakMap<readonly Event[], Map<string, boolean>>();

/** `isChoiceEligible` の結果を `allEvents` の配列ごとに覚えておく版（出題設定と復習の候補選定で使う）。 */
export function isChoiceEligibleCached(event: Event, allEvents: readonly Event[]): boolean {
  let cache = choiceEligibilityCache.get(allEvents);
  if (cache === undefined) {
    cache = new Map();
    choiceEligibilityCache.set(allEvents, cache);
  }
  let eligible = cache.get(event.id);
  if (eligible === undefined) {
    eligible = isChoiceEligible(event, allEvents);
    cache.set(event.id, eligible);
  }
  return eligible;
}

export interface GenerateSessionInput {
  /** 範囲で絞り込んだ母集団。 */
  candidates: readonly Event[];
  /** 誤答の候補に使う core と pool の全出来事。 */
  allEvents: readonly Event[];
  mode: PatternMode;
  count: QuestionCount;
  rng: Rng;
}

/**
 * 1 セッションの問題列を作る（設計書 6.1 節の 4・6、6.3 節）。
 * 適格な出来事から問題数（足りなければ全件）をランダムな順に選び、同じ出来事は 1 回だけ出す。
 * 4 択の選択肢もここで確定する。画面では問題列と選択肢を変えない。
 */
export function generateSession({
  candidates,
  allEvents,
  mode,
  count,
  rng,
}: GenerateSessionInput): Question[] {
  const eligible = shuffle(eligibleQuestions(candidates, allEvents, mode), rng);
  const size = count === 'all' ? eligible.length : Math.min(count, eligible.length);
  return eligible.slice(0, size).map(({ event, patterns }): Question => {
    const pattern = patterns[randomInt(patterns.length, rng)];
    if (pattern === 'yearInput') {
      return { event, pattern };
    }
    return { event, pattern, choices: generateChoices(event, allEvents, rng) };
  });
}

/** 4 択の選択肢（正解と誤答 3 件）をシャッフルして返す（設計書 6.3 節）。 */
export function generateChoices(event: Event, allEvents: readonly Event[], rng: Rng): Event[] {
  return shuffle([event, ...pickDistractors(event, allEvents, rng)], rng);
}

/**
 * 4 択の誤答 3 件を選ぶ（設計書 6.3 節）。除外規則を適用した後の候補のうち、
 * 出題年の前後 100 年以内のものからランダムに選び、足りなければ同じ時代の候補、さらに全候補の順で補う
 * （選択済みのものは除く）。候補が 3 件に満たない出来事（4 択に適格でない）では例外を投げる。
 */
export function pickDistractors(event: Event, allEvents: readonly Event[], rng: Rng): Event[] {
  const candidates = distractorCandidates(event, allEvents);
  const tiers = [
    candidates.filter((candidate) => Math.abs(candidate.year - event.year) <= CHOICE_NEAR_YEARS),
    candidates.filter((candidate) => candidate.era === event.era),
    candidates,
  ];
  const picked: Event[] = [];
  for (const tier of tiers) {
    const rest = shuffle(
      tier.filter((candidate) => !picked.includes(candidate)),
      rng,
    );
    picked.push(...rest.slice(0, CHOICE_DISTRACTOR_COUNT - picked.length));
    if (picked.length === CHOICE_DISTRACTOR_COUNT) {
      return picked;
    }
  }
  throw new Error(`「${event.title}」の 4 択の誤答候補が ${picked.length} 件しかありません`);
}

/** 年号入力の判定（設計書 6.2 節）: `year` または `altYears` のいずれかに一致すれば正解。 */
export function isCorrectYear(event: Pick<Event, 'year' | 'altYears'>, input: number): boolean {
  return input === event.year || event.altYears.includes(input);
}

/**
 * 4 択の誤答の候補（設計書 6.3 節の除外規則 1〜3 を適用した後のもの）。
 * `allEvents` は core と pool の全出来事。並びは `allEvents` の順を保つ。
 *
 * 1. 出題した出来事自身を除く。
 * 2. `year` または `altYears` のいずれかが出題年（`event.year`）と一致するものを除く。
 * 3. 出題した出来事か候補のどちらかが `approx` なら、`year` の差が 50 年以内のものを除く。
 */
export function distractorCandidates(event: Event, allEvents: readonly Event[]): Event[] {
  return allEvents.filter((candidate) => {
    if (candidate.id === event.id) {
      return false;
    }
    if (candidate.year === event.year || candidate.altYears.includes(event.year)) {
      return false;
    }
    if (
      (event.approx || candidate.approx) &&
      Math.abs(candidate.year - event.year) <= APPROX_EXCLUSION_YEARS
    ) {
      return false;
    }
    return true;
  });
}

/** 4 択に出せるか（除外規則を適用した後の誤答の候補が 3 件以上あるか）。 */
export function isChoiceEligible(event: Event, allEvents: readonly Event[]): boolean {
  return distractorCandidates(event, allEvents).length >= CHOICE_DISTRACTOR_COUNT;
}
