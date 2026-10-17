import { useState } from 'react';
import type { GeographyDeckModel } from '../../core/decks';
import type {
  EventScope,
  Question,
  QuestionCount,
  Session,
  GeographyPatternMode,
  GeographyRange,
  GeographySettings,
} from '../../core/models';
import { filterByScope } from '../../core/quiz';
import { eligibleQuestions, filterByRange, generateSession } from '../../core/geography';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { GroupChips } from '../components/GroupChips';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
import { PatternField } from '../components/PatternField';
import { COUNT_OPTIONS } from '../components/quiz-options';

/** 保存した設定が無いときの初期値（設計書 6.12 節）。 */
const DEFAULT_SETTINGS: GeographySettings = {
  scope: 'core',
  pattern: 'geoNameChoice',
  count: 10,
  range: { kind: 'all' },
};
/** 出題パターンの説明（設計書 6.12 節）。 */
const PATTERN_DESCRIPTIONS: Readonly<Record<GeographyPatternMode, string>> = {
  geoNameChoice: '4 つの名前から選ぶ',
  geoNameInput: '名前を打ち込む',
  mixed: '2 つの形式をまぜる',
};
/** 出題範囲の選択肢（設計書 6.12 節の 2）。 */
const RANGE_OPTIONS: { value: GeographyRange['kind']; label: string }[] = [
  { value: 'all', label: '全範囲' },
  { value: 'categories', label: '分類' },
];

interface GeographyQuizSetupProps {
  store: ProgressStore;
  model: GeographyDeckModel;
  deckName?: string;
  onStart: (session: Session, questions: Question[]) => void;
  onBack: () => void;
}

/** 日本地理の出題設定（設計書 6.4 節の 1・6.12 節）。範囲は母集団に地名がある分類から選ぶ。 */
export function GeographyQuizSetup({
  store,
  model,
  deckName,
  onStart,
  onBack,
}: GeographyQuizSetupProps) {
  const { deck, rules, population } = model;
  const [initial] = useState(() => store.getSettings(deck.id, 'geography') ?? DEFAULT_SETTINGS);
  const [scope, setScope] = useState<EventScope>(initial.scope);
  const [pattern, setPattern] = useState<GeographyPatternMode>(initial.pattern);
  const [count, setCount] = useState<QuestionCount>(initial.count);
  const [rangeKind, setRangeKind] = useState<GeographyRange['kind']>(initial.range.kind);
  const [categories, setCategories] = useState<ReadonlySet<string>>(
    () => new Set(initial.range.kind === 'categories' ? initial.range.categories : []),
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const availableCategories = rules.groups.filter((category) =>
    population.some((word) => rules.groupOf(word) === category),
  );
  const range: GeographyRange =
    rangeKind === 'all'
      ? { kind: 'all' }
      : {
          kind: 'categories',
          categories: availableCategories.filter((category) => categories.has(category)),
        };
  const candidates = filterByRange(filterByScope(population, scope), range);
  const emptyCategories = range.kind === 'categories' && range.categories.length === 0;
  const eligibleCount = emptyCategories
    ? null
    : eligibleQuestions(candidates, deck.items, pattern).length;
  const problem = emptyCategories
    ? '分類を 1 つ以上選んでください'
    : eligibleCount === 0
      ? 'この条件で出題できる問題がありません'
      : null;
  const patternOptions = [...rules.patterns, 'mixed' as const].map((value) => ({
    value,
    label: rules.patternLabel(value),
    description: PATTERN_DESCRIPTIONS[value],
  }));
  const toggleCategory = (category: string) =>
    setCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  const handleStart = async () => {
    if (problem !== null || starting) {
      return;
    }
    const questions = generateSession({
      candidates,
      allPlaces: deck.items,
      mode: pattern,
      count,
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
      <main className="setup screen-body geography-setup">
        <Segmented
          legend="出題する地名"
          name="scope"
          options={[
            { value: 'core' as const, label: '基本の地名のみ' },
            { value: 'all' as const, label: 'すべて' },
          ]}
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
          {rangeKind === 'categories' && (
            <fieldset className="field">
              <legend className="visually-hidden">分類</legend>
              <GroupChips
                groups={availableCategories}
                groupHeading={rules.groupHeading}
                groupChipLabel={rules.groupChipLabel}
                columns={rules.chipColumns}
                selected={[...categories]}
                onToggle={toggleCategory}
              />
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
            disabled={problem !== null || starting}
            onClick={() => void handleStart()}
          >
            開始
          </button>
        </div>
      </BottomBar>
    </div>
  );
}
