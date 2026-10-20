/* ============================================================ */
/* SERVICE WORKER - suport offline PWA                           */
/* ============================================================ */
const STATIC_CACHE = 'geografun-static-v30';
// Change this only when the geometry changes. Never mix files from different versions.
const GEOMETRY_VERSION = '1.0';
const DATA_CACHE = `geografun-geometry-${GEOMETRY_VERSION}`;
const SOURCE_CACHE = 'geografun-sources-v1.0';
let geometryJob = null;
let foreground = 0;

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
  './js/geojson-tiles.js',
  './js/geometry-worker.js',
  './js/welcome.js',
  './js/menu.js',
  './js/map.js',
  './js/modes/registry.js',
  './js/modes/polygon-mode.js',
  './js/modes/point-mode.js',
  './js/modes/marine-mode.js',
  './js/modes/line-mode.js',
  './js/game.js',
  './js/scoring.js',
  './js/main.js',
  './assets/images/backgrounds/world-countries.jpg',
  './assets/images/backgrounds/europe-countries.jpg',
  './assets/images/backgrounds/europe-capitals.jpg',
  './assets/images/backgrounds/romania-counties.jpg',
  './assets/images/backgrounds/romania-capitals.jpg',
  './assets/images/backgrounds/romania-rivers.jpg',
  './assets/images/backgrounds/blur/world-countries.jpg',
  './assets/images/backgrounds/blur/europe-countries.jpg',
  './assets/images/backgrounds/blur/europe-capitals.jpg',
  './assets/images/backgrounds/blur/europe-marine.jpg',
  './assets/images/backgrounds/blur/romania-counties.jpg',
  './assets/images/backgrounds/blur/romania-capitals.jpg',
  './assets/images/backgrounds/blur/romania-rivers.jpg'
  // Imaginea europe-marine.jpg este intenționat goală până este înlocuită.
];

const MANIFEST = './assets/data/countries-enriched/manifest.json';
const COUNTY_SOURCE = './assets/data/raw/judete_export.json';

async function cacheResponse(cache, request) {
  const existing = await cache.match(request);
  if (existing) return existing;
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Date indisponibile: ${request.url || request}`);
  await cache.put(request, response.clone());
  return response;
}

async function precacheGeometry() {
  const cache = await caches.open(DATA_CACHE);
  const manifestResponse = await cacheResponse(cache, MANIFEST);
  const manifest = await manifestResponse.json();
  if (manifest.format !== 'country-geojson-v1' || manifest.version !== GEOMETRY_VERSION ||
      !Array.isArray(manifest.countries))
    throw new Error('Manifest geometrie invalid');
  const urls = [COUNTY_SOURCE, ...manifest.countries.flatMap(country =>
    ['fast', 'simple'].filter(tier => country[tier]).map(tier =>
      `./assets/data/countries-enriched/${country[tier].file}`))];
  // One background request at a time; foreground viewport fetches have priority.
  for (const url of urls) {
    while (foreground) await new Promise(resolve => setTimeout(resolve, 80));
    try { await cacheResponse(cache, url); }
    catch (err) {
      console.warn('[offline] Precaching interrupted at', url, err);
      return; // Next visit resumes from the first missing file.
    }
    // Give foreground fetch events a chance to enter the queue between downloads.
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  // Only after the entire replacement is available may old geometry be discarded.
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('geografun-geometry-') && name !== DATA_CACHE)
    .map(name => caches.delete(name)));
}

function startGeometryJob() {
  if (!geometryJob) geometryJob = precacheGeometry().catch(err => console.warn('[offline] geometry', err))
    .finally(() => { geometryJob = null; });
  return geometryJob;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.addAll(PRECACHE_URLS);

  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  const keep = [STATIC_CACHE, DATA_CACHE, SOURCE_CACHE];
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(n => keep.includes(n) || n.startsWith('geografun-geometry-')
        ? null : caches.delete(n)))
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

  /* Source data and geometry have separate, explicitly versioned caches. */
  if (url.pathname.includes('/assets/data/')) {
    const geometry = url.pathname.includes('/countries-enriched/') || url.pathname.endsWith('/judete_export.json');
    event.respondWith((async () => {
      const cache = await caches.open(geometry ? DATA_CACHE : SOURCE_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      foreground++;
      try { return await cacheResponse(cache, request); }
      finally { foreground--; }
    })());
    return;
  }

  /* Imaginea-card este încă goală; după înlocuire trebuie preluată din rețea. */
  if (url.pathname.endsWith('/assets/images/backgrounds/europe-marine.jpg')) {
    event.respondWith(fetch(request).then(async response => {
      if (response.ok && Number(response.headers.get('content-length')) > 0) {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => caches.match(request)));
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
  if (event.data === 'precache-geometry') event.waitUntil(startGeometryJob());
});
