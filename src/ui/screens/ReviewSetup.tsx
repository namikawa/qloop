import { useState } from 'react';
import type { Item, Pattern, Question, QuestionCount, Session } from '../../core/models';
import { generateReviewSession, reviewCandidates, type ReviewRules } from '../../core/review';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
import { COUNT_OPTIONS } from '../components/quiz-options';

interface ReviewSetupProps<I extends Item, P extends Pattern> {
  store: ProgressStore;
  /** 選んだ教材の id。 */
  deckId: string;
  /** 見出しの下に出す教材の名前（教材が 1 つのときは無し）。 */
  deckName?: string;
  /** 選んだ教材の母集団（復習は「出題する項目」の設定によらず母集団全体を対象にする）。 */
  population: readonly I[];
  /** 4 択の適格判定と誤答の候補に使う、その教材の全項目。 */
  allItems: readonly I[];
  /** その教材の種類の差分。 */
  rules: ReviewRules<I, P>;
  onStart: (session: Session, questions: Question[]) => void;
  onBack: () => void;
}

/**
 * 復習の設定画面（設計書 7 章）。選んだ教材の復習を行う。設定は問題数だけ。候補が 0 件なら開始できない。
 * 候補と重みは「開始」を押したときに確定し、問題列を作って出題の画面へ進む。
 */
export function ReviewSetup<I extends Item, P extends Pattern>({
  store,
  deckId,
  deckName,
  population,
  allItems,
  rules,
  onStart,
  onBack,
}: ReviewSetupProps<I, P>) {
  const [candidateCount, setCandidateCount] = useState(
    () =>
      reviewCandidates({
        population,
        allItems,
        stats: store.listEventStats(),
        now: new Date(),
        rules,
      }).length,
  );
  const [count, setCount] = useState<QuestionCount>(10);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async () => {
    // 候補と重み、4 択の選択肢はセッション開始時に確定する
    const now = new Date();
    const candidates = reviewCandidates({
      population,
      allItems,
      stats: store.listEventStats(),
      now,
      rules,
    });
    const questions = generateReviewSession({
      candidates,
      allItems,
      count,
      currentYear: now.getFullYear(),
      rng: Math.random,
      rules,
    });
    if (questions.length === 0) {
      setCandidateCount(0);
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const session = await store.startSession({
        deckId,
        mode: 'review',
        pattern: null,
        range: null,
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
      <ScreenHeader title="復習" deckName={deckName} onBack={onBack} />

      <main className="setup screen-body">
        <section className="card review-card" aria-labelledby="review-card-label">
          <h2 id="review-card-label" className="review-card-label">
            復習する問題
          </h2>
          {candidateCount === 0 ? (
            <p className="review-count-empty" data-testid="review-count">
              復習する問題はありません
            </p>
          ) : (
            <p className="review-count" data-testid="review-count">
              <span className="review-count-number">{candidateCount}</span>
              <span className="review-count-unit"> 件</span>
            </p>
          )}
          <p className="hint">
            最近間違えた問題や、正答率の低い問題を出します。続けて 2
            回正解すると外れます。ただし、間違えた日のうちは外れません。
          </p>
        </section>

        <Segmented
          legend="問題数"
          name="count"
          options={COUNT_OPTIONS}
          value={count}
          onChange={setCount}
        />
      </main>

      <BottomBar>
        {startError !== null && (
          <p className="error-text" role="alert">
            {startError}
          </p>
        )}
        <button
          type="button"
          className="button-primary"
          disabled={candidateCount === 0 || starting}
          onClick={() => void handleStart()}
        >
          開始
        </button>
      </BottomBar>
    </div>
  );
}
