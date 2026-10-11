import type { ReactNode } from 'react';

interface BottomBarProps {
  children: ReactNode;
  className?: string;
}

/**
 * 画面の下に固定する帯（開始・ホームへなど）。`position: sticky` で画面の流れの最後に置くので、
 * 帯の高さが変わっても、本文の最後まで送れば帯に隠れない。
 */
export function BottomBar({ children, className }: BottomBarProps) {
  return (
    <div className={className === undefined ? 'bottom-bar' : `bottom-bar ${className}`}>
      <div className="bottom-bar-inner">{children}</div>
    </div>
  );
}
