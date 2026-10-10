/** 判定に使う navigator の一部（テストで差し替えられるように引数で受け取る）。 */
export interface NavigatorLike {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Safari 独自の非標準プロパティ。iOS でホーム画面から起動したときに true。 */
  standalone?: boolean;
}

/** iPhone・iPad（iPadOS はデスクトップ表示の UA を名乗るのでタッチ対応の Mac として判定する）。 */
export function isIos(nav: NavigatorLike): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  );
}

/** 「ホーム画面に追加」の帯を出すか（設計書 6.5 節）。iOS でホーム画面から起動していないときに出す。 */
export function shouldShowInstallBanner(nav: NavigatorLike): boolean {
  return isIos(nav) && nav.standalone !== true;
}
