// service-worker.js: keeps a copy of the app on the phone so it opens with no internet.
// Phase 1: simple version. Uses the internet when it answers within 4 seconds, else the saved copy.
// Phase 4 adds the "new version, tap to update" button.
const VERSION = '0.2.1';
const CACHE = 'bigas-mantika-' + VERSION;

const FILES = [
  './', './index.html', './styles.css', './app.js', './ui.js', './db.js', './calc.js',
  './backup.js', './demo.js', './report.js', './assets/images/report-header.jpg',
  './assets/images/icon-192.png',
  './assets/images/empty-orders.jpg', './assets/images/empty-customers.jpg',
  './assets/images/mascot-bigas-isip.jpg', './assets/images/mascot-mantika-cheer.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bigas-mantika-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
