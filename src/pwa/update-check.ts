/**
 * ホーム画面の「アプリを更新」を押したときの判定（設計書 6.6 節）。
 * window や navigator には触れず、Service Worker の登録などを引数で受け取る（テストで偽物を渡せるように）。
 */

/** 判定に使う ServiceWorker の一部。 */
export interface WorkerLike {
  readonly state: ServiceWorkerState;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

/** 判定に使う ServiceWorkerRegistration の一部。 */
export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: () => void): void;
  removeEventListener(type: 'updatefound', listener: () => void): void;
}

/** 判定に使う navigator.serviceWorker の一部。 */
export interface ServiceWorkerContainerLike {
  /** このページを制御している Service Worker。制御下に無いときは null。 */
  readonly controller: object | null;
}

/** 画面から渡すもの。 */
export interface UpdateCheckCallbacks {
  /** 新しい版の読み込み（install）を待ち始めたときに呼ぶ。 */
  onInstalling?: () => void;
  /** 中断の合図（ホーム画面を離れたときなど）。中断したら切り替えない。 */
  signal?: AbortSignal;
}

export interface UpdateCheckOptions extends UpdateCheckCallbacks {
  /** 新しい版を読み込み済みで、ホーム画面に帯が出ているか（useRegisterSW の needRefresh）。 */
  available: boolean;
  /** 別の画面が更新を適用し、新しい Service Worker がこの画面も制御しているか。 */
  takenOverByNewWorker: boolean;
  /** navigator.serviceWorker。Service Worker が使えないときは undefined。 */
  serviceWorker: ServiceWorkerContainerLike | undefined;
  /** Service Worker の登録を得る。得られないときは null か undefined。 */
  getRegistration: () => Promise<RegistrationLike | null | undefined>;
  /** 新しい版に切り替える（帯の「更新」と同じ動き）。 */
  apply: () => void;
}

/**
 * 判定の結果。
 * - applied: 新しい版への切り替えを始めた（apply を呼んだ）
 * - latest: 新しい版は無い
 * - failed: 通信できない、新しい版の読み込みに失敗した、Service Worker が使えない
 * - aborted: 途中で中断した（切り替えていない）
 */
export type UpdateCheckResult = 'applied' | 'latest' | 'failed' | 'aborted';

/** worker の状態から見た install の結果。まだ決まらない（parsed・installing）ときは null。 */
function installOutcome(state: ServiceWorkerState): 'installed' | 'redundant' | null {
  switch (state) {
    case 'installed':
    case 'activating':
    case 'activated':
      return 'installed';
    case 'redundant':
      return 'redundant';
    default:
      return null;
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** worker の install が終わる（installed 以降になる）か、失敗する（redundant になる）か、中断するまで待つ。 */
function waitForInstall(
  worker: WorkerLike,
  signal: AbortSignal | undefined,
): Promise<'installed' | 'redundant' | 'aborted'> {
  return new Promise((resolve) => {
    const finish = (outcome: 'installed' | 'redundant' | 'aborted') => {
      worker.removeEventListener('statechange', handleStateChange);
      signal?.removeEventListener('abort', handleAbort);
      resolve(outcome);
    };
    const handleStateChange = () => {
      const outcome = installOutcome(worker.state);
      if (outcome !== null) {
        finish(outcome);
      }
    };
    const handleAbort = () => finish('aborted');
    worker.addEventListener('statechange', handleStateChange);
    signal?.addEventListener('abort', handleAbort);
    if (isAborted(signal)) {
      handleAbort();
    }
  });
}

/**
 * 通信して新しい版を探し、あれば読み込みを待って切り替える（設計書 6.6 節）。
 * 切り替えは options.apply（帯の「更新」と同じ動き）に任せる。
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const { serviceWorker, signal } = options;

  // 新しい版を読み込み済み、または別の画面が適用済みなら、通信せずに切り替える
  if (options.available || options.takenOverByNewWorker) {
    options.apply();
    return 'applied';
  }
  if (serviceWorker === undefined) {
    return 'failed';
  }

  let registration: RegistrationLike | null | undefined;
  try {
    registration = await options.getRegistration();
  } catch {
    return 'failed';
  }
  if (registration === null || registration === undefined) {
    return 'failed';
  }

  // update() の解決より前に updatefound が来て、解決の時点で worker が installing から
  // 外れている（installed や redundant になった）場合に備え、見つかった worker も覚えておく
  const reg = registration;
  let foundWorker: WorkerLike | null = null;
  const handleUpdateFound = () => {
    foundWorker = reg.installing ?? foundWorker;
  };
  reg.addEventListener('updatefound', handleUpdateFound);
  try {
    await reg.update();
  } catch {
    // 通信できないときなど
    return 'failed';
  } finally {
    reg.removeEventListener('updatefound', handleUpdateFound);
  }
  if (isAborted(signal)) {
    return 'aborted';
  }

  // 制御下に無いページ（初めて開いたとき）はネットワークから読み込んだ版で動いているので、
  // 見つかった worker は初回の導入であって更新ではない
  if (serviceWorker.controller === null) {
    return 'latest';
  }

  if (reg.waiting !== null) {
    options.apply();
    return 'applied';
  }

  const worker: WorkerLike | null = reg.installing ?? foundWorker;
  if (worker === null) {
    return 'latest';
  }

  let outcome: 'installed' | 'redundant' | 'aborted' | null = installOutcome(worker.state);
  if (outcome === null) {
    options.onInstalling?.();
    outcome = await waitForInstall(worker, signal);
  }
  if (outcome === 'redundant') {
    return 'failed';
  }
  if (outcome === 'aborted' || isAborted(signal)) {
    return 'aborted';
  }
  options.apply();
  return 'applied';
}
