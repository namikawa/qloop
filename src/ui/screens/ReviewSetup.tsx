import { useState } from 'react';
import type { Event, Question, QuestionCount, Session } from '../../core/models';
import { generateReviewSession, reviewCandidates } from '../../core/review';
import type { ProgressStore } from '../../storage/progress-store';
import { COUNT_OPTIONS } from './QuizSetup';

interface ReviewSetupProps {
  store: ProgressStore;
  /** 出題の母集団（復習は「出題する出来事」の設定によらず母集団全体を対象にする）。 */
  population: readonly Event[];
  /** 4 択の適格判定と誤答の候補に使う全出来事。 */
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
    // 候補と重みはセッション開始時に確定する
    const candidates = reviewCandidates({
      population,
      allEvents,
      stats: store.listEventStats(),
      now: new Date(),
    });
    const questions = generateReviewSession({ candidates, allEvents, count, rng: Math.random });
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
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="button-text" onClick={onBack}>
          ‹ 戻る
        </button>
        <h1 className="screen-title">復習</h1>
      </header>

      <main className="setup">
        <section className="review-summary">
          <p className="review-count" data-testid="review-count">
            {candidateCount === 0
              ? '復習する問題はありません'
              : `復習する問題は ${candidateCount} 件`}
          </p>
          <p className="hint">最近間違えた問題や、正答率の低い問題を出します。</p>
        </section>

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

        <div className="setup-footer">
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
        </div>
      </main>
    </div>
  );
}
