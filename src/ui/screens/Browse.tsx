import { useEffect, useRef, useState } from 'react';
import {
  availableBrowseGroups,
  browseCountText,
  browseGroups,
  browseReviewIds,
  type BrowseHidden,
} from '../../core/browse';
import type { KindRules } from '../../core/decks';
import type { EventScope, Item, Pattern } from '../../core/models';
import { reviewCandidates } from '../../core/review';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { CheckIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';

interface BrowseProps<I extends Item, P extends Pattern> {
  store: ProgressStore;
  deckName?: string;
  population: readonly I[];
  allItems: readonly I[];
  rules: KindRules<I, P>;
  initialScope: EventScope;
  highlightId: string | null;
  fromResult: boolean;
  onBack: () => void;
}

/** 教材の母集団を眺める一覧。絞り込みと暗記カードの状態は、この画面の間だけ持つ。 */
export function Browse<I extends Item, P extends Pattern>({
  store,
  deckName,
  population,
  allItems,
  rules,
  initialScope,
  highlightId,
  fromResult,
  onBack,
}: BrowseProps<I, P>) {
  const [scope, setScope] = useState(initialScope);
  const [selected, setSelected] = useState<string[]>([]);
  const [hidden, setHidden] = useState<BrowseHidden>('none');
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const highlightRef = useRef<HTMLButtonElement>(null);
  const [reviewIds] = useState(() =>
    browseReviewIds(
      reviewCandidates({
        population,
        allItems,
        rules,
        stats: store.listEventStats(),
        now: new Date(),
      }),
    ),
  );
  const groups = availableBrowseGroups(population, rules);
  const sections = browseGroups(population, rules, scope, selected);
  const count = sections.reduce((sum, section) => sum + section.items.length, 0);
  const { browse } = rules;

  useEffect(() => {
    if (highlightId === null) return;
    // 親の画面切り替えの effect が終わってから、行を中央へ送る。
    const frame = requestAnimationFrame(() =>
      highlightRef.current?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [highlightId]);

  function toggleRow(id: string) {
    if (hidden === 'none') return;
    setRevealed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={fromResult ? 'screen screen-with-bar browse-screen' : 'screen browse-screen'}>
      <ScreenHeader title={browse.name} deckName={deckName} onBack={onBack} />
      <main className="screen-body browse-body">
        <div className="browse-filters">
          <Segmented
            legend={`表示する${rules.labels.item}`}
            name="browse-scope"
            options={[
              { value: 'core', label: `${rules.labels.core}のみ` },
              { value: 'all', label: 'すべて' },
            ]}
            value={scope}
            onChange={setScope}
          />
          <fieldset className="field">
            <legend className="field-legend">{rules.labels.group}</legend>
            <div className="chip-options">
              {groups.map((group) => (
                <label className="chip" key={group}>
                  <input
                    type="checkbox"
                    className="overlay-input"
                    checked={selected.includes(group)}
                    onChange={() =>
                      setSelected((previous) =>
                        previous.includes(group)
                          ? previous.filter((value) => value !== group)
                          : [...previous, group],
                      )
                    }
                  />
                  <span className="chip-label">
                    <CheckIcon className="chip-check" />
                    {group}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Segmented<BrowseHidden>
            legend="隠す"
            name="browse-hidden"
            options={[{ value: 'none', label: '隠さない' }, ...browse.hideOptions]}
            value={hidden}
            onChange={(value) => {
              setHidden(value);
              setRevealed(new Set());
            }}
          />
        </div>
        <p className="browse-count" data-testid="browse-count" role="status">
          {browseCountText(rules.labels.group, rules.groups, selected, count)}
        </p>
        {sections.map((section) => (
          <section className="browse-section" key={section.name} aria-label={section.name}>
            <h2 className="section-label browse-heading">
              {section.name} <span>{section.items.length} 件</span>
            </h2>
            <ul className="card card-flat list-card">
              {section.items.map((item) => {
                const concealed = !revealed.has(item.id);
                const hideFront = hidden === 'front' && concealed;
                const hideBack = hidden === 'back' && concealed;
                const reading = hideFront ? null : browse.reading(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      ref={item.id === highlightId ? highlightRef : undefined}
                      className={`browse-row browse-row-${browse.layout}${item.id === highlightId ? ' browse-highlight' : ''}${hidden !== 'none' ? ' browse-interactive' : ''}`}
                      data-testid="browse-row"
                      data-item-id={item.id}
                      aria-pressed={hidden === 'none' ? undefined : revealed.has(item.id)}
                      onClick={() => toggleRow(item.id)}
                    >
                      <span className="browse-front">
                        {hideFront ? <span className="browse-hidden">？</span> : browse.front(item)}
                        {reading !== null && <span className="browse-reading">{reading}</span>}
                      </span>
                      <span className="browse-back">
                        {hideBack ? <span className="browse-hidden">？</span> : browse.back(item)}
                        {reviewIds.has(item.id) && (
                          <span className="history-badge browse-review">復習</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
      {fromResult && (
        <BottomBar>
          <button type="button" className="button-primary" onClick={onBack}>
            結果に戻る
          </button>
        </BottomBar>
      )}
    </div>
  );
}
