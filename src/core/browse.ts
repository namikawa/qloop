import type { EventScope, Item } from './models';

/** 一覧で使う教材の種類ごとの差分。表示する文字と並びをここを通して扱う。 */
export interface BrowseRules<I extends Item> {
  readonly groups: readonly string[];
  groupOf(item: I): string;
  readonly browse: {
    readonly name: string;
    readonly layout: 'inline' | 'stacked';
    readonly hideOptions: readonly {
      readonly value: 'front' | 'back';
      readonly label: string;
    }[];
    front(item: I): string;
    reading(item: I): string | null;
    back(item: I): string;
    compare(a: I, b: I): number;
  };
}

export type BrowseHidden = 'none' | 'front' | 'back';

/** チップは表示する項目の切り替えによらず、母集団にある単位を定義順に並べる。 */
export function availableBrowseGroups<I extends Item>(
  population: readonly I[],
  rules: BrowseRules<I>,
): string[] {
  const present = new Set(population.map((item) => rules.groupOf(item)));
  return rules.groups.filter((group) => present.has(group));
}

/** 絞り込んだ後に項目のある見出しと行。入力の配列は変更しない。 */
export function browseGroups<I extends Item>(
  population: readonly I[],
  rules: BrowseRules<I>,
  scope: EventScope,
  selected: readonly string[],
): { name: string; items: I[] }[] {
  const filtered = population.filter(
    (item) =>
      (scope === 'all' || item.role === 'core') &&
      (selected.length === 0 || selected.includes(rules.groupOf(item))),
  );
  return rules.groups.flatMap((name) => {
    const items = filtered
      .filter((item) => rules.groupOf(item) === name)
      .sort((a, b) => rules.browse.compare(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return items.length === 0 ? [] : [{ name, items }];
  });
}

export function browseRangeText(
  groupLabel: string,
  orderedGroups: readonly string[],
  selected: readonly string[],
  formatSelected?: (selected: readonly string[]) => string,
): string {
  return formatSelected
    ? formatSelected(selected)
    : selected.length === 0
      ? `すべての${groupLabel}`
      : orderedGroups.filter((group) => selected.includes(group)).join('・');
}

/** 複数パターンの候補にも札は項目ごとに 1 つだけ付ける。 */
export function browseReviewIds(candidates: readonly { item: Item }[]): Set<string> {
  return new Set(candidates.map(({ item }) => item.id));
}
