// Service worker: zorgt dat de app ook zonder internet opent.
// Netwerk eerst (zodat je altijd de nieuwste versie krijgt), cache als terugval.
const CACHE = 'freaking-comics-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/model.js',
  './js/store.js',
  './js/ui.js',
  './js/actions.js',
  './js/api.js',
  './js/sync.js',
  './js/views/metron.js',
  './js/views/route.js',
  './js/views/home.js',
  './js/views/lists.js',
  './js/views/detail.js',
  './js/views/forms.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isCover = url.hostname === 'static.metron.cloud';
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return; // server nooit uit de cache
  if (url.origin !== self.location.origin && !isFont && !isCover) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
