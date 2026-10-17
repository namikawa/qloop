import { parseCsv } from './csv';
import {
  GEOGRAPHY_PATTERNS,
  type GeoPlace,
  type GeographyDeck,
  type GeographyPattern,
  type GeographyPatternMode,
  type GeographyQuestion,
  type GeographyRange,
  type GeographySettings,
  type QuestionCount,
  type Range,
} from './models';
import { randomInt, shuffle, type Rng } from './random';

export const GEOGRAPHY_GROUPS = [
  { name: '山地・山脈', categories: ['山地・高地', '山脈', '山脈群'] },
  { name: '山', categories: ['山・火山'] },
  { name: '平野・盆地・台地', categories: ['平野', '盆地', '台地', '高原・台地'] },
  { name: '川・湖', categories: ['河川', '湖'] },
  { name: '半島・岬', categories: ['半島', '岬'] },
  { name: '島', categories: ['島・諸島'] },
  { name: '海・湾・海流', categories: ['海', '湾', '海峡', '海岸・砂丘', '海流', '標準時子午線'] },
  { name: '県庁所在地', categories: ['都道府県庁所在地'] },
] as const;
export const GEOGRAPHY_CATEGORIES: readonly string[] = GEOGRAPHY_GROUPS.flatMap((group) => [
  ...group.categories,
]);
export const GEOGRAPHY_REGIONS: readonly string[] = [
  '北海道',
  '東北',
  '関東',
  '中部',
  '近畿',
  '中国',
  '四国',
  '九州',
  '沖縄',
];
export const GEOGRAPHY_CSV_COLUMNS = [
  'id',
  'name',
  'reading',
  'category',
  'regions',
  'question',
  'note',
  'alt_names',
  'similar',
] as const;
export const GEOGRAPHY_IMAGE_WIDTH = 1000;
export const GEOGRAPHY_IMAGE_HEIGHT = 648;
export const geographyImageUrl = (id: string): string => `/geography/${id}.webp`;
export const geographyGroup = (place: Pick<GeoPlace, 'category'>): string =>
  GEOGRAPHY_GROUPS.find((group) => (group.categories as readonly string[]).includes(place.category))
    ?.name ?? '';

export function buildGeographyDeck(input: {
  id: string;
  name: string;
  idPrefix: string;
  core: string;
  pool: string;
}): { ok: true; deck: GeographyDeck } | { ok: false; errors: string[] } {
  const errors: { file: number; line: number; text: string }[] = [];
  const items: GeoPlace[] = [];
  const seen = { id: new Map<string, string>(), name: new Map<string, string>() };
  const references: { file: number; line: number; id: string; similar: string[] }[] = [];
  [input.core, input.pool].forEach((text, file) => {
    const filename = file === 0 ? 'core.csv' : 'pool.csv';
    const fail = (line: number, column: string, message: string) => {
      errors.push({
        file,
        line,
        text: `${filename} ${line} 行目${column ? ` ${column}` : ''}: ${message}`,
      });
    };
    const parsed = parseCsv(text, GEOGRAPHY_CSV_COLUMNS);
    for (const error of parsed.errors) fail(error.line, '', error.message);
    for (const { line, cells } of parsed.rows) {
      const row = Object.fromEntries(
        GEOGRAPHY_CSV_COLUMNS.map((column, index) => [column, cells[index].trim()]),
      ) as Record<(typeof GEOGRAPHY_CSV_COLUMNS)[number], string>;
      const previousErrors = errors.length;
      for (const column of ['id', 'name', 'reading', 'category', 'question'] as const) {
        if (!row[column]) fail(line, column, '必須です');
      }
      if (row.id && (!row.id.startsWith(input.idPrefix) || row.id.length <= input.idPrefix.length))
        fail(line, 'id', `「${row.id}」は ${input.idPrefix} で始めてください`);
      for (const column of ['id', 'name'] as const) {
        if (!row[column]) continue;
        const first = seen[column].get(row[column]);
        if (first) fail(line, column, `「${row[column]}」は ${first}と重複しています`);
        else seen[column].set(row[column], `${filename} ${line} 行目`);
      }
      if (row.category && !GEOGRAPHY_CATEGORIES.includes(row.category))
        fail(line, 'category', `「${row.category}」は分類の一覧にありません`);
      const split = (value: string, separator: string) =>
        value === '' ? [] : value.split(separator).map((part) => part.trim());
      const regions = split(row.regions, '／');
      for (const region of regions)
        if (!GEOGRAPHY_REGIONS.includes(region))
          fail(line, 'regions', `「${region}」は地方の一覧にありません`);
      for (const [column, limit] of [
        ['question', 30],
        ['note', 50],
      ] as const) {
        if ([...row[column]].length > limit)
          fail(line, column, `${limit} 字（コードポイント）以内で書いてください`);
      }
      const altNames = split(row.alt_names, ';');
      for (const value of altNames) {
        if (!value) fail(line, 'alt_names', '空の値は指定できません');
        else if (value === row.name || value === row.reading)
          fail(line, 'alt_names', 'name・reading と重複しています');
      }
      const similar = split(row.similar, ';');
      references.push({ file, line, id: row.id, similar });
      if (errors.length === previousErrors)
        items.push({
          id: row.id,
          name: row.name,
          reading: row.reading,
          category: row.category,
          regions,
          question: row.question,
          note: row.note || null,
          altNames,
          similar,
          level: '中学',
          role: file === 0 ? 'core' : 'pool',
        });
    }
  });
  for (const { file, line, id, similar } of references) {
    for (const target of similar) {
      const message =
        target === id
          ? '自分自身の id は指定できません'
          : !seen.id.has(target)
            ? `「${target}」はどのファイルにも存在しません`
            : null;
      if (message)
        errors.push({
          file,
          line,
          text: `${file === 0 ? 'core.csv' : 'pool.csv'} ${line} 行目 similar: ${message}`,
        });
    }
  }
  if (errors.length)
    return {
      ok: false,
      errors: errors.sort((a, b) => a.file - b.file || a.line - b.line).map((error) => error.text),
    };
  return { ok: true, deck: { id: input.id, kind: 'geography', name: input.name, items } };
}

