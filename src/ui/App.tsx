import { useState } from 'react';
import type { Deck } from '../core/models';
import deckJson from '../generated/deck.json';
import { shouldShowInstallBanner } from '../pwa/standalone';
import { useAppUpdate } from '../pwa/update';
import { Home } from './screens/Home';

const deck = deckJson as Deck;
const coreCount = deck.events.filter((event) => event.role === 'core').length;
const poolCount = deck.events.filter((event) => event.role === 'pool').length;

export function App() {
  // 帯を閉じた状態は起動の間だけ持つ（保存しない）。画面を切り替えても戻らないよう App で持つ。
  const [installBannerVisible, setInstallBannerVisible] = useState(() =>
    shouldShowInstallBanner(navigator),
  );
  const update = useAppUpdate();

  return (
    <Home
      deckName={deck.name}
      coreCount={coreCount}
      poolCount={poolCount}
      version={__APP_VERSION__}
      installBannerVisible={installBannerVisible}
      onCloseInstallBanner={() => setInstallBannerVisible(false)}
      updateAvailable={update.available}
      onApplyUpdate={update.apply}
    />
  );
}
