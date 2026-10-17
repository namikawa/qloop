import type { PrecacheProgress } from '../../pwa/update-progress';

/** 更新と初回の準備で使う、文とファイル数の進み具合。 */
export function UpdateProgress({
  message,
  progress,
}: {
  message: string;
  progress: PrecacheProgress | null;
}) {
  const loading = progress !== null && progress.total >= 1 && progress.done < progress.total;
  return (
    <span className="update-progress">
      <span>{message}</span>
      {loading && (
        <span className="update-progress-row">
          <progress
            className="update-progress-track"
            aria-label={message}
            value={progress.done}
            max={progress.total}
          />
          <span className="update-progress-percent">
            {Math.floor((progress.done / progress.total) * 100)}%
          </span>
        </span>
      )}
    </span>
  );
}
