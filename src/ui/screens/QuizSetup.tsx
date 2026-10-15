import { useId, useState } from 'react';
import type { TimelineDeckModel } from '../../core/decks';
import { ERAS } from '../../core/era';
import type {
  Era,
  EventScope,
  Question,
  QuestionCount,
  TimelineRange,
  Session,
  Settings,
  TimelinePatternMode,
} from '../../core/models';
import { eligibleQuestions, filterByScope, generateSession } from '../../core/quiz';
import { filterByRange, parseRangeYear, validateRange } from '../../core/range';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { CheckIcon } from '../components/icons';
import { PatternField } from '../components/PatternField';
import { COUNT_OPTIONS } from '../components/quiz-options';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';

/**
 * 保存した設定が無いときの初期値（設計書 6.1 節）。出題する出来事は基本の年表のみ、問題数は 10。
 */
const DEFAULT_SETTINGS: Settings = {
  scope: 'core',
  pattern: 'yearInput',
  count: 10,
  range: { kind: 'all' },
};

/** 出題パターンの説明。 */
const PATTERN_DESCRIPTIONS: Readonly<Record<TimelinePatternMode, string>> = {
  yearInput: '年を数字で入れる',
  yearChoice: '4 つの年から選ぶ',
  choice: '4 つの出来事から選ぶ',
  mixed: '3 つの形式をまぜる',
};

const RANGE_OPTIONS: { value: TimelineRange['kind']; label: string }[] = [
  { value: 'all', label: '全範囲' },
  { value: 'years', label: '年号の範囲' },
  { value: 'eras', label: '時代' },
];

interface QuizSetupProps {
  store: ProgressStore;
  /** 選んだ教材（年表）。母集団は「出題する出来事」で絞り込む前のもの、全項目は誤答の候補に使う。 */
  model: TimelineDeckModel;
  /** 見出しの下に出す教材の名前（教材が 1 つのときは無し）。 */
  deckName?: string;
  onStart: (session: Session, questions: Question[]) => void;
  onBack: () => void;
}

/**
 * 年表の出題設定の画面（設計書 6.1 節・6.4 節の 1）。出題する出来事・パターン・問題数・範囲を選んで開始する。
 * 設定は教材ごとに保存する。
 */
