// service-worker.js: keeps a full copy of the app on the phone so it opens with no internet.
//
// How updates work:
//  - Every app file and picture is saved in a cache named after the version below.
//  - When a new version is published, the phone downloads it in the background into a new cache.
//    The app then shows "New version ready. Tap to update." Nothing reloads by itself.
//  - Tapping it switches to the new version and removes the old copy.
// When you change ANY file in docs/, raise VERSION here and APP_VERSION in app.js (same number),
// and add any new file to FILES (tests/offline.test.js checks this).
const VERSION = '1.0.0';
const CACHE = 'bigas-mantika-' + VERSION;

const FILES = [
  './', './index.html', './manifest.json', './styles.css',
  './app.js', './ui.js', './db.js', './calc.js', './backup.js', './demo.js', './report.js', './game.js',
  './assets/images/icon-192.png', './assets/images/icon-512.png', './assets/images/icon-maskable-512.png',
  './assets/images/report-header.jpg',
  './assets/images/empty-orders.jpg', './assets/images/empty-customers.jpg',
  './assets/images/mascot-bigas-happy.jpg', './assets/images/mascot-bigas-cheer.jpg', './assets/images/mascot-bigas-isip.jpg',
  './assets/images/mascot-mantika-happy.jpg', './assets/images/mascot-mantika-cheer.jpg', './assets/images/mascot-mantika-isip.jpg',
  './assets/images/level-1.jpg', './assets/images/level-2.jpg', './assets/images/level-3.jpg',
  './assets/images/level-4.jpg', './assets/images/level-5.jpg',
  './assets/images/badge-unang-benta.jpg', './assets/images/badge-10-suki.jpg', './assets/images/badge-10k-benta.jpg',
  './assets/images/badge-stock-count.jpg', './assets/images/badge-zero-utang.jpg', './assets/images/badge-streak.jpg',
  './assets/images/badge-level-2.jpg', './assets/images/badge-level-3.jpg',
];

self.addEventListener('install', (e) => {
  // "reload" skips Chrome's normal download cache, so old and new files never get mixed.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  // No skipWaiting here: the new version waits until she taps "Tap to update".
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bigas-mantika-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Saved copy first (fast, and works with no signal). Anything not saved yet is fetched and kept.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
