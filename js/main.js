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

    /* Descarca sursele in fundal pentru offline */
    DataLoader.prefetchAll((done, total) => {
      console.log(`Date preîncărcate: ${done}/${total}`);
    });
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
      () => console.log('ServiceWorker înregistrat'),
      err => console.log('ServiceWorker eșuat:', err)
    );
  });
}

document.addEventListener('DOMContentLoaded', () => App.init());
