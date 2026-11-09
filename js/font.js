/* ============================================================ */
/* FONT - selectorul global de tipografie                       */
/* ============================================================ */
const FontSettings = {
  KEY: 'geografun-font',
  DEFAULT: 'script',
  fadeTimer: null,

  init() {
    this.apply(this.saved(), false);

    document.querySelectorAll('[data-font-choice]').forEach(button => {
      button.addEventListener('click', () => {
        this.change(button.dataset.fontChoice);
      });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const next = button.dataset.fontChoice === 'inter' ? 'script' : 'inter';
        this.change(next);
        document.querySelector(`[data-font-choice="${next}"]`).focus();
      });
    });
  },

  change(font) {
    const value = font === 'inter' ? 'inter' : 'script';
    const root = document.documentElement;
    if (value === root.getAttribute('data-font') && !this.fadeTimer) return;

    clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.classList.remove('font-changing');
      this.apply(value, true);
      return;
    }

    root.classList.add('font-changing');
    this.fadeTimer = window.setTimeout(() => {
      this.fadeTimer = null;
      this.apply(value, true);
      requestAnimationFrame(() => root.classList.remove('font-changing'));
    }, 180);
  },

  saved() {
    try {
      const value = localStorage.getItem(this.KEY);
      return value === 'inter' || value === 'script' ? value : this.DEFAULT;
    } catch (_) {
      return this.DEFAULT;
    }
  },

  apply(font, persist) {
    const value = font === 'inter' ? 'inter' : 'script';
    const root = document.documentElement;
    root.setAttribute('data-font', value);

    document.querySelectorAll('[data-font-choice]').forEach(button => {
      const selected = button.dataset.fontChoice === value;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });

    if (persist) {
      try { localStorage.setItem(this.KEY, value); } catch (_) {}
    }
  }
};

window.FontSettings = FontSettings;