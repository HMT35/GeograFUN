/* Mări/golfuri: suprafețe selectabile; strâmtori: buline selectabile. */
GameModes.register('marine', {
  map: null, layerGroup: null, layers: {}, selectedId: null, armed: false,
  onSelect: null, _zoomHandler: null, _feedbackIds: null, _tooltipLayer: null, _hoverId: null,
  _session: 0, _hitSeq: 0,

  areaStyle: {
    base: { color: '#58a9cf', weight: 1, fillColor: '#21648b', fillOpacity: 0.18 },
    hover: { color: '#bde9ff', weight: 2, fillColor: '#4facfe', fillOpacity: 0.42 },
    selected: { color: '#fff', weight: 3, fillColor: '#4facfe', fillOpacity: 0.7 },
    correct: { color: '#fff', weight: 3, fillColor: '#43e97b', fillOpacity: 0.75 },
    incorrect: { color: '#fff', weight: 3, fillColor: '#ff4d6d', fillOpacity: 0.75 }
  },
  pointStyle: {
    base: { color: '#fff', weight: 2, fillColor: '#2b7fd4', fillOpacity: 0.95 },
    hover: { color: '#fff', weight: 2, fillColor: '#8fd0ff', fillOpacity: 1 },
    selected: { color: '#fff', weight: 3, fillColor: '#4facfe', fillOpacity: 1 },
    correct: { color: '#fff', weight: 3, fillColor: '#43e97b', fillOpacity: 1 },
    incorrect: { color: '#fff', weight: 3, fillColor: '#ff4d6d', fillOpacity: 1 }
  },

  radius() { return this.map && this.map.getZoom() >= 6 ? 10 : 8; },
  render(map, dataset) {
    this._session++;
    this.map = map;
    this.dataset = dataset;
    this.layers = {};
    this._feedbackIds = new Set();
    this._tooltipLayer = null;
    this._hoverId = null;
    this.selectedId = null;
    this.layerGroup = L.layerGroup().addTo(map);
    // Poligoanele întâi; bulinele se adaugă ulterior și rămân deasupra.
    const areas = dataset.items.filter(item => item.marineType !== 'strait');
    const straits = dataset.items.filter(item => item.marineType === 'strait');
    this._straitIds = new Set(straits.map(item => item.id));
    this._feedbackStates = {};
    this._raster = !!(typeof GeoJSONTiles !== 'undefined' &&
      typeof GeoJSONTiles.marineLayer === 'function' &&
      typeof MapViewer !== 'undefined' && MapViewer.tileLayer?.hitTest &&
      typeof GeoJSONTiles.rasterSupported === 'function' && !GeoJSONTiles._workerFailed);
    if (this._raster) {
      const raster = GeoJSONTiles.marineLayer(dataset, {
        onRasterFailure: failed => {
          if (MapViewer.marineLayer !== failed || this.map !== map) return;
          this._raster = false;
          this._session++;
          this._hitSeq++;
          map.off('click', this._mapClick);
          for (const id of [...this._feedbackIds]) {
            if (this._straitIds.has(id)) continue;
            this.layerGroup.removeLayer(this.layers[id]);
            delete this.layers[id];
          }
          this._renderAreas(areas);
          for (const id of this._feedbackIds)
            this.layers[id]?.setStyle(this.styleFor(id, this._feedbackStates[id] || 'selected'));
          map.removeLayer(failed);
          MapViewer.marineLayer = null;
        }
      });
      MapViewer.marineLayer = raster;
      raster.addTo(map);
      this._mapClick = e => {
        if (!this.armed) return;
        const session = this._session, sequence = ++this._hitSeq;
        raster.hitTest(e.latlng).then(id => {
          if (id && this.armed && this._raster && this._session === session &&
              this._hitSeq === sequence) this.pick(id);
        }).catch(err => console.warn('[marine] Hit-test indisponibil:', err));
      };
      map.on('click', this._mapClick);
    } else {
      this._renderAreas(areas);
    }
    straits.forEach(item => {
      const layer = L.circleMarker(item.center, {
        radius: this.radius(), bubblingMouseEvents: false, pane: 'gfMarine', ...this.pointStyle.base
      });
      layer.on('click', e => {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        this._hitSeq++;
        this.pick(item.id);
      });
      layer.on('mouseover', () => {
        if (this.armed && this.selectedId !== item.id) {
          this._hoverId = item.id;
          layer.setStyle(this.pointStyle.hover);
        }
      });
      layer.on('mouseout', () => {
        if (this._hoverId === item.id) this._hoverId = null;
        if (this.armed && this.selectedId !== item.id) layer.setStyle(this.pointStyle.base);
      });
      layer.addTo(this.layerGroup);
      this.layers[item.id] = layer;
    });
    this._zoomHandler = () => straits.forEach(item => this.layers[item.id]?.setRadius(this.radius()));
    map.on('zoomend', this._zoomHandler);
  },
  _renderAreas(areas) {
    areas.forEach(item => {
      const layer = L.geoJSON({ type: 'Feature', geometry: item.geometry, properties: {} }, {
        style: this.areaStyle.base, bubblingMouseEvents: false, pane: 'gfMarine'
      });
      layer.on('click', e => {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        this.pick(item.id);
      });
      layer.on('mouseover', () => {
        if (this.armed && this.selectedId !== item.id) {
          this._hoverId = item.id;
          layer.setStyle(this.areaStyle.hover);
        }
      });
      layer.on('mouseout', () => {
        if (this._hoverId === item.id) this._hoverId = null;
        if (this.armed && this.selectedId !== item.id) layer.setStyle(this.areaStyle.base);
      });
      layer.addTo(this.layerGroup);
      this.layers[item.id] = layer;
    });
  },
  arm(question, onSelect) {
    this._hitSeq++;
    this.resetStyles();
    this.armed = true;
    this.onSelect = onSelect;
    this.selectedId = null;
  },
  styleFor(id, state) {
    return this._straitIds.has(id) ? this.pointStyle[state] : this.areaStyle[state];
  },
  setStyle(id, state) {
    if (this._feedbackStates) {
      if (state === 'base') delete this._feedbackStates[id];
      else this._feedbackStates[id] = state;
    }
    let layer = this.layers[id];
    if (this._raster && !this._straitIds.has(id)) {
      if (state === 'base') {
        if (layer) this.layerGroup.removeLayer(layer);
        delete this.layers[id];
        this._feedbackIds.delete(id);
        return;
      }
      if (!layer) {
        const item = this.dataset.items.find(item => item.id === id);
        if (!item) return;
        layer = L.geoJSON({ type: 'Feature', geometry: item.geometry, properties: {} }, {
          style: this.styleFor(id, state), interactive: false, pane: 'gfMarine'
        }).addTo(this.layerGroup);
        this.layers[id] = layer;
      }
    }
    if (layer) layer.setStyle(this.styleFor(id, state));
    if (state !== 'base') this._feedbackIds.add(id);
    else this._feedbackIds.delete(id);
  },
  pick(id) {
    if (!this.armed) return;
    if (this.selectedId === id) return;
    // Prepare the new outline before discarding the previous one.
    this.setStyle(id, 'selected');
    if (this.selectedId) this.setStyle(this.selectedId, 'base');
    this.selectedId = id;
    if (this.onSelect) this.onSelect({ chosenId: id });
  },
  hasSelection() { return !!this.selectedId; },
  commit() {
    if (!this.selectedId) return null;
    this.armed = false;
    this._hitSeq++;
    if (this._hoverId && this._hoverId !== this.selectedId)
      this.layers[this._hoverId].setStyle(this.styleFor(this._hoverId, 'base'));
    this._hoverId = null;
    return { chosenId: this.selectedId };
  },
  evaluate(input, question) {
    return { correct: input.chosenId === question.id, chosenId: input.chosenId, distance: null };
  },
  reveal(question, result) {
    if (!result.correct && result.chosenId !== question.id) this.setStyle(result.chosenId, 'incorrect');
    this.setStyle(question.id, 'correct');
    const layer = this.layers[question.id];
    if (layer) {
      this._tooltipLayer = layer;
      layer.bindTooltip(question.name, { permanent: true, direction: 'top', className: 'map-tooltip' })
        .openTooltip(L.latLng(question.center[0], question.center[1]));
    }
  },
  resetStyles() {
    // Only the previous answer can carry a non-base style. Avoid touching
    // every marine geometry before every question on slower mobile devices.
    for (const id of [...this._feedbackIds]) this.setStyle(id, 'base');
    if (this._hoverId && this.layers[this._hoverId])
      this.layers[this._hoverId].setStyle(this.styleFor(this._hoverId, 'base'));
    this._hoverId = null;
    if (this._tooltipLayer) this._tooltipLayer.unbindTooltip();
    this._tooltipLayer = null;
  },
  cleanup() {
    this._session++;
    this._hitSeq++;
    if (this.map && this._mapClick) this.map.off('click', this._mapClick);
    if (this.map && MapViewer.marineLayer) this.map.removeLayer(MapViewer.marineLayer);
    if (typeof MapViewer !== 'undefined') MapViewer.marineLayer = null;
    if (this.map && this._zoomHandler) this.map.off('zoomend', this._zoomHandler);
    if (this.map && this.layerGroup) this.map.removeLayer(this.layerGroup);
    this.map = null;
    this.layerGroup = null;
    this.layers = {};
    this._feedbackIds = null;
    this._tooltipLayer = null;
    this._straitIds = null;
    this._hoverId = null;
    this.dataset = null;
    this.armed = false;
    this.selectedId = null;
    this.onSelect = null;
    this._zoomHandler = null;
    this._mapClick = null;
    this._raster = false;
    this._feedbackStates = null;
  }
});