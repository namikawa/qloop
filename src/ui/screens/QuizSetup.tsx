import { useId, useState } from 'react';
import { ERAS } from '../../core/era';
import type {
  Era,
  Event,
  EventScope,
  PatternMode,
  Question,
  QuestionCount,
  Range,
  Session,
  Settings,
} from '../../core/models';
import { eligibleQuestions, filterByScope, generateSession } from '../../core/quiz';
import { filterByRange, parseRangeYear, validateRange } from '../../core/range';
import { PATTERN_LABELS } from '../../core/stats';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { CheckCircleIcon, CheckIcon } from '../components/icons';
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

const SCOPE_OPTIONS: { value: EventScope; label: string }[] = [
  { value: 'core', label: '基本の年表のみ' },
  { value: 'all', label: 'すべて' },
];

/** 出題パターンの説明。 */
const PATTERN_DESCRIPTIONS: Readonly<Record<PatternMode, string>> = {
  yearInput: '年を数字で入れる',
  yearChoice: '4 つの年から選ぶ',
  choice: '4 つの出来事から選ぶ',
  mixed: '3 つの形式をまぜる',
};

/** 出題パターンの選択肢（年号入力・年号 4 択・出来事 4 択・ミックスの順。表示名は `PATTERN_LABELS`）。 */
const PATTERN_OPTIONS: { value: PatternMode; label: string; description: string }[] = (
  ['yearInput', 'yearChoice', 'choice', 'mixed'] as const
).map((value) => ({
  value,
  label: PATTERN_LABELS[value],
  description: PATTERN_DESCRIPTIONS[value],
}));

/** 問題数の選択肢（出題設定と復習で共通）。 */
export const COUNT_OPTIONS: { value: QuestionCount; label: string }[] = [
  { value: 10, label: '10 問' },
  { value: 20, label: '20 問' },
  { value: 'all', label: '全問' },
];

const RANGE_OPTIONS: { value: Range['kind']; label: string }[] = [
  { value: 'all', label: '全範囲' },
  { value: 'years', label: '年号の範囲' },
  { value: 'eras', label: '時代' },
];

interface QuizSetupProps {
  store: ProgressStore;
  /** 出題の母集団（「出題する出来事」で絞り込む前のもの）。 */
  population: readonly Event[];
  /** 誤答の候補に使う全出来事。 */
  allEvents: readonly Event[];
  onStart: (session: Session, questions: Question[]) => void;
  onBack: () => void;
}

/** 出題設定の画面（設計書 6.1 節・6.4 節の 1）。出題する出来事・パターン・問題数・範囲を選んで開始する。 */
export function QuizSetup({ store, population, allEvents, onStart, onBack }: QuizSetupProps) {
  const [initial] = useState(() => store.getSettings() ?? DEFAULT_SETTINGS);
  const [scope, setScope] = useState<EventScope>(initial.scope);
  const [pattern, setPattern] = useState<PatternMode>(initial.pattern);
  const [count, setCount] = useState<QuestionCount>(initial.count);
  const [rangeKind, setRangeKind] = useState<Range['kind']>(initial.range.kind);
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
  let range: Range | null = null;
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
      await store.saveSettings({ scope, pattern, count, range });
      const session = await store.startSession({
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
      <ScreenHeader title="出題設定" onBack={onBack} />

      <main className="setup screen-body">
        <Segmented
          legend="出題する出来事"
          name="scope"
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={setScope}
        />

        <PatternField value={pattern} onChange={setPattern} />

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

interface PatternFieldProps {
  value: PatternMode;
  onChange: (value: PatternMode) => void;
}

/**
 * 出題パターンの選択（2 列のカード）。ラジオボタンの名前はパターン名だけにし、説明は aria-describedby で添える。
 */
function PatternField({ value, onChange }: PatternFieldProps) {
  const idPrefix = useId();
  return (
    <fieldset className="field">
      <legend className="field-legend">出題パターン</legend>
      <div className="pattern-options">
        {PATTERN_OPTIONS.map((option) => {
          const inputId = `${idPrefix}-${option.value}`;
          const descriptionId = `${inputId}-description`;
          return (
            <div key={option.value} className="pattern-option">
              <input
                id={inputId}
                type="radio"
                className="overlay-input"
                name="pattern"
                checked={value === option.value}
                aria-describedby={descriptionId}
                onChange={() => onChange(option.value)}
              />
              <div className="pattern-card">
                <label htmlFor={inputId} className="pattern-name">
                  {option.label}
                </label>
                <span id={descriptionId} className="pattern-desc">
                  {option.description}
                </span>
                <CheckCircleIcon className="pattern-check" />
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
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
