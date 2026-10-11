import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { formatLocalDate, formatLocalDateTime } from '../../core/date';
import type { Event } from '../../core/models';
import {
  accuracyOf,
  describeSession,
  formatAccuracy,
  isInterrupted,
  PATTERN_LABELS,
  sortEventRows,
  summarizeStats,
  type EventSortOrder,
} from '../../core/stats';
import { formatEventYear } from '../../core/year';
import type { ProgressStore } from '../../storage/progress-store';
import { exportFileName, parseProgressJson, type ProgressExport } from '../../storage/transfer';
import { Bar } from '../components/Bar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  prepareExportFile,
  releaseExportFile,
  shareExportFile,
  type PreparedExport,
} from '../export-file';

const SORT_OPTIONS: { value: EventSortOrder; label: string }[] = [
  { value: 'accuracy', label: '正答率の低い順' },
  { value: 'attempts', label: '回答数の多い順' },
  { value: 'recent', label: '最終回答日の新しい順' },
];

interface StatsProps {
  store: ProgressStore;
  /** 出題の母集団（成績は「出題する出来事」の設定によらず母集団全体を対象にする）。 */
  population: readonly Event[];
  onBack: () => void;
}

/** 操作の結果の知らせ。 */
interface Notice {
  kind: 'info' | 'error';
  text: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message !== '' ? error.message : error.name;
  }
  return String(error);
}

/**
 * 成績の画面（設計書 8 章）。全体・時代別・出来事別・履歴の 4 区分と、書き出し・読み込み・リセットの操作。
 * 集計は ProgressStore の状態からその場で行う（起動後の回答も反映される）。
 */
