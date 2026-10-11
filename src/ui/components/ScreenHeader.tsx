import { BackIcon } from './icons';

interface ScreenHeaderProps {
  title: string;
  /** 戻るを押したとき。無ければ戻るの行を出さない（結果の画面）。 */
  onBack?: () => void;
}

/** 画面の上部。戻るの行と、その下の大きな見出し。 */
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <header className={onBack === undefined ? 'screen-header no-back' : 'screen-header'}>
      {onBack !== undefined && (
        <div className="back-row">
          <button type="button" className="back-button" onClick={onBack}>
            <BackIcon />
            戻る
          </button>
        </div>
      )}
      <h1 className="screen-title">{title}</h1>
    </header>
  );
}
