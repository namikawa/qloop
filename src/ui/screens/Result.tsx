import type { KindRules } from '../../core/decks';
import type { Pattern } from '../../core/models';
import { progressSteps } from '../../core/progress';
import { Banner } from '../components/Banner';
import { ChevronRightIcon } from '../components/icons';
import { BottomBar } from '../components/BottomBar';
import { ProgressSteps } from '../components/ProgressSteps';
import { ScreenHeader } from '../components/ScreenHeader';
import type { AnsweredQuestion, QuizResult } from './Quiz';

interface ResultProps {
  result: QuizResult;
  /** 出題した教材の種類の差分（画面の言葉と、間違えた項目の表示）。 */
  rules: Pick<
    KindRules<AnsweredQuestion['item'], Pattern>,
    'labels' | 'itemTitle' | 'itemReading' | 'resultLayout' | 'answerText'
  >;
  onHome: () => void;
  onOpenBrowse: (itemId: string) => void;
}

/** 輪のグラフの半径と線の太さ（112px の正方形の中央に描く）。 */
const RING_RADIUS = 48;
const RING_STROKE = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 正答の割合を緑の弧で示す輪（上から時計回り）。数は中央の文字で示すので、読み上げからは外す。 */
function ScoreRing({ ratio }: { ratio: number }) {
  return (
    <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true" focusable="false">
      <circle
        cx="56"
        cy="56"
        r={RING_RADIUS}
        fill="none"
        stroke="var(--color-bar-track)"
        strokeWidth={RING_STROKE}
      />
      {ratio > 0 && (
        <circle
          cx="56"
          cy="56"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-correct)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${ratio * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 56 56)"
        />
      )}
    </svg>
  );
}

/** まとめの画面（設計書 6.4 節の 6）。正答数 / 回答済み数と、間違えた項目（年表は出来事）の一覧を出す。 */
export function Result({ result, rules, onHome, onOpenBrowse }: ResultProps) {
  const answered = result.answers.length;
  const correct = result.answers.filter((answer) => answer.outcome === 'correct').length;
  const wrong = result.answers.filter((answer) => answer.outcome !== 'correct');
  // 出題中の区切りと同じ判定の列。問題数が多いときは出さない
  const steps = progressSteps(
    result.total,
    result.answers.map((answer) => answer.outcome),
    null,
  );
  const longScore = `${correct}${answered}`.length > 4;

  return (
    <div className="screen screen-with-bar result-screen">
      {result.saveFailed && <Banner>保存に失敗した記録があります</Banner>}

      <ScreenHeader title="結果" />

      <main className="result screen-body">
        <section className="card result-card" aria-label="得点">
          <div className="score-ring">
            <ScoreRing ratio={answered === 0 ? 0 : correct / answered} />
            <p
              className={longScore ? 'result-score long' : 'result-score'}
              data-testid="result-score"
            >
              {correct}
              <span className="result-slash"> / </span>
              {answered}
            </p>
          </div>
          <p className="result-caption">正答数 / 回答済み数</p>
          {steps !== null && <ProgressSteps steps={steps} className="result-steps" />}
          <p className="result-total" data-testid="result-total">
            予定の問題数 {result.total} 問{answered < result.total && '（途中で終了）'}
          </p>
        </section>

        <section aria-labelledby="result-wrong-title">
          <h2 id="result-wrong-title" className="section-label">
            間違えた{rules.labels.item}
          </h2>
          {wrong.length === 0 ? (
            <p className="empty-text">ありません</p>
          ) : (
            <ul className="card card-flat list-card" data-testid="wrong-list">
              {wrong.map((answer) => {
                const reading = rules.itemReading(answer.item);
                // 復習では同じ項目が複数のパターンで出ることがあるので、パターンも key に含める
                return (
                  <li key={`${answer.pattern}:${answer.item.id}`}>
                    <button
                      type="button"
                      onClick={() => onOpenBrowse(answer.item.id)}
                      className={
                        rules.resultLayout === 'stacked'
                          ? 'wrong-item wrong-item-stacked'
                          : 'wrong-item'
                      }
                    >
                      <span className="wrong-content">
                        <span className="wrong-title">{rules.itemTitle(answer.item)}</span>
                        {reading !== null && <span className="wrong-reading">{reading}</span>}
                        <span className="wrong-year">{rules.answerText(answer.item)}</span>
                      </span>
                      <ChevronRightIcon className="wrong-chevron" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <BottomBar>
        <button type="button" className="button-primary" onClick={onHome}>
          ホームへ
        </button>
      </BottomBar>
    </div>
  );
}
