import { GeographyQuizSetup } from './screens/GeographyQuizSetup';
import { useEffect, useState } from 'react';
import { localDateKey } from '../core/date';
import { deckModel, pickDeck, type DeckModel } from '../core/decks';
import type { Deck, Pattern, Question, Session } from '../core/models';
import { reviewCandidates } from '../core/review';
import { streakDays } from '../core/stats';
import decksJson from '../generated/decks.json';
import { shouldShowInstallBanner } from '../pwa/standalone';
import { useAppUpdate } from '../pwa/update';
import { openDb, requestPersistentStorage } from '../storage/db';
import { ProgressStore } from '../storage/progress-store';
import { describeError } from './errors';
import { Browse } from './screens/Browse';
import { EnglishQuizSetup } from './screens/EnglishQuizSetup';
import { Home, type StoreStatus } from './screens/Home';
import { Quiz, type QuizResult } from './screens/Quiz';
import { QuizSetup } from './screens/QuizSetup';
import { Records } from './screens/Records';
import { Result } from './screens/Result';
import { ReviewSetup } from './screens/ReviewSetup';
import { VocabularyQuizSetup } from './screens/VocabularyQuizSetup';
import { Stats } from './screens/Stats';

/**
 * 教材の一覧（`decks.json` の並び = 教材の定義の並び）と、その種類の差分・母集団。
 * 出題設定の「出題する項目」の絞り込みは出題設定の画面で行い、復習と成績は母集団の全体を使う。
 */
const DECKS: readonly DeckModel[] = (decksJson as Deck[]).map(deckModel);

/** 教材が 2 つ以上のときだけ、ホームの切り替えと各画面の見出しの下の教材名を出す（設計書 6.9 節）。 */
const SHOW_DECK_NAMES = DECKS.length > 1;

/** 画面の状態。ルーティングライブラリは使わず、アプリ内の状態で切り替える（設計書 3 章）。 */
type View =
  | { screen: 'home' }
  | { screen: 'setup' }
  | { screen: 'review-setup' }
  | { screen: 'stats' }
  | { screen: 'records' }
  | { screen: 'quiz'; session: Session; questions: Question[] }
  | { screen: 'result'; result: QuizResult; scrollY?: number }
  | {
      screen: 'browse';
      returnTo: { screen: 'home' } | { screen: 'result'; result: QuizResult; scrollY: number };
      highlightId: string | null;
    };

/** 学習の記録（IndexedDB）の準備の状態。 */
type StoreState =
  | Exclude<StoreStatus, { status: 'ready' }>
  | (Extract<StoreStatus, { status: 'ready' }> & { store: ProgressStore });

let storePromise: Promise<ProgressStore> | null = null;

/** データベースを開いて成績を読み込む。起動の間に 1 回だけ行う（開発時の StrictMode の再実行でも開き直さない）。 */
function loadStore(): Promise<ProgressStore> {
  storePromise ??= (async () => {
    const db = await openDb();
    const store = new ProgressStore({ db });
    await store.load();
    requestPersistentStorage();
    return store;
  })();
  return storePromise;
}

