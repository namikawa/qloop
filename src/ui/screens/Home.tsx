import { useEffect, useId, useRef, useState } from 'react';
import type { KindLabels } from '../../core/decks';
import type { UpdateCheckCallbacks, UpdateCheckResult } from '../../pwa/update-check';
import { Banner, BannerCloseButton } from '../components/Banner';
import {
  BrowseIcon,
  ChevronRightIcon,
  ReviewIcon,
  ShareIcon,
  StatsIcon,
  UpdateIcon,
} from '../components/icons';
import { Segmented } from '../components/Segmented';

/** 学習の記録（IndexedDB）の準備の状態。 */
export type StoreStatus =
  { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

interface HomeProps {
  /** 切り替えボタンに出す教材の一覧。教材が 1 つのときは `null`（切り替えを出さない。設計書 6.9 節）。 */
  decks: readonly { id: string; name: string }[] | null;
  /** 選んだ教材の id。 */
  deckId: string;
  /** 切り替えボタンで教材を選んだとき。 */
  onSelectDeck: (deckId: string) => void;
  /** 選んだ教材の名前。 */
  deckName: string;
  /** 選んだ教材の種類の画面の言葉（「出来事」「基本の年表」など）。 */
  labels: KindLabels;
  /** 出題できる項目（母集団）の件数。 */
  targetCount: number;
  /** 母集団のうち、基本データ（core.csv）の件数。 */
  coreCount: number;
  version: string;
  storeStatus: StoreStatus;
  /** 連続学習日数。学習の記録の準備ができるまでは `null`（行を出さない）。 */
  streakDays: number | null;
  /** 復習する問題の件数（復習の画面と同じ数え方）。準備ができるまでは `null`。0 件なら札を出さない。 */
  reviewCount: number | null;
  onStartQuiz: () => void;
  onStartReview: () => void;
  onOpenStats: () => void;
  browseName: string;
  onOpenBrowse: () => void;
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
  decks,
  deckId,
  onSelectDeck,
  deckName,
  labels,
  targetCount,
  coreCount,
  version,
  storeStatus,
  streakDays,
  reviewCount,
  onStartQuiz,
  onStartReview,
  onOpenStats,
  browseName,
  onOpenBrowse,
  installBannerVisible,
  onCloseInstallBanner,
  updateAvailable,
  onApplyUpdate,
  onCheckUpdate,
}: HomeProps) {
  const ready = storeStatus.status === 'ready';
  const reviewLabelId = useId();
  const reviewBadgeId = useId();
  const showReviewBadge = ready && reviewCount !== null && reviewCount > 0;

  return (
    <div className="screen home-screen">
      {installBannerVisible && (
        <Banner icon={<ShareIcon />} action={<BannerCloseButton onClick={onCloseInstallBanner} />}>
          Safari の共有メニューから『ホーム画面に追加』して使ってください
        </Banner>
      )}
      {updateAvailable && (
        <Banner
          icon={<UpdateIcon />}
          action={
            <button type="button" className="banner-button" onClick={onApplyUpdate}>
              更新
            </button>
          }
        >
          新しいバージョンがあります
        </Banner>
      )}

      <main className="home">
        <div className="home-heading">
          <h1 className="home-logo">
            <img src="/qloop-logo.svg" alt="QLoop" width={112} height={36} />
          </h1>
          {ready && streakDays !== null && (
            <p className="streak" data-testid="home-streak">
              連続学習日数 <span className="streak-number">{streakDays}</span>{' '}
              <span className="streak-unit">日</span>
            </p>
          )}
        </div>

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

        <section className="card deck" aria-labelledby="deck-name">
          {decks !== null && (
            <div className="deck-switch">
              <Segmented
                legend="教材"
                legendHidden
                name="deck"
                options={decks.map((deck) => ({ value: deck.id, label: deck.name }))}
                value={deckId}
                onChange={onSelectDeck}
                // 読み込み中は lastDeck に保存できないので、他のボタンと同じく押せなくする
                disabled={!ready}
              />
            </div>
          )}
          <h2 id="deck-name" className="deck-name">
            {deckName}
          </h2>
          <p className="deck-count-text" data-testid="target-count">
            {/* 狭い画面では括弧の前で折り返す */}
            <span className="nowrap">
              出題できる{labels.item} {targetCount} 件
            </span>
            {labels.core !== null && (
              <span className="nowrap">
                （{labels.core} {coreCount} 件）
              </span>
            )}
          </p>
          <button
            type="button"
            className="button-primary home-start"
            disabled={!ready}
            onClick={onStartQuiz}
          >
            出題
          </button>
          <div className="deck-menu">
            <button type="button" className="menu-row" disabled={!ready} onClick={onOpenBrowse}>
              <BrowseIcon className="menu-icon" />
              <span className="menu-label">{browseName}</span>
              <ChevronRightIcon className="menu-chevron" />
            </button>
            <button
              type="button"
              className="menu-row"
              disabled={!ready}
              aria-labelledby={reviewLabelId}
              aria-describedby={showReviewBadge ? reviewBadgeId : undefined}
              onClick={onStartReview}
            >
              <ReviewIcon className="menu-icon" />
              <span id={reviewLabelId} className="menu-label">
                復習
              </span>
              {showReviewBadge && (
                <span id={reviewBadgeId} className="menu-badge" data-testid="home-review-count">
                  {reviewCount} 件
                </span>
              )}
              <ChevronRightIcon className="menu-chevron" />
            </button>
            <button type="button" className="menu-row" disabled={!ready} onClick={onOpenStats}>
              <StatsIcon className="menu-icon" />
              <span className="menu-label">成績</span>
              <ChevronRightIcon className="menu-chevron" />
            </button>
          </div>
        </section>
      </main>

      <VersionFooter version={version} onCheckUpdate={onCheckUpdate} />
    </div>
  );
}
