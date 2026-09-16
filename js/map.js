/* ============================================================ */
/* MAP - Leaflet viewer                                          */
/* Nu stie nimic despre logica jocului; doar creeaza harta si    */
/* ofera utilitare de vizualizare.                               */
/* ============================================================ */
const MapViewer = {
  map: null,
  tileLayer: null,
  currentGameId: null,
  isInitialized: false,

  /* ZERO tile-uri raster: orice serviciu extern vine cu toponime sau
     granite. Fundalul e desenat local din uscatul mondial (GeoJSON),
     deci harta nu poate afisa niciun nume, in nicio limba. */
  landLayer: null,
  reliefLayer: null,
  bordersLayer: null,

  colors() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return light
      /* border* = exact stilul "base" al poligoanelor din jocul cu tari
         (js/modes/polygon-mode.js), ca fundalul sa arate identic */
      ? { sea: '#0f2f5c', land: '#ffffff', landStroke: '#ffffff',
          border: '#9aa6c4', borderFill: '#ffffff', borderWeight: 0.8, borderFillOpacity: 1 }
      : { sea: '#0a1224', land: '#20263c', landStroke: '#20263c',
          border: '#7f8dbd', borderFill: '#2f3a5f', borderWeight: 1, borderFillOpacity: 0.9 };
  },

  /* Paleta hipsometrica: banda 0 = campie ... banda 4 = munte inalt.
     Indicii corespund pragurilor din generate-relief.py (200/500/800/1500 m). */
  reliefPalette() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return light
      ? ['#c8e6a0', '#e9edA0', '#e8d59a', '#c9a26b', '#8b6b4a']
      /* dark: albastru-gri rece -> sepia cald, desaturat si cu luminozitate
         joasa, ca liniile albastre ale raurilor sa iasa clar deasupra */
      : ['#22303f', '#2b3a42', '#3a4240', '#4d483f', '#5f5244'];
  },

  reliefStyle(feature) {
    const palette = this.reliefPalette();
    const band = feature && feature.properties ? feature.properties.band : 0;
    return {
      fillColor: palette[Math.min(band, palette.length - 1)] || palette[0],
      color: 'transparent',
      weight: 0,
      fillOpacity: 1,
      opacity: 1
    };
  },


  /* Reaplica paleta cand se schimba tema */
  refreshTheme() {
    const c = this.colors();
    const el = document.getElementById('map');
    if (el) el.style.background = c.sea;
    if (this.landLayer) {
      this.landLayer.setStyle({
        fillColor: c.land, color: c.landStroke, weight: 0.6, fillOpacity: 1, opacity: 1
      });
    }
    if (this.reliefLayer) {
      this.reliefLayer.eachLayer(l => l.setStyle(this.reliefStyle(l.feature)));
    }
    if (this.bordersLayer) {
      this.bordersLayer.setStyle({
        fillColor: c.borderFill, fillOpacity: c.borderFillOpacity,
        color: c.border, weight: c.borderWeight, opacity: 1
      });
    }
  },

  async loadMap(gameId, dataset) {
    this.currentGameId = gameId;

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    const view = (dataset && dataset.view) || { center: [45.9, 25.0], zoom: 6 };

    this.map = L.map('map', {
      center: view.center,
      zoom: view.zoom,
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      minZoom: Number.isFinite(view.minZoom) ? view.minZoom : 3,
      maxZoom: 12
    });

    /* Panouri proprii: uscat (200) < relief (250) < granite (350) < overlay jocului (400) */
    this.map.createPane('gfLand');
    this.map.getPane('gfLand').style.zIndex = 200;
    this.map.createPane('gfRelief');
    this.map.getPane('gfRelief').style.zIndex = 250;
    this.map.createPane('gfBorders');
    this.map.getPane('gfBorders').style.zIndex = 350;
    this.map.getPane('gfBorders').style.pointerEvents = 'none';

    /* Fundal desenat local: marea = culoarea containerului, uscatul = poligoane */
    await this.addLandBackground();
    /* relieful se incarca doar pentru seturile care il cer (ex. Romania) */
    if (dataset && dataset.relief) await this.addReliefBackground();
    if (dataset && dataset.borders) await this.addBordersBackground(dataset.borders);
    this.refreshTheme();

    this.isInitialized = true;

    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 100);

    return this.map;
  },

  /* Uscatul mondial ca strat de fundal (fara nume, fara granite) */
  async addLandBackground() {
    if (!this.map) return;
    try {
      if (!MapViewer._landGeo) {
        const res = await fetch('assets/data/base/land.geojson');
        if (!res.ok) throw new Error('land.geojson lipseste');
        MapViewer._landGeo = await res.json();
      }
      const c = this.colors();
      this.landLayer = L.geoJSON(MapViewer._landGeo, {
        interactive: false,
        pane: 'gfLand',
        style: { fillColor: c.land, color: c.landStroke, weight: 0.6, fillOpacity: 1, opacity: 1 }
      }).addTo(this.map);
      if (this.landLayer.bringToBack) this.landLayer.bringToBack();
    } catch (err) {
      /* fara fundal: raman doar poligoanele jocului pe fond de mare */
      console.warn('[MapViewer] fundal uscat indisponibil:', err.message);
    }
  },

  /* Benzi hipsometrice (campie / dealuri / podis / munte) peste uscat */
  async addReliefBackground() {
    if (!this.map) return;
    try {
      if (!MapViewer._reliefGeo) {
        const res = await fetch('assets/data/base/relief_ro.geojson');
        if (!res.ok) throw new Error('relief_ro.geojson lipseste');
        MapViewer._reliefGeo = await res.json();
      }
      this.reliefLayer = L.geoJSON(MapViewer._reliefGeo, {
        interactive: false,
        pane: 'gfRelief',
        style: f => this.reliefStyle(f)
      }).addTo(this.map);
      /* sub straturile jocului, dar peste uscatul alb */
      if (this.reliefLayer.bringToBack) this.reliefLayer.bringToBack();
      if (this.landLayer && this.landLayer.bringToBack) this.landLayer.bringToBack();
    } catch (err) {
      console.warn('[MapViewer] relief indisponibil:', err.message);
    }
  },

  /* Granitele tarilor: exact acelasi set (filtrat, normalizat) folosit de
     jocul cu tari, ca fundalul sa fie identic vizual. `borderSource` e
     id-ul unui dataset (ex. 'europe-countries'). */
  async addBordersBackground(borderSource) {
    if (!this.map) return;
    const gameId = typeof borderSource === 'string' ? borderSource : 'europe-countries';
    try {
      if (!MapViewer._bordersGeo) MapViewer._bordersGeo = {};
      if (!MapViewer._bordersGeo[gameId]) {
        const src = await DataLoader.loadGameData(gameId);
        MapViewer._bordersGeo[gameId] = {
          type: 'FeatureCollection',
          features: src.items
            .filter(it => it.geometry)
            .map(it => ({ type: 'Feature', properties: { id: it.id }, geometry: it.geometry }))
        };
      }
      const c = this.colors();
      this.bordersLayer = L.geoJSON(MapViewer._bordersGeo[gameId], {
        interactive: false,
        pane: 'gfBorders',
        style: {
          fillColor: c.borderFill, fillOpacity: c.borderFillOpacity,
          color: c.border, weight: c.borderWeight, opacity: 1
        }
      }).addTo(this.map);
    } catch (err) {
      console.warn('[MapViewer] granite indisponibile:', err.message);
    }
  },

  /* Incadreaza harta pe intreg setul de date */
  fitToDataset(dataset) {
    if (!this.map || !dataset || !dataset.items.length) return;
    const bounds = L.latLngBounds([]);
    dataset.items.forEach(it => bounds.extend(L.latLng(it.center[0], it.center[1])));
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [30, 30] });
    }
  },

  /* Puls colorat pe o pozitie [lat, lng] */
  flashFeature(center, color) {
    if (!this.map) return;
    const latlng = Array.isArray(center) ? L.latLng(center[0], center[1]) : center;

    const marker = L.circleMarker(latlng, {
      radius: 8,
      fillColor: color,
      color: color,
      weight: 3,
      opacity: 0.9,
      fillOpacity: 0.35,
      interactive: false
    }).addTo(this.map);

    const map = this.map;
    let start = null;
    const duration = 900;

    const animate = (ts) => {
      if (!start) start = ts;
      const t = (ts - start) / duration;
      if (t < 1 && map.hasLayer(marker)) {
        marker.setRadius(8 + t * 26);
        marker.setStyle({ opacity: 0.9 * (1 - t), fillOpacity: 0.35 * (1 - t) });
        requestAnimationFrame(animate);
      } else if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    };
    requestAnimationFrame(animate);
  },

  /* Blocheaza/deblocheaza interactiunea cu harta (in timpul feedback-ului) */
  setInteractive(on) {
    if (!this.map) return;
    const handlers = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];
    handlers.forEach(h => {
      if (this.map[h]) on ? this.map[h].enable() : this.map[h].disable();
    });
  },

  cleanup() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.landLayer = null;
    this.reliefLayer = null;
    this.bordersLayer = null;
    this.tileLayer = null;
    this.isInitialized = false;
    this.currentGameId = null;
  }
};

window.MapViewer = MapViewer;
