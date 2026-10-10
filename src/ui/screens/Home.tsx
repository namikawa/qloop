import { Banner } from '../components/Banner';

interface HomeProps {
  deckName: string;
  coreCount: number;
  poolCount: number;
  version: string;
  installBannerVisible: boolean;
  onCloseInstallBanner: () => void;
  updateAvailable: boolean;
  onApplyUpdate: () => void;
}

export function Home({
  deckName,
  coreCount,
  poolCount,
  version,
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
          <dl className="deck-counts">
            <div className="deck-count">
              <dt>出題対象</dt>
              <dd data-testid="core-count">{coreCount} 件</dd>
            </div>
            <div className="deck-count">
              <dt>誤答用</dt>
              <dd data-testid="pool-count">{poolCount} 件</dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="footer" data-testid="version">
        バージョン {version}
      </footer>
    </div>
  );
}
