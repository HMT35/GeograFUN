/* ============================================================ */
/* PIN - drag cu offset (stil Street View)                       */
/* Pointer Events, listeneri atasati o singura data.             */
/* ============================================================ */
const PinControl = {
  pinMarker: null,
  pinZone: null,
  isDragging: false,
  currentLatLng: null,
  offset: { x: 0, y: -64 },   // pin-ul pluteste deasupra degetului
  onDrop: null,
  enabled: false,
  bound: false,

  init() {
    this.pinMarker = document.getElementById('pin-marker');
    this.pinZone = document.getElementById('pin-button');
    if (!this.bound) {
      this.bind();
      this.bound = true;
    }
  },

  bind() {
    this.pinZone.addEventListener('pointerdown', e => this.onDown(e));
    this.pinZone.addEventListener('pointermove', e => this.onMove(e));
    this.pinZone.addEventListener('pointerup', e => this.onUp(e));
    this.pinZone.addEventListener('pointercancel', e => this.onUp(e));
  },

  enable(onDropCallback) {
    this.onDrop = onDropCallback || null;
    this.enabled = true;
  },

  disable() {
    this.enabled = false;
    this.onDrop = null;
    this.hidePin();
  },

  onDown(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.pinZone.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.pinMarker.classList.add('active');
    this.update(e.clientX, e.clientY);
  },

  onMove(e) {
    if (!this.enabled || !this.isDragging) return;
    e.preventDefault();
    this.update(e.clientX, e.clientY);
  },

  onUp(e) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.pinMarker.classList.remove('active');
    try { this.pinZone.releasePointerCapture(e.pointerId); } catch (_) {}

    const latlng = this.currentLatLng;
    this.currentLatLng = null;
    if (latlng && this.onDrop && this.enabled) this.onDrop(latlng);
  },

  update(clientX, clientY) {
    const x = clientX + this.offset.x;
    const y = clientY + this.offset.y;

    this.pinMarker.style.left = x + 'px';
    this.pinMarker.style.top = y + 'px';

    if (MapViewer.map) {
      const rect = document.getElementById('map').getBoundingClientRect();
      /* varful pin-ului = baza markerului */
      const point = L.point(x - rect.left, y - rect.top + 34);
      this.currentLatLng = MapViewer.map.containerPointToLatLng(point);
    }
  },

  hidePin() {
    if (this.pinMarker) this.pinMarker.classList.remove('active');
    this.isDragging = false;
    this.currentLatLng = null;
  }
};

window.PinControl = PinControl;
