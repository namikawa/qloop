import type { ReactNode } from 'react';
import { CloseIcon } from './icons';

interface BannerProps {
  children: ReactNode;
  /** 文の前に置く印。 */
  icon?: ReactNode;
  /** 帯の右側に置くボタンなど。 */
  action?: ReactNode;
}

/** 画面上部に出す帯。 */
export function Banner({ children, icon, action }: BannerProps) {
  return (
    <div className={action === undefined ? 'banner' : 'banner banner-with-action'} role="status">
      {icon !== undefined && <span className="banner-icon">{icon}</span>}
      <p className="banner-text">{children}</p>
      {action !== undefined && <div className="banner-action">{action}</div>}
    </div>
  );
}

/** 帯を閉じるボタン（押せる範囲は 44 × 44）。 */
export function BannerCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="banner-close" aria-label="閉じる" onClick={onClick}>
      <CloseIcon />
    </button>
  );
}
