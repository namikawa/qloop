import { useState } from 'react';
import { ERAS } from '../../core/era';
import type {
  Era,
  Event,
  PatternMode,
  Question,
  QuestionCount,
  Range,
  Session,
  Settings,
} from '../../core/models';
import { eligibleQuestions, generateSession } from '../../core/quiz';
import { filterByRange, parseRangeYear, validateRange } from '../../core/range';
import type { ProgressStore } from '../../storage/progress-store';

/** 保存した設定が無いときの初期値（問題数の既定は 10。設計書 6.1 節の 4）。 */
export const DEFAULT_SETTINGS: Settings = {
  pattern: 'yearInput',
  count: 10,
  range: { kind: 'all' },
};

const PATTERN_OPTIONS: { value: PatternMode; label: string }[] = [
  { value: 'yearInput', label: '年号入力' },
  { value: 'choice', label: '4 択' },
  { value: 'mixed', label: 'ミックス' },
];

const COUNT_OPTIONS: { value: QuestionCount; label: string }[] = [
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
  /** 出題の母集団。 */
  population: readonly Event[];
  /** 誤答の候補に使う全出来事。 */
  allEvents: readonly Event[];
  onStart: (session: Session, questions: Question[]) => void;
  onBack: () => void;
}

/** 出題設定の画面（設計書 6.1 節・6.4 節の 1）。パターン・問題数・範囲を選んで開始する。 */
export function QuizSetup({ store, population, allEvents, onStart, onBack }: QuizSetupProps) {
  const [initial] = useState(() => store.getSettings() ?? DEFAULT_SETTINGS);
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
  const candidates = range !== null && problem === null ? filterByRange(population, range) : [];
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
      rng: Math.random,
    });
    setStarting(true);
    setStartError(null);
    try {
      await store.saveSettings({ pattern, count, range });
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
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="button-text" onClick={onBack}>
          ‹ 戻る
        </button>
        <h1 className="screen-title">出題設定</h1>
      </header>

      <main className="setup">
        <fieldset className="field">
          <legend className="field-legend">出題パターン</legend>
          <div className="options options-3">
            {PATTERN_OPTIONS.map((option) => (
              <label key={option.value} className="option">
                <input
                  type="radio"
                  name="pattern"
                  checked={pattern === option.value}
                  onChange={() => setPattern(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field-legend">問題数</legend>
          <div className="options options-3">
            {COUNT_OPTIONS.map((option) => (
              <label key={option.value} className="option">
                <input
                  type="radio"
                  name="count"
                  checked={count === option.value}
                  onChange={() => setCount(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field-legend">範囲</legend>
          <div className="options options-fit">
            {RANGE_OPTIONS.map((option) => (
              <label key={option.value} className="option">
                <input
                  type="radio"
                  name="range"
                  checked={rangeKind === option.value}
                  onChange={() => setRangeKind(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          {rangeKind === 'years' && (
            <div className="year-range">
              <label className="year-range-item">
                <span className="year-range-label">開始年</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className="text-input"
                  value={fromText}
                  aria-invalid={from === undefined}
                  onChange={(event) => setFromText(event.target.value)}
                />
              </label>
              <span className="year-range-separator" aria-hidden="true">
                〜
              </span>
              <label className="year-range-item">
                <span className="year-range-label">終了年</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className="text-input"
                  value={toText}
                  aria-invalid={to === undefined}
                  onChange={(event) => setToText(event.target.value)}
                />
              </label>
              <p className="hint">
                空欄の側は制限なし。紀元前の出来事は開始年が空欄のときだけ含みます。
              </p>
            </div>
          )}

          {rangeKind === 'eras' && (
            <div className="options options-3 era-options">
              {ERAS.map(({ name }) => (
                <label key={name} className="option">
                  <input
                    type="checkbox"
                    checked={eras.has(name)}
                    onChange={() => toggleEra(name)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="setup-footer">
          {eligibleCount !== null && (
            <p className="setup-count" data-testid="eligible-count">
              対象 {eligibleCount} 件
            </p>
          )}
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
          <button
            type="button"
            className="button-primary"
            disabled={!canStart}
            onClick={() => void handleStart()}
          >
            開始
          </button>
        </div>
      </main>
    </div>
  );
}
