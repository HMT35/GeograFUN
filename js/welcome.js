/* ============================================ */
/* WELCOME SCREEN - Apple Style Animation      */
/* ============================================ */
const WelcomeScreen = {
  container: null,
  isTransitioning: false,
  
  init() {
    this.container = document.getElementById('welcome-screen');
  },

  async show() {
    this.container.classList.add('active');
    
    // Animare secvențială cu GSAP
    const tl = gsap.timeline();
    
    tl.to('.welcome-icon', {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power2.out'
    })
    .to('.welcome-title', {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: 'power2.out'
    }, '-=0.4')
    .to('.welcome-subtitle', {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: 'power2.out'
    }, '-=0.3')
    .to('.welcome-description', {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: 'power2.out'
    }, '-=0.3')
    .to('.welcome-container', {
      opacity: 1,
      y: 0,
      duration: 0.3,
      ease: 'power2.out'
    }, '-=0.2')
    .to('.welcome-loader', {
      opacity: 1,
      duration: 0.4,
      ease: 'power2.out'
    }, '-=0.1');
    
    // Așteaptă 2.5 secunde, apoi fade-out
    await tl.play();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await this.hide();
  },

  async hide() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    
    const tl = gsap.timeline();
    
    tl.to('.welcome-container', {
      opacity: 0,
      y: -20,
      scale: 0.95,
      duration: 0.6,
      ease: 'power2.in'
    })
    .to('#welcome-screen', {
      opacity: 0,
      duration: 0.4,
      ease: 'power2.in'
    }, '-=0.2');
    
    await tl.play();
    
    this.container.classList.remove('active');
    this.isTransitioning = false;
  }
};

window.WelcomeScreen = WelcomeScreen;