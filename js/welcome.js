/* ============================================ */
/* WELCOME SCREEN                               */
/* ============================================ */
const WelcomeScreen = {
  container: null,
  MIN_MS: 2000,
  PHOTO_CAP_MS: 8000,
  ZOOM_S: 0.85,
  FADE_S: 0.35,
  SCALE: 1.4,

  init() {
    this.container = document.getElementById('welcome-screen');
  },

  reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },

  async hold() {
    this.enter();
    const started = performance.now();
    await this.photos();
    const left = this.MIN_MS - (performance.now() - started);
    if (left > 0) await new Promise(resolve => setTimeout(resolve, left));
  },

  enter() {
    if (this.reduced() || !window.gsap) return;
    gsap.from('.welcome-container', { opacity: 0, y: 14, duration: 0.55, ease: 'power2.out' });
  },

  photos() {
    const images = Array.from(document.querySelectorAll('#menu-screen .card-photo'));
    const pending = images.map(img => new Promise(resolve => {
      const finish = () => {
        if (typeof img.decode === 'function') img.decode().then(resolve, resolve);
        else resolve();
      };
      if (img.complete) finish();
      else {
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }
    }));
    return Promise.race([
      Promise.all(pending),
      new Promise(resolve => setTimeout(resolve, this.PHOTO_CAP_MS))
    ]);
  },

  depart() {
    const reduce = this.reduced();
    return {
      revealAt: reduce ? 0 : Math.round((this.ZOOM_S - this.FADE_S) * 1000),
      done: this.playExit(reduce)
    };
  },

  async playExit(reduce) {
    const screen = this.container;
    if (!screen) return;
    if (reduce) {
      await gsap.to(screen, { opacity: 0, duration: 0.2, ease: 'power2.out' });
    } else {
      const tl = gsap.timeline();
      tl.to(screen, {
        scale: this.SCALE,
        duration: this.ZOOM_S,
        ease: 'power3.inOut',
        transformOrigin: '50% 50%'
      }, 0);
      tl.to(screen, {
        opacity: 0,
        duration: this.FADE_S,
        ease: 'power2.out'
      }, this.ZOOM_S - this.FADE_S);
      await tl;
    }
    screen.classList.remove('active');
    gsap.set(screen, { clearProps: 'opacity,transform,transformOrigin' });
    if (window.Theme) Theme.apply(Theme.current(), false);
  }
};

window.WelcomeScreen = WelcomeScreen;