export function distractorCandidates(place: GeoPlace, allPlaces: readonly GeoPlace[]): GeoPlace[] {
  return allPlaces.filter(
    (candidate) =>
      candidate.id !== place.id &&
      candidate.category === place.category &&
      !place.similar.includes(candidate.id) &&
      !candidate.similar.includes(place.id),
  );
}
const eligibilityCache = new WeakMap<readonly GeoPlace[], Map<string, boolean>>();
export function isEligibleFor(
  place: GeoPlace,
  pattern: GeographyPattern,
  allPlaces: readonly GeoPlace[],
): boolean {
  if (pattern === 'geoNameInput') return true;
  let cache = eligibilityCache.get(allPlaces);
  if (!cache) {
    cache = new Map();
    eligibilityCache.set(allPlaces, cache);
  }
  let eligible = cache.get(place.id);
  if (eligible === undefined) {
    const candidates = distractorCandidates(place, allPlaces);
    eligible =
      candidates.length >= 3 &&
      candidates.some((candidate) => candidate.question === place.question);
    cache.set(place.id, eligible);
  }
  return eligible;
}
export function generateChoices(
  place: GeoPlace,
  allPlaces: readonly GeoPlace[],
  rng: Rng,
): GeoPlace[] {
  const candidates = distractorCandidates(place, allPlaces);
  if (!isEligibleFor(place, 'geoNameChoice', allPlaces))
    throw new Error(`「${place.name}」は名前 4 択に適格ではありません`);
  const preferred = candidates.filter((candidate) =>
    candidate.regions.some((region) => place.regions.includes(region)),
  );
  const picked = shuffle(preferred, rng).slice(0, 3);
  const remaining = candidates.filter((candidate) => !picked.includes(candidate));
  return shuffle([place, ...picked, ...shuffle(remaining, rng).slice(0, 3 - picked.length)], rng);
}
export function buildQuestion(
  place: GeoPlace,
  pattern: GeographyPattern,
  allPlaces: readonly GeoPlace[],
  _currentYear: number,
  rng: Rng,
): GeographyQuestion {
  return pattern === 'geoNameInput'
    ? { item: place, pattern }
    : { item: place, pattern, choices: generateChoices(place, allPlaces, rng) };
}
export function eligibleQuestions(
  candidates: readonly GeoPlace[],
  allPlaces: readonly GeoPlace[],
  mode: GeographyPatternMode,
): { place: GeoPlace; patterns: GeographyPattern[] }[] {
  const seen = new Set<string>();
  return candidates.flatMap((place) => {
    if (seen.has(place.id)) return [];
    seen.add(place.id);
    const patterns = (mode === 'mixed' ? GEOGRAPHY_PATTERNS : [mode]).filter((pattern) =>
      isEligibleFor(place, pattern, allPlaces),
    );
    return patterns.length ? [{ place, patterns }] : [];
  });
}
export function generateSession(input: {
  candidates: readonly GeoPlace[];
  allPlaces: readonly GeoPlace[];
  mode: GeographyPatternMode;
  count: QuestionCount;
  rng: Rng;
}): GeographyQuestion[] {
  const { candidates, allPlaces, mode, count, rng } = input;
  const eligible = shuffle(eligibleQuestions(candidates, allPlaces, mode), rng);
  return eligible
    .slice(0, count === 'all' ? eligible.length : count)
    .map(({ place, patterns }) =>
      buildQuestion(place, patterns[randomInt(patterns.length, rng)], allPlaces, 0, rng),
    );
}
export function normalizeGeographyInput(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, '')
    .replace(/[！-～]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/ヶ/g, 'ケ')
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
}
export function isCorrectName(input: string, place: GeoPlace): boolean {
  const normalized = normalizeGeographyInput(input);
  const answers = [place.name, place.reading, ...place.altNames];
  if (
    place.category === '都道府県庁所在地' &&
    place.name.endsWith('市') &&
    place.reading.endsWith('し')
  )
    answers.push(place.name.slice(0, -1), place.reading.slice(0, -1));
  return (
    normalized !== '' && answers.some((answer) => normalizeGeographyInput(answer) === normalized)
  );
}
export function filterByRange(places: readonly GeoPlace[], range: GeographyRange): GeoPlace[] {
  return range.kind === 'all'
    ? [...places]
    : places.filter((place) => range.categories.includes(geographyGroup(place)));
}
export function normalizeGeographySettings(settings: GeographySettings): GeographySettings {
  if (settings.range.kind === 'all') return settings;
  const selected = settings.range.categories;
  const known = GEOGRAPHY_GROUPS.map((group) => group.name).filter((group) =>
    selected.includes(group),
  );
  return {
    ...settings,
    range: known.length ? { kind: 'categories', categories: known } : { kind: 'all' },
  };
}
export function formatGeographyRange(range: Range | null): string {
  if (range === null) return '';
  return range.kind === 'categories'
    ? GEOGRAPHY_GROUPS.filter((group) => range.categories.includes(group.name))
        .map((group) => group.name)
        .join('、')
    : '全範囲';
}
