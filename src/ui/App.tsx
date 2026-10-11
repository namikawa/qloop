import { useEffect, useState } from 'react';
import { localDateKey } from '../core/date';
import type { Deck, Question, Session } from '../core/models';
import { population } from '../core/quiz';
import { reviewCandidates } from '../core/review';
import { streakDays } from '../core/stats';
import deckJson from '../generated/deck.json';
import { shouldShowInstallBanner } from '../pwa/standalone';
import { useAppUpdate } from '../pwa/update';
import { openDb, requestPersistentStorage } from '../storage/db';
import { ProgressStore } from '../storage/progress-store';
import { Home } from './screens/Home';
import { Quiz, type QuizResult } from './screens/Quiz';
import { QuizSetup } from './screens/QuizSetup';
import { Result } from './screens/Result';
import { ReviewSetup } from './screens/ReviewSetup';
import { Stats } from './screens/Stats';

const deck = deckJson as Deck;
/** 出題の母集団。出題設定の「出題する出来事」の絞り込みは出題設定の画面で行い、復習と成績はこの全体を使う。 */
const targets = population(deck);
const coreCount = targets.filter((event) => event.role === 'core').length;

/** 画面の状態。ルーティングライブラリは使わず、アプリ内の状態で切り替える（設計書 3 章）。 */
type View =
  | { screen: 'home' }
  | { screen: 'setup' }
  | { screen: 'review-setup' }
  | { screen: 'stats' }
  | { screen: 'quiz'; session: Session; questions: Question[] }
  | { screen: 'result'; result: QuizResult };

/** 学習の記録（IndexedDB）の準備の状態。 */
type StoreState =
  | { status: 'loading' }
  | { status: 'ready'; store: ProgressStore }
  | { status: 'error'; message: string };

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

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message !== '' ? error.message : error.name;
  }
  return String(error);
}

export function App() {
  // 帯を閉じた状態は起動の間だけ持つ（保存しない）。画面を切り替えても戻らないよう App で持つ。
  const [installBannerVisible, setInstallBannerVisible] = useState(() =>
    shouldShowInstallBanner(navigator),
  );
  const update = useAppUpdate();
  const [storeState, setStoreState] = useState<StoreState>({ status: 'loading' });
  const [view, setView] = useState<View>({ screen: 'home' });

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
    window.scrollTo(0, 0);
  }, [view]);

  const store = storeState.status === 'ready' ? storeState.store : null;

  if (store !== null && view.screen === 'setup') {
    return (
      <QuizSetup
        store={store}
        population={targets}
        allEvents={deck.events}
        onStart={(session, questions) => setView({ screen: 'quiz', session, questions })}
        onBack={() => setView({ screen: 'home' })}
      />
    );
  }
  if (store !== null && view.screen === 'review-setup') {
    return (
      <ReviewSetup
        store={store}
        population={targets}
        allEvents={deck.events}
        onStart={(session, questions) => setView({ screen: 'quiz', session, questions })}
        onBack={() => setView({ screen: 'home' })}
      />
    );
  }
  if (store !== null && view.screen === 'stats') {
    return <Stats store={store} population={targets} onBack={() => setView({ screen: 'home' })} />;
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
  if (view.screen === 'result') {
    return <Result result={view.result} onHome={() => setView({ screen: 'home' })} />;
  }

  // ホームの連続学習日数と復習の件数。復習の件数は復習の画面と同じ数え方
  const now = new Date();
  return (
    <Home
      deckName={deck.name}
      targetCount={targets.length}
      coreCount={coreCount}
      version={__APP_VERSION__}
      storeStatus={storeState}
      streakDays={store === null ? null : streakDays(store.getStudyDays(), localDateKey(now))}
      reviewCount={
        store === null
          ? null
          : reviewCandidates({
              population: targets,
              allEvents: deck.events,
              stats: store.listEventStats(),
              now,
            }).length
      }
      onStartQuiz={() => setView({ screen: 'setup' })}
      onStartReview={() => setView({ screen: 'review-setup' })}
      onOpenStats={() => setView({ screen: 'stats' })}
      installBannerVisible={installBannerVisible}
      onCloseInstallBanner={() => setInstallBannerVisible(false)}
      updateAvailable={update.available}
      onApplyUpdate={update.apply}
      onCheckUpdate={update.check}
    />
  );
}
