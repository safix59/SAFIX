// ─────────────────────────────────────────────────────────────────────────
// MODE MAINTENANCE (Edge Middleware).
// S'exécute AVANT le système de fichiers → intercepte TOUT le public (/,
// /index.html, /iphone-*, assets…) et renvoie la page de maintenance (503).
// EXCLUT /admin (+ ses assets) et /api : le Dashboard et l'API restent 100 %
// fonctionnels. POUR LEVER LA MAINTENANCE : supprimer ce fichier middleware.js
// (un seul fichier) puis redéployer.
// ─────────────────────────────────────────────────────────────────────────
export const config = {
  matcher: '/((?!admin|api|_next|favicon).*)',
};

const HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SAFIX · Maintenance</title>
<meta name="theme-color" content="#000000">
<meta name="robots" content="noindex">
<style>
:root{--accent:#007AFF;--accent2:#5AC8FA;--accent-rgb:0,122,255}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;min-height:100svh;padding:28px;text-align:center;position:relative;overflow:hidden}
.glow{position:fixed;inset:0;pointer-events:none;background:radial-gradient(620px 360px at 50% -4%,rgba(var(--accent-rgb),.16),transparent 62%)}
.wrap{position:relative;width:100%;max-width:452px;animation:rise .85s cubic-bezier(.22,1,.36,1) both}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.logo{position:relative;display:inline-flex;align-items:center;justify-content:center;width:78px;height:78px;border-radius:23px;margin-bottom:32px;background:linear-gradient(135deg,var(--accent) 0%,var(--accent2) 100%);box-shadow:0 18px 52px rgba(var(--accent-rgb),.5);font-size:39px;font-weight:800;color:#fff}
.logo::after{content:'';position:absolute;inset:-11px;border-radius:31px;border:1.5px solid rgba(var(--accent-rgb),.42);animation:ring 2.8s ease-out infinite}
@keyframes ring{0%{transform:scale(.9);opacity:.7}80%,100%{transform:scale(1.4);opacity:0}}
.brand{font-size:14px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:rgba(235,235,245,.5);margin-bottom:24px}
.brand b{color:var(--accent)}
h1{font-size:31px;font-weight:750;letter-spacing:-.02em;line-height:1.15;margin-bottom:17px}
p{font-size:15.5px;line-height:1.66;color:rgba(235,235,245,.66);margin:0 auto 30px;max-width:400px}
.status{display:inline-flex;align-items:center;gap:10px;padding:10px 19px;border-radius:100px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);font-size:13px;font-weight:600;color:rgba(235,235,245,.82)}
.dots{display:inline-flex;gap:4px}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:blink 1.4s infinite}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,100%{opacity:.28;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
.foot{margin-top:46px;font-size:12.5px;color:rgba(235,235,245,.38)}
@media(max-width:480px){h1{font-size:26px}p{font-size:14.5px}.logo{width:70px;height:70px;font-size:35px}}
@media(prefers-reduced-motion:reduce){.logo::after,.dots i,.wrap{animation:none}}
</style>
</head>
<body>
<div class="glow"></div>
<main class="wrap">
<div class="logo" aria-hidden="true">S</div>
<div class="brand"><b>SA</b>FIX</div>
<h1>Bientôt de retour</h1>
<p>Nous effectuons actuellement des améliorations afin de vous offrir une expérience encore meilleure. Le site sera de nouveau disponible très prochainement — merci de votre confiance.</p>
<div class="status"><span class="dots"><i></i><i></i><i></i></span> Maintenance en cours</div>
<div class="foot">SAFIX · Réparation iPhone à Dunkerque</div>
</main>
</body>
</html>`;

export default function middleware() {
  return new Response(HTML, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0, must-revalidate',
      'retry-after': '3600',
    },
  });
}