export function Stats({ store, population, onBack }: StatsProps) {
  // 集計の基準の時刻。読み込みやリセットの後に更新して、集計をやり直す
  const [now, setNow] = useState(() => new Date());
  const [sortOrder, setSortOrder] = useState<EventSortOrder>('accuracy');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [pendingImport, setPendingImport] = useState<ProgressExport | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 書き出しの Blob の URL は、作り直したときと画面を離れたときに解放する
  useEffect(() => {
    if (prepared === null) {
      return undefined;
    }
    return () => releaseExportFile(prepared);
  }, [prepared]);

  const summary = summarizeStats({
    population,
    stats: store.listEventStats(),
    sessions: store.listSessions(),
    studyDays: store.getStudyDays(),
    now,
  });
  const rows = sortEventRows(summary.events, sortOrder);

  const toggleRow = (eventId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const handleExport = async () => {
    setBusy(true);
    setNotice(null);
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
      // 共有できなければ、ダウンロードのリンクに切り替える
      setPrepared({ ...target, canShare: false });
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
    try {
      setPendingImport(parseProgressJson(await file.text()));
    } catch (error) {
      setNotice({ kind: 'error', text: `読み込めませんでした（${describeError(error)}）` });
    }
  };

  const confirmImport = async (data: ProgressExport) => {
    setPendingImport(null);
    setBusy(true);
    try {
      await store.importData(data);
      setPrepared(null);
      setExpanded(new Set());
      setNotice({
        kind: 'info',
        text: `読み込みました（回答 ${data.attempts.length} 件・セッション ${data.sessions.length} 件）`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: `読み込みに失敗しました（${describeError(error)}）` });
    }
    setBusy(false);
    setNow(new Date());
  };

  const confirmReset = async () => {
    setConfirmingReset(false);
    setBusy(true);
    try {
      await store.reset();
      setPrepared(null);
      setExpanded(new Set());
      setNotice({ kind: 'info', text: '成績をリセットしました' });
    } catch (error) {
      setNotice({ kind: 'error', text: `リセットに失敗しました（${describeError(error)}）` });
    }
    setBusy(false);
    setNow(new Date());
  };

  const { overall, eras, history } = summary;

  return (
    <div className="screen">
      <header className="screen-header">
        <button type="button" className="button-text" onClick={onBack}>
          ‹ 戻る
        </button>
        <h1 className="screen-title">成績</h1>
      </header>

      <main className="stats">
        <section className="stats-section" aria-labelledby="stats-overall">
          <h2 id="stats-overall" className="section-title">
            全体
          </h2>
          <dl className="overall">
            <div className="overall-item">
              <dt>総回答数</dt>
              <dd data-testid="overall-attempts">{overall.attempts} 回</dd>
            </div>
            <div className="overall-item">
              <dt>正答率</dt>
              <dd data-testid="overall-accuracy">{formatAccuracy(overall)}</dd>
            </div>
            <div className="overall-item">
              <dt>連続学習日数</dt>
              <dd data-testid="overall-streak">{overall.streakDays} 日</dd>
            </div>
          </dl>
        </section>

        {/* 出来事別の一覧が長いので、記録の管理は上に置く */}
        <section className="stats-section" aria-labelledby="stats-transfer">
          <h2 id="stats-transfer" className="section-title">
            記録の管理
          </h2>
          <div className="stats-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => void handleExport()}
            >
              書き出し
            </button>
            {prepared !== null && (
              <div className="export-ready" data-testid="export-ready">
                <p className="export-ready-text">
                  書き出しの準備ができました（{prepared.fileName}）
                </p>
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
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              読み込み
            </button>
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
            <button
              type="button"
              className="button-secondary button-danger"
              disabled={busy}
              onClick={() => setConfirmingReset(true)}
            >
              リセット
            </button>
          </div>
          {notice !== null && (
            <p
              className={notice.kind === 'error' ? 'error-text notice' : 'notice'}
              role={notice.kind === 'error' ? 'alert' : 'status'}
              data-testid="stats-notice"
            >
              {notice.text}
            </p>
          )}
        </section>

        <section className="stats-section" aria-labelledby="stats-eras">
          <h2 id="stats-eras" className="section-title">
            時代別
          </h2>
          <ul className="era-list">
            {eras.map((era) => (
              <li key={era.era} className="era-row" data-testid="era-row">
                <span className="era-name">{era.era}</span>
                <Bar ratio={accuracyOf(era)} />
                <span className="era-figure">
                  {era.attempts === 0 ? '未回答' : `${formatAccuracy(era)}（${era.attempts} 回）`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="stats-section" aria-labelledby="stats-events">
          <h2 id="stats-events" className="section-title">
            出来事別
          </h2>
          <fieldset className="field">
            <legend className="field-legend field-legend-small">並べ替え</legend>
            <div className="options options-fit">
              {SORT_OPTIONS.map((option) => (
                <label key={option.value} className="option">
                  <input
                    type="radio"
                    name="event-sort"
                    checked={sortOrder === option.value}
                    onChange={() => setSortOrder(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ul className="event-list">
            {rows.map((row) => {
              const open = expanded.has(row.event.id);
              return (
                <li key={row.event.id} className="event-item" data-testid="event-row">
                  <button
                    type="button"
                    className="event-row"
                    aria-expanded={open}
                    onClick={() => toggleRow(row.event.id)}
                  >
                    <span className="event-row-main">
                      <span className="event-row-title">{row.event.title}</span>
                      <span className="event-row-year">{formatEventYear(row.event)}</span>
                    </span>
                    <span className="event-row-figures">
                      <span className="event-row-accuracy">{formatAccuracy(row)}</span>
                      {row.lastAnsweredAt !== null && (
                        <span className="event-row-sub">
                          {row.attempts} 回・{formatLocalDate(new Date(row.lastAnsweredAt))}
                        </span>
                      )}
                    </span>
                  </button>
                  {open && (
                    <ul className="breakdown" data-testid="breakdown">
                      {row.patterns.length === 0 ? (
                        <li className="breakdown-item">まだ回答していません</li>
                      ) : (
                        row.patterns.map((pattern) => (
                          <li key={pattern.pattern} className="breakdown-item">
                            <span className="breakdown-name">
                              {PATTERN_LABELS[pattern.pattern]}
                            </span>
                            <span>
                              {formatAccuracy(pattern)}（{pattern.correct} / {pattern.attempts}）・
                              {formatLocalDate(new Date(pattern.lastAnsweredAt))}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="stats-section" aria-labelledby="stats-history">
          <h2 id="stats-history" className="section-title">
            履歴
          </h2>
          <p className="hint">右の数字は 正答数 / 回答済み数</p>
          {history.length === 0 ? (
            <p className="status-text" data-testid="history-empty">
              ありません
            </p>
          ) : (
            <ul className="history-list">
              {history.map((session) => (
                <li key={session.id} className="history-item" data-testid="history-item">
                  <div className="history-head">
                    <span className="history-date">
                      {formatLocalDateTime(new Date(session.startedAt))}
                    </span>
                    <span className="history-score">
                      {session.correct} / {session.answered}
                    </span>
                  </div>
                  <p className="history-meta">
                    <span>{describeSession(session)}</span>
                    {isInterrupted(session) && <span className="history-badge">中断</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
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
            この端末の学習の記録（回答・履歴・出題設定）はすべて消え、ファイルの内容（回答{' '}
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
          onConfirm={() => void confirmReset()}
          onCancel={() => setConfirmingReset(false)}
        >
          <p>この端末の学習の記録（回答・履歴・出題設定）がすべて消えます。元に戻せません。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
