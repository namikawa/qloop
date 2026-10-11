import { useRef, useState } from 'react';
import type { Event, Pattern, Question, Session } from '../../core/models';
import { answeredRatio, progressSteps, type AnswerOutcome } from '../../core/progress';
import { isCorrectYear } from '../../core/quiz';
import {
  formatAnswerYears,
  formatEventYear,
  normalizeYearInput,
  splitYearText,
} from '../../core/year';
import type { ProgressStore } from '../../storage/progress-store';
import { Banner, BannerCloseButton } from '../components/Banner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AnswerMarkIcon, JudgementIcon } from '../components/icons';
import { ProgressSteps, ProgressTrack } from '../components/ProgressSteps';

/** 回答した 1 問（まとめ画面に渡す）。 */
export interface AnsweredQuestion {
  event: Event;
  pattern: Pattern;
  /** 判定。「わからない」は記録では不正解だが、進み具合の区切りでは分けて示す。 */
  outcome: AnswerOutcome;
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

function outcomeOf({ correct, gaveUp }: Judgement): AnswerOutcome {
  if (gaveUp) {
    return 'gaveUp';
  }
  return correct ? 'correct' : 'wrong';
}

/** 判定の帯の見出し（正解・不正解・わからない）と、その色のクラス。 */
const JUDGEMENT_MARKS: Readonly<Record<AnswerOutcome, { text: string; className: string }>> = {
  correct: { text: '正解', className: 'correct' },
  wrong: { text: '不正解', className: 'wrong' },
  gaveUp: { text: 'わからない', className: 'gave-up' },
};

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
  const outcome = judgement === null ? null : outcomeOf(judgement);
  const steps = progressSteps(
    questions.length,
    answers.map((answered) => answered.outcome),
    index,
  );

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
    const next: Judgement = { correct, chosen, gaveUp };
    setAnswers((previous) => [
      ...previous,
      { event: question.event, pattern: question.pattern, outcome: outcomeOf(next) },
    ]);
    setJudgement(next);
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
    <div className="screen screen-with-bar">
      <header className="quiz-header">
        <p className="progress" data-testid="progress">
          {index + 1} / {questions.length}
        </p>
        {steps === null ? (
          <ProgressTrack ratio={answeredRatio(questions.length, answers.length)} />
        ) : (
          <ProgressSteps steps={steps} />
        )}
        <button
          type="button"
          className="button-text quiz-end"
          disabled={saving || ending || finished}
          onClick={() => setConfirmingEnd(true)}
        >
          終了
        </button>
      </header>

      {saveErrorVisible && (
        <Banner action={<BannerCloseButton onClick={() => setSaveErrorVisible(false)} />}>
          保存に失敗しました（学習は続けられます）
        </Banner>
      )}

