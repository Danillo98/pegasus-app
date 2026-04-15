const fs = require('fs');
let c = fs.readFileSync('src/main.js', 'utf8');
c = c.split('showSplashScreen()')[0] + `showSplashScreen()
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
`;
fs.writeFileSync('src/main.js', c);
