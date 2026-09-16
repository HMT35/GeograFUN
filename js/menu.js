/* ============================================================ */
/* MENU - Seamless 2D card deck                                 */
/* One card is always centered on screen. Neighbours peek only  */
/* slightly at the edges. Swipe is LIVE (follows the finger),   */
/* release snaps elastically to the nearest card.               */
/* Horizontal = games, Vertical = regions (Europa / România)    */
/* ============================================================ */
const Menu = {
  stage: null,
  cards: [],
  grid: [],            // grid[row][col] = card element
  rows: 0,
  cols: 0,
  col: 0,              // active column
  row: 0,              // active row
  dragX: 0,            // live drag offset (px)
  dragY: 0,
  axis: null,          // 'x' | 'y' | null - locked once movement is clear
  isDragging: false,
  moved: false,
  pointerId: null,
  startX: 0,
  startY: 0,

  /* Geometrie memorata: citirea lui offsetWidth/clientWidth forteaza
     un reflow sincron, asa ca o facem doar la init si la resize,
     niciodata in bucla de drag. */
  _stepX: 0,
  _stepY: 0,
  _rafId: 0,        // frame programat pentru randare (coalesare pointermove)
  _resizeId: 0,     // debounce pentru resize
  _maxDist: 1,      // cate carduri raman vizibile de o parte si de alta

  /* Mouse real (desktop) vs touch. Pe desktop drag-ul e nenatural:
     navigam prin click. Detectam capabilitatea, nu latimea ecranului,
     ca sa nu gresim pe laptopuri cu touchscreen sau tablete. */
  isDesktop: false,


  // Layout tuning
  PEEK: 0.06,          // how much of the neighbour peeks (fraction of step)
  SIDE_SCALE: 0.82,
  SIDE_OPACITY: 0.45,
  FAR_SCALE: 0.7,
  FAR_OPACITY: 0.2,    // a doua vecinatate, vizibila doar cand incape

  regionNames: DatasetsConfig.regionNames,

  /* Genereaza cardurile din DatasetsConfig.menu */
  buildCards() {
    this.stage.innerHTML = '';
    DatasetsConfig.menu.forEach((rowIds, r) => {
      rowIds.forEach((gameId, c) => {
        const cfg = DatasetsConfig.get(gameId);
        if (!cfg) return;

        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.game = gameId;
        card.dataset.row = r;
        card.dataset.col = c;
        /* Gradientul + iconita raman randate dedesubt, ca fallback vizibil
           daca poza nu se incarca. Poza este opaca si le acopera complet. */
        const photo = cfg.image
          ? `<img class="card-photo" src="${cfg.image}" alt="" draggable="false"
                  loading="eager" decoding="async"
                  onload="this.classList.add('is-loaded');this.parentNode.classList.add('has-photo')"
                  onerror="this.remove()">`
          : '';

        card.innerHTML = `
          <button class="card-flip-tab" type="button" aria-expanded="false" aria-label="Întoarce cardul ${cfg.title}">
            <span aria-hidden="true">⇄</span>
          </button>
          <div class="card-polaroid card-inner">
            <div class="card-face card-front">
            <div class="card-image" style="background-image: ${cfg.gradient};">
              <div class="card-icon">${cfg.icon}</div>
              ${photo}
            </div>
            <div class="card-label">${cfg.title}</div>
            <button class="card-play" type="button" aria-label="Joacă ${cfg.title}">→</button>
            </div>
            <div class="card-face card-back" aria-hidden="true">
              <div class="card-info-icon" aria-hidden="true">${cfg.icon}</div>
              <h3>${cfg.title}</h3>
              <p class="card-fact">${cfg.funFact || 'Explorează harta și descoperă cât de bine cunoști geografia.'}</p>
              <div class="card-stats" data-stats-for="${gameId}"></div>
            </div>
          </div>`;
        this.stage.appendChild(card);
      });
    });
    /* Ascunse pana la primul layout valid, ca sa nu apara stivuite in centru */
    gsap.set(this.stage.querySelectorAll('.card'), { opacity: 0 });
  },

  init() {

    this.stage = document.getElementById('menu-stage');
    if (!this.stage) return;

    this.isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.stage.classList.toggle('is-desktop', this.isDesktop);

    this.buildCards();
    this.cards = Array.from(this.stage.querySelectorAll('.card'));
    this.buildGrid();
    this.buildDots();
    this.bindPointer();
    this.bindKeyboard();
    this.bindClicks();
    this.bindOptions();
    this.updateStats();

    /* Resize debounced: recalculam geometria o singura data, la final */
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeId);
      this._resizeId = setTimeout(() => {
        this.measure();
        this.layout(false);
      }, 120);
    });

    this.measure();
    this.layout(false);
  },

  buildGrid() {
    this.grid = [];
    this.cards.forEach(card => {
      const r = parseInt(card.dataset.row, 10) || 0;
      const c = parseInt(card.dataset.col, 10) || 0;
      if (!this.grid[r]) this.grid[r] = [];
      this.grid[r][c] = card;
      card._row = r;
      card._col = c;
    });
    this.rows = this.grid.length;
    this.cols = Math.max(...this.grid.map(r => r.length));
  },

  /* ---------------- Geometry ---------------- */

  /* Singurul loc care atinge DOM-ul pentru dimensiuni. Chemat la init
     si la resize, niciodata din bucla de drag sau din layout(). */
  measure() {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!w || !h) return false;

    const cardW = this.cards[0] ? this.cards[0].offsetWidth : w * 0.78;
    const cardH = this.cards[0] ? this.cards[0].offsetHeight : h * 0.7;

    // Step = card size + gap, but capped so the neighbour only peeks
    this._stepX = Math.min(cardW + 28, w * (1 - this.PEEK * 2)) || 1;
    this._stepY = Math.min(cardH + 28, h * (1 - this.PEEK * 2)) || 1;

    /* Cate carduri incap efectiv de o parte si de alta a celui central.
       Pe telefon un card ocupa ~78vw => doar vecinul imediat (1).
       Pe desktop (~30vw) incape si al doilea (2). Derivat din geometria
       reala, deci se adapteaza corect si la redimensionarea ferestrei. */
    const sideRoom = (w - cardW) / 2;
    this._maxDist = Math.max(1, Math.min(2, Math.floor(sideRoom / this._stepX) + 1));
    return true;
  },

  stepX() { return this._stepX || 1; },
  stepY() { return this._stepY || 1; },

  /* ---------------- Rendering ---------------- */

  /**
   * Positions every card relative to the active cell.
   * @param {boolean} animate  use elastic tween instead of instant set
   */
  layout(animate = true) {
    /* Ecranul poate fi inca ascuns (display:none) => dimensiuni 0.
       Nu desenam nimic gresit, ci reincercam in frame-ul urmator. */
    if (!this._stepX && !this.measure()) {
      if (!this._pendingLayout) {
        this._pendingLayout = true;
        requestAnimationFrame(() => {
          this._pendingLayout = false;
          this.layout(animate);
        });
      }
      return;
    }

    const sx = this._stepX;
    const sy = this._stepY;

    this.cards.forEach(card => {
      const dc = card._col - this.col;   // column distance
      const dr = card._row - this.row;   // row distance

      const x = dc * sx + this.dragX;
      const y = dr * sy + this.dragY;

      const dist = Math.max(Math.abs(dc), Math.abs(dr));

      // Live proximity to the center, used for smooth scale/opacity blending
      const nx = Math.abs(x) / sx;
      const ny = Math.abs(y) / sy;
      const prox = Math.min(1, Math.hypot(nx, ny));

      let scale, opacity, zIndex;
      if (dist === 0) {
        scale = 1 - prox * (1 - this.SIDE_SCALE);
        opacity = 1 - prox * (1 - this.SIDE_OPACITY);
        zIndex = 30;
      } else if (dist === 1) {
        scale = this.SIDE_SCALE + (1 - Math.min(1, prox)) * (1 - this.SIDE_SCALE);
        opacity = this.SIDE_OPACITY + (1 - Math.min(1, prox)) * (1 - this.SIDE_OPACITY);
        zIndex = 20;
      } else if (dist === 2 && this._maxDist >= 2) {
        /* A doua vecinatate: vizibila doar pe ecrane late, unde chiar incape */
        scale = this.FAR_SCALE;
        opacity = this.FAR_OPACITY;
        zIndex = 10;
      } else {
        scale = this.FAR_SCALE;
        opacity = 0;
        zIndex = 10;
      }

      /* zIndex nu e o valoare animabila: il scriem doar cand chiar
         se schimba, nu la fiecare frame. */
      if (card._z !== zIndex) {
        card._z = zIndex;
        card.style.zIndex = zIndex;
      }

      /* Cardurile invizibile ies complet din compozitie */
      const hidden = dist > this._maxDist;
      if (card._hidden !== hidden) {
        card._hidden = hidden;
        card.style.visibility = hidden ? 'hidden' : '';
      }
      if (hidden) return;

      // Subtle tilt for a physical, deck-like feel
      const rotate = (x / sx) * -4;

      if (animate) {
        gsap.to(card, {
          x, y, scale, opacity, rotation: rotate,
          duration: 0.75,
          ease: 'elastic.out(1, 0.62)',
          overwrite: 'auto'
        });
      } else {
        /* Calea de drag: fara overwrite (nimic de suprascris, tween-urile
           au fost deja oprite la pointerdown) */
        gsap.set(card, { x, y, scale, opacity, rotation: rotate });
      }
    });

    this.updateChrome();
  },

  updateChrome() {
    const region = document.getElementById('menu-region');
    if (region) region.textContent = this.regionNames[this.row] || '';

    document.querySelectorAll('#dots-col .dot').forEach((d, i) => {
      d.classList.toggle('active', i === this.col);
    });
    document.querySelectorAll('#dots-row .dot').forEach((d, i) => {
      d.classList.toggle('active', i === this.row);
    });
  },

  buildDots() {
    const colDots = document.getElementById('dots-col');
    const rowDots = document.getElementById('dots-row');
    if (colDots) {
      colDots.innerHTML = '';
      for (let i = 0; i < this.cols; i++) {
        const d = document.createElement('span');
        d.className = 'dot' + (i === this.col ? ' active' : '');
        colDots.appendChild(d);
      }
    }
    if (rowDots) {
      rowDots.innerHTML = '';
      for (let i = 0; i < this.rows; i++) {
        const d = document.createElement('span');
        d.className = 'dot' + (i === this.row ? ' active' : '');
        rowDots.appendChild(d);
      }
    }
  },

  /* ---------------- Input ---------------- */

  bindPointer() {
    const stage = this.stage;

    /* Pe desktop nu exista swipe: navigarea se face prin click
       (vezi bindClicks). Nu legam deloc handlerele de drag. */
    if (this.isDesktop) return;

    stage.addEventListener('pointerdown', e => {
      /* butonul de intrare in joc nu declanseaza swipe */
      if (e.target.closest('.card-play')) return;
      this.isDragging = true;
      this.moved = false;
      this.axis = null;
      this.pointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.dragX = 0;
      this.dragY = 0;
      this.cards.forEach(c => gsap.killTweensOf(c));
      /* Promovam in layere doar pe durata gestului */
      this.setWillChange(true);
      stage.setPointerCapture(e.pointerId);
    });

    stage.addEventListener('pointermove', e => {
      if (!this.isDragging || e.pointerId !== this.pointerId) return;

      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;

      // Lock the axis after a small threshold so diagonal drags feel stable
      if (!this.axis) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          this.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          this.moved = true;
        } else {
          return;
        }
      }

      if (this.axis === 'x') {
        this.dragX = this.resist(dx, 'x');
        this.dragY = 0;
      } else {
        this.dragY = this.resist(dy, 'y');
        this.dragX = 0;
      }

      /* LIVE, dar coalesat: pointermove poate veni de mai multe ori
         per frame. Randam o singura data, in rAF. */
      this.scheduleRender();
    });

    const end = e => {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (this.pointerId !== null) {
        try { stage.releasePointerCapture(this.pointerId); } catch (_) {}
      }
      this.pointerId = null;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = 0;
      }
      this.settle();
    };

    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  },

  /** Un singur render per frame, oricat de des ar veni pointermove */
  scheduleRender() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = 0;
      this.layout(false);
    });
  },

  /** will-change doar cat dureaza miscarea, ca sa nu tinem layere degeaba */
  setWillChange(on) {
    this.cards.forEach(c => {
      c.style.willChange = on ? 'transform, opacity' : '';
    });
  },

  /** Rubber-band resistance at the edges of the deck */
  resist(delta, axis) {
    const atStart = axis === 'x' ? this.col === 0 : this.row === 0;
    const atEnd = axis === 'x' ? this.col === this.cols - 1 : this.row === this.rows - 1;
    if ((delta > 0 && atStart) || (delta < 0 && atEnd)) {
      return delta * 0.32;
    }
    return delta;
  },

  /** Decide the target cell on release and snap elastically */
  settle() {
    const threshold = 0.22;

    if (this.axis === 'x') {
      const ratio = this.dragX / this.stepX();
      if (ratio < -threshold) this.col = Math.min(this.col + 1, this.cols - 1);
      else if (ratio > threshold) this.col = Math.max(this.col - 1, 0);
    } else if (this.axis === 'y') {
      const ratio = this.dragY / this.stepY();
      if (ratio < -threshold) this.row = Math.min(this.row + 1, this.rows - 1);
      else if (ratio > threshold) this.row = Math.max(this.row - 1, 0);
      // Clamp the column if the new row is shorter
      this.col = Math.min(this.col, (this.grid[this.row] || []).length - 1);
    }

    this.dragX = 0;
    this.dragY = 0;
    this.axis = null;
    this.layout(true);
    /* eliberam layerele dupa ce se termina animatia de snap */
    clearTimeout(this._wcId);
    this._wcId = setTimeout(() => this.setWillChange(false), 800);
  },

  bindKeyboard() {
    document.addEventListener('keydown', e => {
      const menuActive = document.getElementById('menu-screen').classList.contains('active');
      if (!menuActive) return;

      if (e.key === 'ArrowRight') this.go(this.row, this.col + 1);
      else if (e.key === 'ArrowLeft') this.go(this.row, this.col - 1);
      else if (e.key === 'ArrowDown') this.go(this.row + 1, this.col);
      else if (e.key === 'ArrowUp') this.go(this.row - 1, this.col);
      else if (e.key === 'Enter') this.openActive();
    });
  },

  go(row, col) {
    const r = Math.max(0, Math.min(row, this.rows - 1));
    const c = Math.max(0, Math.min(col, (this.grid[r] || []).length - 1));
    if (r === this.row && c === this.col) return;
    this.closeFlippedCards();
    this.row = r;
    this.col = c;
    this.layout(true);
  },

  bindClicks() {
    this.cards.forEach(card => {
      /* Butonul de hârtie: intră direct în joc */
      card.querySelectorAll('.card-play').forEach(play => {
        const enter = e => {
          e.stopPropagation();
          e.preventDefault();
          if (card._row === this.row && card._col === this.col) {
            this.openGame(card.dataset.game);
          } else {
            this.go(card._row, card._col);
          }
        };
        play.addEventListener('click', enter);
        play.addEventListener('pointerdown', e => e.stopPropagation());
      });

      const flip = card.querySelector('.card-flip-tab');
      if (flip) {
        flip.addEventListener('pointerdown', e => e.stopPropagation());
        flip.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          if (card._row !== this.row || card._col !== this.col) {
            this.go(card._row, card._col);
            return;
          }
          this.toggleCard(card);
        });
      }

      card.addEventListener('click', e => {
        if (e.target.closest('.card-play, .card-flip-tab')) return;
        /* Pe touch, click-ul care incheie un swipe nu trebuie sa navigheze.
           Pe desktop nu exista swipe, deci nu e nimic de ignorat. */
        if (!this.isDesktop && this.moved) { this.moved = false; return; }
        if (card._row === this.row && card._col === this.col) {
          this.openGame(card.dataset.game);
        } else {
          this.go(card._row, card._col);
        }
      });
    });
  },

  toggleCard(card) {
    const open = !card.classList.contains('is-flipped');
    this.cards.forEach(other => {
      other.classList.remove('is-flipped');
      other.querySelector('.card-flip-tab')?.setAttribute('aria-expanded', 'false');
      other.querySelector('.card-back')?.setAttribute('aria-hidden', 'true');
    });
    card.classList.toggle('is-flipped', open);
    card.querySelector('.card-flip-tab')?.setAttribute('aria-expanded', String(open));
    card.querySelector('.card-back')?.setAttribute('aria-hidden', String(!open));
    const availableHeight = window.innerHeight - 148;
    const expandedScale = Math.max(1, Math.min(1.3, availableHeight / Math.max(1, card.offsetHeight)));
    gsap.to(card, {
      scale: open ? expandedScale : 1,
      duration: 0.55,
      ease: 'power3.inOut',
      overwrite: 'auto'
    });
  },

  closeFlippedCards() {
    this.cards.forEach(card => {
      if (!card.classList.contains('is-flipped')) return;
      card.classList.remove('is-flipped');
      card.querySelector('.card-flip-tab')?.setAttribute('aria-expanded', 'false');
      card.querySelector('.card-back')?.setAttribute('aria-hidden', 'true');
      gsap.to(card, { scale: 1, duration: 0.42, ease: 'power3.inOut', overwrite: 'auto' });
    });
  },

  bindOptions() {
    const button = document.getElementById('options-toggle');
    const panel = document.getElementById('options-panel');
    if (!button || !panel || button.dataset.bound) return;
    button.dataset.bound = 'true';
    const close = () => {
      if (panel.hidden || panel.classList.contains('is-closing')) return;
      panel.classList.add('is-closing');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Deschide opțiunile');
      window.setTimeout(() => {
        panel.hidden = true;
        panel.classList.remove('is-closing');
      }, 260);
    };
    button.addEventListener('click', () => {
      const open = panel.hidden;
      if (!open) { close(); return; }
      panel.hidden = !open;
      panel.classList.remove('is-closing');
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Închide opțiunile' : 'Deschide opțiunile');
      if (open) gsap.fromTo(panel, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
    });
    panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => {
      if (panel.hidden || event.target.closest('#options-toggle')) return;
      close();
    });
  },

  updateStats() {
    document.querySelectorAll('[data-stats-for]').forEach(container => {
      const stats = Scoring.getCardStats(container.dataset.statsFor);
      const errors = stats.errors.length
        ? stats.errors.map((item, i) => `<li><span>${i + 1}. ${item.name}</span><strong>${item.count}×</strong></li>`).join('')
        : '<li class="empty-stat">Nicio eroare înregistrată</li>';
      const slowest = stats.slowest.length
        ? stats.slowest.map((item, i) => `<li><span>${i + 1}. ${item.name}</span><strong>${item.seconds.toFixed(1)} s</strong></li>`).join('')
        : '<li class="empty-stat">Joacă pentru a colecta timpi</li>';
      container.innerHTML = `
        <section><h4>Erori frecvente</h4><ol>${errors}</ol></section>
        <section><h4>Cel mai mult timp de gândire</h4><ol>${slowest}</ol></section>
        <small>Media ultimelor două jocuri finalizate</small>`;
    });
  },

  activeCard() {
    return (this.grid[this.row] || [])[this.col] || null;
  },

  openActive() {
    const card = this.activeCard();
    if (card) this.openGame(card.dataset.game);
  },

  openGame(gameId) {
    if (!gameId) return;
    document.dispatchEvent(new CustomEvent('game-start', { detail: { gameId } }));
  },

  // Kept for backwards compatibility with main.js
  updatePageIndicator() {
    this.updateChrome();
  }
};

window.Menu = Menu;
