/* ============================================================ */
/* MAP - Leaflet viewer                                          */
/* Nu stie nimic despre logica jocului; doar creeaza harta si    */
/* ofera utilitare de vizualizare.                               */
/* ============================================================ */
const MapViewer = {
  map: null,
  currentGameId: null,
  isInitialized: false,

  /* Harta folosește geometrii complete per țară. */
  tileLayer: null,
  marineLayer: null,
  rasterLayer: null,
  detailLayer: null,
  _rendererFrame: null,

  /* Leaflet 1.9 updates SVG/Canvas clip bounds and viewBox only on moveend.
     While dragging, freshly streamed polygons would otherwise remain clipped
     outside the old viewport even though their layers have already loaded. */
  _refreshRenderers() {
    const map = this.map;
    if (!map || map._animatingZoom || map._gfZooming || map.touchZoom?._zooming) return;
    const renderers = new Set([map._renderer, ...Object.values(map._paneRenderers || {})]);
    for (const renderer of renderers) {
      if (renderer && renderer._container) renderer._update();
    }
  },

  _scheduleRendererRefresh() {
    if (this._rendererFrame !== null) return;
    const map = this.map;
    this._rendererFrame = requestAnimationFrame(() => {
      this._rendererFrame = null;
      if (map === this.map) this._refreshRenderers();
    });
  },

  _stopRendererRefresh() {
    if (this._rendererFrame !== null) cancelAnimationFrame(this._rendererFrame);
    this._rendererFrame = null;
    if (this.map) this.map.off('move', this._scheduleRendererRefresh, this);
    if (this.map) this.map.off('zoomstart', this._zoomStart, this);
    if (this.map) this.map.off('zoomend', this._zoomEnd, this);
  },
  _zoomStart() { if (this.map) this.map._gfZooming = true; },
  _zoomEnd() { if (this.map) this.map._gfZooming = false; },

  isRomaniaGame(gameId = this.currentGameId) {
    return gameId === 'romania-rivers' || gameId === 'romania-capitals' ||
      gameId === 'romania-counties' || gameId === 'romania-relief-subunits';
  },

  isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  },

  showsReliefImage(gameId = this.currentGameId) {
    return gameId === 'romania-relief-subunits' || gameId === 'romania-rivers';
  },

  usesReliefDem() {
    return this.showsReliefImage();
  },

  colors() {
    if (this.isRomaniaGame()) {
      /* Light: verdele deschis și suprafața albă. Dark: aceeași paletă ca la celelalte jocuri. */
      if (!this.isLight()) return { sea: '#0a1224', land: '#20263c', landStroke: '#7281a5' };
      return { sea: '#c5e8bd', land: '#ffffff', landStroke: '#6f9f68' };
    }
    if (this.currentGameId === 'europe-countries' || this.currentGameId === 'europe-capitals' ||
        this.currentGameId === 'world-countries') {
      return { sea: '#eef1f8', land: '#f7f7f7', landStroke: '#000000' };
    }
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return light
      /* border* = exact stilul "base" al poligoanelor din jocul cu tari
         (js/modes/polygon-mode.js), ca fundalul sa arate identic */
      ? { sea: '#0f2f5c', land: '#ffffff', landStroke: '#9aaac4' }
      : { sea: '#0a1224', land: '#20263c', landStroke: '#7281a5' };
  },

  /* Reaplica paleta cand se schimba tema */
  refreshTheme() {
    const c = this.colors();
    const el = document.getElementById('map');
    if (el) el.style.background = c.sea;
    if (this._landBackdrop) this._landBackdrop.setStyle({ color: c.landStroke, fillColor: c.land, weight: 1, fillOpacity: 1 });
    if (this.tileLayer) this.tileLayer.refreshTheme();
    if (this.marineLayer) this.marineLayer.refreshTheme();
    if (this.rasterLayer) this.rasterLayer.refreshTheme();
    this.syncReliefDem();
  },

  async loadMap(gameId, dataset) {
    this.currentGameId = gameId;
    this._backgroundDataset = dataset;

    if (this.map) {
      this._stopRendererRefresh();
      this.map.remove();
      this.map = null;
    }
    this.tileLayer = null;
    this._reliefLight = null;
    this._reliefDark = null;
    this._landBackdrop = null;
    this.marineLayer = null;
    this.rasterLayer = null;
    this.detailLayer = null;

    const view = (dataset && dataset.view) || { center: [45.9, 25.0], zoom: 6 };

    this.map = L.map('map', {
      center: view.center,
      zoom: view.zoom,
      zoomSnap: 0,
      zoomDelta: 0.25,
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      minZoom: Number.isFinite(view.minZoom) ? view.minZoom : 3,
      maxZoom: 12
    });
    this.map.getContainer().classList.toggle('romania-palette', this.isRomaniaGame(gameId));
    // Keep Leaflet's SVG clip bounds aligned with the moving map. This is
    // needed for streamed country geometry as well as the marine overlay;
    // the frame guard in _scheduleRendererRefresh prevents duplicate work.
    this.map.on('move', this._scheduleRendererRefresh, this);
    this.map.on('zoomstart', this._zoomStart, this);
    this.map.on('zoomend', this._zoomEnd, this);

    /* Singurele straturi ale hărții sunt tile-urile enriched. */
    this.map.createPane('gfRelief');
    this.map.getPane('gfRelief').style.zIndex = 180;
    this.map.getPane('gfRelief').style.pointerEvents = 'none';
    this.map.createPane('gfTiles');
    this.map.getPane('gfTiles').style.zIndex = 200;
    this.map.createPane('gfSimple');
    this.map.getPane('gfSimple').style.zIndex = 215;
    this.map.getPane('gfSimple').style.pointerEvents = 'none';
    this.map.createPane('gfDetail');
    this.map.getPane('gfDetail').style.zIndex = 225;
    this.map.getPane('gfDetail').style.pointerEvents = 'none';
    this.map.createPane('gfMarine');
    this.map.getPane('gfMarine').style.zIndex = 300;
    this.map.createPane('gfMarineRaster');
    this.map.getPane('gfMarineRaster').style.zIndex = 275;
    this.map.getPane('gfMarineRaster').style.pointerEvents = 'none';

    await this.addTiledBackground();
    this.refreshTheme();

    this.isInitialized = true;

    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 100);

    return this.map;
  },

  async addTiledBackground() {
    const map = this.map;
    try {
      if (this.showsReliefImage()) {
        await this.addReliefDem(map);
        if (map !== this.map) return;
        const credit = this.currentGameId === 'romania-rivers'
          ? 'Relief: AWS Terrain Tiles'
          : 'Relief: AWS Terrain Tiles; subunități: Posea și Badea, 1984 / geo-spatial.org';
        map.attributionControl.addAttribution(credit);
      }
      if (this.currentGameId === 'romania-counties' || this.currentGameId === 'romania-capitals' ||
          this.currentGameId === 'romania-relief-subunits') {
        const polygons = this.currentGameId === 'romania-capitals'
          ? await DataLoader.loadGameData('romania-counties')
          : this._backgroundDataset;
        if (map !== this.map) return;
        this.tileLayer = GeoJSONTiles.countyLayer(polygons, this.currentGameId === 'romania-relief-subunits'
          ? { style: () => this.subunitStyle() }
          : {}).addTo(map);
        return;
      }
      const countries = await GeoJSONTiles.manifest('assets/data/countries-enriched/manifest.json');
      if (map !== this.map) return;
      let gameIds = null;
      if (this.currentGameId === 'europe-countries' || this.currentGameId === 'europe-capitals' ||
          this.currentGameId === 'europe-marine') {
        /* Capitalele folosesc aceleași granițe ca jocul cu țări. */
        const borders = this.currentGameId === 'europe-countries'
          ? this._backgroundDataset : await DataLoader.loadGameData('europe-countries');
        if (map !== this.map) return;
        const ids = new Set(borders.items.map(item => item.id));
        const aliases = { NLD: 'olanda', GBR: 'regatul-unit', VAT: 'vatican' };
        gameIds = new Map();
        for (const country of countries.countries) {
          const id = aliases[country.iso3] || country.gameId;
          if (ids.has(id)) gameIds.set(country.iso3, id);
        }
      }
      /* România folosește exclusiv geometria SIMPLE; geometria FAST nu este
         cerută/încărcată pentru ea. Vecinii europeni folosesc doar FAST. */
      const europe = new Set(('ALB AND AUT BEL BGR BIH BLR CHE CYP CZE DEU DNK ESP EST FIN FRA GBR GRC HRV HUN IRL ISL ITA LIE LTU LUX LVA MCO MDA MKD MLT MNE NLD NOR POL PRT ROU RUS SMR SRB SVK SVN SWE TUR UKR VAT').split(' '));
      const rivers = this.currentGameId === 'romania-rivers';
      const tileOptions = this.currentGameId === 'europe-marine'
        ? {
            include: europe,
            maxTier: 'simple-fast',
            // Playable European countries get their readable simple geometry;
            // every other country remains a cheap fast background.
            tierFor: (_country, playable) => playable ? 'simple' : 'fast',
            onChunkAdded: () => this._scheduleRendererRefresh()
          }
        : rivers ? {
            /* Râurile României au nevoie de un singur fundal: România.
               Nu solicita geometria niciunei alte țări. */
            include: new Set(['ROU']),
            tierFor: () => 'simple',
            maxTier: 'simple',
          } : {};
      tileOptions.onRasterFailure = failedLayer => {
        if (this.map !== map || this.tileLayer !== failedLayer) return;
        const replacement = GeoJSONTiles.layer(countries, gameIds, tileOptions).addTo(map);
        this.tileLayer = replacement;
        if (this.currentGameId === 'europe-countries' || this.currentGameId === 'world-countries') {
          GameModes.get('polygon').useVectorHitboxes();
        }
        map.removeLayer(failedLayer);
      };
      /* Tot fundalul este raster în worker; numai feedback-ul rămâne SVG.
         Fallback vectorial pe browsere fără OffscreenCanvas. */
      if (!rivers && typeof GeoJSONTiles.rasterSupported === 'function' && await GeoJSONTiles.rasterSupported()) {
        if (map !== this.map) return;
        this.tileLayer = GeoJSONTiles.backgroundLayer(countries, gameIds, tileOptions);
        this.tileLayer.addTo(map);
      } else {
        this.tileLayer = GeoJSONTiles.layer(countries, gameIds, tileOptions).addTo(map);
      }
      map.attributionControl.addAttribution('Boundaries: geoBoundaries CGAZ (CC BY 4.0)');
      if (this.currentGameId === 'europe-marine') {
        map.attributionControl.addAttribution('Marine areas: VLIZ / Marine Regions, SeaVoX v19');
      }
    } catch (err) {
      console.warn('[MapViewer] tile-urile indisponibile; nu se afișează o hartă legacy:', err);
    }
  },

  subunitStyle() {
    if (this.showsReliefImage()) {
      return this.isLight()
        ? { color: '#5c4632', weight: 1.15, fillOpacity: 0, opacity: 0.9 }
        : { color: '#c5ccd8', weight: 1.15, fillOpacity: 0, opacity: 0.85 };
    }
    const colors = this.colors();
    return { color: colors.landStroke, fillColor: colors.land, weight: 1, fillOpacity: 1, opacity: 1 };
  },

  reliefBounds() {
    return [[43.5, 20.0], [48.4, 30.0]];
  },

  syncReliefDem() {
    if (!this.map || !this._reliefLight || !this._reliefDark) return;
    if (!this.showsReliefImage()) {
      if (this.map.hasLayer(this._reliefLight)) this.map.removeLayer(this._reliefLight);
      if (this.map.hasLayer(this._reliefDark)) this.map.removeLayer(this._reliefDark);
      return;
    }
    if (!this.map.hasLayer(this._reliefLight)) this._reliefLight.addTo(this.map);
    if (!this.map.hasLayer(this._reliefDark)) this._reliefDark.addTo(this.map);
    const light = this.isLight();
    this._reliefLight.setOpacity(light ? 1 : 0);
    this._reliefDark.setOpacity(light ? 0 : 1);
  },

  async addReliefDem(map) {
    const urls = ['assets/images/relief/romania-dem-autumn.jpg', 'assets/images/relief/romania-dem-dark.jpg'];
    await Promise.all(urls.map(url => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = () => reject(new Error('DEM indisponibil'));
      image.src = url;
    })));
    if (map !== this.map || !map.getPane('gfRelief')) return;
    const bounds = this.reliefBounds();
    const light = this.isLight();
    const common = { pane: 'gfRelief', interactive: false, className: 'gf-relief-dem' };
    this._reliefLight = L.imageOverlay(urls[0], bounds, { ...common, opacity: light ? 1 : 0 });
    this._reliefDark = L.imageOverlay(urls[1], bounds, { ...common, opacity: light ? 0 : 1 });
    this.syncReliefDem();
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
      this._stopRendererRefresh();
      this.map.remove();
      this.map = null;
    }
    this.tileLayer = null;
    this._reliefLight = null;
    this._reliefDark = null;
    this._landBackdrop = null;
    this.marineLayer = null;
    this.rasterLayer = null;
    this.detailLayer = null;
    this.isInitialized = false;
    this.currentGameId = null;
    this._backgroundDataset = null;
  }
};

window.MapViewer = MapViewer;
