import { parseCsv } from './csv';
import { ERAS, isEra, resolveEra } from './era';
import type { Deck, Era, Event, Level, Role } from './models';
import { CHOICE_DISTRACTOR_COUNT, distractorCandidates } from './quiz';

/** CSV の列（設計書 5.1 節）。順序も固定。 */
export const CSV_COLUMNS = [
  'id',
  'year',
  'title',
  'era',
  'approx',
  'alt_years',
  'year_label',
  'level',
] as const;

type Column = (typeof CSV_COLUMNS)[number];

export interface DeckInput {
  id: string;
  name: string;
  /** core.csv の内容（出題対象）。 */
  core: string;
  /** pool.csv の内容（誤答専用）。 */
  pool: string;
}

export type BuildDeckResult = { ok: true; deck: Deck } | { ok: false; errors: string[] };

const ID_PREFIXES = ['jh-', 'demo-'];
/** 0 以外の整数（先頭の 0 と + は不可）。 */
const NONZERO_INTEGER = /^-?[1-9][0-9]*$/;

/** エラーの位置（ファイルの順番と行番号。並べ替えと表示に使う）。 */
interface Location {
  fileIndex: number;
  line: number;
  /** 例: `core.csv 3 行目` */
  label: string;
}

interface DeckError {
  at: Location;
  /** 列名がある場合は先頭に付ける（例: `year: …`）。 */
  column: Column | null;
  message: string;
}

/**
 * core.csv と pool.csv から問題集を作り、設計書 5.2 節の検証を行う。
 * エラーは「ファイル名 行番号 列名: 内容」の形で、全件をファイル順・行番号順に並べて返す。
 */
export function buildDeck(input: DeckInput): BuildDeckResult {
  const sources: { file: string; role: Role; text: string }[] = [
    { file: 'core.csv', role: 'core', text: input.core },
    { file: 'pool.csv', role: 'pool', text: input.pool },
  ];
  const errors: DeckError[] = [];
  const events: Event[] = [];
  const eventLocations = new Map<Event, Location>();
  const seenIds = new Map<string, Location>();
  const seenTitles = new Map<string, Location>();

  sources.forEach((source, fileIndex) => {
    const locate = (line: number): Location => ({
      fileIndex,
      line,
      label: `${source.file} ${line} 行目`,
    });
    const parsed = parseCsv(source.text, CSV_COLUMNS);
    for (const error of parsed.errors) {
      errors.push({ at: locate(error.line), column: null, message: error.message });
    }
    for (const row of parsed.rows) {
      const at = locate(row.line);
      const cells = row.cells.map((cell) => cell.trim());
      const result = rowToEvent(cells, source.role);
      for (const fieldError of result.errors) {
        errors.push({ at, ...fieldError });
      }
      checkUnique(seenIds, cells[CSV_COLUMNS.indexOf('id')], at, 'id', errors);
      checkUnique(seenTitles, cells[CSV_COLUMNS.indexOf('title')], at, 'title', errors);
      if (result.event) {
        events.push(result.event);
        eventLocations.set(result.event, at);
      }
    }
  });

  for (const [event, at] of eventLocations) {
    if (event.role !== 'core') {
      continue;
    }
    const count = distractorCandidates(event, events).length;
    if (count < CHOICE_DISTRACTOR_COUNT) {
      errors.push({
        at,
        column: 'year',
        message:
          `4 択の誤答候補が ${count} 件しかありません` +
          `（除外規則の適用後に ${CHOICE_DISTRACTOR_COUNT} 件以上必要です）`,
      });
    }
  }

  if (errors.length > 0) {
    // sort は安定なので、同じ行のエラーは見つけた順のまま
    errors.sort((a, b) => a.at.fileIndex - b.at.fileIndex || a.at.line - b.at.line);
    return {
      ok: false,
      errors: errors.map(({ at, column, message }) =>
        column === null ? `${at.label}: ${message}` : `${at.label} ${column}: ${message}`,
      ),
    };
  }
  return { ok: true, deck: { id: input.id, name: input.name, events } };
}

function checkUnique(
  seen: Map<string, Location>,
  value: string,
  at: Location,
  column: Column,
  errors: DeckError[],
): void {
  if (value === '') {
    return;
  }
  const first = seen.get(value);
  if (first !== undefined) {
    errors.push({ at, column, message: `「${value}」は ${first.label}と重複しています` });
    return;
  }
  seen.set(value, at);
}

interface FieldError {
  column: Column;
  message: string;
}

/** CSV の 1 行（前後の空白を除いたセル）を Event に変換する。不正な列があれば event は null。 */
function rowToEvent(
  cells: readonly string[],
  role: Role,
): { event: Event | null; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const cell = (column: Column): string => cells[CSV_COLUMNS.indexOf(column)];
  const fail = (column: Column, message: string): void => {
    errors.push({ column, message });
  };

  const id = cell('id');
  if (id === '') {
    fail('id', '必須です');
  } else if (!ID_PREFIXES.some((prefix) => id.startsWith(prefix) && id.length > prefix.length)) {
    fail('id', `「${id}」は ${ID_PREFIXES.join(' または ')} で始めてください`);
  }

  const yearText = cell('year');
  let year = 0;
  if (yearText === '') {
    fail('year', '必須です');
  } else if (!isNonZeroInteger(yearText)) {
    fail('year', `「${yearText}」は 0 以外の整数で書いてください（紀元前は負数）`);
  } else {
    year = Number(yearText);
  }

  const title = cell('title');
  if (title === '') {
    fail('title', '必須です');
  }

  const eraText = cell('era');
  let eraOverride: Era | null = null;
  if (eraText !== '') {
    if (isEra(eraText)) {
      eraOverride = eraText;
    } else {
      fail(
        'era',
        `「${eraText}」は時代区分表にありません（${ERAS.map((era) => era.name).join('・')}）`,
      );
    }
  }

  const approxText = cell('approx');
  if (approxText !== '' && approxText !== '1') {
    fail('approx', `「${approxText}」は 1 か空にしてください`);
  }

  const altYearsText = cell('alt_years');
  const altYears: number[] = [];
  if (altYearsText !== '') {
    for (const part of altYearsText.split(';').map((s) => s.trim())) {
      if (!isNonZeroInteger(part)) {
        fail('alt_years', `「${part}」は 0 以外の整数で書いてください（複数は ; 区切り）`);
      } else if (year !== 0 && Number(part) === year) {
        fail('alt_years', `「${part}」は year と同じです`);
      } else {
        altYears.push(Number(part));
      }
    }
  }

  const yearLabel = cell('year_label');

  const levelText = cell('level');
  let level: Level = '中学';
  if (levelText === '高校') {
    level = '高校';
  } else if (levelText !== '' && levelText !== '中学') {
    fail('level', `「${levelText}」は 中学・高校・空のいずれかにしてください`);
  }

  if (errors.length > 0) {
    return { event: null, errors };
  }
  return {
    event: {
      id,
      year,
      title,
      era: resolveEra(year, eraOverride),
      approx: approxText === '1',
      altYears,
      yearLabel: yearLabel === '' ? null : yearLabel,
      level,
      role,
    },
    errors,
  };
}

function isNonZeroInteger(text: string): boolean {
  return NONZERO_INTEGER.test(text) && Number.isSafeInteger(Number(text));
}
