/* ============================================================ */
/* POLYGON MODE - judete, tari                                   */
/* Tap pe poligon = selectie; raspunsul se trimite la confirm.   */
/* ============================================================ */
GameModes.register('polygon', {

  map: null,
  dataset: null,
  layerGroup: null,
  layers: {},        // id -> L.Layer
  onSelect: null,
  armed: false,
  isCoarsePointer: window.matchMedia?.('(pointer: coarse), (hover: none)').matches || false,
  usesPin: false,
  needsConfirm: true,
  selectedId: null,
  _unregisterHitboxes: null,
  microstates: { andorra: [42.542, 1.597], 'san-marino': [43.942, 12.46],
    vatican: [41.904, 12.452], monaco: [43.738, 7.425] },

  /* paleta se schimba cu tema: pe light tarile sunt albe pe mare albastra */
  get style() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const solidSelection = this._solidSelection ??
      (MapViewer.currentGameId === 'europe-countries' || MapViewer.currentGameId === 'world-countries');
    /* cand harta are relief dedesubt, umplutura de baza devine transparenta,
       ca sa se vada benzile hipsometrice; raman doar conturele */
    const relief = !!(this.dataset && this.dataset.relief);
    const baseFill = relief ? 0 : 1;

    return light
      ? {
          base:      { color: '#9aa6c4', weight: 0.8, fillColor: '#ffffff', fillOpacity: 0, opacity: 0 },
          hover:     { color: '#2b7fd4', weight: 2,   fillColor: '#dceaf9', fillOpacity: 1 },
          selected:  { color: solidSelection ? '#000000' : '#123f75', weight: 4,
                       dashArray: solidSelection ? null : '3 5', fillColor: '#9ccbf5', fillOpacity: 1 },
          correct:   { color: '#073f26', weight: 5, dashArray: null, fillColor: '#5fdf9c', fillOpacity: 1 },
          incorrect: { color: '#64101f', weight: 5,
                       dashArray: solidSelection ? null : '10 6', fillColor: '#f8909f', fillOpacity: 1 }
        }
      : {
          base:      { color: '#7f8dbd', weight: 1, fillColor: '#2f3a5f', fillOpacity: 0, opacity: 0 },
          hover:     { color: '#ffffff', weight: 2, fillColor: '#4a5a92', fillOpacity: 0.95 },
          selected:  { color: solidSelection ? '#000000' : '#ffffff', weight: 4,
                       dashArray: solidSelection ? null : '3 5', fillColor: '#4facfe', fillOpacity: 0.9 },
          correct:   { color: '#ffffff', weight: 5, dashArray: null, fillColor: '#43e97b', fillOpacity: 0.85 },
          incorrect: { color: '#ffffff', weight: 5,
                       dashArray: solidSelection ? null : '10 6', fillColor: '#ff4d6d', fillOpacity: 0.85 }
        };
  },

  render(map, dataset) {
    this.map = map;
    this.dataset = dataset;
    this._solidSelection = dataset.id === 'europe-countries' || dataset.id === 'world-countries';
    this.layers = {};
    this.selectedId = null;
    this.layerGroup = L.layerGroup().addTo(map);
    this._raster = typeof MapViewer.tileLayer?.hitTest === 'function';
    this._session = (this._session || 0) + 1;
    this._states = {};
    if (this._raster) {
      this._mapClick = async e => {
        if (!this.armed) return;
        const session = this._session;
        const question = this._questionToken;
        const id = await MapViewer.tileLayer.hitTest(e.latlng).catch(() => null);
        if (id && this.armed && session === this._session && question === this._questionToken)
          this._pick(id);
      };
      map.on('click', this._mapClick);
      this._refreshRaster = () => {
        for (const [id, layer] of Object.entries(this.layers)) {
          const style = this._states[id];
          if (!style) continue;
          this.layerGroup.removeLayer(layer);
          delete this.layers[id];
          this._setStyle(id, style);
        }
      };
      map.on('zoomend', this._refreshRaster);
    }
    if (!this._raster) this.useVectorHitboxes();
    this._setupMicroMarkers();
  },
  useVectorHitboxes() {
    if (this._raster) {
      this._raster = false;
      this._session++;
      if (this.map && this._mapClick) this.map.off('click', this._mapClick);
      if (this.map && this._refreshRaster) this.map.off('zoomend', this._refreshRaster);
      this._mapClick = null;
      this._refreshRaster = null;
      this.layerGroup.clearLayers();
      this.layers = {};
      this._states = {};
      this._setupMicroMarkers();
    }
    if (!this.map || this._unregisterHitboxes || !window.GeoJSONTiles) return;
    this._unregisterHitboxes = GeoJSONTiles.registerHitboxes(feature => {
        const id = feature.properties.gameId;
        const layer = L.geoJSON(feature, {
          /* Geometria tile-ului este hitbox-ul; canvas-ul rămâne singurul
             strat vizual pentru starea normală. */
          style: { ...this.style.base, fillOpacity: 0, opacity: 0 },
          interactive: true,
          bubblingMouseEvents: false
        });
        layer.on('click', e => {
          if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
          this._pick(id);
        });
        layer.on('mouseover', () => {
          if (!this.isCoarsePointer && this.armed && id !== this.selectedId) layer.setStyle(this.style.hover);
        });
        layer.on('mouseout', () => {
          if (!this.isCoarsePointer && this.armed && id !== this.selectedId) layer.setStyle(this.style.base);
        });
        layer.addTo(this.layerGroup);
        /* GeoJSON group are setStyle()/eachLayer(), necesare feedback-ului. */
        if (!this.layers[id]) this.layers[id] = L.geoJSON(null);
        this.layers[id].addLayer(layer);
        return () => {
          if (this.layers[id]) this.layers[id].removeLayer(layer);
          if (this.layerGroup) this.layerGroup.removeLayer(layer);
        };
      });
  },
  _setupMicroMarkers() {
    if (!this.dataset || !this.map || this._microMarkers) return;
    if (this.dataset.id === 'europe-countries' || this.dataset.id === 'world-countries') {
      const map = this.map, dataset = this.dataset;
      this._microMarkers = L.layerGroup().addTo(map);
      this._updateMicroMarkers = () => {
        const shown = map.getZoom() >= 6;
        this._microMarkers.clearLayers();
        if (!shown) return;
        for (const [id, center] of Object.entries(this.microstates)) {
          if (!dataset.items.some(item => item.id === id)) continue;
          if (!map.getBounds().pad(0.1).contains(L.latLng(center))) continue;
          const marker = L.circleMarker(center, {
            radius: this.isCoarsePointer ? 10 : 8, weight: 2, color: '#ffffff',
            fillColor: '#2b7fd4', fillOpacity: 0.95, bubblingMouseEvents: false
          });
          marker.on('click', e => {
            if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
            this._pick(id);
          });
          marker.addTo(this._microMarkers);
        }
      };
      map.on('moveend zoomend', this._updateMicroMarkers);
      this._updateMicroMarkers();
    }
    this.resetStyles();
  },

  arm(question, onSelect) {
    this._questionToken = (this._questionToken || 0) + 1;
    this.onSelect = onSelect;
    this.armed = true;
    this.resetStyles();
    this.selectedId = null;
  },

  _pick(id) {
    if (!this.armed) return;
    if (this.selectedId && this.selectedId !== id) this._setStyle(this.selectedId, this.style.base, true);
    this.selectedId = id;
    this._setStyle(id, this.style.selected);
    if (this.onSelect) this.onSelect({ chosenId: id });
  },

  hasSelection() {
    return !!this.selectedId;
  },

  commit() {
    if (!this.selectedId) return null;
    this.armed = false;
    this._questionToken++;
    return { chosenId: this.selectedId };
  },

  evaluate(input, question) {
    const chosenId = input.chosenId;
    return {
      correct: chosenId === question.id,
      chosenId,
      distance: null
    };
  },

  reveal(question, result) {
    if (!result.correct && result.chosenId) {
      this._setStyle(result.chosenId, this.style.incorrect);
    }
    this._setStyle(question.id, this.style.correct);
  },

  fadeFeedback(duration = 950, result = null, question = null) {
    const ids = [this.selectedId, result && result.chosenId, question && question.id];
    ids.forEach(id => {
      const group = this.layers[id];
      if (!group) return;
      group.eachLayer(layer => {
        const path = layer.getElement && layer.getElement();
        if (!path) return;
        path.style.transition = `fill-opacity ${duration}ms cubic-bezier(.55,.05,1,.45), stroke-opacity ${duration}ms cubic-bezier(.55,.05,1,.45)`;
        path.style.fillOpacity = '0';
        path.style.strokeOpacity = '0';
      });
    });
  },

  _setStyle(id, style, base = false) {
    if (this._raster) {
      const previous = this.layers[id];
      if (base) {
        delete this._states[id];
        if (previous) { this.layerGroup.removeLayer(previous); delete this.layers[id]; }
        return;
      }
      this._states[id] = style;
      if (previous) { previous.setStyle(style); return; }
      const session = this._session;
      MapViewer.tileLayer.outline(id).then(feature => {
        if (!feature || session !== this._session || !this._states[id] || this.layers[id]) return;
        const layer = L.geoJSON(feature, { interactive: false, style: this._states[id] });
        layer.addTo(this.layerGroup);
        this.layers[id] = layer;
      }).catch(err => console.warn('[polygon] contur indisponibil:', err));
      return;
    }
    const layer = this.layers[id];
    if (layer) {
      layer.setStyle(style);
      if (layer.bringToFront) layer.bringToFront();
    }
  },

  resetStyles() {
    if (this._raster) {
      this._states = {};
      this.layerGroup.clearLayers();
      this.layers = {};
      return;
    }
    Object.values(this.layers).forEach(group => {
      group.eachLayer(layer => {
        const path = layer.getElement && layer.getElement();
        if (path) {
          path.style.transition = '';
          path.style.fillOpacity = '';
          path.style.strokeOpacity = '';
        }
      });
      group.setStyle(this.style.base);
    });
  },

  cleanup() {
    this._session++;
    this._questionToken++;
    if (this.map && this._mapClick) this.map.off('click', this._mapClick);
    if (this.map && this._refreshRaster) this.map.off('zoomend', this._refreshRaster);
    this._refreshRaster = null;
    this._mapClick = null;
    this._raster = false;
    if (this._updateMicroMarkers && this.map) {
      this.map.off('moveend zoomend', this._updateMicroMarkers);
      this.map.removeLayer(this._microMarkers);
    }
    this._updateMicroMarkers = null;
    this._microMarkers = null;
    this.armed = false;
    this.onSelect = null;
    this.selectedId = null;
    if (this.layerGroup && this.map) {
      this.map.removeLayer(this.layerGroup);
    }
    if (this._unregisterHitboxes) this._unregisterHitboxes();
    this._unregisterHitboxes = null;
    this.layerGroup = null;
    this.layers = {};
    this.dataset = null;
    this._solidSelection = null;
    this.map = null;
  }
});
