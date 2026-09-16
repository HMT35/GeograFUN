/* ============================================ */
/* SCORING - Result display and persistence    */
/* ============================================ */
const Scoring = {
  results: {},
  
  async show({ gameId, correct, incorrect, total, time, analytics }) {
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
    
    // Update UI
    document.getElementById('score-percentage').textContent = `${percentage}%`;
    document.getElementById('score-detail').textContent = `${correct} / ${total}`;
    document.getElementById('score-time').textContent = this.formatTime(time);
    document.getElementById('score-correct').textContent = correct;
    document.getElementById('score-incorrect').textContent = incorrect;
    
    // Set CSS variable for circle animation
    const circle = document.getElementById('score-circle');
    circle.style.setProperty('--percentage', percentage);
    
    // Color the circle based on percentage
    const color = percentage >= 75 ? '#43e97b' : (percentage >= 50 ? '#fddb92' : '#f5576c');
    circle.style.borderColor = color;
    
    // Store result
    this.saveResult(gameId, { correct, incorrect, total, time, percentage, analytics });
    
    // Show score screen
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('score-screen').classList.add('active');
    
    // Buttons
    document.getElementById('score-replay').onclick = () => {
      this.closeScore();
      Game.start(gameId);
    };
    
    document.getElementById('score-menu').onclick = () => {
      this.closeScore();
      this.showMenu();
    };
  },
  
  closeScore() {
    document.getElementById('score-screen').classList.remove('active');
  },
  
  showMenu() {
    // Update card glow states
    this.updateCardGlows();
    if (window.Menu) Menu.updateStats();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('menu-screen').classList.add('active');
  },
  
  saveResult(gameId, result) {
    const previous = this.results[gameId];
    const sessions = Array.isArray(previous?.sessions) ? previous.sessions : [];
    sessions.push({
      errors: result.analytics?.errors || {},
      thinking: result.analytics?.thinking || {}
    });
    this.results[gameId] = { ...result, sessions: sessions.slice(-2) };
    // Persist to localStorage
    try {
      localStorage.setItem('geografun-results', JSON.stringify(this.results));
    } catch (e) {
      console.warn('Could not save results:', e);
    }
  },

  getCardStats(gameId) {
    const sessions = this.results[gameId]?.sessions || [];
    const errors = {};
    const thinking = {};
    sessions.forEach(session => {
      Object.entries(session.errors || {}).forEach(([name, count]) => {
        errors[name] = (errors[name] || 0) + count;
      });
      Object.entries(session.thinking || {}).forEach(([name, values]) => {
        if (!thinking[name]) thinking[name] = [];
        thinking[name].push(...values);
      });
    });
    return {
      errors: Object.entries(errors)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ro'))
        .slice(0, 3),
      slowest: Object.entries(thinking)
        .map(([name, values]) => ({ name, seconds: values.reduce((a, b) => a + b, 0) / values.length }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 3)
    };
  },
  
  loadResults() {
    try {
      const saved = localStorage.getItem('geografun-results');
      if (saved) {
        this.results = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Could not load results:', e);
    }
  },
  
  updateCardGlows() {
    document.querySelectorAll('.card').forEach(card => {
      const gameId = card.dataset.game;
      card.classList.remove('glow-green', 'glow-yellow', 'glow-red');
      
      const result = this.results[gameId];
      if (!result) return;
      
      const percentage = result.percentage;
      if (percentage >= 90) {
        card.classList.add('glow-green');
      } else if (percentage >= 50) {
        card.classList.add('glow-yellow');
      } else {
        card.classList.add('glow-red');
      }
    });
  },
  
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }
};

window.Scoring = Scoring;