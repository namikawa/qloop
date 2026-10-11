import { Banner } from '../components/Banner';

/** 学習の記録（IndexedDB）の準備の状態。 */
export type StoreStatus =
  { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

interface HomeProps {
  deckName: string;
  /** 出題できる出来事（母集団）の件数。 */
  targetCount: number;
  /** 母集団のうち、基本の年表（core.csv）の件数。 */
  coreCount: number;
  version: string;
  storeStatus: StoreStatus;
  onStartQuiz: () => void;
  onStartReview: () => void;
  onOpenStats: () => void;
  installBannerVisible: boolean;
  onCloseInstallBanner: () => void;
  updateAvailable: boolean;
  onApplyUpdate: () => void;
}

export function Home({
  deckName,
  targetCount,
  coreCount,
  version,
  storeStatus,
  onStartQuiz,
  onStartReview,
  onOpenStats,
  installBannerVisible,
  onCloseInstallBanner,
  updateAvailable,
  onApplyUpdate,
}: HomeProps) {
  return (
    <div className="screen">
      {installBannerVisible && (
        <Banner
          action={
            <button
              type="button"
              className="banner-close"
              aria-label="閉じる"
              onClick={onCloseInstallBanner}
            >
              ×
            </button>
          }
        >
          Safari の共有メニューから『ホーム画面に追加』して使ってください
        </Banner>
      )}
      {updateAvailable && (
        <Banner
          action={
            <button type="button" className="button" onClick={onApplyUpdate}>
              更新
            </button>
          }
        >
          新しいバージョンがあります
        </Banner>
      )}

      <main className="home">
        <h1 className="app-name">QLoop</h1>
        <section className="deck" aria-labelledby="deck-name">
          <h2 id="deck-name" className="deck-name">
            {deckName}
          </h2>
          <p className="deck-count-text" data-testid="target-count">
            {/* 狭い画面では括弧の前で折り返す */}
            <span className="nowrap">出題できる出来事 {targetCount} 件</span>
            <span className="nowrap">（基本の年表 {coreCount} 件）</span>
          </p>
        </section>

        {storeStatus.status === 'loading' && (
          <p className="status-text" role="status">
            学習の記録を読み込んでいます…
          </p>
        )}
        {storeStatus.status === 'error' && (
          <div className="error-box" role="alert">
            <p className="error-box-title">学習の記録を開けないため、学習を始められません</p>
            <p className="error-box-detail">理由: {storeStatus.message}</p>
          </div>
        )}

        <div className="home-actions">
          <button
            type="button"
            className="button-primary"
            disabled={storeStatus.status !== 'ready'}
            onClick={onStartQuiz}
          >
            出題
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={storeStatus.status !== 'ready'}
            onClick={onStartReview}
          >
            復習
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={storeStatus.status !== 'ready'}
            onClick={onOpenStats}
          >
            成績
          </button>
        </div>
      </main>

      <footer className="footer" data-testid="version">
        バージョン {version}
      </footer>
    </div>
  );
}
