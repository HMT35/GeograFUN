/* ============================================================ */
/* GEOMETRY WORKER                                               */
/* Download + JSON.parse + quantizare în afara thread-ului       */
/* principal, ca pinch-zoom-ul să nu aștepte fișierele mari.     */
/* ============================================================ */
const CACHE = 'geografun-geometry-1.0';
const jobs = new Map();

async function cachedFetch(url, signal) {
  let cache = null;
  try {
    if (self.caches) {
      cache = await caches.open(CACHE);
      const hit = await cache.match(url);
      if (hit) return hit;
    }
  } catch (err) { cache = null; }
  const res = await fetch(url, { signal });
  if (res.ok && cache) {
    try { await cache.put(url, res.clone()); } catch (err) { /* cache plin: ignorăm */ }
  }
  return res;
}

/* Fixăm coordonatele pe o grilă și eliminăm punctele consecutive identice.
   Țările vecine au aceleași vârfuri pe graniță, deci se fixează identic:
   nu apar fante între poligoane, spre deosebire de simplificarea per poligon. */
function quantizeRing(ring, step, closed) {
  const out = [];
  let px = NaN, py = NaN;
  for (const p of ring) {
    const x = Math.round(p[0] / step) * step;
    const y = Math.round(p[1] / step) * step;
    if (x === px && y === py) continue;
    out.push([x, y]);
    px = x; py = y;
  }
  if (closed) {
    if (out.length && (out[0][0] !== px || out[0][1] !== py)) out.push([out[0][0], out[0][1]]);
    return out.length >= 4 ? out : null;
  }
  return out.length >= 2 ? out : null;
}

function quantizePolygon(rings, step) {
  const outer = quantizeRing(rings[0], step, true);
  if (!outer) return null;
  return [outer, ...rings.slice(1).map(r => quantizeRing(r, step, true)).filter(Boolean)];
}

function quantizeGeometry(g, step) {
  if (!g || !step) return g;
  switch (g.type) {
    case 'Polygon': {
      const p = quantizePolygon(g.coordinates, step);
      return p ? { type: 'Polygon', coordinates: p } : g;
    }
    case 'MultiPolygon': {
      const ps = g.coordinates.map(p => quantizePolygon(p, step)).filter(Boolean);
      return ps.length ? { type: 'MultiPolygon', coordinates: ps } : g;
    }
    case 'LineString': {
      const l = quantizeRing(g.coordinates, step, false);
      return l ? { type: 'LineString', coordinates: l } : g;
    }
    case 'MultiLineString': {
      const ls = g.coordinates.map(l => quantizeRing(l, step, false)).filter(Boolean);
      return ls.length ? { type: 'MultiLineString', coordinates: ls } : g;
    }
    case 'GeometryCollection':
      return { ...g, geometries: g.geometries.map(x => quantizeGeometry(x, step)) };
    default:
      return g;
  }
}

function quantizeFeature(f, step) {
  if (!step || !f) return f;
  if (f.type === 'FeatureCollection') return { ...f, features: f.features.map(x => quantizeFeature(x, step)) };
  if (f.type === 'Feature') return { ...f, geometry: quantizeGeometry(f.geometry, step) };
  return quantizeGeometry(f, step);
}

/* ---------- Fundal raster (OffscreenCanvas) ---------- */
/* Leaflet scalează tile-urile existente în timpul pinch-ului. Fișierele
   GeoJSON se citesc doar pentru țările care intersectează tile-ul cerut. */
