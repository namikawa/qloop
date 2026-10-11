import { formatAnswerYears } from '../../core/year';
import { Banner } from '../components/Banner';
import type { QuizResult } from './Quiz';

interface ResultProps {
  result: QuizResult;
  onHome: () => void;
}

/** まとめの画面（設計書 6.4 節の 6）。正答数 / 回答済み数と、間違えた出来事の一覧を出す。 */
export function Result({ result, onHome }: ResultProps) {
  const answered = result.answers.length;
  const correct = result.answers.filter((answer) => answer.correct).length;
  const wrong = result.answers.filter((answer) => !answer.correct);

  return (
    <div className="screen">
      {result.saveFailed && <Banner>保存に失敗した記録があります</Banner>}

      <header className="screen-header">
        <h1 className="screen-title">結果</h1>
      </header>

      <main className="result">
        <section className="result-summary">
          <p className="result-score" data-testid="result-score">
            {correct} / {answered}
          </p>
          <p className="result-caption">正答数 / 回答済み数</p>
          <p className="result-total" data-testid="result-total">
            予定の問題数 {result.total} 問{answered < result.total && '（途中で終了）'}
          </p>
        </section>

        <section className="result-wrong" aria-labelledby="result-wrong-title">
          <h2 id="result-wrong-title" className="section-title">
            間違えた出来事
          </h2>
          {wrong.length === 0 ? (
            <p className="status-text">ありません</p>
          ) : (
            <ul className="wrong-list" data-testid="wrong-list">
              {wrong.map((answer) => (
                // 復習では同じ出来事が 2 つのパターンで出ることがあるので、パターンも key に含める
                <li key={`${answer.pattern}:${answer.event.id}`} className="wrong-item">
                  <span className="wrong-title">{answer.event.title}</span>
                  <span className="wrong-year">{formatAnswerYears(answer.event)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button type="button" className="button-primary" onClick={onHome}>
          ホームへ
        </button>
      </main>
    </div>
  );
}
