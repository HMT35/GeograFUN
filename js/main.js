/* ============================================================ */
/* MAIN - punct de intrare                                       */
/* ============================================================ */
const App = {
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
      Game.quit();
      Scoring.showMenu();
    });
  },

  async switchToGame(gameId) {
    await Game.start(gameId);
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
