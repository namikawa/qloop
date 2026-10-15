import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import type { ProgressStore } from '../../storage/progress-store';
import { exportFileName, parseProgressJson, type ProgressExport } from '../../storage/transfer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportIcon, ImportIcon, TrashIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { describeError } from '../errors';
import {
  prepareExportFile,
  releaseExportFile,
  shareExportFile,
  type PreparedExport,
} from '../export-file';

interface RecordsProps {
  store: ProgressStore;
  /** 教材の定義の順に並べた名前。全教材をまとめて扱う説明に使う。 */
  deckNames: readonly string[];
  onBack: () => void;
}

/** 操作の結果の知らせ。 */
interface Notice {
  kind: 'info' | 'error';
  text: string;
}

/** 全教材の記録の書き出し・読み込み・リセット（設計書 5.6 節）。ホームの下部から開く。 */
export function Records({ store, deckNames, onBack }: RecordsProps) {
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [pendingImport, setPendingImport] = useState<ProgressExport | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportPanelId = useId();

  // 書き出しの Blob の URL は、作り直したときと画面を離れたときに解放する
  useEffect(() => {
    if (prepared === null) {
      return undefined;
    }
    return () => releaseExportFile(prepared);
  }, [prepared]);

  // 「書き出し」は開閉を兼ねる。準備した欄が出ているときに押すと閉じ、用意したファイルを捨てる
  // （URL は上の effect の後片付けで解放される）。次に押したときは、その時点の記録で作り直す
  const handleExport = async () => {
    // 開くときも閉じるときも、前の知らせ（共有できなかったときの「ファイルを保存」への案内など）を消す
    setNotice(null);
    if (prepared !== null) {
      setPrepared(null);
      return;
    }
    setBusy(true);
    try {
      const data = await store.exportData();
      setPrepared(prepareExportFile(JSON.stringify(data), exportFileName(new Date())));
    } catch (error) {
      setNotice({ kind: 'error', text: `書き出しに失敗しました（${describeError(error)}）` });
    }
    setBusy(false);
  };

  const handleShare = async (target: PreparedExport) => {
    setNotice(null);
    try {
      await shareExportFile(target);
    } catch {
      // 共有できなければ、ダウンロードのリンクに切り替える。
      // 前の prepared は effect の後片付けで URL が解放されるので、同じファイルから URL を作り直す
      setPrepared({ ...target, url: URL.createObjectURL(target.file), canShare: false });
      setNotice({
        kind: 'error',
        text: '共有できませんでした。「ファイルを保存」から保存してください',
      });
    }
  };

  const handleFileChange = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const input = changeEvent.currentTarget;
    const file = input.files?.[0];
    // 同じファイルをもう一度選んでも change が起きるように空にする
    input.value = '';
    if (file === undefined) {
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      setPendingImport(parseProgressJson(await file.text()));
    } catch (error) {
      setNotice({ kind: 'error', text: `読み込めませんでした（${describeError(error)}）` });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async (data: ProgressExport) => {
    setPendingImport(null);
    setBusy(true);
    try {
      await store.importData(data);
      setPrepared(null);
      setNotice({
        kind: 'info',
        text: `読み込みました（回答 ${data.attempts.length} 件・セッション ${data.sessions.length} 件）`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: `読み込みに失敗しました（${describeError(error)}）` });
    }
    setBusy(false);
  };

  const confirmReset = async () => {
    setConfirmingReset(false);
    setBusy(true);
    try {
      await store.reset();
      setPrepared(null);
      setNotice({ kind: 'info', text: '成績をリセットしました' });
    } catch (error) {
      setNotice({ kind: 'error', text: `リセットに失敗しました（${describeError(error)}）` });
    }
    setBusy(false);
  };

  return (
    <div className="screen records-screen">
      <ScreenHeader title="記録の管理" onBack={onBack} backDisabled={busy} />
      <main>
        <p className="hint">
          {deckNames.join('・')}の学習の記録を、まとめて書き出し・読み込み・リセットします。
        </p>
        <div className="card card-flat records">
          <button
            type="button"
            className="record-row"
            disabled={busy}
            aria-expanded={prepared !== null}
            aria-controls={prepared !== null ? exportPanelId : undefined}
            onClick={() => void handleExport()}
          >
            <ExportIcon className="record-icon" />
            書き出し
          </button>
          {prepared !== null && (
            <div id={exportPanelId} className="export-ready" data-testid="export-ready">
              <p className="export-ready-text">書き出しの準備ができました（{prepared.fileName}）</p>
              {prepared.canShare ? (
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => void handleShare(prepared)}
                >
                  共有して保存
                </button>
              ) : (
                <a className="button-primary" href={prepared.url} download={prepared.fileName}>
                  ファイルを保存
                </a>
              )}
            </div>
          )}
          <div className="record-divider" aria-hidden="true" />
          <button
            type="button"
            className="record-row"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImportIcon className="record-icon" />
            読み込み
          </button>
          <div className="record-divider" aria-hidden="true" />
          <button
            type="button"
            className="record-row danger"
            disabled={busy}
            onClick={() => setConfirmingReset(true)}
          >
            <TrashIcon className="record-icon" />
            リセット
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="import-file"
          onChange={(changeEvent) => void handleFileChange(changeEvent)}
        />
        {notice !== null && (
          <p
            className={notice.kind === 'error' ? 'error-text notice' : 'notice'}
            role={notice.kind === 'error' ? 'alert' : 'status'}
            data-testid="records-notice"
          >
            {notice.text}
          </p>
        )}
      </main>

      {pendingImport !== null && (
        <ConfirmDialog
          title="記録を読み込みますか？"
          confirmLabel="読み込む"
          cancelLabel="やめる"
          onConfirm={() => void confirmImport(pendingImport)}
          onCancel={() => setPendingImport(null)}
        >
          <p>
            この端末の、すべての教材の学習の記録（回答・履歴・出題設定）が消え、ファイルの内容（回答{' '}
            {pendingImport.attempts.length} 件・セッション {pendingImport.sessions.length}{' '}
            件）に置き換わります。
          </p>
        </ConfirmDialog>
      )}

      {confirmingReset && (
        <ConfirmDialog
          title="成績をリセットしますか？"
          confirmLabel="リセットする"
          cancelLabel="やめる"
          destructive
          onConfirm={() => void confirmReset()}
          onCancel={() => setConfirmingReset(false)}
        >
          <p>
            この端末の、すべての教材の学習の記録（回答・履歴・出題設定）が消えます。元に戻せません。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
