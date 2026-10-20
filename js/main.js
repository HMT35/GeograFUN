/* ============================================================ */
/* MAIN - punct de intrare                                       */
/* ============================================================ */
const App = {
  gameOpening: false,
  async init() {
    Theme.init();
    Scoring.loadResults();
    Menu.init();
    WelcomeScreen.init();
    this.setupEventListeners();
    Scoring.updateCardGlows();

    await WelcomeScreen.show();

    document.getElementById('menu-screen').classList.add('active');

    /* Layout-ul se re-declanseaza singur cand stage-ul are dimensiuni reale,
       deci pornim animatia de intrare abia dupa ce pozitiile sunt asezate. */
    Menu.layout(false);
    requestAnimationFrame(() => {
      gsap.from('.card', {
        opacity: 0,
        scale: 0.9,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.04
      });
    });

    /* Nu preîncărcăm alte jocuri sau hărți legacy. Datele metadata pentru
       jocul ales sunt încărcate la pornirea acelui joc. */
  },

  setupEventListeners() {
    document.addEventListener('game-start', e => {
      this.switchToGame(e.detail.gameId);
    });
    document.getElementById('game-back').addEventListener('click', () => {
      this.cancelGameTransition();
      Game.quit();
      Scoring.showMenu();
    });
  },
  cancelGameTransition() {
    if (this.transition) {
      this.transition.remove();
      this.transition.restoreMenu();
      this.transition = null;
    }
    this.gameOpening = false;
  },
  async switchToGame(gameId) {
    if (this.gameOpening) return;
    this.gameOpening = true;
    const transition = Menu.gameTransition(gameId);
    this.transition = transition;
    try {
      if (transition) await transition.zoom;
      if (transition && this.transition !== transition) return;
      const ready = await Game.start(gameId);
      if (!ready || !transition || this.transition !== transition) return;
      await new Promise(resolve => setTimeout(resolve, 200));
      const titleHold = Math.max(0, transition.titleVisibleAt + 500 - performance.now());
      if (titleHold) await new Promise(resolve => setTimeout(resolve, titleHold));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (this.transition === transition) await transition.dismiss();
    } catch (err) {
      console.error('Pornirea jocului a eșuat:', err);
      if (document.getElementById('game-screen').classList.contains('active')) {
        Game.setBanner('Jocul nu s-a putut pregăti. Reîncearcă.', '');
        document.getElementById('data-retry').hidden = false;
        document.getElementById('data-menu').hidden = false;
      }
    } finally {
      if (this.transition === transition) this.cancelGameTransition();
      else if (!transition) this.gameOpening = false;
    }
  }
};

/* Service Worker (PWA) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(
      registration => {
        console.log('ServiceWorker înregistrat');
        const precache = () => (navigator.serviceWorker.controller || registration.active)?.postMessage('precache-geometry');
        precache();
        navigator.serviceWorker.addEventListener('controllerchange', precache);
        registration.update().catch(() => {});
      },
      err => {
        if (err.name !== 'NotSupportedError' && err.name !== 'SecurityError')
          console.warn('ServiceWorker eșuat:', err);
      }
    );
  });
}

document.addEventListener('DOMContentLoaded', () => App.init());
