import { useRegisterSW } from 'virtual:pwa-register/react';

export interface AppUpdate {
  /** 新しい Service Worker が待機しているか。 */
  available: boolean;
  /** 新しい Service Worker を有効にして再読み込みする。 */
  apply: () => void;
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
  } = useRegisterSW();
  return {
    available: needRefresh,
    apply: () => {
      void updateServiceWorker(true);
    },
  };
}
