/* ============================================================ */
/* GAME MODES REGISTRY                                           */
/* Fiecare mod implementeaza:                                    */
/*   kind                                                        */
/*   render(map, dataset)                                        */
/*   arm(question, onAnswer)                                     */
/*   evaluate(input, question) -> { correct, chosenId, distance }*/
/*   reveal(question, result)                                    */
/*   cleanup()                                                   */
/* ============================================================ */
const GameModes = {
  _modes: {},

  register(kind, mode) {
    mode.kind = kind;
    this._modes[kind] = mode;
  },

  get(kind) {
    const m = this._modes[kind];
    if (!m) throw new Error(`Mod de joc necunoscut: ${kind}`);
    return m;
  },

  has(kind) {
    return !!this._modes[kind];
  }
};

/* ---------- Utilitare geometrice comune modurilor ---------- */
const GeoUtils = {

  /* Distanta in metri intre doua LatLng */
  dist(map, a, b) {
    return map.distance(a, b);
  },

  /* Point-in-polygon (ray casting) pe coordonate GeoJSON [lng, lat] */
  pointInRing(pt, ring) {
    let inside = false;
    const x = pt[0], y = pt[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  pointInPolygon(pt, polygon) {
    if (!this.pointInRing(pt, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
      if (this.pointInRing(pt, polygon[i])) return false; // hole
    }
    return true;
  },

  pointInGeometry(pt, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return this.pointInPolygon(pt, geom.coordinates);
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.some(poly => this.pointInPolygon(pt, poly));
    }
    return false;
  },

  /* Distanta minima (metri) de la un LatLng la o geometrie liniara */
  distanceToLine(map, latlng, geom) {
    const lines = geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.type === 'MultiLineString' ? geom.coordinates : [];

    const p = map.project(latlng, 12);
    let best = Infinity;

    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = map.project(L.latLng(line[i - 1][1], line[i - 1][0]), 12);
        const b = map.project(L.latLng(line[i][1], line[i][0]), 12);
        const d = this._segDist(p, a, b);
        if (d < best) best = d;
      }
    }
    if (best === Infinity) return Infinity;

    /* px la zoom 12 -> metri, aproximat prin latitudine */
    const metersPerPixel = 156543.03392 * Math.cos(latlng.lat * Math.PI / 180) / Math.pow(2, 12);
    return best * metersPerPixel;
  },

  _segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  }
};

window.GameModes = GameModes;
window.GeoUtils = GeoUtils;
