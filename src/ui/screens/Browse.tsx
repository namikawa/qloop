import { useEffect, useRef, useState } from 'react';
import {
  availableBrowseGroups,
  browseRangeText,
  browseGroups,
  browseReviewIds,
  type BrowseHidden,
} from '../../core/browse';
import type { KindRules } from '../../core/decks';
import type { EventScope, Item, Pattern } from '../../core/models';
import { reviewCandidates } from '../../core/review';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { ChevronUpIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
import { GroupChips } from './VocabularyQuizSetup';

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
  const [scope, setScope] = useState(rules.labels.core === null ? 'all' : initialScope);
  const [selected, setSelected] = useState<string[]>([]);
  const [hidden, setHidden] = useState<BrowseHidden>('none');
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [showTopButton, setShowTopButton] = useState(false);
  const countRef = useRef<HTMLParagraphElement>(null);
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
  const rangeText = browseRangeText(
    rules.labels.group,
    rules.groups,
    selected,
    rules.browseRangeText,
  );

  useEffect(() => {
    const countLine = countRef.current;
    if (countLine === null) return;
    let frame: number | null = null;
    const checkPosition = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setShowTopButton(countLine.getBoundingClientRect().bottom < 0);
      });
    };
    checkPosition();
    window.addEventListener('scroll', checkPosition, { passive: true });
    window.addEventListener('resize', checkPosition);
    return () => {
      window.removeEventListener('scroll', checkPosition);
      window.removeEventListener('resize', checkPosition);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [count, rangeText]);

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
          {rules.labels.core !== null && (
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
          )}
          <fieldset className="field">
            <legend className="field-legend">{rules.labels.group}</legend>
            <GroupChips
              groups={groups}
              groupHeading={rules.groupHeading}
              groupChipLabel={rules.groupChipLabel}
              selected={selected}
              onToggle={(group) =>
                setSelected((previous) =>
                  previous.includes(group)
                    ? previous.filter((value) => value !== group)
                    : [...previous, group],
                )
              }
            />
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
        <p ref={countRef} className="browse-count" data-testid="browse-count" role="status">
          {count === 0 ? (
            'ありません'
          ) : (
            <>
              <span>{rangeText}</span> <span className="browse-count-number">{count} 件</span>
            </>
          )}
        </p>
        {sections.map((section) => (
          <section className="browse-section" key={section.name} aria-label={section.name}>
            <div className="browse-heading-bar">
              <h2 className="section-label browse-heading">
                <span className="browse-heading-name">{section.name}</span>{' '}
                <span className="browse-heading-count">{section.items.length} 件</span>
              </h2>
              <button
                type="button"
                className="back-button browse-top-button"
                style={{ visibility: showTopButton ? 'visible' : 'hidden' }}
                onClick={() => window.scrollTo(0, 0)}
              >
                <ChevronUpIcon />
                上へ
              </button>
            </div>
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
