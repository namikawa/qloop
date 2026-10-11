import { useRef, useState } from 'react';
import type { Event, Pattern, Question, Session } from '../../core/models';
import { isCorrectYear } from '../../core/quiz';
import {
  formatAnswerYears,
  formatEventYear,
  formatYear,
  normalizeYearInput,
} from '../../core/year';
import type { ProgressStore } from '../../storage/progress-store';
import { Banner } from '../components/Banner';
import { ConfirmDialog } from '../components/ConfirmDialog';

/** 回答した 1 問（まとめ画面に渡す）。 */
export interface AnsweredQuestion {
  event: Event;
  pattern: Pattern;
  correct: boolean;
}

/** 1 セッションの結果（まとめ画面に渡す）。 */
export interface QuizResult {
  /** 予定の問題数（生成した問題数）。 */
  total: number;
  answers: AnsweredQuestion[];
  /** 保存に失敗した回答や終了の記録があったか。 */
  saveFailed: boolean;
}

/**
 * 判定の結果。`chosen` は選んだ選択肢（出来事 4 択は出来事の id、年号 4 択は年。年号入力は `null`）。
 * `gaveUp` は「わからない」を押したとき（記録は不正解で、`chosen` は `null`）。
 */
interface Judgement {
  correct: boolean;
  chosen: string | number | null;
  gaveUp: boolean;
}

/** 判定欄の見出し（正解・不正解・わからない）と、その色のクラス。 */
function judgementMark({ correct, gaveUp }: Judgement): { text: string; className: string } {
  if (gaveUp) {
    return { text: 'わからない', className: 'gave-up' };
  }
  return correct ? { text: '正解', className: 'correct' } : { text: '不正解', className: 'wrong' };
}

interface QuizProps {
  store: ProgressStore;
  session: Session;
  /** セッション開始時に確定した問題列。画面では変えない。 */
  questions: readonly Question[];
  onFinish: (result: QuizResult) => void;
}

/**
 * 出題の画面（設計書 6.2〜6.4 節・6.7 節）。1 問ごとに 判定 → 保存 → 表示 の順で進める。
 * 保存に失敗しても帯で知らせて続けられるようにする。
 */
