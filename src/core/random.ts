/** 乱数の生成器。0 以上 1 未満の数を返す。本番は `Math.random`、テストは `mulberry32` を渡す。 */
export type Rng = () => number;

/** 固定シードの乱数の生成器（mulberry32）。テストで出題を決定的にするために使う。 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0 以上 `n` 未満の整数を等確率で選ぶ。 */
export function randomInt(n: number, rng: Rng): number {
  return Math.floor(rng() * n);
}

/** 並びをシャッフルした新しい配列を返す（Fisher–Yates）。元の配列は変えない。 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * UUID（版 4 の形式）を乱数から作る。`crypto.randomUUID()` が使えない環境
 * （HTTPS でない配信など）の代わりに使う。暗号用途の強さは無い。
 */
export function uuidFromRng(rng: Rng): string {
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) {
    hex.push(randomInt(16, rng).toString(16));
  }
  hex[12] = '4';
  // 版 4 の variant（上位 2 ビットが 10）。8・9・a・b のいずれか
  hex[16] = (8 + randomInt(4, rng)).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
