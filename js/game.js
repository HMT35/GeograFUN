/* ============================================================ */
/* GAME - orchestrator                                           */
/* Nu stie nimic despre geometrie; delega catre modul de joc     */
/* obtinut din GameModes dupa dataset.kind.                      */
/* ============================================================ */
const Game = {
  gameId: null,
  dataset: null,
  mode: null,
  questions: [],
  index: 0,
  correctCount: 0,
  incorrectCount: 0,
  isPlaying: false,
  locked: false,
  timerInterval: null,
  seconds: 0,
  feedbackTimeout: null,
  pendingInput: null,
  confirmBound: false,
  loadController: null,
  session: 0,
  requiresConfirmation: false,
  audioContext: null,
  feedbackFadeTimeout: null,
  questionStartedAt: 0,
  analytics: null,

  async start(gameId) {
    if (this.loadController) this.loadController.abort();
    this.loadController = new AbortController();
    const session = ++this.session;
    this.gameId = gameId;
    this.index = 0;
    this.correctCount = 0;
    this.incorrectCount = 0;
    this.seconds = 0;
    this.locked = false;
    this.isPlaying = false;
    this.pendingInput = null;
    this.analytics = { errors: {}, thinking: {} };

    const cfg = DatasetsConfig.get(gameId);
    if (!cfg) {
      alert('Acest joc nu are încă un set de date.');
      return;
    }

    this.showScreen('game-screen');
    document.getElementById('game-title').textContent = cfg.title;
    document.getElementById('game-timer').textContent = '00:00';
    this.setBanner('Se încarcă datele…', '');
    const retry = document.getElementById('data-retry');
    const menu = document.getElementById('data-menu');
    retry.hidden = true;
    menu.hidden = true;
    retry.onclick = () => this.start(gameId);
    menu.onclick = () => { this.quit(); Scoring.showMenu(); };

    try {
      this.dataset = await DataLoader.loadGameData(gameId, { signal: this.loadController.signal });
      if (session !== this.session) return;
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'TIMEOUT' && session !== this.session) return;
      console.error(err);
      const reason = err.code === 'SOURCE_NOT_FOUND' ? 'Fișierul de date nu există.' :
        err.code === 'INVALID_JSON' || err.code === 'DATASET_INVALID' ? 'Datele sunt corupte sau invalide.' :
        err.code === 'DATASET_EMPTY' ? 'Setul de date este gol.' :
        location.protocol === 'file:' ? 'Pornește aplicația printr-un server HTTP, nu prin dublu-click.' :
        'Verifică conexiunea și încearcă din nou.';
      this.setBanner(`${reason} Reîncearcă.`, '');
      retry.hidden = false;
      menu.hidden = false;
      return;
    }

    this.questions = this.shuffle([...this.dataset.items]);

    await MapViewer.loadMap(gameId, this.dataset);
    MapViewer.fitToDataset(this.dataset);

    this.mode = GameModes.get(this.dataset.kind);
    this.mode.render(MapViewer.map, this.dataset);

    this.setupInput();

    this.isPlaying = true;
    this.showQuestion();
    this.startTimer();
  },

  /* ---------- Input ---------- */
  setupInput() {
    const pinBtn = document.getElementById('pin-button');
    const confirmBtn = document.getElementById('confirm-button');
    const actions = document.getElementById('game-actions');

    /* Confirmarea previne tap-urile accidentale dupa panare pe touchscreen.
       Cu mouse/trackpad selectia este suficient de precisa si se trimite direct. */
    this.requiresConfirmation = window.matchMedia('(pointer: coarse), (hover: none)').matches;
    if (!this.confirmBound) {
      confirmBtn.addEventListener('click', () => {
        this.playSound('click');
        this.confirm();
      });
      this.confirmBound = true;
    }
    if (this.mode.usesPin) {
      actions.style.display = '';
      pinBtn.style.display = '';
      PinControl.init();
      PinControl.enable(latlng => {
        if (!this.isPlaying || this.locked) return;
        this.onSelect({ latlng });
        if (this.mode.submitPin) this.mode.submitPin(latlng);
      });
      this.setPinLabel('Ține apăsat pentru a plasa');
      pinBtn.classList.remove('next-mode');
    } else {
      /* selectia se face direct pe harta */
      actions.style.display = 'none';
      pinBtn.style.display = 'none';
      PinControl.disable();
    }

    this.setConfirmState(false);
  },

  /* apelat de modul de joc cand utilizatorul face o selectie */
  onSelect(input) {
    if (!this.isPlaying || this.locked) return;
    this.pendingInput = input;
    this.playSound('click');
    if (this.requiresConfirmation) this.setConfirmState(true);
    else this.confirm();
  },

  setConfirmState(ready) {
    const btn = document.getElementById('confirm-button');
    const txt = btn.querySelector('.confirm-btn-text');
    const visible = this.requiresConfirmation && !!ready;
    btn.hidden = !visible;
    if (this.mode && !this.mode.usesPin) {
      document.getElementById('game-actions').style.display = visible ? '' : 'none';
      requestAnimationFrame(() => {
        if (MapViewer.map) MapViewer.map.invalidateSize(false);
      });
    }
    btn.disabled = !ready;
    btn.classList.toggle('ready', !!ready);
    if (txt) txt.textContent = 'Confirmă';
  },

  confirm() {
    if (!this.isPlaying || this.locked) return;

    let input = this.pendingInput;
    if (this.mode.commit) {
      const committed = this.mode.commit();
      if (committed) input = { ...input, ...committed };
    }
    if (!input) return;

    this.onAnswer(input);
  },

  /* ---------- Flow ---------- */
  showQuestion() {
    if (this.index >= this.questions.length) {
      this.endGame();
      return;
    }

    const q = this.questions[this.index];
    this.locked = false;
    this.pendingInput = null;
    this.setConfirmState(false);
    this.questionStartedAt = performance.now();

    document.getElementById('question-number').textContent =
      `${this.index + 1}/${this.questions.length}`;
    document.getElementById('question-text').textContent = this.promptFor(q);

    if (this.mode.usesPin) {
      this.setPinLabel('Ține apăsat pentru a plasa');
      document.getElementById('pin-button').classList.remove('next-mode');
    }

    MapViewer.setInteractive(true);
    this.mode.arm(q, input => this.onSelect(input));
  },

  promptFor(q) {
    switch (this.dataset.kind) {
      case 'polygon': return `Atinge: ${q.name}`;
      case 'point':   return `Unde este ${q.name}?`;
      case 'line':    return `Unde curge ${q.name}?`;
      default:        return q.name;
    }
  },

  onAnswer(input) {
    if (!this.isPlaying || this.locked) return;
    this.locked = true;
    this.setConfirmState(false);

    const q = this.questions[this.index];
    const result = this.mode.evaluate(input, q);
    this.playSound(result.correct ? 'correct' : 'incorrect');

    if (result.correct) {
      this.correctCount++;
      const elapsed = Math.max(0, (performance.now() - this.questionStartedAt) / 1000);
      if (!this.analytics.thinking[q.name]) this.analytics.thinking[q.name] = [];
      this.analytics.thinking[q.name].push(Number(elapsed.toFixed(2)));
    }
    else {
      this.incorrectCount++;
      const chosen = this.dataset.items.find(item => item.id === result.chosenId);
      const chosenName = chosen?.name || 'altă unitate';
      this.analytics.errors[chosenName] = (this.analytics.errors[chosenName] || 0) + 1;
      /* Raspunsul gresit revine la finalul cozii si va fi reluat. */
      this.questions.push(q);
    }

    this.mode.reveal(q, result);
    this.showFeedback(q, result);
  },

  showFeedback(q, result) {
    const text = document.getElementById('question-text');
    const banner = document.getElementById('question-banner');
    const chosen = this.dataset.items.find(item => item.id === result.chosenId);
    text.textContent = result.correct ? 'Corect!' : `Ai ales: ${chosen?.name || 'altă unitate'}`;
    banner.classList.toggle('answer-correct', result.correct);
    banner.classList.toggle('answer-incorrect', !result.correct);

    if (this.mode.usesPin) {
      document.getElementById('pin-button').classList.add('next-mode');
      this.setPinLabel('Următorul →');
    }

    clearTimeout(this.feedbackTimeout);
    clearTimeout(this.feedbackFadeTimeout);
    this.feedbackFadeTimeout = setTimeout(() => {
      if (this.mode && this.mode.fadeFeedback) this.mode.fadeFeedback(950, result, q);
      banner.classList.add('answer-exiting');
    }, 1100);
    this.feedbackTimeout = setTimeout(() => {
      banner.classList.remove('answer-correct', 'answer-incorrect', 'answer-exiting');
      this.nextQuestion();
    }, 2050);
  },

  nextQuestion() {
    this.index++;
    /* Nu resetam harta si nu flash-uim containerul: schimbarea ramane
       continua, ca intr-o aplicatie nativa. */
    this.showQuestion();
  },

  endGame() {
    this.isPlaying = false;
    this.stopTimer();
    PinControl.disable();

    const total = this.questions.length;
    const correct = this.correctCount;
    const incorrect = this.incorrectCount;
    const time = this.seconds;
    const gameId = this.gameId;

    this.teardown();

    Scoring.show({ gameId, correct, incorrect, total, time, analytics: this.analytics });
  },

  quit() {
    this.session++;
    if (this.loadController) this.loadController.abort();
    this.loadController = null;
    this.isPlaying = false;
    this.stopTimer();
    clearTimeout(this.feedbackTimeout);
    clearTimeout(this.feedbackFadeTimeout);
    PinControl.disable();
    this.teardown();
  },

  teardown() {
    if (this.mode) {
      this.mode.cleanup();
      this.mode = null;
    }
    this.pendingInput = null;
    MapViewer.cleanup();
    document.getElementById('game-actions').style.display = '';
    const pinBtn = document.getElementById('pin-button');
    if (pinBtn) pinBtn.style.display = '';
    this.setConfirmState(false);
  },

  /* ---------- UI helpers ---------- */
  setBanner(text, number) {
    document.getElementById('question-text').textContent = text;
    document.getElementById('question-number').textContent = number;
  },

  setPinLabel(text) {
    const el = document.querySelector('.pin-btn-text');
    if (el) el.textContent = text;
  },

  playSound(type) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      this.audioContext ||= new AudioCtx();
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const now = this.audioContext.currentTime;
      const notes = type === 'correct'
        ? [[523, 0, 0.12], [659, 0.1, 0.16], [784, 0.22, 0.2]]
        : type === 'incorrect'
          ? [[220, 0, 0.16], [165, 0.13, 0.24]]
          : [[620, 0, 0.055]];
      notes.forEach(([frequency, delay, duration]) => {
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        oscillator.type = type === 'incorrect' ? 'sawtooth' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, now + delay);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(type === 'click' ? 0.035 : 0.07, now + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
        oscillator.connect(gain).connect(this.audioContext.destination);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + duration + 0.02);
      });
    } catch (err) {
      console.debug('Sunet indisponibil', err);
    }
  },

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  },

  /* ---------- Timer ---------- */
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.seconds++;
      const m = Math.floor(this.seconds / 60).toString().padStart(2, '0');
      const s = (this.seconds % 60).toString().padStart(2, '0');
      document.getElementById('game-timer').textContent = `${m}:${s}`;
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  },

  /* ---------- Utilitare ---------- */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  getGameTitle(gameId) {
    const cfg = DatasetsConfig.get(gameId);
    return cfg ? cfg.title : 'Joc geografic';
  }
};

window.Game = Game;
