/* ============================================================ */
/* POINT MODE - capitale, resedinte de judet                     */
/* Toate punctele sunt vizibile ca cerculete (fara nume).        */
/* Utilizatorul alege un cerculet, apoi confirma. Fara pin.      */
/* ============================================================ */
GameModes.register('point', {

  map: null,
  dataset: null,
  layerGroup: null,
  markers: {},
  onSelect: null,
  armed: false,
  usesPin: false,
  needsConfirm: true,
  selectedId: null,
  _zoomHandler: null,

  style: {
    base:      { color: '#ffffff', weight: 1.5, fillColor: '#5fb0ff', fillOpacity: 0.75, opacity: 0.85 },
    hover:     { color: '#ffffff', weight: 2.5, fillColor: '#8fd0ff', fillOpacity: 0.95, opacity: 1 },
    selected:  { color: '#ffffff', weight: 3, fillColor: '#4facfe', fillOpacity: 1, opacity: 1 },
    correct:   { color: '#ffffff', weight: 3, fillColor: '#43e97b', fillOpacity: 1, opacity: 1 },
    incorrect: { color: '#ffffff', weight: 3, fillColor: '#ff4d6d', fillOpacity: 1, opacity: 1 }
  },

  /* raza creste cu zoom-ul: 4px la z=3, ~14px la z=10+ */
  radiusForZoom(zoom, boost) {
    const r = Math.max(4, Math.min(16, 3 + (zoom - 2) * 1.15));
    return boost ? r * 1.45 : r;
  },

  render(map, dataset) {
    this.map = map;
    this.dataset = dataset;
    this.markers = {};
    this.selectedId = null;
    this.layerGroup = L.layerGroup().addTo(map);

    const r = this.radiusForZoom(map.getZoom(), false);

    dataset.items.forEach(item => {
      const marker = L.circleMarker(L.latLng(item.center[0], item.center[1]), {
        radius: r,
        interactive: true,
        bubblingMouseEvents: false,
        ...this.style.base
      });

      marker._gfId = item.id;
      marker._gfState = 'base';

      marker.on('click', e => {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        this._pick(item.id);
      });
      marker.on('mouseover', () => {
        if (!this.armed || marker._gfState === 'selected') return;
        marker.setStyle(this.style.hover);
        marker.setRadius(this.radiusForZoom(this.map.getZoom(), true));
      });
      marker.on('mouseout', () => {
        if (!this.armed || marker._gfState === 'selected') return;
        marker.setStyle(this.style.base);
        marker.setRadius(this.radiusForZoom(this.map.getZoom(), false));
      });

      marker.addTo(this.layerGroup);
      this.markers[item.id] = marker;
    });

    this._zoomHandler = () => this._rescale();
    map.on('zoomend', this._zoomHandler);
  },

  _rescale() {
    if (!this.map) return;
    const z = this.map.getZoom();
    Object.values(this.markers).forEach(m => {
      const big = m._gfState !== 'base';
      m.setRadius(this.radiusForZoom(z, big));
    });
  },

  arm(question, onSelect) {
    this.onSelect = onSelect;
    this.armed = true;
    this.selectedId = null;
    this.resetStyles();
  },

  _pick(id) {
    if (!this.armed) return;
    if (this.selectedId && this.markers[this.selectedId]) {
      const prev = this.markers[this.selectedId];
      prev._gfState = 'base';
      prev.setStyle(this.style.base);
      prev.setRadius(this.radiusForZoom(this.map.getZoom(), false));
    }
    this.selectedId = id;
    const m = this.markers[id];
    if (m) {
      m._gfState = 'selected';
      m.setStyle(this.style.selected);
      m.setRadius(this.radiusForZoom(this.map.getZoom(), true));
      if (m.bringToFront) m.bringToFront();
    }
    if (this.onSelect) this.onSelect({ chosenId: id });
  },

  hasSelection() {
    return !!this.selectedId;
  },

  commit() {
    if (!this.selectedId) return null;
    this.armed = false;
    return { chosenId: this.selectedId };
  },

  evaluate(input, question) {
    return {
      correct: input.chosenId === question.id,
      chosenId: input.chosenId,
      distance: null
    };
  },

  reveal(question, result) {
    if (!result.correct && result.chosenId && result.chosenId !== question.id) {
      const wrong = this.markers[result.chosenId];
      if (wrong) {
        wrong._gfState = 'incorrect';
        wrong.setStyle(this.style.incorrect);
        wrong.setRadius(this.radiusForZoom(this.map.getZoom(), true));
      }
    }

    const m = this.markers[question.id];
    if (m) {
      m._gfState = 'correct';
      m.setStyle(this.style.correct);
      m.setRadius(this.radiusForZoom(this.map.getZoom(), true));
      if (m.bringToFront) m.bringToFront();
      m.bindTooltip(question.name, {
        permanent: true, direction: 'top', className: 'map-tooltip'
      }).openTooltip();
    }
  },

  resetStyles() {
    const z = this.map ? this.map.getZoom() : 5;
    Object.values(this.markers).forEach(m => {
      m._gfState = 'base';
      m.setStyle(this.style.base);
      m.setRadius(this.radiusForZoom(z, false));
      if (m.getTooltip && m.getTooltip()) m.unbindTooltip();
    });
  },

  cleanup() {
    this.armed = false;
    this.onSelect = null;
    this.selectedId = null;
    if (this.map && this._zoomHandler) this.map.off('zoomend', this._zoomHandler);
    this._zoomHandler = null;
    if (this.layerGroup && this.map) this.map.removeLayer(this.layerGroup);
    this.layerGroup = null;
    this.markers = {};
    this.dataset = null;
    this.map = null;
  }
});
