import { useEffect, useRef, useState } from 'react';
import type { UpdateCheckCallbacks, UpdateCheckResult } from '../../pwa/update-check';
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
  /** 「アプリを更新」を押したとき。通信して新しい版を探し、あれば切り替える。 */
  onCheckUpdate: (callbacks: UpdateCheckCallbacks) => Promise<UpdateCheckResult>;
}

/** 「アプリを更新」の表示の状態。 */
type UpdateCheckStatus = 'idle' | 'checking' | 'installing' | 'latest' | 'failed';

const UPDATE_CHECK_MESSAGES: Record<UpdateCheckStatus, string> = {
  idle: '',
  checking: '確認しています',
  installing: '新しい版を読み込んでいます',
  latest: '最新の版です',
  failed: '確認できませんでした。通信できる場所でもう一度押してください',
};

/** ホーム画面の下部の版の表示と「アプリを更新」（設計書 6.6 節）。 */
function VersionFooter({
  version,
  onCheckUpdate,
}: {
  version: string;
  onCheckUpdate: HomeProps['onCheckUpdate'];
}) {
  const [status, setStatus] = useState<UpdateCheckStatus>('idle');
  const abortRef = useRef<AbortController | null>(null);

  // ホーム画面を離れたら確認を中断し、学習の途中で切り替わらないようにする
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const busy = status === 'checking' || status === 'installing';

  async function handleCheck() {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('checking');
    const result = await onCheckUpdate({
      signal: controller.signal,
      onInstalling: () => setStatus('installing'),
    }).catch((): UpdateCheckResult => 'failed');
    switch (result) {
      case 'applied':
        // 新しい版に切り替えて読み込み直すまで、押せないままにする
        setStatus('installing');
        break;
      case 'latest':
      case 'failed':
        setStatus(result);
        break;
      case 'aborted':
        break;
    }
  }

  return (
    <footer className="footer">
      <div className="footer-row">
        <span data-testid="version">バージョン {version}</span>
        <button
          type="button"
          className="button-text update-button"
          disabled={busy}
          onClick={() => void handleCheck()}
        >
          アプリを更新
        </button>
      </div>
      <p
        className={status === 'failed' ? 'update-status update-status-error' : 'update-status'}
        role="status"
      >
        {UPDATE_CHECK_MESSAGES[status]}
      </p>
    </footer>
  );
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
  onCheckUpdate,
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

      <VersionFooter version={version} onCheckUpdate={onCheckUpdate} />
    </div>
  );
}
