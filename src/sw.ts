/// <reference lib="webworker" />
import { cacheNames } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  PrecacheController,
  PrecacheRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { countUncachedFiles } from './pwa/precache-progress';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

let done = 0;
let total = 0;

async function notifyProgress(): Promise<void> {
  try {
    const message = { type: 'PRECACHE_PROGRESS', done, total };
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) client.postMessage(message);
  } catch {
    // 進み具合は表示の補助なので、知らせの失敗で取り込みを止めない。
  }
}

const controller = new PrecacheController({
  plugins: [
    {
      async cacheDidUpdate() {
        done += 1;
        await notifyProgress();
      },
    },
  ],
});
controller.addToCacheList(self.__WB_MANIFEST);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheNames.precache);
      total = countUncachedFiles(
        controller.getURLsToCacheKeys().values(),
        new Set((await cache.keys()).map((request) => request.url)),
      );
      done = 0;
      await notifyProgress();
      await controller.install(event);
      done = total;
      await notifyProgress();
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(controller.activate(event));
});
cleanupOutdatedCaches();
registerRoute(new PrecacheRoute(controller));
registerRoute(new NavigationRoute(controller.createHandlerBoundToURL('index.html')));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
