import { describe, expect, it, vi } from 'vitest';
import { createUpdateProgressStore } from './update-progress';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  changeState(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting = null;
  update = async () => {};
  find(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
  }
}
const message = { type: 'PRECACHE_PROGRESS', done: 2, total: 5 };

function setup(initial = false) {
  const store = createUpdateProgressStore();
  const registration = new FakeRegistration();
  const worker = new FakeWorker();
  if (initial) registration.installing = worker;
  store.watchRegistration(registration);
  if (!initial) registration.find(worker);
  return { store, registration, worker };
}

describe('更新の進み具合', () => {
  it('登録時に既に取り込み中でも進捗を受信し、購読先へ通知する', () => {
    const { store, worker } = setup(true);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot()).toBeNull();
    store.receive(message, worker);
    expect(store.getSnapshot()).toEqual({ done: 2, total: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.receive({ ...message, done: 3 }, worker);
    expect(store.getSnapshot()).toEqual({ done: 3, total: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { ...message, type: 'OTHER' },
    { ...message, done: '2' },
    { ...message, total: null },
    { ...message, done: NaN },
    { ...message, total: Infinity },
  ])('不正な message は無視する: %j', (data) => {
    const { store, worker } = setup();
    store.receive(message, worker);
    const previous = store.getSnapshot();
    store.receive(data, worker);
    expect(store.getSnapshot()).toBe(previous);
  });
  it('別の worker の知らせを無視する', () => {
    const { store } = setup();
    store.receive(message, new FakeWorker());
    expect(store.getSnapshot()).toBeNull();
  });
  it('redundant になったら消し、遅れて届いた知らせも無視する', () => {
    const { store, worker } = setup();
    store.receive(message, worker);
    worker.changeState('redundant');
    expect(store.getSnapshot()).toBeNull();
    store.receive(message, worker);
    expect(store.getSnapshot()).toBeNull();
  });
  it('updatefound で初期化し、古い worker の状態や知らせに影響されない', () => {
    const { store, registration, worker } = setup();
    store.receive(message, worker);
    const next = new FakeWorker();
    registration.find(next);
    expect(store.getSnapshot()).toBeNull();
    store.receive({ ...message, done: 1 }, next);
    worker.changeState('redundant');
    store.receive(message, worker);
    expect(store.getSnapshot()).toEqual({ done: 1, total: 5 });
  });
  it('完了の知らせと total が 0 の知らせも保持する', () => {
    const { store, worker } = setup();
    store.receive({ ...message, done: 5 }, worker);
    worker.changeState('installed');
    expect(store.getSnapshot()).toEqual({ done: 5, total: 5 });
    store.receive({ ...message, done: 0, total: 0 }, worker);
    expect(store.getSnapshot()).toEqual({ done: 0, total: 0 });
  });
});