const backgrounds = new Map();
const shapes = new Map();
const pendingShapes = new Map();
let activeFetches = 0;
const fetchQueue = [];
function fetchSlot() {
  if (activeFetches < 4) { activeFetches++; return Promise.resolve(); }
  return new Promise(resolve => fetchQueue.push(resolve));
}
function releaseSlot() {
  if (fetchQueue.length) fetchQueue.shift()();
  else activeFetches--;
}
async function shapeFor(url) {
  if (url && typeof url === 'object' && url.polygons) return url;
  if (shapes.has(url)) return shapes.get(url);
  if (pendingShapes.has(url)) return pendingShapes.get(url);
  const pending = (async () => {
    await fetchSlot();
    try {
      const res = await cachedFetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const feature = await res.json();
      const shape = prepareShape(feature);
      shapes.set(url, shape);
      return shape;
    } finally { releaseSlot(); pendingShapes.delete(url); }
  })();
  pendingShapes.set(url, pending);
  return pending;
}

function prepareShape(feature) {
  const polygons = polygonsOf(feature.geometry);
  return { feature, polygons, bounds: polygons.map(polygon => {
        let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (const [x, y] of polygon[0] || []) {
          w = Math.min(w, x); s = Math.min(s, y);
          e = Math.max(e, x); n = Math.max(n, y);
        }
        return [w, s, e, n];
      }) };
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(polygonsOf);
  return [];
}

