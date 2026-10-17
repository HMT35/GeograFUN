/* ============================================================ */
/* LINE MODE - rauri                                             */
/* Toate raurile sunt vizibile (fara nume). Hover = highlight    */
/* pulsing. Click = selectie. Raspunsul se trimite la confirm.   */
/* ============================================================ */
GameModes.register('line', {

  map: null,
  dataset: null,
  layerGroup: null,
  layers: {},
  pins: {},
  onSelect: null,
  armed: false,
  usesPin: false,
  needsConfirm: true,
  selectedId: null,
  hoverId: null,
  _pulseRaf: null,
  _pulseStart: 0,

  style: {
    base:      { color: '#5fb0ff', weight: 2.5, opacity: 0.55 },
    selected:  { color: '#4facfe', weight: 6, opacity: 1 },
    correct:   { color: '#43e97b', weight: 6, opacity: 1 },
    incorrect: { color: '#ff4d6d', weight: 5, opacity: 1 }
  },

  render(map, dataset) {
    this.map = map;
    this.dataset = dataset;
    this.layers = {};
    this.pins = {};
    this.selectedId = null;
    this.hoverId = null;
    this.layerGroup = L.layerGroup().addTo(map);

    dataset.items.forEach(item => {
      const layer = L.geoJSON(
        { type: 'Feature', properties: { id: item.id }, geometry: item.geometry },
        {
          style: this.style.base,
          interactive: true,
          bubblingMouseEvents: false,
          /* zona de click mai groasa decat linia desenata */
          onEachFeature: (f, l) => {
            if (l.setStyle) l.setStyle({ ...this.style.base });
          }
        }
      );

      layer.on('click', e => {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        this._pick(item.id);
      });
      layer.on('mouseover', () => this._hoverOn(item.id));
      layer.on('mouseout', () => this._hoverOff(item.id));

      layer.addTo(this.layerGroup);
      this.layers[item.id] = layer;

      /* Ținta punctuală este mult mai ușor de atins pe ecrane tactile decât
         o linie subțire. Centrul este calculat de DataLoader după geometria
         tăiată la granița României. */
      const pin = L.circleMarker([item.center[0], item.center[1]], {
        radius: 11,
        color: '#9ed8ff',
        weight: 2,
        opacity: 0.9,
        fillColor: '#3182ce',
        fillOpacity: 0.7,
        bubblingMouseEvents: false,
        interactive: true
      });
      pin.on('click', e => {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        this._pick(item.id);
      });
      pin.on('mouseover', () => this._hoverOn(item.id));
      pin.on('mouseout', () => this._hoverOff(item.id));
      pin.addTo(this.layerGroup);
      this.pins[item.id] = pin;
    });
  },

  /* ---------- hover pulsing ---------- */
  _hoverOn(id) {
    if (!this.armed || id === this.selectedId) return;
    this.hoverId = id;
    const layer = this.layers[id];
    if (!layer) return;
    if (layer.bringToFront) layer.bringToFront();
    this._pulseStart = performance.now();
    this._stopPulse();

    const tick = now => {
      if (this.hoverId !== id) return;
      const t = (now - this._pulseStart) / 900;
      const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      layer.setStyle({
        color: '#8fd0ff',
        weight: 4 + wave * 4,
        opacity: 0.7 + wave * 0.3
      });
      this._pulseRaf = requestAnimationFrame(tick);
    };
    this._pulseRaf = requestAnimationFrame(tick);
  },

  _hoverOff(id) {
    if (this.hoverId !== id) return;
    this.hoverId = null;
    this._stopPulse();
    const layer = this.layers[id];
    if (layer && id !== this.selectedId) layer.setStyle(this.style.base);
  },

  _stopPulse() {
    if (this._pulseRaf) {
      cancelAnimationFrame(this._pulseRaf);
      this._pulseRaf = null;
    }
  },

  arm(question, onSelect) {
    this.onSelect = onSelect;
    this.armed = true;
    this.selectedId = null;
    this.resetStyles();
  },

  _pick(id) {
    if (!this.armed) return;
    this._stopPulse();
    this.hoverId = null;
    if (this.selectedId && this.layers[this.selectedId]) {
      this.layers[this.selectedId].setStyle(this.style.base);
      this.pins[this.selectedId]?.setStyle({
        color: '#9ed8ff', fillColor: '#3182ce', weight: 2,
        opacity: 0.9, fillOpacity: 0.7
      });
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
    this._stopPulse();
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
      this._setStyle(result.chosenId, this.style.incorrect);
    }
    this._setStyle(question.id, this.style.correct);

    const layer = this.layers[question.id];
    if (layer) {
      layer.bindTooltip(question.name, {
        permanent: true, direction: 'top', className: 'map-tooltip', sticky: false
      }).openTooltip(L.latLng(question.center[0], question.center[1]));
    }
  },

  _setStyle(id, style) {
    const layer = this.layers[id];
    if (layer) {
      layer.setStyle(style);
      if (layer.bringToFront) layer.bringToFront();
    }
    const pin = this.pins[id];
    if (pin) pin.setStyle({
      color: style.color,
      fillColor: style.color,
      weight: style.weight >= 5 ? 3 : 2,
      opacity: style.opacity,
      fillOpacity: style.opacity >= 1 ? 0.9 : 0.7
    });
    if (pin && pin.bringToFront) pin.bringToFront();
  },

  resetStyles() {
    this._stopPulse();
    this.hoverId = null;
    Object.values(this.layers).forEach(l => {
      l.setStyle(this.style.base);
      if (l.getTooltip && l.getTooltip()) l.unbindTooltip();
    });
    Object.values(this.pins).forEach(pin => pin.setStyle({
      color: '#9ed8ff', fillColor: '#3182ce', weight: 2,
      opacity: 0.9, fillOpacity: 0.7
    }));
  },

  cleanup() {
    this.armed = false;
    this.onSelect = null;
    this.selectedId = null;
    this._stopPulse();
    this.hoverId = null;
    if (this.layerGroup && this.map) this.map.removeLayer(this.layerGroup);
    this.layerGroup = null;
    this.layers = {};
    this.pins = {};
    this.dataset = null;
    this.map = null;
  }
});
