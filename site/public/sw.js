// The app's service worker used to live here, controlling the whole site. It's at
// /app/sw.js now (see vite.config.ts); browsers that still have the old one get this
// instead, which removes it and its cache, so the landing and privacy pages load
// from the network. The app's own data (IndexedDB, localStorage) is untouched.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Workbox names its caches after the scope: only this (root) scope's.
      const scope = self.registration.scope;
      for (const key of await caches.keys()) if (key.endsWith(scope)) await caches.delete(key);
      await self.registration.unregister();
    })(),
  );
});
