import { useRegisterSW } from 'virtual:pwa-register/react';

export interface AppUpdate {
  /** 新しい Service Worker が待機しているか。 */
  available: boolean;
  /** 新しい Service Worker を有効にして再読み込みする。 */
  apply: () => void;
}

// アプリ全体で 1 回だけ使うので、更新の状態はモジュールに持つ
/** この画面で「更新」を押したか。 */
let applyRequested = false;
/** 別の画面が更新を適用し、新しい Service Worker がこの画面も制御し始めたか。 */
let takenOverByNewWorker = false;

/**
 * 新しい Service Worker がこの画面を制御し始めたとき（vite-plugin-pwa の onNeedReload）。
 * 自分で「更新」を押したときだけ再読み込みする。別の画面が更新を適用したときは、
 * 学習中に勝手に再読み込みしないよう、ここでは覚えておくだけにする（設計書 6.6 節）。
 */
function handleNeedReload(): void {
  if (applyRequested) {
    window.location.reload();
  } else {
    takenOverByNewWorker = true;
  }
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
  } = useRegisterSW({ onNeedReload: handleNeedReload });
  return {
    available: needRefresh,
    apply: () => {
      if (takenOverByNewWorker) {
        // 別の画面で更新済み。待機中の Service Worker はもう無いので、読み込み直すだけでよい
        window.location.reload();
        return;
      }
      applyRequested = true;
      void updateServiceWorker(true);
    },
  };
}
