import { useState } from 'react';
import type { Event, Question, QuestionCount, Session } from '../../core/models';
import { generateReviewSession, reviewCandidates } from '../../core/review';
import type { ProgressStore } from '../../storage/progress-store';
import { BottomBar } from '../components/BottomBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
import { COUNT_OPTIONS } from './QuizSetup';

interface ReviewSetupProps {
  store: ProgressStore;
  /** 出題の母集団（復習は「出題する出来事」の設定によらず母集団全体を対象にする）。 */
  population: readonly Event[];
  /** 出来事 4 択の適格判定と誤答の候補に使う全出来事。 */
  allEvents: readonly Event[];
  onStart: (session: Session, questions: Question[]) => void;
  onBack: () => void;
}

/**
 * 復習の設定画面（設計書 7 章）。設定は問題数だけ。候補が 0 件なら開始できない。
 * 候補と重みは「開始」を押したときに確定し、問題列を作って出題の画面へ進む。
 */
export function ReviewSetup({ store, population, allEvents, onStart, onBack }: ReviewSetupProps) {
  const [candidateCount, setCandidateCount] = useState(
    () =>
      reviewCandidates({ population, allEvents, stats: store.listEventStats(), now: new Date() })
        .length,
  );
  const [count, setCount] = useState<QuestionCount>(10);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async () => {
    // 候補と重み、年号 4 択と出来事 4 択の選択肢はセッション開始時に確定する
    const now = new Date();
    const candidates = reviewCandidates({
      population,
      allEvents,
      stats: store.listEventStats(),
      now,
    });
    const questions = generateReviewSession({
      candidates,
      allEvents,
      count,
      currentYear: now.getFullYear(),
      rng: Math.random,
    });
    if (questions.length === 0) {
      setCandidateCount(0);
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const session = await store.startSession({
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
      <ScreenHeader title="復習" onBack={onBack} />

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
          <p className="hint">最近間違えた問題や、正答率の低い問題を出します。</p>
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
