// Офлайн ажиллагаа: аппын файлууд ба газрын зургийн хэсгүүдийг утсанд хадгална.
const VERSION = 'v1.2.8';
const SHELL = 'shell-' + VERSION;
const TILES = 'tiles-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/content.js', 'js/db.js', 'js/export.js', 'js/geo.js', 'js/gps.js', 'js/model.js', 'js/sync.js', 'js/ui.js',
  'js/vendor/leaflet.js', 'js/vendor/leaflet.css', 'js/vendor/xlsx.core.min.js', 'js/vendor/jszip.min.js',
  'js/vendor/images/layers.png', 'js/vendor/images/layers-2x.png', 'js/vendor/images/marker-icon.png', 'js/vendor/images/marker-icon-2x.png',
  'data/transects-2026.json', 'data/species.json',
  'img/icon-192.png', 'img/icon-512.png', 'img/brcc.png', 'img/wwf.png', 'img/transect-map.jpg', 'img/method.png', 'img/method-rot.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'server.arcgisonline.com') {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req.url, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
    return res;
  })));
});
