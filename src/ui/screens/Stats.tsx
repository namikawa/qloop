import { useId, useState } from 'react';
import { formatLocalDate, formatLocalDateTime } from '../../core/date';
import type { KindRules } from '../../core/decks';
import type { Item, Pattern } from '../../core/models';
import {
  accuracyOf,
  describeSession,
  formatAccuracy,
  isInterrupted,
  sortItemRows,
  summarizeStats,
  type ItemSortOrder,
} from '../../core/stats';
import type { ProgressStore } from '../../storage/progress-store';
import { Bar } from '../components/Bar';
import { ChevronDownIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
/** 成績の画面の切り替え。 */
type StatsView = 'overall' | 'items' | 'history';

const SORT_OPTIONS: { value: ItemSortOrder; label: string }[] = [
  { value: 'accuracy', label: '正答率の低い順' },
  { value: 'attempts', label: '回答数の多い順' },
  { value: 'recent', label: '最終回答日の新しい順' },
];

interface StatsProps<I extends Item, P extends Pattern> {
  store: ProgressStore;
  /** 選んだ教材の id（履歴をこの教材のセッションに絞る）。 */
  deckId: string;
  /** 見出しの下に出す教材の名前（教材が 1 つのときは無し）。 */
  deckName?: string;
  /** 選んだ教材の母集団（成績は「出題する項目」の設定によらず母集団全体を対象にする）。 */
  population: readonly I[];
  /** その教材の種類の差分（まとめる単位・パターンの表示名・項目の表示・画面の言葉）。 */
  rules: KindRules<I, P>;
  onBack: () => void;
}

/** `formatAccuracy` の表示（`67%` か `未回答`）の % を小さく見せる。 */
function AccuracyFigure({ text }: { text: string }) {
  if (!text.endsWith('%')) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, -1)}
      <span className="overall-unit">%</span>
    </>
  );
}

/**
 * 成績の画面（設計書 8 章）。選んだ教材の、全体・まとめる単位ごと（年表は時代別）・項目別（年表は出来事別）・履歴の
 * 4 区分。「全体」（全体・まとめる単位ごと）、「項目別」、「履歴」を切り替えて出す。
 * 集計は ProgressStore の状態からその場で行う（起動後の回答も反映される）。
 */
export function Stats<I extends Item, P extends Pattern>({
  store,
  deckId,
  deckName,
  population,
  rules,
  onBack,
}: StatsProps<I, P>) {
  const viewOptions: { value: StatsView; label: string }[] = [
    { value: 'overall', label: '全体' },
    { value: 'items', label: `${rules.labels.item}別` },
    { value: 'history', label: '履歴' },
  ];
  const [view, setView] = useState<StatsView>('overall');
  const [sortOrder, setSortOrder] = useState<ItemSortOrder>('accuracy');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const sortId = useId();

  const summary = summarizeStats({
    deckId,
    population,
    stats: store.listEventStats(),
    sessions: store.listSessions(),
    studyDays: store.getStudyDays(),
    now: new Date(),
    rules,
  });
  const rows = sortItemRows(summary.items, sortOrder);

  const toggleRow = (itemId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const { overall, groups, history } = summary;
  const accuracyText = formatAccuracy(overall);

  return (
    <div className="screen stats-screen">
      <ScreenHeader title="成績" deckName={deckName} onBack={onBack} />

      <Segmented
        legend="成績の表示"
        legendHidden
        name="stats-view"
        options={viewOptions}
        value={view}
        onChange={setView}
      />

      <main className="stats">
        {view === 'overall' && (
          <>
            <dl className="card overall">
              <div className="overall-item">
                <dt>総回答数</dt>
                <dd data-testid="overall-attempts">
                  {overall.attempts}
                  <span className="overall-unit"> 回</span>
                </dd>
              </div>
              <div className="overall-item">
                <dt>正答率</dt>
                <dd
                  className={overall.attempts === 0 ? 'overall-empty' : undefined}
                  data-testid="overall-accuracy"
                >
                  <AccuracyFigure text={accuracyText} />
                </dd>
              </div>
              <div className="overall-item">
                <dt>連続学習日数</dt>
                <dd data-testid="overall-streak">
                  {overall.streakDays}
                  <span className="overall-unit"> 日</span>
                </dd>
              </div>
            </dl>

            <section aria-labelledby="stats-eras">
              <h2 id="stats-eras" className="section-label">
                {rules.labels.group}別
              </h2>
              <ul className="card card-flat era-list">
                {groups.map((group) => (
                  <li key={group.group} className="era-row" data-testid="era-row">
                    <span className="era-name">{group.group}</span>
                    <Bar ratio={accuracyOf(group)} />
                    <span className="era-figure">
                      {group.attempts === 0
                        ? '未回答'
                        : `${formatAccuracy(group)}（${group.attempts} 回）`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {view === 'items' && (
          <>
            <div className="sort-row">
              <label htmlFor={sortId} className="sort-label">
                並べ替え
              </label>
              <div className="select-box">
                <select
                  id={sortId}
                  className="select"
                  value={sortOrder}
                  onChange={(changeEvent) =>
                    setSortOrder(changeEvent.target.value as ItemSortOrder)
                  }
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="select-arrow" />
              </div>
            </div>
            <ul className="card card-flat list-card event-list">
              {rows.map((row) => {
                const open = expanded.has(row.item.id);
                const sub = [rules.itemDetail(row.item)];
                if (row.lastAnsweredAt !== null) {
                  sub.push(`${row.attempts} 回`, formatLocalDate(new Date(row.lastAnsweredAt)));
                }
                return (
                  <li key={row.item.id} className="event-item" data-testid="event-row">
                    <button
                      type="button"
                      className="event-row"
                      aria-expanded={open}
                      onClick={() => toggleRow(row.item.id)}
                    >
                      <span className="event-row-main">
                        <span className="event-row-title">{rules.itemTitle(row.item)}</span>
                        <span className="event-row-sub">{sub.join(' · ')}</span>
                      </span>
                      <span className="event-row-accuracy">{formatAccuracy(row)}</span>
                      <ChevronDownIcon className="event-row-chevron" />
                    </button>
                    {open && (
                      <ul className="breakdown" data-testid="breakdown">
                        {row.patterns.length === 0 ? (
                          <li className="breakdown-item">まだ回答していません</li>
                        ) : (
                          row.patterns.map((pattern) => (
                            <li key={pattern.pattern} className="breakdown-item">
                              <span className="breakdown-name">
                                {rules.patternLabel(pattern.pattern)}
                              </span>
                              <span className="breakdown-figure">
                                {formatAccuracy(pattern)}（{pattern.correct} / {pattern.attempts}
                                ）・{formatLocalDate(new Date(pattern.lastAnsweredAt))}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {view === 'history' && (
          <>
            <p className="history-hint">右の数字は 正答数 / 回答済み数</p>
            {history.length === 0 ? (
              <p className="empty-text" data-testid="history-empty">
                ありません
              </p>
            ) : (
              <ul className="card card-flat list-card">
                {history.map((session) => (
                  <li key={session.id} className="history-item" data-testid="history-item">
                    <div className="history-head">
                      <span className="history-date">
                        {formatLocalDateTime(new Date(session.startedAt))}
                      </span>
                      <span className="history-score">
                        {session.correct} / {session.answered}
                      </span>
                    </div>
                    <p className="history-meta">
                      <span>{describeSession(session, rules)}</span>
                      {isInterrupted(session) && <span className="history-badge">中断</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