export function App() {
  // 帯を閉じた状態は起動の間だけ持つ（保存しない）。画面を切り替えても戻らないよう App で持つ。
  const [installBannerVisible, setInstallBannerVisible] = useState(() =>
    shouldShowInstallBanner(navigator),
  );
  const update = useAppUpdate();
  const [storeState, setStoreState] = useState<StoreState>({ status: 'loading' });
  const [view, setView] = useState<View>({ screen: 'home' });
  // この起動の間にホームで選んだ教材の id。選ぶまでは、保存した最後の教材（`lastDeck`）を使う
  const [chosenDeckId, setChosenDeckId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadStore().then(
      (store) => {
        if (active) {
          setStoreState({ status: 'ready', store });
        }
      },
      (error: unknown) => {
        if (active) {
          setStoreState({ status: 'error', message: describeError(error) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // 画面を切り替えたら先頭から表示する
  useEffect(() => {
    if (view.screen === 'browse' && view.highlightId !== null) return;
    window.scrollTo(0, view.screen === 'result' ? (view.scrollY ?? 0) : 0);
  }, [view]);

  const store = storeState.status === 'ready' ? storeState.store : null;
  // 選んだ教材。保存が無いときと、無い教材を指しているときは最初の教材（設計書 6.9 節）
  const current = pickDeck(DECKS, chosenDeckId ?? store?.getLastDeck() ?? null);
  const { deck, rules } = current;
  const deckName = SHOW_DECK_NAMES ? deck.name : undefined;
  const goHome = () => setView({ screen: 'home' });
  const startQuiz = (session: Session, questions: Question[]) =>
    setView({ screen: 'quiz', session, questions });

  if (store !== null && view.screen === 'setup') {
    return current.kind === 'timeline' ? (
      <QuizSetup
        store={store}
        model={current}
        deckName={deckName}
        onStart={startQuiz}
        onBack={goHome}
      />
    ) : current.kind === 'geography' ? (
      <GeographyQuizSetup
        store={store}
        model={current}
        deckName={deckName}
        onStart={startQuiz}
        onBack={goHome}
      />
    ) : current.kind === 'english' ? (
      <EnglishQuizSetup
        store={store}
        model={current}
        deckName={deckName}
        onStart={startQuiz}
        onBack={goHome}
      />
    ) : (
      <VocabularyQuizSetup
        store={store}
        model={current}
        deckName={deckName}
        onStart={startQuiz}
        onBack={goHome}
      />
    );
  }
  if (store !== null && view.screen === 'review-setup') {
    return (
      <ReviewSetup<Question['item'], Pattern>
        store={store}
        deckId={deck.id}
        deckName={deckName}
        population={current.population}
        allItems={deck.items}
        rules={rules}
        onStart={startQuiz}
        onBack={goHome}
      />
    );
  }
  if (store !== null && view.screen === 'stats') {
    return (
      <Stats<Question['item'], Pattern>
        store={store}
        deckId={deck.id}
        deckName={deckName}
        population={current.population}
        rules={rules}
        onBack={goHome}
      />
    );
  }
  if (store !== null && view.screen === 'records') {
    return (
      <Records store={store} deckNames={DECKS.map((model) => model.deck.name)} onBack={goHome} />
    );
  }
  if (store !== null && view.screen === 'quiz') {
    return (
      <Quiz
        key={view.session.id}
        store={store}
        session={view.session}
        questions={view.questions}
        onFinish={(result) => setView({ screen: 'result', result })}
      />
    );
  }
  if (store !== null && view.screen === 'browse') {
    const savedScope =
      current.kind === 'timeline'
        ? store.getSettings(deck.id)?.scope
        : current.kind === 'geography'
          ? store.getSettings(deck.id, 'geography')?.scope
          : current.kind === 'vocabulary'
            ? store.getSettings(deck.id, 'vocabulary')?.scope
            : 'all';
    const item = current.population.find((item) => item.id === view.highlightId);
    return (
      <Browse<Question['item'], Pattern>
        store={store}
        deckName={deckName}
        population={current.population}
        allItems={deck.items}
        rules={rules}
        initialScope={
          rules.labels.core === null || item?.role === 'pool' ? 'all' : (savedScope ?? 'core')
        }
        highlightId={view.highlightId}
        fromResult={view.returnTo.screen === 'result'}
        onBack={() => setView(view.returnTo)}
      />
    );
  }
  if (view.screen === 'result') {
    return (
      <Result
        result={view.result}
        rules={rules}
        onHome={goHome}
        onOpenBrowse={(highlightId) =>
          setView({
            screen: 'browse',
            returnTo: { screen: 'result', result: view.result, scrollY: window.scrollY },
            highlightId,
          })
        }
      />
    );
  }

  const selectDeck = (deckId: string) => {
    setChosenDeckId(deckId);
    // 保存できなくても、この起動の間は選んだ教材で続ける（次回の初期値になるだけなので知らせない）
    store?.saveLastDeck(deckId).catch(() => undefined);
  };

  // ホームの連続学習日数と復習の件数。連続学習日数は全教材で共通、復習の件数は選んだ教材の分を復習の画面と同じ数え方で
  const now = new Date();
  return (
    <Home
      decks={SHOW_DECK_NAMES ? DECKS.map((model) => model.deck) : null}
      deckId={deck.id}
      onSelectDeck={selectDeck}
      deckName={deck.name}
      labels={rules.labels}
      targetCount={current.population.length}
      coreCount={current.population.filter((item) => item.role === 'core').length}
      version={__APP_VERSION__}
      storeStatus={storeState}
      streakDays={store === null ? null : streakDays(store.getStudyDays(), localDateKey(now))}
      reviewCount={
        store === null
          ? null
          : reviewCandidates<Question['item'], Pattern>({
              population: current.population,
              allItems: deck.items,
              stats: store.listEventStats(),
              now,
              rules,
            }).length
      }
      onStartQuiz={() => setView({ screen: 'setup' })}
      onStartReview={() => setView({ screen: 'review-setup' })}
      browseName={rules.browse.name}
      onOpenBrowse={() =>
        setView({ screen: 'browse', returnTo: { screen: 'home' }, highlightId: null })
      }
      onOpenStats={() => setView({ screen: 'stats' })}
      onOpenRecords={() => setView({ screen: 'records' })}
      installBannerVisible={installBannerVisible}
      onCloseInstallBanner={() => setInstallBannerVisible(false)}
      updateAvailable={update.available}
      updateProgress={update.progress}
      onApplyUpdate={update.apply}
      onCheckUpdate={update.check}
    />
  );
}
