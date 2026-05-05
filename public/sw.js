const VERSION = 'ward-v1.33.0';
const SHELL = ['/ward-helper/', '/ward-helper/index.html', '/ward-helper/install-promo.js', '/ward-helper/install-promo-config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin && e.request.method === 'GET') {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
