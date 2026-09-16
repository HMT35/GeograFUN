/* ============================================================ */
/* THEME - toggle global dark / light                            */
/* Butoanele traiesc in topbar-ul meniului si in header-ul       */
/* jocului (langa cronometru). Iconitele sunt SVG-uri custom:    */
/*   assets/icons/theme-moon.svg  (tema activa = dark)           */
/*   assets/icons/theme-sun.svg   (tema activa = light)          */
/* ============================================================ */
const Theme = {
  KEY: 'geografun-theme',
  buttons: [],

  ICONS: {
    dark:  'assets/icons/theme-moon.svg',
    light: 'assets/icons/theme-sun.svg'
  },

  init() {
    const saved = this.saved();
    const prefersLight = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;

    this.apply(saved || (prefersLight ? 'light' : 'dark'), false);

    this.buttons = Array.from(document.querySelectorAll('.theme-toggle'));
    this.buttons.forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      this.toggle();
    }));

    this.updateButtons();
  },

  saved() {
    try { return localStorage.getItem(this.KEY); } catch (_) { return null; }
  },

  current() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  },

  toggle() {
    this.apply(this.current() === 'light' ? 'dark' : 'light', true);
  },

  apply(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5fa' : '#1a1a2e');

    if (persist) {
      try { localStorage.setItem(this.KEY, theme); } catch (_) {}
    }

    this.updateButtons();

    if (window.MapViewer && MapViewer.refreshTheme) MapViewer.refreshTheme();
    /* modul de joc activ isi reaplica paleta */
    if (window.Game && Game.mode && Game.mode.resetStyles && !Game.locked) {
      try { Game.mode.resetStyles(); } catch (_) {}
    }
  },

  updateButtons() {
    if (!this.buttons || !this.buttons.length) {
      this.buttons = Array.from(document.querySelectorAll('.theme-toggle'));
    }
    const theme = this.current();
    const light = theme === 'light';
    const src = this.ICONS[theme] || this.ICONS.dark;
    const label = light ? 'Comută pe tema întunecată' : 'Comută pe tema luminoasă';

    this.buttons.forEach(btn => {
      const img = btn.querySelector('.theme-icon');
      if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
      btn.setAttribute('aria-label', label);
    });
  }
};

window.Theme = Theme;