      <main className="quiz screen-body" key={index}>
        {question.pattern === 'yearInput' && (
          <YearInputQuestion
            event={question.event}
            outcome={outcome}
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
      </main>

      {outcome !== null && (
        <section
          className={`bottom-bar judgement-bar ${JUDGEMENT_MARKS[outcome].className}`}
          aria-live="polite"
        >
          <div className="judgement-row">
            <div className="judgement-main">
              <p className="judgement-mark" data-testid="judgement">
                <JudgementIcon kind={outcome} />
                {JUDGEMENT_MARKS[outcome].text}
              </p>
              {question.pattern !== 'choice' && (
                <p className="judgement-detail">
                  正解の年{' '}
                  <span className="judgement-years">{formatAnswerYears(question.event)}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              className="button-primary judgement-next"
              disabled={ending}
              autoFocus
              onClick={goNext}
            >
              {finished ? '結果を見る' : '次へ'}
            </button>
          </div>
        </section>
      )}

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

/** 年号入力と年号 4 択の問題（「何年の出来事？」と出来事の文）。 */
function QuestionCard({ event }: { event: Event }) {
  return (
    <div className="card question-card">
      <p className="question-prompt">何年の出来事？</p>
      <p className="question-text">{event.title}</p>
    </div>
  );
}

const YEAR_FIELD_CLASSES: Readonly<Record<AnswerOutcome, string>> = {
  correct: 'year-field is-correct',
  wrong: 'year-field is-wrong',
  gaveUp: 'year-field is-gaveup',
};

interface YearInputQuestionProps {
  event: Event;
  /** 判定。回答前は `null`。 */
  outcome: AnswerOutcome | null;
  disabled: boolean;
  onAnswer: (year: number) => void;
  onGiveUp: () => void;
}

/** パターン A: 年号入力（設計書 6.2 節）。 */
function YearInputQuestion({
  event,
  outcome,
  disabled,
  onAnswer,
  onGiveUp,
}: YearInputQuestionProps) {
  const [text, setText] = useState('');
  const year = normalizeYearInput(text);
  const answered = outcome !== null;
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
      <QuestionCard event={event} />
      <div className="year-answer">
        <div className={outcome === null ? 'year-field' : YEAR_FIELD_CLASSES[outcome]}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            className="input-box-input year-field-input"
            aria-label="年号"
            value={outcome === 'gaveUp' ? '' : text}
            disabled={locked}
            autoFocus
            onChange={(changeEvent) => setText(changeEvent.target.value)}
          />
          <span className="year-field-unit" aria-hidden="true">
            {(outcome === 'correct' || outcome === 'wrong') && (
              <AnswerMarkIcon className={`year-field-mark ${outcome}`} kind={outcome} />
            )}
            年
          </span>
        </div>
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

/** 判定の後の選択肢のクラスと札（正解・選んだ誤答・残り）。 */
function settledChoice(
  judgement: Judgement | null,
  isAnswer: boolean,
  isChosen: boolean,
  baseClass: string,
): { className: string; badge: string | null } {
  if (judgement === null) {
    return { className: baseClass, badge: null };
  }
  if (isAnswer) {
    return { className: `${baseClass} settled correct`, badge: '◯ 正解' };
  }
  if (!judgement.correct && isChosen) {
    return { className: `${baseClass} settled wrong`, badge: '✕ 選んだ答え' };
  }
  return { className: `${baseClass} settled`, badge: null };
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
      <QuestionCard event={event} />
      <ul className="year-choices">
        {years.map((year) => {
          const { className, badge } = settledChoice(
            judgement,
            year === event.year,
            year === judgement?.chosen,
            'choice year-choice',
          );
          return (
            <li key={year}>
              <button
                type="button"
                className={className}
                data-testid="year-choice"
                disabled={judgement !== null || disabled}
                onClick={() => onAnswer(year)}
              >
                <span className="year-choice-year">
                  {year}
                  <span className="year-choice-unit">年</span>
                </span>
                {badge !== null && <span className="choice-badge">{badge}</span>}
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

/** パターン B: 出来事 4 択（設計書 6.3 節）。問いの年の数字を大きく見せる。 */
function ChoiceQuestion({
  event,
  choices,
  judgement,
  disabled,
  onAnswer,
  onGiveUp,
}: ChoiceQuestionProps) {
  const year = splitYearText(formatEventYear(event));
  return (
    <div className="question">
      <p className="question-text choice-question">
        {year.prefix !== '' && <span className="choice-question-unit">{year.prefix}</span>}
        {year.number !== '' && <span className="choice-question-number">{year.number}</span>}
        {year.suffix !== '' && <span className="choice-question-unit">{year.suffix}</span>}
        <span className="choice-question-rest">の出来事は？</span>
      </p>
      <ul className="choices">
        {choices.map((choice) => {
          const { className, badge } = settledChoice(
            judgement,
            choice.id === event.id,
            choice.id === judgement?.chosen,
            'choice',
          );
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
                {badge !== null && <span className="choice-badge">{badge}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {judgement === null && <GiveUpButton disabled={disabled} onClick={onGiveUp} />}
    </div>
  );
}
