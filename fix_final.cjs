const fs = require('fs');
const path = 'src/main.js';
let content = fs.readFileSync(path, 'utf8');

// Localiza o ponto onde o código quebrou e reconstrói o final do arquivo corretamente
const splitPoint = 'function showSplashScreen()';
const baseContent = content.split(splitPoint)[0];

const finalCode = baseContent + \unction showSplashScreen() {
  const splash = document.createElement('div');
  splash.id = 'pwa-splash-container';
  splash.style.cssText = \\\
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: white; z-index: 9999999; margin: 0; padding: 0; gap: 2rem;
  \\\;
  splash.innerHTML = \\\
    <img src="/logo_pegasus_full.png" alt="Pegasus" style="width: 75vw; max-width: 500px; height: auto;">
    <div class="pwa-spinner"></div>
    <style>
      .pwa-spinner {
        width: 40px; height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #b8860b;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  \\\;
  document.body.appendChild(splash);
}

showSplashScreen()
handleMpCallback().then(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    appState.user = session.user;
    appState.screen = 'dashboard';
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      appState.user = null;
      appState.screen = 'login';
      render();
    }
  });

  render();
  setTimeout(() => {
    const splash = document.getElementById('pwa-splash-container');
    if (splash) {
      splash.style.transition = 'opacity 0.5s ease-out';
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 500);
    }
  }, 1000);
})
\;

fs.writeFileSync(path, finalCode);
console.log('Arquivo src/main.js corrigido com sucesso!');
