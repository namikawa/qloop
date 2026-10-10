import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 確認ダイアログ。iOS 15.8 の Safari では dialog 要素の showModal を使わない方針なので（設計書 9.4 節）、
 * 画面全体を覆う要素で作る。開いたときは取り消しのボタンにフォーカスを置き、Esc で閉じる。
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children !== undefined && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button-secondary dialog-button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className="button-primary dialog-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
