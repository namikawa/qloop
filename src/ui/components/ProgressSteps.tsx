import type { ProgressStep } from '../../core/progress';

interface ProgressStepsProps {
  steps: readonly ProgressStep[];
  className?: string;
}

/**
 * 進み具合の区切り（問題ごとに判定の色で埋まる）。数は横の「3 / 10」や得点で示すので、読み上げからは外す。
 */
export function ProgressSteps({ steps, className }: ProgressStepsProps) {
  return (
    <div
      className={className === undefined ? 'progress-steps' : `progress-steps ${className}`}
      aria-hidden="true"
      data-testid="progress-steps"
    >
      {steps.map((step, position) => (
        <span key={position} className="progress-step" data-state={step} />
      ))}
    </div>
  );
}

/** 問題数が多いときの、回答済みの割合を塗る 1 本の帯。`ratio` は 0〜1。 */
export function ProgressTrack({ ratio }: { ratio: number }) {
  return (
    <span className="progress-track" aria-hidden="true" data-testid="progress-track">
      <span className="progress-fill" style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}