export function Quiz({ store, session, questions, onFinish }: QuizProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
  const [judgement, setJudgement] = useState<Judgement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrorVisible, setSaveErrorVisible] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  // 連打で同じ問題を 2 回保存しないよう、保存中かどうかを同期的に持つ
  const busyRef = useRef(false);

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const finished = isLast && judgement !== null;

  const answer = async (correct: boolean, chosen: string | number | null, gaveUp = false) => {
    if (judgement !== null || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setSaving(true);
    let failed = false;
    try {
      await store.recordAnswer({
        sessionId: session.id,
        eventId: question.event.id,
        pattern: question.pattern,
        correct,
        endSession: isLast,
      });
    } catch {
      failed = true;
    }
    if (failed) {
      setSaveErrorVisible(true);
      setSaveFailed(true);
    }
    busyRef.current = false;
    setSaving(false);
    setAnswers((previous) => [
      ...previous,
      { event: question.event, pattern: question.pattern, correct },
    ]);
    setJudgement({ correct, chosen, gaveUp });
  };

  // 「わからない」は不正解として記録し、答えを見せる（設計書 6.2・6.3・6.7 節）
  const giveUp = () => void answer(false, null, true);

  const goNext = () => {
    if (finished) {
      onFinish({ total: questions.length, answers, saveFailed });
      return;
    }
    setIndex(index + 1);
    setJudgement(null);
  };

  const endNow = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setConfirmingEnd(false);
    setEnding(true);
    let failed = false;
    try {
      await store.endSession(session.id);
    } catch {
      failed = true;
    }
    onFinish({ total: questions.length, answers, saveFailed: saveFailed || failed });
  };

  return (
    <div className="screen">
      <header className="quiz-header">
        <p className="progress" data-testid="progress">
          {index + 1} / {questions.length}
        </p>
        <button
          type="button"
          className="button-text"
          disabled={saving || ending || finished}
          onClick={() => setConfirmingEnd(true)}
        >
          終了
        </button>
      </header>

      {saveErrorVisible && (
        <Banner
          action={
            <button
              type="button"
              className="banner-close"
              aria-label="閉じる"
              onClick={() => setSaveErrorVisible(false)}
            >
              ×
            </button>
          }
        >
          保存に失敗しました（学習は続けられます）
        </Banner>
      )}

      <main className="quiz" key={index}>
        {question.pattern === 'yearInput' && (
          <YearInputQuestion
            event={question.event}
            answered={judgement !== null}
            disabled={saving || ending}
            onAnswer={(year) => void answer(isCorrectYear(question.event, year), null)}
            onGiveUp={giveUp}
          />
        )}
        {question.pattern === 'yearChoice' && (
          <YearChoiceQuestion
            event={question.event}
            years={question.years}
            judgement={judgement}
            disabled={saving || ending}
            onAnswer={(year) => void answer(year === question.event.year, year)}
            onGiveUp={giveUp}
          />
        )}
        {question.pattern === 'choice' && (
          <ChoiceQuestion
            event={question.event}
            choices={question.choices}
            judgement={judgement}
            disabled={saving || ending}
            onAnswer={(choice) => void answer(choice.id === question.event.id, choice.id)}
            onGiveUp={giveUp}
          />
        )}

        {judgement !== null && (
          <section className="judgement" aria-live="polite">
            <p
              className={`judgement-mark ${judgementMark(judgement).className}`}
              data-testid="judgement"
            >
              {judgementMark(judgement).text}
            </p>
            {question.pattern !== 'choice' && (
              <p className="judgement-detail">正解の年: {formatAnswerYears(question.event)}</p>
            )}
            <button
              type="button"
              className="button-primary"
              disabled={ending}
              autoFocus
              onClick={goNext}
            >
              {finished ? '結果を見る' : '次へ'}
            </button>
          </section>
        )}
      </main>

      {confirmingEnd && (
        <ConfirmDialog
          title="ここで終了しますか？"
          confirmLabel="終了する"
          cancelLabel="続ける"
          onConfirm={() => void endNow()}
          onCancel={() => setConfirmingEnd(false)}
        >
          <p>回答済みの分は成績に残ります。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

interface GiveUpButtonProps {
  disabled: boolean;
  onClick: () => void;
}

/** 「わからない」のボタン。答えられないときの逃げ道なので、目立たない形で置く（設計書 6.2・6.3・6.7 節）。 */
function GiveUpButton({ disabled, onClick }: GiveUpButtonProps) {
  return (
    <div className="give-up">
      <button type="button" className="button-quiet" disabled={disabled} onClick={onClick}>
        わからない
      </button>
    </div>
  );
}

interface YearInputQuestionProps {
  event: Event;
  answered: boolean;
  disabled: boolean;
  onAnswer: (year: number) => void;
  onGiveUp: () => void;
}

/** パターン A: 年号入力（設計書 6.2 節）。 */
function YearInputQuestion({
  event,
  answered,
  disabled,
  onAnswer,
  onGiveUp,
}: YearInputQuestionProps) {
  const [text, setText] = useState('');
  const year = normalizeYearInput(text);
  const locked = answered || disabled;

  return (
    // 全角数字も受け付けるので、pattern 属性による検証では送信を止めない
    <form
      className="question"
      noValidate
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        if (year !== null && !locked) {
          onAnswer(year);
        }
      }}
    >
      <p className="question-text">{event.title}</p>
      <p className="question-prompt">何年の出来事？</p>
      <div className="year-answer">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className="text-input year-answer-input"
          aria-label="年号"
          value={text}
          disabled={locked}
          autoFocus
          onChange={(changeEvent) => setText(changeEvent.target.value)}
        />
        <span className="year-answer-unit">年</span>
        <button
          type="submit"
          className="button-primary year-answer-button"
          disabled={year === null || locked}
        >
          回答
        </button>
      </div>
      {!answered && <GiveUpButton disabled={disabled} onClick={onGiveUp} />}
    </form>
  );
}

interface YearChoiceQuestionProps {
  event: Event;
  /** 正解を含む 4 つの年（小さい順）。 */
  years: readonly number[];
  judgement: Judgement | null;
  disabled: boolean;
  onAnswer: (year: number) => void;
  onGiveUp: () => void;
}

/** パターン C: 年号 4 択（設計書 6.7 節）。年号の選択肢を 2 列 2 段に、渡された順（小さい順）で並べる。 */
function YearChoiceQuestion({
  event,
  years,
  judgement,
  disabled,
  onAnswer,
  onGiveUp,
}: YearChoiceQuestionProps) {
  return (
    <div className="question">
      <p className="question-text">{event.title}</p>
      <p className="question-prompt">何年の出来事？</p>
      <ul className="year-choices">
        {years.map((year) => {
          const isAnswer = judgement !== null && year === event.year;
          const isWrongPick = judgement !== null && !judgement.correct && year === judgement.chosen;
          const className = [
            'choice',
            'year-choice',
            isAnswer ? 'correct' : '',
            isWrongPick ? 'wrong' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={year}>
              <button
                type="button"
                className={className}
                data-testid="year-choice"
                disabled={judgement !== null || disabled}
                onClick={() => onAnswer(year)}
              >
                <span className="year-choice-year">{formatYear(year)}</span>
                {isAnswer && <span className="choice-badge">正解</span>}
                {isWrongPick && <span className="choice-badge">選んだ答え</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {judgement === null && <GiveUpButton disabled={disabled} onClick={onGiveUp} />}
    </div>
  );
}

interface ChoiceQuestionProps {
  event: Event;
  choices: readonly Event[];
  judgement: Judgement | null;
  disabled: boolean;
  onAnswer: (choice: Event) => void;
  onGiveUp: () => void;
}

/** パターン B: 出来事 4 択（設計書 6.3 節）。 */
function ChoiceQuestion({
  event,
  choices,
  judgement,
  disabled,
  onAnswer,
  onGiveUp,
}: ChoiceQuestionProps) {
  return (
    <div className="question">
      <p className="question-text">{formatEventYear(event)}の出来事は？</p>
      <ul className="choices">
        {choices.map((choice) => {
          const isAnswer = judgement !== null && choice.id === event.id;
          const isWrongPick =
            judgement !== null && !judgement.correct && choice.id === judgement.chosen;
          const className = ['choice', isAnswer ? 'correct' : '', isWrongPick ? 'wrong' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <li key={choice.id}>
              <button
                type="button"
                className={className}
                data-testid="choice"
                disabled={judgement !== null || disabled}
                onClick={() => onAnswer(choice)}
              >
                <span className="choice-title">{choice.title}</span>
                {isAnswer && <span className="choice-badge">正解</span>}
                {isWrongPick && <span className="choice-badge">選んだ答え</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {judgement === null && <GiveUpButton disabled={disabled} onClick={onGiveUp} />}
    </div>
  );
}
