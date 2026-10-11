import { useRegisterSW } from 'virtual:pwa-register/react';
import { checkForUpdate, type UpdateCheckCallbacks, type UpdateCheckResult } from './update-check';

export interface AppUpdate {
  /** 新しい Service Worker が待機しているか。 */
  available: boolean;
  /** 新しい Service Worker を有効にして再読み込みする。 */
  apply: () => void;
  /** 通信して新しい版を探し、あれば読み込みを待って切り替える（ホーム画面の「アプリを更新」）。 */
  check: (callbacks: UpdateCheckCallbacks) => Promise<UpdateCheckResult>;
}

// アプリ全体で 1 回だけ使うので、更新の状態はモジュールに持つ
/** この画面で「更新」を押したか。 */
let applyRequested = false;
/** 別の画面が更新を適用し、新しい Service Worker がこの画面も制御し始めたか。 */
let takenOverByNewWorker = false;

/** Service Worker の登録（vite-plugin-pwa の onRegisteredSW・onRegisterError で決まる）。 */
let settleRegistration: (registration: ServiceWorkerRegistration | null) => void = () => {};
const registrationReady = new Promise<ServiceWorkerRegistration | null>((resolve) => {
  settleRegistration = resolve;
});

function handleRegisteredSW(
  _swScriptUrl: string,
  registration: ServiceWorkerRegistration | undefined,
): void {
  settleRegistration(registration ?? null);
}

function handleRegisterError(): void {
  settleRegistration(null);
}

/** Service Worker の登録を得る。Service Worker が使えないときは null。 */
function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  return 'serviceWorker' in navigator ? registrationReady : Promise.resolve(null);
}

/** 再読み込みを始めたか（切り替わりの知らせが 2 か所から来ても 1 回だけ読み込み直す）。 */
let reloading = false;

/**
 * 新しい Service Worker がこの画面を制御し始めたとき。
 * 自分で「更新」を押したときだけ再読み込みする。別の画面が更新を適用したときは、
 * 学習中に勝手に再読み込みしないよう、ここでは覚えておくだけにする（設計書 6.6 節）。
 */
function handleNeedReload(): void {
  if (applyRequested) {
    if (!reloading) {
      reloading = true;
      window.location.reload();
    }
  } else {
    takenOverByNewWorker = true;
  }
}

// vite-plugin-pwa が onNeedReload を呼ぶ準備をするのは、needRefresh を true にするとき（帯を出すとき）だけ。
// 帯を出す前に切り替わる場合（「アプリを更新」から切り替えたとき、別の画面が更新を適用したとき）も拾えるよう、
// 制御の切り替わりは起動したときから自分でも見る
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', handleNeedReload);
}

/**
 * Service Worker を登録し、新しい版の検知と適用を扱う（設計書 6.6 節）。
 * registerType は prompt なので、apply を呼ぶまで新しい版には切り替わらない。
 * アプリ全体で 1 回だけ使う（App から呼ぶ）。
 */
export function useAppUpdate(): AppUpdate {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload: handleNeedReload,
    onRegisteredSW: handleRegisteredSW,
    onRegisterError: handleRegisterError,
  });

  const apply = () => {
    if (takenOverByNewWorker) {
      // 別の画面で更新済み。待機中の Service Worker はもう無いので、読み込み直すだけでよい
      window.location.reload();
      return;
    }
    applyRequested = true;
    void updateServiceWorker(true);
  };

  return {
    available: needRefresh,
    apply,
    check: (callbacks) =>
      checkForUpdate({
        ...callbacks,
        available: needRefresh,
        takenOverByNewWorker,
        serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
        getRegistration,
        apply,
      }),
  };
}
