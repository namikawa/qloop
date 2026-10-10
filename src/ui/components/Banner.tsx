import type { ReactNode } from 'react';

interface BannerProps {
  children: ReactNode;
  /** 帯の右側に置くボタンなど。 */
  action?: ReactNode;
}

/** 画面上部に出す帯。 */
export function Banner({ children, action }: BannerProps) {
  return (
    <div className="banner" role="status">
      <p className="banner-text">{children}</p>
      {action !== undefined && <div className="banner-action">{action}</div>}
    </div>
  );
}
