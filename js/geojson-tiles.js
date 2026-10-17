/* One complete GeoJSON per country and resolution. */
const GeoJSONTiles = {
  listeners: new Set(),
  active: new Map(),
  TIERS: ['fast', 'simple', 'detailed'],
  /* ~20 m: sub un pixel chiar și la zoom 12, dar elimină punctele redundante
     din fișierele detailed (Norvegia/Rusia au sute de mii). */
  DETAIL_QUANTUM: 0.0002,
  /* Timp maxim de montare per frame; restul geometriei intră în frame-ul următor. */
  MOUNT_BUDGET_MS: 8,
  _worker: null,
  _workerJobs: new Map(),
  _workerSeq: 0,
  _workerFailed: false,
  _workerFailureListeners: new Set(),
  registerHitboxes(listener) {
    this.listeners.add(listener);
    for (const [key, item] of this.active) {
      const cleanup = listener(item.feature, key);
      if (typeof cleanup === 'function') item.cleanups.set(listener, cleanup);
    }
    return () => {
      this.listeners.delete(listener);
      for (const item of this.active.values()) {
        item.cleanups.get(listener)?.();
        item.cleanups.delete(listener);
      }
    };
  },
  remove(key) {
    const item = this.active.get(key);
    if (item) for (const cleanup of item.cleanups.values()) cleanup();
    this.active.delete(key);
  },
  publish(key, feature) {
    this.remove(key);
    if (!feature.properties?.gameId) return;
    const item = { feature, cleanups: new Map() };
    this.active.set(key, item);
    for (const listener of this.listeners) {
      const cleanup = listener(feature, key);
      if (typeof cleanup === 'function') item.cleanups.set(listener, cleanup);
    }
  },
  async manifest(url) {
    const res = await this.cachedFetch(url);
    if (!res.ok) throw new Error(`Manifest indisponibil: ${url} (${res.status})`);
    const data = await res.json();
    if (data.format !== 'country-geojson-v1' || data.version !== '1.0')
      throw new Error('Format sau versiune țări necunoscute');
    return { ...data, base: url.slice(0, url.lastIndexOf('/') + 1) };
  },
  async cachedFetch(url, options = {}) {
    // Also check Cache Storage on the first visit, before the service worker controls this tab.
    let cache;
    if (window.caches) {
      try {
        cache = await caches.open('geografun-geometry-1.0');
        const hit = await cache.match(url);
        if (hit) return hit;
      } catch (err) { console.warn('[GeoJSONTiles] Cache unavailable:', err); }
    }
    const response = await fetch(url, options);
    if (response.ok && cache) {
      try { await cache.put(url, response.clone()); }
      catch (err) { console.warn('[GeoJSONTiles] Cache write failed:', err); }
    }
    return response;
  },
  /* Download, JSON.parse și quantizarea rulează într-un Web Worker. Fără
     Worker (file://, teste Node, browser vechi) se folosește thread-ul principal. */
  worker() {
    if (this._worker || this._workerFailed) return this._worker;
    if (typeof Worker !== 'function' || typeof location === 'undefined' || location.protocol === 'file:') {
      this._workerFailed = true;
      return null;
    }
    try {
      this._worker = new Worker('js/geometry-worker.js');
      this._worker.onmessage = ({ data }) => {
        const job = this._workerJobs.get(data.id);
        if (!job) return;
        this._workerJobs.delete(data.id);
        if (data.error) {
          const err = new Error(data.error);
          err.name = data.name || 'Error';
          job.reject(err);
        } else {
          job.resolve(data.result);
        }
      };
      this._worker.onerror = event => {
        console.warn('[GeoJSONTiles] Worker indisponibil, revin la thread-ul principal:', event.message);
        this._workerFailed = true;
        this._worker.terminate();
        this._worker = null;
        this._rasterSupport = Promise.resolve(false);
        const pending = [...this._workerJobs.values()];
        this._workerJobs.clear();
        pending.forEach(job => job.fallback());
        for (const listener of this._workerFailureListeners) listener();
      };
    } catch (err) {
      console.warn('[GeoJSONTiles] Worker indisponibil:', err);
      this._workerFailed = true;
      this._worker = null;
    }
    return this._worker;
  },
  async _mainThreadFeature(url, signal) {
    const res = await this.cachedFetch(url, { signal });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  },
  loadFeature(url, { signal, quantize = 0 } = {}) {
    const worker = this.worker();
    if (!worker) return this._mainThreadFeature(url, signal);
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const id = ++this._workerSeq;
      const fallback = () => this._mainThreadFeature(url, signal).then(resolve, reject);
      this._workerJobs.set(id, { resolve, reject, fallback });
      if (signal) signal.addEventListener('abort', () => {
        if (!this._workerJobs.has(id)) return;
        this._workerJobs.delete(id);
        if (this._worker) this._worker.postMessage({ type: 'abort', id });
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
      /* URL absolut: în worker un URL relativ s-ar rezolva față de js/. */
      worker.postMessage({ type: 'load', id, url: new URL(url, location.href).href, quantize });
    });
  },
  /* Cerere generică (fără fallback pe thread-ul principal). */
  _call(message, transfer) {
    const worker = this.worker();
    if (!worker) return Promise.reject(new Error('Worker indisponibil'));
    return new Promise((resolve, reject) => {
      const id = ++this._workerSeq;
      this._workerJobs.set(id, { resolve, reject, fallback: () => reject(new Error('Worker oprit')) });
      worker.postMessage({ ...message, id }, transfer || []);
    });
  },
  _rasterSupport: null,
  /* Fundalul raster cere Worker + OffscreenCanvas 2D în worker (iOS 16.4+). */
  rasterSupported() {
    if (this._rasterSupport) return this._rasterSupport;
    if (!this.worker()) {
      this._rasterSupport = Promise.resolve(false);
    } else {
      this._rasterSupport = Promise.race([
        this._call({ type: 'probe' }).catch(() => false),
        new Promise(resolve => setTimeout(() => resolve(false), 1500))
      ]);
    }
    return this._rasterSupport;
  },
  _bgSeq: 0,
  /* SeaVoX is already loaded for questions. Keep one copy inside the worker
     and reuse the country raster pipeline without constructing SVG hitboxes. */
  marineLayer(dataset, options = {}) {
    const countries = dataset.items.filter(item => item.marineType !== 'strait').map(item => ({
      iso3: item.id, gameId: item.id,
      feature: { type: 'Feature', geometry: item.geometry, properties: { gameId: item.id } }
    }));
    return this.backgroundLayer({ countries }, null, {
      ...options, marine: true, pane: 'gfMarineRaster',
      style: { fill: '#21648b', stroke: '#58a9cf', fillOpacity: 0.18, opacity: 1, weight: 1 }
    });
  },
  /* Strat raster pentru țările de fundal. Tile-urile se desenează în worker
     și ajung ca ImageBitmap; în timpul pinch-ului Leaflet doar le scalează. */
  backgroundLayer(manifest, gameIds, options = {}) {
    const countries = manifest.countries.filter(c => !options.include || options.include.has(c.iso3))
      .map(c => {
        if (c.feature) return c;
        const fixed = options.tierFor?.(c, !!gameIds?.has(c.iso3)) ||
          (gameIds && !gameIds.has(c.iso3) ? 'fast' : null);
        const entry = c.fast || c.simple || c.detailed;
        if (!entry) return null;
        return {
          iso3: c.iso3, bounds: (c.detailed || c.simple || entry).bounds, fixed,
          low: !!(gameIds && !gameIds.has(c.iso3)),
          gameId: gameIds ? gameIds.get(c.iso3) || null : c.iso3 === 'VAT' ? 'vatican' : c.gameId,
          files: Object.fromEntries(['fast', 'simple', 'detailed'].filter(t => c[t]).map(t =>
            [t, new URL(manifest.base + c[t].file, location.href).href]))
        };
      }).filter(Boolean);
    const layerId = `bg${++this._bgSeq}`;
    const ready = this._call({ type: 'bg-init', layer: layerId, countries });
    const tiles = this;
    const Layer = L.GridLayer.extend({
      onAdd(map) {
        this._failureListener = () => this._workerFailure();
        tiles._workerFailureListeners.add(this._failureListener);
        L.GridLayer.prototype.onAdd.call(this, map);
      },
      createTile(coords, done) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        tile.width = Math.round(size.x * dpr);
        tile.height = Math.round(size.y * dpr);
        const c = MapViewer.colors();
        const style = options.style || { fill: c.land, stroke: c.landStroke, fillOpacity: 0.22, opacity: 0.35, weight: 1 };
        ready
          .then(() => tiles._call({ type: 'tile', layer: layerId, z: coords.z, x: coords.x, y: coords.y,
            size: size.x, dpr, style }))
          .then(bitmap => {
            if (!this._map) {
              bitmap.close(); done(null, tile); return;
            }
            const ctx = tile.getContext('bitmaprenderer');
            if (ctx) ctx.transferFromImageBitmap(bitmap);
            else { tile.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); }
            done(null, tile);
          })
          .catch(err => {
            done(err, tile);
            Promise.resolve().then(() => this._workerFailure());
          });
        return tile;
      },
      onRemove(map) {
        tiles._workerFailureListeners.delete(this._failureListener);
        L.GridLayer.prototype.onRemove.call(this, map);
        if (tiles._worker) tiles._worker.postMessage({ type: 'bg-drop', layer: layerId });
      },
      _workerFailure() {
        if (this._fallbackStarted || !this._map) return;
        this._fallbackStarted = true;
        if (typeof options.onRasterFailure === 'function') options.onRasterFailure(this);
      },
      hitTest(latlng) {
        if (!this._map) return Promise.resolve(null);
        return ready.then(() => tiles._call({ type: 'hit', layer: layerId,
          lat: latlng.lat, lng: latlng.lng, zoom: this._map.getZoom() }))
          .catch(err => { this._workerFailure(); throw err; });
      },
      outline(gameId) {
        if (!this._map) return Promise.resolve(null);
        return ready.then(() => tiles._call({ type: 'outline', layer: layerId,
          gameId, zoom: this._map.getZoom() }))
          .catch(err => { this._workerFailure(); throw err; });
      },
      /* Tema s-a schimbat: redesenăm tile-urile cu noile culori. */
      refreshTheme() { this.redraw(); }
    });
    return new Layer({ pane: options.pane || 'gfTiles', tileSize: 256, updateWhenZooming: false, keepBuffer: 3,
      className: 'gf-raster-bg', noWrap: false });
  },
  countyLayer(dataset) {
    const items = dataset.items.map(item => ({ item,
      bounds: L.geoJSON({ type: 'Feature', geometry: item.geometry }).getBounds() }));
    const Layer = L.Layer.extend({
      onAdd(map) {
        this._map = map;
        this._entries = new Map();
        this._frame = null;
        map.on('move zoom moveend zoomend', this._schedule, this);
        this.update();
      },
      onRemove(map) {
        map.off('move zoom moveend zoomend', this._schedule, this);
        if (this._frame !== null) (window.cancelAnimationFrame || clearTimeout)(this._frame);
        for (const [id, layer] of this._entries) {
          GeoJSONTiles.remove(`county/${id}`);
          map.removeLayer(layer);
        }
        this._entries.clear();
        this._map = null;
      },
      _schedule() {
        if (this._frame !== null) return;
        this._frame = (window.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => {
          this._frame = null;
          this.update();
        });
      },
      refreshTheme() {
        const colors = MapViewer.colors();
        for (const layer of this._entries.values()) layer.setStyle({ color: colors.landStroke, fillColor: colors.land });
      },
      update() {
        if (!this._map) return;
        const map = this._map;
        const size = map.getSize();
        const screen = L.latLngBounds(map.containerPointToLatLng([0, size.y]), map.containerPointToLatLng([size.x, 0]));
        const wanted = screen.pad(0.5);
        for (const { item, bounds } of items) {
          if (wanted.intersects(bounds)) {
            if (this._entries.has(item.id)) continue;
            const feature = { type: 'Feature', properties: { gameId: item.id }, geometry: item.geometry };
            const colors = MapViewer.colors();
            const layer = L.geoJSON(feature, { pane: 'gfTiles', interactive: false,
              style: { color: colors.landStroke, fillColor: colors.land, weight: 1, fillOpacity: 1 } }).addTo(map);
            this._entries.set(item.id, layer);
            GeoJSONTiles.publish(`county/${item.id}`, feature);
          } else if (this._entries.has(item.id)) {
            GeoJSONTiles.remove(`county/${item.id}`);
            map.removeLayer(this._entries.get(item.id));
            this._entries.delete(item.id);
          }
        }
      }
    });
    return new Layer();
  },
  layer(manifest, gameIds = null, options = {}) {
    // Europe games still draw every visible country as a subdued background;
    // gameIds only controls which countries are playable/high contrast.
    const countries = manifest.countries;
    const Layer = L.Layer.extend({
      onAdd(map) {
        this._map = map;
        this._entries = new Map();
        this._queue = new Map();
        this._requests = new Map();
        this._generation = (this._generation || 0) + 1;
        this._detailWanted = false;
        this._zooming = false;
        this._mountQueue = [];
        this._mountFrame = null;
        this._simple = L.layerGroup().addTo(map);
        this._detail = L.layerGroup().addTo(map);
        /* Prefetch-ul începe înainte de finalul panului: pe desktop,
           mousemove anticipează zona spre care se deplasează cursorul;
           pe touch, evenimentul move continuă încărcarea în timpul gestului. */
        this._updateFrame = null;
        map.on('zoomstart', this._zoomStart, this);
        map.on('zoomend', this._zoomEnd, this);
        map.on('move moveend', this._scheduleUpdate, this);
        this.update();
      },
      onRemove(map) {
        map.off('zoomstart', this._zoomStart, this);
        map.off('zoomend', this._zoomEnd, this);
        map.off('move moveend', this._scheduleUpdate, this);
        if (this._mountFrame !== null) (window.cancelAnimationFrame || clearTimeout)(this._mountFrame);
        this._mountQueue.length = 0;
        if (this._updateFrame !== null) {
          (window.cancelAnimationFrame || clearTimeout)(this._updateFrame);
          this._updateFrame = null;
        }
        this._generation++;
        for (const controller of this._requests.values()) controller.abort();
        this._requests.clear();
        this._queue.clear();
        for (const [code, entry] of this._entries) this._discard(code, entry);
        this._entries.clear();
        map.removeLayer(this._simple);
        map.removeLayer(this._detail);
        this._map = null;
      },
      _scheduleUpdate() {
        if (!this._map || this._zooming || this._updateFrame !== null) return;
        const requestFrame = window.requestAnimationFrame || (callback => setTimeout(callback, 0));
        this._updateFrame = requestFrame(() => {
          this._updateFrame = null;
          this.update();
        });
      },
      _zoomStart() { this._zooming = true; },
      _zoomEnd() {
        this._zooming = false;
        this.update();
        this._drainMounts();
      },
      refreshTheme() {
        const c = MapViewer.colors();
        for (const entry of this._entries.values()) {
          entry.fastLayer?.setStyle(this._style(entry, c, 'fast'));
          entry.simpleLayer?.setStyle(this._style(entry, c, 'simple'));
          entry.detailedLayer?.setStyle(this._style(entry, c, 'detailed'));
        }
      },
      _style(entry, colors, tier = null) {
        if (options.darkFast && entry.iso3 === 'ROU' && tier === 'fast') {
          return { color: '#17233a', fillColor: '#101827', opacity: 0.7, fillOpacity: 0.7 };
        }
        return entry.lowContrast
          ? { color: colors.landStroke, fillColor: colors.land, opacity: 0.35, fillOpacity: 0.22 }
          : { color: colors.landStroke, fillColor: colors.land, opacity: 1, fillOpacity: 1 };
      },
      _tierFor(country, entry) {
        if (typeof options.tierFor === 'function') return options.tierFor(country, entry);
        return null;
      },
      _visible(box, view) {
        const [w, s, e, n] = box;
        return n >= view.getSouth() && s <= view.getNorth() &&
          [-360, 0, 360].some(shift => e + shift >= view.getWest() && w + shift <= view.getEast());
      },
      _distance(box) {
        const c = this._map.getCenter();
        const [w, s, e, n] = box;
        const y = Math.max(s, Math.min(n, c.lat));
        const x = Math.min(...[-360, 0, 360].map(shift =>
          Math.abs(Math.max(w + shift, Math.min(e + shift, c.lng)) - c.lng)));
        return Math.hypot(2 * (y - c.lat), x);
      },
      update() {
        if (!this._map || this._zooming) return;
        const zoom = this._map.getZoom();
        /* Hysteresis prevents a slow geometry response from repeatedly
           crossing the detailed threshold while a pinch gesture settles. */
        if (!options.maxTier) {
          if (this._detailWanted ? zoom < 7.0 : zoom >= 7.25) this._detailWanted = zoom >= 7.25;
        } else {
          this._detailWanted = false;
        }
        const detail = this._detailWanted;
        /* Leaflet can return its previous cached bounds mid-drag. Container
           coordinates include the current dragging offset on touch and mouse. */
        const screen = L.latLngBounds(
          this._map.containerPointToLatLng([0, this._map.getSize().y]),
          this._map.containerPointToLatLng([this._map.getSize().x, 0])
        );
        this._screenBounds = screen;
        // Keep one complete viewport queued beyond the screen for rapid pans.
        const buffer = screen.pad(1);
        const visible = new Set();
        for (const country of countries) {
          const preferred = this._tierFor(country, gameIds && gameIds.has(country.iso3));
          const first = (preferred && country[preferred]) || country.fast || country.simple;
          if ((options.include && !options.include.has(country.iso3)) ||
              (options.rasterCodes && options.rasterCodes.has(country.iso3)) ||
              !first || !this._visible(first.bounds, buffer)) continue;
          const code = country.iso3;
          visible.add(code);
          if (!this._entries.has(code)) this._entries.set(code, {});
          const entry = this._entries.get(code);
           entry.iso3 = code;
          entry.lowContrast = Boolean(gameIds && !gameIds.has(code));
           if (preferred === 'simple' && options.keepLowerTier && country.fast &&
               !entry.fastFeature && !this._requests.has(`fast/${code}`))
             this._queue.set(`fast/${code}`, country);
           else if (preferred === 'fast' && country.fast && !entry.fastFeature &&
              !this._requests.has(`fast/${code}`)) this._queue.set(`fast/${code}`, country);
           if (preferred === 'simple' && country.simple && !entry.simpleFeature &&
               !this._requests.has(`simple/${code}`)) this._queue.set(`simple/${code}`, country);
          else if ((!options.maxTier || entry.lowContrast) && country.fast &&
              !entry.fastFeature && !this._requests.has(`fast/${code}`))
            this._queue.set(`fast/${code}`, country);
          else if (!country.fast && country.simple && !entry.simpleFeature &&
              !this._requests.has(`simple/${code}`)) this._queue.set(`simple/${code}`, country);
          if (!detail && entry.detailedFeature) this._dropDetail(code, entry);
        }
        // Upgrade each country independently: an unrelated slow or failed download
        // must not prevent the newly visible viewport from filling during a pan.
        for (const country of countries) {
          if (!visible.has(country.iso3)) continue;
          const code = country.iso3;
          const entry = this._entries.get(code);
          const preferred = this._tierFor(country, gameIds && gameIds.has(code));
          if (!preferred && !entry.lowContrast && (options.maxTier || !country.fast || entry.fastFeature) &&
              country.simple && !entry.simpleFeature &&
              !this._requests.has(`simple/${code}`)) this._queue.set(`simple/${code}`, country);
          if (!preferred && !entry.lowContrast && detail && country.detailed && entry.simpleFeature &&
              !entry.detailedFeature && !this._requests.has(`detailed/${code}`)) {
            this._queue.set(`detailed/${code}`, country);
          }
        }
        for (const [code, entry] of this._entries) {
          if (visible.has(code)) continue;
          this._discard(code, entry);
          this._entries.delete(code);
        }
        for (const [key, controller] of this._requests) {
          const [tier, code] = key.split('/');
          if (!visible.has(code) || (tier === 'detailed' && !detail)) {
            controller.abort();
            this._requests.delete(key);
          }
        }
        for (const key of this._queue.keys()) {
          const [tier, code] = key.split('/');
          if (!visible.has(code) || (tier === 'detailed' && !detail)) this._queue.delete(key);
        }
        this._pump();
      },
      _pump() {
        if (!this._map) return;
        const sorted = [...this._queue].sort(([a, A], [b, B]) => {
            const ta = a.split('/')[0], tb = b.split('/')[0];
            const view = this._screenBounds;
            const av = this._visible(A[ta].bounds, view);
            const bv = this._visible(B[tb].bounds, view);
            if (av !== bv) return av ? -1 : 1;
            if (ta !== tb) return ['fast', 'simple', 'detailed'].indexOf(ta) -
              ['fast', 'simple', 'detailed'].indexOf(tb);
            return this._distance(A[ta].bounds) - this._distance(B[tb].bounds);
          });
        while (this._requests.size < 4 && sorted.length) {
          const [key, country] = sorted.shift();
          if (!this._queue.has(key)) continue;
          this._queue.delete(key);
          if (this._requests.has(key)) continue;
          const [tier, code] = key.split('/');
          const controller = new AbortController();
          const generation = this._generation;
          this._requests.set(key, controller);
          GeoJSONTiles.loadFeature(manifest.base + country[tier].file, {
            signal: controller.signal,
            quantize: tier === 'detailed' ? GeoJSONTiles.DETAIL_QUANTUM : 0
          })
            .then(feature => {
              if (!this._map || this._generation !== generation || controller.signal.aborted) return;
              const entry = this._entries.get(code);
              if (!entry) return;
              this._mountQueue.push({ tier, code, key, feature, generation, controller });
              this._drainMounts();
            })
            .catch(err => { if (err.name !== 'AbortError') console.warn('[GeoJSONTiles]', err); })
            .finally(() => {
              if (this._requests.get(key) === controller) this._requests.delete(key);
              if (this._map && generation === this._generation && !this._zooming) this.update();
            });
        }
      },
      _drainMounts() {
        if (!this._map || this._zooming || this._mountFrame !== null) return;
        /* O singură țară per frame: gesturile noi pot întrerupe montarea. */
        while (this._mountQueue.length) {
          const next = this._mountQueue.shift();
          if (!this._entries.has(next.code) || next.controller.signal.aborted ||
              (next.tier === 'detailed' && !this._detailWanted)) continue;
          this._mount(next);
          break;
        }
        if (this._mountQueue.length) {
          const frame = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
          this._mountFrame = frame(() => { this._mountFrame = null; this._drainMounts(); });
        }
      },
      _mount({ tier, code, key, feature, generation, controller }) {
              if (!this._map || generation !== this._generation || controller.signal.aborted) return;
              const entry = this._entries.get(code);
              if (!entry || (tier === 'detailed' && !this._detailWanted)) return;
              if (gameIds && gameIds.has(code)) feature.properties.gameId = gameIds.get(code);
              if (!gameIds && code === 'VAT') feature.properties.gameId = 'vatican';
              if (gameIds && !gameIds.has(code)) delete feature.properties.gameId;
              const c = MapViewer.colors();
              entry._styleTier = tier;
              const layer = L.geoJSON(feature, {
                interactive: false,
                pane: tier === 'detailed' ? 'gfDetail' : tier === 'simple' ? 'gfSimple' : 'gfTiles',
                style: { ...this._style(entry, c), weight: 1 }
              });
              entry[`${tier}Feature`] = feature;
              entry[`${tier}Layer`] = layer;
              if (tier === 'detailed') {
                /* Add first, remove second: the old geometry remains visible
                   until Leaflet has the replacement in its layer group. */
                this._detail.addLayer(layer);
                if (entry.simpleLayer) this._simple.removeLayer(entry.simpleLayer);
                if (entry.fastLayer) this._simple.removeLayer(entry.fastLayer);
                // Keep references to the lower-resolution layers. They are
                // reused immediately if the zoom drops below the threshold.
                GeoJSONTiles.remove(`simple/${code}`);
                GeoJSONTiles.remove(`fast/${code}`);
              } else if (tier === 'simple') {
                if (!entry.detailedLayer) this._simple.addLayer(layer);
                if (!options.keepLowerTier && entry.fastLayer) {
                  this._simple.removeLayer(entry.fastLayer);
                  entry.fastLayer = null;
                  GeoJSONTiles.remove(`fast/${code}`);
                }
              } else if (!entry.simpleLayer && !entry.detailedLayer) {
                this._simple.addLayer(layer);
              }
              if (options.onChunkAdded) options.onChunkAdded(tier, code);
              if (tier === 'detailed' || (tier === 'simple' && !entry.detailedLayer) ||
                  (tier === 'fast' && !entry.simpleLayer && !entry.detailedLayer)) GeoJSONTiles.publish(key, feature);
              if (!this._zooming) this.update();
      },
      _dropDetail(code, entry) {
        this._detail.removeLayer(entry.detailedLayer);
        GeoJSONTiles.remove(`detailed/${code}`);
        entry.detailedLayer = null;
        entry.detailedFeature = null;
        if (entry.simpleLayer) {
          this._simple.addLayer(entry.simpleLayer);
          GeoJSONTiles.publish(`simple/${code}`, entry.simpleFeature);
        } else if (entry.fastLayer) {
          this._simple.addLayer(entry.fastLayer);
          GeoJSONTiles.publish(`fast/${code}`, entry.fastFeature);
        }
      },
      _discard(code, entry) {
        if (entry.detailedLayer) this._dropDetail(code, entry);
        if (entry.simpleLayer) this._simple.removeLayer(entry.simpleLayer);
        if (entry.fastLayer) this._simple.removeLayer(entry.fastLayer);
        GeoJSONTiles.remove(`simple/${code}`);
        GeoJSONTiles.remove(`fast/${code}`);
      }
    });
    return new Layer();
  }
};
window.GeoJSONTiles = GeoJSONTiles;