/* ============================================================ */
/* SERVICE WORKER - suport offline PWA                           */
/* ============================================================ */
const STATIC_CACHE = 'geografun-static-v12';
const DATA_CACHE = 'geografun-data-v12';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/welcome.css',
  './css/menu.css',
  './css/game.css',
  './css/score.css',
  './css/animations.css',
  './js/theme.js',
  './js/datasets.config.js',
  './js/data-loader.js',
  './js/welcome.js',
  './js/menu.js',
  './js/map.js',
  './js/pin.js',
  './js/modes/registry.js',
  './js/modes/polygon-mode.js',
  './js/modes/point-mode.js',
  './js/modes/line-mode.js',
  './js/game.js',
  './js/scoring.js',
  './js/main.js',
  './assets/images/backgrounds/europe-countries.jpg',
  './assets/images/backgrounds/europe-capitals.jpg',
  './assets/images/backgrounds/romania-counties.jpg',
  './assets/images/backgrounds/romania-capitals.jpg',
  './assets/images/backgrounds/romania-rivers.jpg'
];

/* Seturile de date brute Overpass + fundalul de harta */
const DATA_URLS = [
  './assets/data/raw/state_global_poligon.json',
  './assets/data/base/land.geojson',
  './assets/data/base/relief_ro.geojson',
  './assets/data/raw/judete_export.json',
  './assets/data/raw/rauri_export.json',
  './assets/data/raw/tari_export.json',
  './assets/data/raw/capitale_export.geojson',
  './assets/data/raw/resedinte_judet_export.geojson'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.addAll(PRECACHE_URLS);

    /* datele sunt mari: le punem in cache dar nu blocam instalarea daca esueaza */
    const dataCache = await caches.open(DATA_CACHE);
    await Promise.allSettled(DATA_URLS.map(u => dataCache.add(u)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  const keep = [STATIC_CACHE, DATA_CACHE];
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(n => keep.includes(n) ? null : caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* CDN (Leaflet, GSAP, tiles): network-first cu fallback pe cache */
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (!res || !res.ok) return res;
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  /* Seturi de date: cache-first (nu se schimba) */
  if (url.pathname.includes('/assets/data/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (!res || !res.ok) return res;
        const copy = res.clone();
        caches.open(DATA_CACHE).then(c => c.put(request, copy));
        return res;
      }))
    );
    return;
  }

  /* Restul aplicatiei: cache-first */
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const copy = res.clone();
        caches.open(STATIC_CACHE).then(c => c.put(request, copy));
        return res;
      });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
