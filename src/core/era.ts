import type { Era } from './models';

export interface EraDefinition {
  name: Era;
  /** この年以上なら（次の時代の開始年未満の範囲で）この時代。縄文は下限なし。 */
  start: number;
}

/** 時代区分表（設計書 5.3 節）。開始年の昇順。 */
export const ERAS: readonly EraDefinition[] = [
  { name: '縄文', start: Number.NEGATIVE_INFINITY },
  { name: '弥生', start: -400 },
  { name: '古墳', start: 250 },
  { name: '飛鳥', start: 592 },
  { name: '奈良', start: 710 },
  { name: '平安', start: 794 },
  { name: '鎌倉', start: 1185 },
  { name: '室町', start: 1334 },
  { name: '安土桃山', start: 1573 },
  { name: '江戸', start: 1603 },
  { name: '明治', start: 1868 },
  { name: '大正', start: 1912 },
  { name: '昭和', start: 1926 },
  { name: '平成', start: 1989 },
  { name: '令和', start: 2019 },
];

const ERA_NAMES: ReadonlySet<string> = new Set(ERAS.map((era) => era.name));

/** 時代区分表にある名前か。 */
export function isEra(name: string): name is Era {
  return ERA_NAMES.has(name);
}

/** 年から時代区分表で時代を決める。 */
export function eraOfYear(year: number): Era {
  for (let i = ERAS.length - 1; i >= 0; i--) {
    if (year >= ERAS[i].start) {
      return ERAS[i].name;
    }
  }
  return ERAS[0].name;
}

/** 出来事の時代を決める。上書き（CSV の `era` 列）があればそれを使い、無ければ年から決める。 */
export function resolveEra(year: number, override: Era | null): Era {
  return override ?? eraOfYear(year);
}
