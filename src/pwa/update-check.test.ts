import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  type RegistrationLike,
  type UpdateCheckOptions,
  type WorkerLike,
} from './update-check';

class FakeWorker implements WorkerLike {
  private readonly listeners = new Set<() => void>();

  constructor(public state: ServiceWorkerState) {}

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** 状態を変えて statechange を送る。 */
  changeState(state: ServiceWorkerState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  readonly update = vi.fn<() => Promise<unknown>>(() => Promise.resolve(undefined));
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'updatefound', listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** 新しい worker が見つかったとき（installing に入れて updatefound を送る）。 */
  findWorker(worker: FakeWorker): void {
    this.installing = worker;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

const CONTROLLED = { controller: {} };
const UNCONTROLLED = { controller: null };

function setup(overrides: Partial<UpdateCheckOptions> = {}) {
  const registration = new FakeRegistration();
  const apply = vi.fn();
  const onInstalling = vi.fn();
  const options: UpdateCheckOptions = {
    available: false,
    takenOverByNewWorker: false,
    serviceWorker: CONTROLLED,
    getRegistration: () => Promise.resolve(registration),
    apply,
    onInstalling,
    ...overrides,
  };
  return { registration, apply, onInstalling, options };
}

/** 待っている Promise の続きを進める。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('checkForUpdate', () => {
  it('新しい版が無ければ「最新の版です」（切り替えない）', async () => {
    const { registration, apply, onInstalling, options } = setup();

    await expect(checkForUpdate(options)).resolves.toBe('latest');
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(onInstalling).not.toHaveBeenCalled();
    expect(registration.listenerCount).toBe(0);
  });

  it('update() の後に installing があれば、installed になるのを待って切り替える', async () => {
    const { registration, apply, onInstalling, options } = setup();
    const worker = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      registration.findWorker(worker);
      return Promise.resolve(undefined);
    });

    const result = checkForUpdate(options);
    await flush();
    expect(onInstalling).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    registration.installing = null;
    registration.waiting = worker;
    worker.changeState('installed');
    await expect(result).resolves.toBe('applied');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(worker.listenerCount).toBe(0);
  });

  it('installing の worker が redundant になったら失敗（切り替えない）', async () => {
    const { registration, apply, onInstalling, options } = setup();
    const worker = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      registration.findWorker(worker);
      return Promise.resolve(undefined);
    });

    const result = checkForUpdate(options);
    await flush();
    expect(onInstalling).toHaveBeenCalledTimes(1);

    registration.installing = null;
    worker.changeState('redundant');
    await expect(result).resolves.toBe('failed');
    expect(apply).not.toHaveBeenCalled();
    expect(worker.listenerCount).toBe(0);
  });

  it('update() の後に waiting があれば、すぐ切り替える', async () => {
    const { registration, apply, onInstalling, options } = setup();
    registration.waiting = new FakeWorker('installed');

    await expect(checkForUpdate(options)).resolves.toBe('applied');
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onInstalling).not.toHaveBeenCalled();
  });

  it('update() が例外を投げたら失敗（通信できないときなど）', async () => {
    const { registration, apply, options } = setup();
    registration.update.mockRejectedValue(new TypeError('Load failed'));

    await expect(checkForUpdate(options)).resolves.toBe('failed');
    expect(apply).not.toHaveBeenCalled();
    expect(registration.listenerCount).toBe(0);
  });

  it('Service Worker の登録が得られなければ失敗', async () => {
    const { apply, options } = setup({ getRegistration: () => Promise.resolve(undefined) });

    await expect(checkForUpdate(options)).resolves.toBe('failed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('Service Worker の登録を得るときに例外が出たら失敗', async () => {
    const { apply, options } = setup({
      getRegistration: () => Promise.reject(new Error('registration failed')),
    });

    await expect(checkForUpdate(options)).resolves.toBe('failed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('Service Worker が使えなければ失敗', async () => {
    const getRegistration = vi.fn(() => Promise.resolve(new FakeRegistration()));
    const { apply, options } = setup({ serviceWorker: undefined, getRegistration });

    await expect(checkForUpdate(options)).resolves.toBe('failed');
    expect(getRegistration).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('帯が出ている（新しい版を読み込み済み）ときは、update() を呼ばずに切り替える', async () => {
    const { registration, apply, options } = setup({ available: true });

    await expect(checkForUpdate(options)).resolves.toBe('applied');
    expect(registration.update).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('別の画面が更新を適用済み（takenOverByNewWorker）なら、update() を呼ばずに切り替える', async () => {
    const { registration, apply, options } = setup({ takenOverByNewWorker: true });

    await expect(checkForUpdate(options)).resolves.toBe('applied');
    expect(registration.update).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('制御下に無いページで installing が見つかっても「最新の版です」（初回の導入なので切り替えない）', async () => {
    const { registration, apply, onInstalling, options } = setup({ serviceWorker: UNCONTROLLED });
    registration.update.mockImplementation(() => {
      registration.findWorker(new FakeWorker('installing'));
      return Promise.resolve(undefined);
    });

    await expect(checkForUpdate(options)).resolves.toBe('latest');
    expect(apply).not.toHaveBeenCalled();
    expect(onInstalling).not.toHaveBeenCalled();
  });

  it('制御下に無いページで update() が例外を投げたら失敗', async () => {
    const { registration, apply, options } = setup({ serviceWorker: UNCONTROLLED });
    registration.update.mockRejectedValue(new TypeError('Load failed'));

    await expect(checkForUpdate(options)).resolves.toBe('failed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('update() の解決より前に見つかった worker が installed になっていれば切り替える', async () => {
    const { registration, apply, onInstalling, options } = setup();
    const worker = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      registration.findWorker(worker);
      // 解決の時点では installing から外れ、waiting にも入っていない（ほかの画面がすでに有効にした）
      registration.installing = null;
      worker.changeState('activated');
      return Promise.resolve(undefined);
    });

    await expect(checkForUpdate(options)).resolves.toBe('applied');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onInstalling).not.toHaveBeenCalled();
  });

  it('update() の解決より前に見つかった worker が redundant になっていれば失敗', async () => {
    const { registration, apply, options } = setup();
    const worker = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      registration.findWorker(worker);
      registration.installing = null;
      worker.changeState('redundant');
      return Promise.resolve(undefined);
    });

    await expect(checkForUpdate(options)).resolves.toBe('failed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('update() の解決の後に updatefound が来ても、解決の時点の installing を待つ', async () => {
    const { registration, apply, options } = setup();
    const worker = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      // installing は解決の前に入り、updatefound は解決の後に来る
      registration.installing = worker;
      setTimeout(() => registration.findWorker(worker), 0);
      return Promise.resolve(undefined);
    });

    const result = checkForUpdate(options);
    await flush();
    worker.changeState('installed');
    await expect(result).resolves.toBe('applied');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('読み込みを待つ間に中断したら切り替えない', async () => {
    const { registration, apply, options } = setup();
    const controller = new AbortController();
    const worker = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      registration.findWorker(worker);
      return Promise.resolve(undefined);
    });

    const result = checkForUpdate({ ...options, signal: controller.signal });
    await flush();
    controller.abort();
    await expect(result).resolves.toBe('aborted');
    worker.changeState('installed');
    expect(apply).not.toHaveBeenCalled();
    expect(worker.listenerCount).toBe(0);
  });

  it('update() の間に中断したら、waiting があっても切り替えない', async () => {
    const { registration, apply, options } = setup();
    const controller = new AbortController();
    registration.update.mockImplementation(() => {
      registration.waiting = new FakeWorker('installed');
      controller.abort();
      return Promise.resolve(undefined);
    });

    await expect(checkForUpdate({ ...options, signal: controller.signal })).resolves.toBe(
      'aborted',
    );
    expect(apply).not.toHaveBeenCalled();
  });
});