export function QuizSetup({ store, model, deckName, onStart, onBack }: QuizSetupProps) {
  const { deck, rules, population } = model;
  const allEvents = deck.items;
  const scopeOptions: { value: EventScope; label: string }[] = [
    { value: 'core', label: `${rules.labels.core}のみ` },
    { value: 'all', label: 'すべて' },
  ];
  // 年号入力・年号 4 択・出来事 4 択・ミックスの順
  const patternOptions = [...rules.patterns, 'mixed' as const].map((value) => ({
    value,
    label: rules.patternLabel(value),
    description: PATTERN_DESCRIPTIONS[value],
  }));
  const [initial] = useState(() => store.getSettings(deck.id) ?? DEFAULT_SETTINGS);
  const [scope, setScope] = useState<EventScope>(initial.scope);
  const [pattern, setPattern] = useState<TimelinePatternMode>(initial.pattern);
  const [count, setCount] = useState<QuestionCount>(initial.count);
  const [rangeKind, setRangeKind] = useState<TimelineRange['kind']>(initial.range.kind);
  // 範囲の種類を切り替えても、年と時代の入力は残しておく
  const [fromText, setFromText] = useState(
    initial.range.kind === 'years' ? (initial.range.from?.toString() ?? '') : '',
  );
  const [toText, setToText] = useState(
    initial.range.kind === 'years' ? (initial.range.to?.toString() ?? '') : '',
  );
  const [eras, setEras] = useState<ReadonlySet<Era>>(
    () => new Set(initial.range.kind === 'eras' ? initial.range.eras : []),
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const from = parseRangeYear(fromText);
  const to = parseRangeYear(toText);
  let range: TimelineRange | null = null;
  let problem: string | null = null;
  if (rangeKind === 'all') {
    range = { kind: 'all' };
  } else if (rangeKind === 'years') {
    if (from === undefined || to === undefined) {
      problem = '年は 1〜4 桁の正の整数で入力してください';
    } else {
      range = { kind: 'years', from, to };
    }
  } else {
    // 時代区分表の順に並べて保存する
    range = { kind: 'eras', eras: ERAS.map((era) => era.name).filter((name) => eras.has(name)) };
  }
  if (range !== null) {
    problem = validateRange(range);
  }
  const candidates =
    range !== null && problem === null
      ? filterByRange(filterByScope(population, scope), range)
      : [];
  const eligibleCount =
    range !== null && problem === null
      ? eligibleQuestions(candidates, allEvents, pattern).length
      : null;
  if (eligibleCount === 0) {
    problem = 'この条件で出題できる問題がありません';
  }
  const canStart = range !== null && problem === null && !starting;

  const toggleEra = (era: Era) => {
    setEras((previous) => {
      const next = new Set(previous);
      if (next.has(era)) {
        next.delete(era);
      } else {
        next.add(era);
      }
      return next;
    });
  };

  const handleStart = async () => {
    if (range === null || problem !== null) {
      return;
    }
    const questions = generateSession({
      candidates,
      allEvents,
      mode: pattern,
      count,
      currentYear: new Date().getFullYear(),
      rng: Math.random,
    });
    setStarting(true);
    setStartError(null);
    try {
      await store.saveSettings(deck.id, { scope, pattern, count, range });
      const session = await store.startSession({
        deckId: deck.id,
        mode: 'normal',
        pattern,
        range,
        total: questions.length,
      });
      onStart(session, questions);
    } catch {
      setStartError('保存に失敗しました。もう一度「開始」を押してください');
      setStarting(false);
    }
  };

  return (
    <div className="screen screen-with-bar">
      <ScreenHeader title="出題設定" deckName={deckName} onBack={onBack} />

      <main className="setup screen-body">
        <Segmented
          legend={`出題する${rules.labels.item}`}
          name="scope"
          options={scopeOptions}
          value={scope}
          onChange={setScope}
        />

        <PatternField options={patternOptions} value={pattern} onChange={setPattern} />

        <Segmented
          legend="問題数"
          name="count"
          options={COUNT_OPTIONS}
          value={count}
          onChange={setCount}
        />

        <div>
          <Segmented
            legend="範囲"
            name="range"
            options={RANGE_OPTIONS}
            value={rangeKind}
            onChange={setRangeKind}
          />

          {rangeKind === 'years' && (
            <>
              <div className="year-range">
                <YearRangeInput
                  label="開始年"
                  value={fromText}
                  invalid={from === undefined}
                  onChange={setFromText}
                />
                <span className="year-range-separator" aria-hidden="true">
                  〜
                </span>
                <YearRangeInput
                  label="終了年"
                  value={toText}
                  invalid={to === undefined}
                  onChange={setToText}
                />
              </div>
              <p className="hint">
                空欄の側は制限なし。紀元前の出来事は開始年が空欄のときだけ含みます。
              </p>
            </>
          )}

          {rangeKind === 'eras' && (
            <fieldset className="field">
              <legend className="visually-hidden">時代</legend>
              <div className="chip-options">
                {ERAS.map(({ name }) => (
                  <label key={name} className="chip">
                    <input
                      type="checkbox"
                      className="overlay-input"
                      checked={eras.has(name)}
                      onChange={() => toggleEra(name)}
                    />
                    <span className="chip-label">
                      <CheckIcon className="chip-check" />
                      {name}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </main>

      <BottomBar>
        {problem !== null && (
          <p className="error-text" role="alert">
            {problem}
          </p>
        )}
        {startError !== null && (
          <p className="error-text" role="alert">
            {startError}
          </p>
        )}
        <div className="start-row">
          {eligibleCount !== null && (
            <p className="target-count" data-testid="eligible-count">
              <span className="target-label">対象</span>{' '}
              <span>
                <span className="target-number">{eligibleCount}</span>
                <span className="target-unit"> 件</span>
              </span>
            </p>
          )}
          <button
            type="button"
            className="button-primary"
            disabled={!canStart}
            onClick={() => void handleStart()}
          >
            開始
          </button>
        </div>
      </BottomBar>
    </div>
  );
}

interface YearRangeInputProps {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}

/** 年号の範囲の入力欄（欄の右端の中に「年」を置く）。 */
function YearRangeInput({ label, value, invalid, onChange }: YearRangeInputProps) {
  const inputId = useId();
  return (
    <div className="year-range-item">
      <label htmlFor={inputId} className="year-range-caption">
        {label}
      </label>
      <div className={invalid ? 'input-box is-invalid' : 'input-box'}>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className="input-box-input"
          value={value}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="input-box-unit" aria-hidden="true">
          年
        </span>
      </div>
    </div>
  );
}
