import { BackIcon } from './icons';

interface ScreenHeaderProps {
  title: string;
  /** 見出しの下に出す教材の名前（設計書 6.9 節）。無ければ出さない（教材が 1 つのとき）。 */
  deckName?: string;
  /** 戻るを押したとき。無ければ戻るの行を出さない（結果の画面）。 */
  onBack?: () => void;
  /** 処理中など、戻るのボタンを押せなくするとき。 */
  backDisabled?: boolean;
}

/** 画面の上部。戻るの行と、その下の大きな見出し（と教材の名前）。 */
export function ScreenHeader({ title, deckName, onBack, backDisabled = false }: ScreenHeaderProps) {
  return (
    <header className={onBack === undefined ? 'screen-header no-back' : 'screen-header'}>
      {onBack !== undefined && (
        <div className="back-row">
          <button type="button" className="back-button" disabled={backDisabled} onClick={onBack}>
            <BackIcon />
            戻る
          </button>
        </div>
      )}
      <h1 className="screen-title">{title}</h1>
      {deckName !== undefined && (
        <p className="screen-deck" data-testid="screen-deck">
          {deckName}
        </p>
      )}
    </header>
  );
}
