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
  usesPin: false,
  needsConfirm: true,
  selectedId: null,

  /* paleta se schimba cu tema: pe light tarile sunt albe pe mare albastra */
  get style() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    /* cand harta are relief dedesubt, umplutura de baza devine transparenta,
       ca sa se vada benzile hipsometrice; raman doar conturele */
    const relief = !!(this.dataset && this.dataset.relief);
    const baseFill = relief ? 0 : 1;

    return light
      ? {
          base:      { color: '#9aa6c4', weight: 0.8, fillColor: '#ffffff', fillOpacity: baseFill },
          hover:     { color: '#2b7fd4', weight: 2,   fillColor: '#dceaf9', fillOpacity: 1 },
          selected:  { color: '#123f75', weight: 4, dashArray: '3 5', fillColor: '#9ccbf5', fillOpacity: 1 },
          correct:   { color: '#073f26', weight: 5, dashArray: null, fillColor: '#5fdf9c', fillOpacity: 1 },
          incorrect: { color: '#64101f', weight: 5, dashArray: '10 6', fillColor: '#f8909f', fillOpacity: 1 }
        }
      : {
          base:      { color: '#7f8dbd', weight: 1, fillColor: '#2f3a5f', fillOpacity: relief ? 0 : 0.9 },
          hover:     { color: '#ffffff', weight: 2, fillColor: '#4a5a92', fillOpacity: 0.95 },
          selected:  { color: '#ffffff', weight: 4, dashArray: '3 5', fillColor: '#4facfe', fillOpacity: 0.9 },
          correct:   { color: '#ffffff', weight: 5, dashArray: null, fillColor: '#43e97b', fillOpacity: 0.85 },
          incorrect: { color: '#ffffff', weight: 5, dashArray: '10 6', fillColor: '#ff4d6d', fillOpacity: 0.85 }
        };
  },

  render(map, dataset) {
    this.map = map;
    this.dataset = dataset;
    this.layers = {};
    this.selectedId = null;
    this.layerGroup = L.layerGroup().addTo(map);

    dataset.items.forEach(item => {
      const layer = L.geoJSON(
        { type: 'Feature', properties: { id: item.id }, geometry: item.geometry },
        { style: this.style.base, interactive: true, bubblingMouseEvents: false }
      );

      layer.on('click', e => {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        this._pick(item.id);
      });
      layer.on('mouseover', () => {
        if (this.armed && item.id !== this.selectedId) layer.setStyle(this.style.hover);
      });
      layer.on('mouseout', () => {
        if (this.armed && item.id !== this.selectedId) layer.setStyle(this.style.base);
      });

      layer.addTo(this.layerGroup);
      this.layers[item.id] = layer;
    });

    this.resetStyles();
  },

  arm(question, onSelect) {
    this.onSelect = onSelect;
    this.armed = true;
    this.selectedId = null;
    this.resetStyles();
  },

  _pick(id) {
    if (!this.armed) return;
    if (this.selectedId && this.layers[this.selectedId]) {
      this.layers[this.selectedId].setStyle(this.style.base);
    }
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

  _setStyle(id, style) {
    const layer = this.layers[id];
    if (layer) {
      layer.setStyle(style);
      if (layer.bringToFront) layer.bringToFront();
    }
  },

  resetStyles() {
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
    this.armed = false;
    this.onSelect = null;
    this.selectedId = null;
    if (this.layerGroup && this.map) {
      this.map.removeLayer(this.layerGroup);
    }
    this.layerGroup = null;
    this.layers = {};
    this.dataset = null;
    this.map = null;
  }
});
