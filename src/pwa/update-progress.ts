import type { RegistrationLike, WorkerLike } from './update-check';

export interface PrecacheProgress {
  done: number;
  total: number;
}

/** 取り込み中の worker から届いた進捗だけを保持する。 */
export function createUpdateProgressStore() {
  let progress: PrecacheProgress | null = null;
  let worker: WorkerLike | null = null;
  let detachWorker = () => {};
  const listeners = new Set<() => void>();

  function publish(value: PrecacheProgress | null) {
    progress = value;
    for (const listener of listeners) listener();
  }

  function trackWorker(next: WorkerLike | null) {
    if (next === null || next === worker) return;
    detachWorker();
    worker = next;
    publish(null);
    const handleStateChange = () => {
      if (next.state === 'redundant') {
        worker = null;
        detachWorker();
        publish(null);
      }
    };
    next.addEventListener('statechange', handleStateChange);
    detachWorker = () => next.removeEventListener('statechange', handleStateChange);
    handleStateChange();
  }

  return {
    getSnapshot: () => progress,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watchRegistration(registration: RegistrationLike) {
      registration.addEventListener('updatefound', () => trackWorker(registration.installing));
      trackWorker(registration.installing);
    },
    receive(data: unknown, source: unknown) {
      if (worker === null || source !== worker || worker.state === 'redundant') return;
      if (typeof data !== 'object' || data === null) return;
      const message = data as Record<string, unknown>;
      if (
        message.type !== 'PRECACHE_PROGRESS' ||
        typeof message.done !== 'number' ||
        !Number.isFinite(message.done) ||
        typeof message.total !== 'number' ||
        !Number.isFinite(message.total)
      )
        return;
      publish({ done: message.done, total: message.total });
    },
  };
}
