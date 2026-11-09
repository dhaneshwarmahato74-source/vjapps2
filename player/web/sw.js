/* Minimal service worker: makes the app installable ("Add to Home screen").
   Always goes to the network (the bridge is live), so nothing stale is ever served. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request));
});
