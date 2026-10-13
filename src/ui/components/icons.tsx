/**
 * 画面で使う印（1 色の線の SVG）。色は `currentColor` で、置いた場所の文字の色に合わせる。
 * どれも飾りなので、読み上げからは外す（意味は横の文字で示す）。
 */

interface IconProps {
  className?: string;
}

const hidden = { 'aria-hidden': true, focusable: false } as const;

/** 戻るの山形。 */
export function BackIcon({ className }: IconProps) {
  return (
    <svg className={className} width="11" height="19" viewBox="0 0 11 19" {...hidden}>
      <path
        d="M9 2 2 9.5 9 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 一覧の行の右端の山形。 */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} width="8" height="14" viewBox="0 0 8 14" {...hidden}>
      <path
        d="M1.5 1.5 6.5 7l-5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 下向きの山形（選ぶ欄・開閉）。 */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} width="12" height="8" viewBox="0 0 12 8" {...hidden}>
      <path
        d="M1.5 1.5 6 6l4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 復習（円の 3/4 と右上の矢印）。 */
export function ReviewIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...hidden}
    >
      <path d="M18.5 11a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M17 2.5v4h-4" />
    </svg>
  );
}

/** 一覧（箇条書きの 3 行）。 */
export function BrowseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      {...hidden}
    >
      <path d="M8 5h10M8 11h10M8 17h10M4 5h.1M4 11h.1M4 17h.1" />
    </svg>
  );
}

/** 成績（高さの違う縦線 3 本）。 */
export function StatsIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      {...hidden}
    >
      <path d="M5 18.5v-5M11 18.5v-13M17 18.5v-8.5" />
    </svg>
  );
}

/** 共有（四角と上向きの矢印）。 */
export function ShareIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...hidden}
    >
      <path d="M8 8H6.5A1.5 1.5 0 0 0 5 9.5v9A1.5 1.5 0 0 0 6.5 20h9a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 15.5 8H14" />
      <path d="M11 13.5V2M7.5 5.5 11 2l3.5 3.5" />
    </svg>
  );
}

/** 更新（下向きの矢印の入った円）。 */
export function UpdateIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...hidden}
    >
      <circle cx="11" cy="11" r="8.5" />
      <path d="M11 6.5v6M8 10l3 3 3-3" />
    </svg>
  );
}

/** 閉じる（×）。 */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" {...hidden}>
      <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RecordIcon({ className, d }: IconProps & { d: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...hidden}
    >
      <path d={d} />
    </svg>
  );
}

/** 書き出し（上向きの矢印と受け皿）。 */
export function ExportIcon({ className }: IconProps) {
  return (
    <RecordIcon
      className={className}
      d="M10 13V2.5M6 6.5l4-4 4 4M3 12v4.5A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V12"
    />
  );
}

/** 読み込み（下向きの矢印と受け皿）。 */
export function ImportIcon({ className }: IconProps) {
  return (
    <RecordIcon
      className={className}
      d="M10 2.5V13M6 9l4 4 4-4M3 12v4.5A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V12"
    />
  );
}

/** リセット（ごみ箱）。 */
export function TrashIcon({ className }: IconProps) {
  return (
    <RecordIcon
      className={className}
      d="M3.5 5.5h13M8 5.5v-2h4v2M5 5.5l.8 11.2A1.5 1.5 0 0 0 7.3 18h5.4a1.5 1.5 0 0 0 1.5-1.3L15 5.5"
    />
  );
}

/** 選んだ出題パターンの印（丸に ✓）。丸は `currentColor`、✓ は白。 */
export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" {...hidden}>
      <circle cx="10" cy="10" r="10" fill="currentColor" />
      <path
        d="M5.8 10.3l2.8 2.8 5.6-5.8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 選んだ時代のチップの ✓。 */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" {...hidden}>
      <path
        d="M2.5 7.3l2.9 2.9 6-6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 判定の帯の印（26px の円に白い ◯・✕・–）。円は `currentColor`。 */
export function JudgementIcon({
  className,
  kind,
}: IconProps & { kind: 'correct' | 'wrong' | 'gaveUp' }) {
  return (
    <svg className={className} width="26" height="26" viewBox="0 0 26 26" {...hidden}>
      <circle cx="13" cy="13" r="13" fill="currentColor" />
      {kind === 'correct' && (
        <circle cx="13" cy="13" r="6.3" fill="none" stroke="#ffffff" strokeWidth="2.6" />
      )}
      {kind === 'wrong' && (
        <path d="M9 9l8 8M17 9l-8 8" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      )}
      {kind === 'gaveUp' && (
        <path d="M8.5 13h9" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** 年号入力の欄に添える ◯・✕（18px）。色は `currentColor`。 */
export function AnswerMarkIcon({ className, kind }: IconProps & { kind: 'correct' | 'wrong' }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" {...hidden}>
      {kind === 'correct' ? (
        <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
      ) : (
        <path
          d="M4 4l10 10M14 4 4 14"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
