/* ============================================================ */
/* DATA LOADER                                                   */
/* Fetch fisiere brute Overpass -> normalizare client-side.      */
/* Cache: IndexedDB (raw GeoJSON) + memorie (dataset normalizat) */
/* ============================================================ */
const DataLoader = {

  memCache: {},   // gameId -> dataset normalizat
  rawCache: {},   // sourceKey -> FeatureCollection brut

  /* ---------- IndexedDB ---------- */
  DB_NAME: 'geografun',
  DB_VERSION: 1,
  STORE: 'raw',
  _db: null,
  CACHE_VERSION: 2,
  FETCH_TIMEOUT: 12000,
  RETRIES: 2,

  error(code, message, details = {}) {
    const err = new Error(message);
    err.code = code;
    Object.assign(err, details);
    return err;
  },

  openDB() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE);
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => {
        console.warn('[DataLoader] IndexedDB indisponibil:', req.error);
        resolve(null);
      };
    });
  },

  async idbGet(key) {
    const db = await this.openDB();
    if (!db) return null;
    return new Promise(resolve => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => {
        console.warn('[DataLoader] IndexedDB read failed:', key, req.error);
        resolve(null);
      };
    });
  },

  async idbPut(key, value) {
    const db = await this.openDB();
    if (!db) return;
    return new Promise(resolve => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[DataLoader] IndexedDB write failed:', key, tx.error);
        resolve();
      };
    });
  },

  /* ---------- Fetch sursa bruta ---------- */
  async loadSource(sourceKey, options = {}) {
    if (this.rawCache[sourceKey]) return this.rawCache[sourceKey];

    const cacheKey = `${this.CACHE_VERSION}:${sourceKey}`;
    const cached = await this.idbGet(cacheKey);
    if (cached && this.isFeatureCollection(cached)) {
      this.rawCache[sourceKey] = cached.data || cached;
      return this.rawCache[sourceKey];
    }

    const url = DatasetsConfig.sources[sourceKey];
    if (!url) throw this.error('SOURCE_NOT_CONFIGURED', `Sursa necunoscuta: ${sourceKey}`, { sourceKey });

    let lastError;
    for (let attempt = 0; attempt <= this.RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || this.FETCH_TIMEOUT);
        const res = await fetch(url, { signal: options.signal || controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw this.error(res.status === 404 ? 'SOURCE_NOT_FOUND' : 'HTTP_ERROR', `Nu am putut incarca ${url} (${res.status})`, { url, status: res.status });
        let json;
        try { json = await res.json(); } catch (e) { throw this.error('INVALID_JSON', `Răspuns JSON invalid pentru ${url}`, { url, cause: e }); }
        this.validateFeatureCollection(json, sourceKey);
        this.rawCache[sourceKey] = json;
        await this.idbPut(cacheKey, { version: this.CACHE_VERSION, url, savedAt: Date.now(), data: json });
        return json;
      } catch (e) {
        lastError = e.name === 'AbortError'
          ? this.error('TIMEOUT', `Încărcarea a expirat pentru ${url}`, { url }) : e;
        if (lastError.code === 'SOURCE_NOT_FOUND' || lastError.code === 'INVALID_JSON' || lastError.code === 'DATASET_INVALID') break;
        if (attempt < this.RETRIES) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  },

  /* ---------- Public API ---------- */
  async loadGameData(gameId, options = {}) {
    if (this.memCache[gameId]) return this.memCache[gameId];

    const cfg = DatasetsConfig.get(gameId);
    if (!cfg) throw this.error('DATASET_NOT_CONFIGURED', `Dataset neconfigurat: ${gameId}`, { gameId });

    const raw = await this.loadSource(cfg.source, options);
    const dataset = this.normalize(raw, cfg, gameId);

    if (!dataset.items.length) throw this.error('DATASET_EMPTY', `Dataset gol: ${gameId}`, { gameId });

    this.memCache[gameId] = dataset;
    return dataset;
  },

  isFeatureCollection(value) {
    return !!value && (value.type === 'FeatureCollection' || Array.isArray(value.features) || (value.data && value.data.type === 'FeatureCollection'));
  },

  validateFeatureCollection(raw, sourceKey) {
    if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
      throw this.error('DATASET_INVALID', `Sursa ${sourceKey} nu este un FeatureCollection valid`, { sourceKey });
    }
    for (let i = 0; i < raw.features.length; i++) {
      const feature = raw.features[i];
      if (!feature || !feature.geometry || !feature.geometry.coordinates) continue;
      if (!this.coordinatesAreFinite(feature.geometry.coordinates)) {
        throw this.error('DATASET_INVALID', `Coordonate invalide la elementul ${i} din ${sourceKey}`, { sourceKey, index: i });
      }
    }
    return raw;
  },

  coordinatesAreFinite(value) {
    if (!Array.isArray(value)) return false;
    if (typeof value[0] === 'number') return value.length >= 2 && value.every(Number.isFinite);
    return value.length > 0 && value.every(v => this.coordinatesAreFinite(v));
  },

  async clearCache() {
    this.memCache = {};
    this.rawCache = {};
    const db = await this.openDB();
    if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },

  /* Preincarca toate sursele in IndexedDB (offline) */
  async prefetchAll(onProgress) {
    const keys = Object.keys(DatasetsConfig.sources);
    const used = new Set(DatasetsConfig.ids().map(id => DatasetsConfig.get(id).source));
    const list = keys.filter(k => used.has(k));
    let done = 0;
    for (const k of list) {
      try { await this.loadSource(k); } catch (e) { console.warn('prefetch', k, e); }
      done++;
      if (onProgress) onProgress(done, list.length);
    }
  },

  /* ============================================================ */
  /* NORMALIZARE                                                   */
  /* ============================================================ */
  normalize(raw, cfg, gameId) {
    const features = Array.isArray(raw.features) ? raw.features : [];
    const nameFields = cfg.nameField || ['name'];
    const nameFix = cfg.nameFix || {};
    const excludeSet = new Set(cfg.exclude || []);
    const includeSet = cfg.include ? new Set(cfg.include) : null;

    const items = [];

    for (const f of features) {
      if (!f) continue;
      const geom = f.geometry;
      if (!geom || !geom.coordinates) continue;                 // Vatican & co.
      if (cfg.dropNullGeometry && !geom) continue;

      const props = f.properties || {};

      /* 1. numele brut, dupa ordinea campurilor din config */
      let rawName = null;
      for (const field of nameFields) {
        if (props[field] && String(props[field]).trim()) {
          rawName = String(props[field]).trim();
          break;
        }
      }
      if (!rawName) continue;

      /* 2. filtrare pe numele brut (whitelist / blacklist) */
      if (includeSet && !includeSet.has(rawName)) continue;
      if (excludeSet.has(rawName)) continue;

      /* 3. corectie de nume (doar cheile prezente in nameFix) */
      const name = nameFix[rawName] || rawName;

      /* 4. filtrare si pe numele corectat */
      if (excludeSet.has(name)) continue;

      items.push({
        id: this.slug(name),
        name,
        geometry: geom,
        center: this.centerOf(geom)
      });
    }

    /* 5. uneste teritorii asociate cu statul lor suveran */
    const withTerritories = this.mergeAssociatedTerritories(items, cfg.associatedTerritories);

    /* 6. merge segmente cu acelasi nume (rauri) */
    const merged = cfg.mergeByName ? this.mergeByName(withTerritories) : this.dedupe(withTerritories);

    /* 7. sortare alfabetica stabila */
    merged.sort((a, b) => a.name.localeCompare(b.name, 'ro'));

    return {
      id: gameId,
      kind: cfg.kind,
      region: cfg.region,
      title: cfg.title,
      tolerance: cfg.tolerance || null,
      relief: cfg.relief || false,
      borders: cfg.borders || false,
      view: cfg.view,
      totalItems: merged.length,
      items: merged,
      source: 'OpenStreetMap / Overpass',
      license: 'ODbL 1.0'
    };
  },

  mergeAssociatedTerritories(items, associations = {}) {
    if (!associations || !Object.keys(associations).length) return items;
    const byName = new Map(items.map(item => [item.name, item]));
    const removed = new Set();

    for (const [ownerName, territoryNames] of Object.entries(associations)) {
      const owner = byName.get(ownerName);
      if (!owner) continue;
      for (const territoryName of territoryNames) {
        const territory = byName.get(territoryName);
        if (!territory || territory === owner) continue;
        owner.geometry = this.combinePolygonGeometry(owner.geometry, territory.geometry);
        owner.center = this.centerOf(owner.geometry);
        removed.add(territory.id);
      }
    }
    return items.filter(item => !removed.has(item.id));
  },

  combinePolygonGeometry(first, second) {
    const polygons = [];
    const add = geometry => {
      if (!geometry) return;
      if (geometry.type === 'Polygon') polygons.push(geometry.coordinates);
      else if (geometry.type === 'MultiPolygon') polygons.push(...geometry.coordinates);
    };
    add(first);
    add(second);
    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  },

  /* Uneste toate geometriile cu acelasi nume intr-una singura */
  mergeByName(items) {
    const map = new Map();

    for (const it of items) {
      if (!map.has(it.id)) {
        map.set(it.id, { id: it.id, name: it.name, parts: [] });
      }
      map.get(it.id).parts.push(it.geometry);
    }

    const out = [];
    for (const entry of map.values()) {
      const lines = [];
      for (const g of entry.parts) {
        if (g.type === 'LineString') lines.push(g.coordinates);
        else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
      }
      if (!lines.length) continue;

      const geometry = lines.length === 1
        ? { type: 'LineString', coordinates: lines[0] }
        : { type: 'MultiLineString', coordinates: lines };

      out.push({
        id: entry.id,
        name: entry.name,
        geometry,
        center: this.centerOf(geometry)
      });
    }
    return out;
  },

  /* Pastreaza prima aparitie a fiecarui id */
  dedupe(items) {
    const seen = new Set();
    return items.filter(it => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
  },

  /* ---------- Geometrie ---------- */

  /* Centru reprezentativ [lat, lng] */
  centerOf(geom) {
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point':
        return [c[1], c[0]];
      case 'LineString':
        return this.midOfLine(c);
      case 'MultiLineString': {
        const longest = c.reduce((a, b) => (b.length > a.length ? b : a), c[0]);
        return this.midOfLine(longest);
      }
      case 'Polygon':
        return this.centroidOfRing(c[0]);
      case 'MultiPolygon': {
        let best = null, bestArea = -1;
        for (const poly of c) {
          const a = Math.abs(this.ringArea(poly[0]));
          if (a > bestArea) { bestArea = a; best = poly[0]; }
        }
        return best ? this.centroidOfRing(best) : [0, 0];
      }
      default:
        return [0, 0];
    }
  },

  midOfLine(coords) {
    const p = coords[Math.floor(coords.length / 2)];
    return [p[1], p[0]];
  },

  ringArea(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    }
    return area / 2;
  },

  /* Centroid ponderat pe arie; fallback pe media punctelor */
  centroidOfRing(ring) {
    let x = 0, y = 0, a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
      a += cross;
      x += (ring[j][0] + ring[i][0]) * cross;
      y += (ring[j][1] + ring[i][1]) * cross;
    }
    a = a / 2;
    if (Math.abs(a) < 1e-12) {
      let sx = 0, sy = 0;
      ring.forEach(p => { sx += p[0]; sy += p[1]; });
      return [sy / ring.length, sx / ring.length];
    }
    return [y / (6 * a), x / (6 * a)];
  },

  /* ---------- Utilitare ---------- */
  slug(name) {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[ăâ]/g, 'a').replace(/[îi]/g, 'i')
      .replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
};

window.DataLoader = DataLoader;
