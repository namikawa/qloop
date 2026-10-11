interface BarProps {
  /** 0〜1 の割合。`null`（未回答）なら空の棒。 */
  ratio: number | null;
}

/** CSS で描く横棒（設計書 8 章の 2）。値は横の文字で示すので、読み上げからは外す。 */
export function Bar({ ratio }: BarProps) {
  const percent = ratio === null ? 0 : Math.min(100, Math.max(0, ratio * 100));
  return (
    <span className="bar" aria-hidden="true">
      <span className="bar-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}