const mercY = lat => {
  const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const latOf = y => 90 - 360 * Math.atan(Math.exp((y - 0.5) * 2 * Math.PI)) / Math.PI;

function tierFor(country, z) {
  if (country.shape) return country.shape;
  if (country.fixed) return country.files[country.fixed] || country.files.fast || country.files.simple;
  return (z >= 8 && country.files.detailed) || country.files.simple || country.files.fast;
}
function visible(box, west, south, east, north) {
  return box[2] >= west && box[0] <= east && box[3] >= south && box[1] <= north;
}
async function drawTile({ layer, z, x, y, size, dpr, style }) {
  const countries = backgrounds.get(layer);
  if (!countries) throw new Error(`Fundal necunoscut: ${layer}`);
  const n = 2 ** z;
  const wx = ((x % n) + n) % n;
  const world = size * n;
  const ox = wx * size, oy = y * size;
  const pad = 2 / world; // ~2 px în unități normalizate
  const west = (wx / n - pad) * 360 - 180, east = ((wx + 1) / n + pad) * 360 - 180;
  const north = latOf(y / n - pad), south = latOf((y + 1) / n + pad);
  const selected = countries.filter(country => visible(country.bounds, west, south, east, north));
  const loaded = await Promise.all(selected.map(async country => {
    try { return { country, shape: await shapeFor(tierFor(country, z)) }; }
    catch (err) { throw new Error(`Geometrie raster indisponibilă (${country.iso3}): ${err.message}`); }
  }));
  const canvas = new OffscreenCanvas(Math.round(size * dpr), Math.round(size * dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineJoin = 'round';
  ctx.lineWidth = style.weight;
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  for (const entry of loaded) {
    if (!entry) continue;
    const { country, shape } = entry;
    const { polygons } = shape;
    for (let p = 0; p < polygons.length; p++) {
      // Clip work to the viewport, including the tile's antialiasing margin.
      // Keep entire intersecting rings: clipping their vertices independently
      // would change shared borders and create visible seams.
      if (!visible(shape.bounds[p], west, south, east, north)) continue;
      const polygon = polygons[p];
      ctx.beginPath();
      for (const ring of polygon) {
        let previousX = NaN, previousY = NaN;
        for (let i = 0; i < ring.length; i++) {
          /* Grila globală garantează același pixel pentru granițele vecine.
             Nu modificăm coordonatele din `shape.polygons` pentru hit-test. */
          const px = Math.round((ring[i][0] + 180) / 360 * world * 2) / 2;
          const py = Math.round(mercY(ring[i][1]) * world * 2) / 2;
          if (px === previousX && py === previousY) continue;
          if (i) ctx.lineTo(px - ox, py - oy); else ctx.moveTo(px - ox, py - oy);
          previousX = px; previousY = py;
        }
        ctx.closePath();
      }
      ctx.globalAlpha = country.low ? 0.22 : (style.fillOpacity ?? 1);
      ctx.fill('evenodd');
      ctx.globalAlpha = country.low ? 0.35 : (style.opacity ?? 1);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return canvas.transferToImageBitmap();
}

function insideRing(ring, x, y) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) &&
        x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function insideShape(polygons, x, y) {
  for (const polygon of polygons) {
    if (!insideRing(polygon[0], x, y)) continue;
    if (!polygon.slice(1).some(ring => insideRing(ring, x, y))) return true;
  }
  return false;
}
async function hitTest({ layer, lng, lat, zoom }) {
  const countries = backgrounds.get(layer) || [];
  const candidates = countries.filter(c => c.gameId && visible(c.bounds, lng, lat, lng, lat))
    .sort((a, b) => (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) -
      (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]));
  for (const country of candidates) {
    try {
      const shape = await shapeFor(tierFor(country, zoom));
      if (insideShape(shape.polygons, lng, lat)) return country.gameId;
    } catch (err) { console.warn('[geometry-worker] hit-test:', err); }
  }
  return null;
}
async function outline({ layer, gameId, zoom }) {
  const country = (backgrounds.get(layer) || []).find(c => c.gameId === gameId);
  if (!country) return null;
  const shape = await shapeFor(tierFor(country, zoom));
  return shape.feature;
}

function reply(id, result, transfer) {
  self.postMessage({ id, result }, transfer || []);
}
function fail(id, err) {
  self.postMessage({ id, error: String((err && err.message) || err), name: err && err.name });
}

self.onmessage = async ({ data }) => {
  if (!data) return;
  if (data.type === 'abort') {
    const controller = jobs.get(data.id);
    if (controller) controller.abort();
    jobs.delete(data.id);
    return;
  }
  if (data.type === 'probe') {
    let ok = false;
    try {
      if (typeof OffscreenCanvas === 'function') {
        const canvas = new OffscreenCanvas(1, 1);
        if (canvas.getContext('2d') && typeof canvas.transferToImageBitmap === 'function') {
          const bitmap = canvas.transferToImageBitmap();
          bitmap.close();
          ok = true;
        }
      }
    }
    catch (err) { ok = false; }
    return reply(data.id, ok);
  }
  if (data.type === 'bg-init') {
    try {
      backgrounds.set(data.layer, data.countries.map(country => {
        if (!country.feature) return country;
        const shape = prepareShape(country.feature);
        const boxes = shape.bounds;
        if (!boxes.length) throw new Error(`Geometrie marină invalidă: ${country.iso3}`);
        return { ...country, shape, bounds: [
          Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
          Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))
        ] };
      }));
      reply(data.id, true);
    } catch (err) { fail(data.id, err); }
    return;
  }
  if (data.type === 'bg-drop') {
    backgrounds.delete(data.layer);
    return;
  }
  if (data.type === 'tile') {
    try {
      const bitmap = await drawTile(data);
      reply(data.id, bitmap, [bitmap]);
    } catch (err) { fail(data.id, err); }
    return;
  }
  if (data.type === 'hit') {
    try { reply(data.id, await hitTest(data)); } catch (err) { fail(data.id, err); }
    return;
  }
  if (data.type === 'outline') {
    try { reply(data.id, await outline(data)); } catch (err) { fail(data.id, err); }
    return;
  }
  if (data.type !== 'load') return;
  const controller = new AbortController();
  jobs.set(data.id, controller);
  try {
    const res = await cachedFetch(data.url, controller.signal);
    if (!res.ok) throw new Error(`${data.url}: ${res.status}`);
    const feature = quantizeFeature(await res.json(), data.quantize);
    if (!controller.signal.aborted) reply(data.id, feature);
  } catch (err) {
    if (!controller.signal.aborted) fail(data.id, err);
  } finally {
    jobs.delete(data.id);
  }
};

/* Export pentru testele Node (în browser `module` nu există). */
if (typeof module !== 'undefined') module.exports = { quantizeFeature, quantizeRing };
