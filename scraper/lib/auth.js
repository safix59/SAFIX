import fs from "node:fs";
import path from "node:path";

const LOGIN_URL = "https://www.utopya.fr/customer/account/login/";
const ACCOUNT_URL = "https://www.utopya.fr/customer/account/";

const EMAIL_SELECTORS = [
  "#email",
  'input[name="login[username]"]',
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
];
const PASSWORD_SELECTORS = [
  "#pass",
  'input[name="login[password]"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
];
const SUBMIT_SELECTORS = [
  "#send2",
  'button[type="submit"]',
  "button.action.login",
  'button.login',
  'input[type="submit"]',
];

// Attend que le challenge Cloudflare Turnstile soit résolu.
async function waitForCloudflare(page, logger, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const title = await page.title().catch(() => "");
    const url = page.url();
    const cfMarker = /Just a moment|Checking your browser|Vérification|cf-mitigated/i.test(
      title,
    );
    if (!cfMarker) {
      logger.info(`  ✓ Cloudflare passé (titre="${title.slice(0, 40)}")`);
      return true;
    }
    await page.waitForTimeout(1500);
  }
  logger.warn(`  ⚠ Cloudflare non résolu après ${maxMs}ms`);
  return false;
}

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const els = await page.$$(sel);
    for (const el of els) {
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.fill(value);
      return sel;
    }
  }
  throw new Error(
    `Aucun champ VISIBLE trouvé parmi : ${selectors.join(", ")}`,
  );
}

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const els = await page.$$(sel);
    for (const el of els) {
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click();
      return sel;
    }
  }
  throw new Error(
    `Aucun bouton VISIBLE trouvé parmi : ${selectors.join(", ")}`,
  );
}

export async function isSessionValid(context) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(ACCOUNT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!resp || !resp.ok()) return false;
    // Si on est redirigé vers /customer/account/login -> session morte
    const url = page.url();
    if (/\/customer\/account\/login/i.test(url)) return false;
    // Présence d'un élément réservé aux connectés
    const html = await page.content();
    return /Mon compte|Se déconnecter|Logout|My Account/i.test(html);
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

async function dismissCookieBanner(page, logger) {
  // Bannière Axeptio
  try {
    const accept = await page.$("#axeptio_btn_acceptAll");
    if (accept && (await accept.isVisible().catch(() => false))) {
      await accept.click();
      logger.info("  ✓ Bannière cookies acceptée.");
      await page.waitForTimeout(500);
    }
  } catch {}
}

async function openLoginModal(page, logger) {
  // Le form #form-popup-login existe dans le DOM mais est caché. Cliquer sur
  // le lien "Se connecter" l'affiche.
  const candidates = [
    'a:has-text("Se connecter")',
    'a:has-text("Connexion"):not([href*="createpost"])',
    'a[href="#"]:has-text("Connexion")',
    ".header-account a",
  ];
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.click({ timeout: 5000 });
        logger.info(`  ✓ Modale ouverte via : ${sel}`);
        return true;
      }
    } catch {}
  }
  // Fallback : forcer l'affichage du form-popup-login via JS si le clic n'a rien fait
  try {
    await page.evaluate(() => {
      const f = document.querySelector("#form-popup-login");
      if (f) {
        let n = f;
        while (n && n !== document.body) {
          n.style.display = "block";
          n.style.visibility = "visible";
          n.style.opacity = "1";
          n = n.parentElement;
        }
      }
    });
    logger.info("  ✓ Modale forcée visible via JS.");
    return true;
  } catch (e) {
    logger.warn(`Impossible d'ouvrir la modale : ${e.message}`);
    return false;
  }
}

export async function login(context, { email, password, logger }) {
  if (!email || !password) {
    throw new Error("UTOPYA_EMAIL ou UTOPYA_PASSWORD manquant dans .env");
  }
  const page = await context.newPage();
  try {
    logger.info("Navigation vers la page de login Utopya…");
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await waitForCloudflare(page, logger, 60000);
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {}

    await dismissCookieBanner(page, logger);
    await openLoginModal(page, logger);

    // Attendre que le champ email soit visible
    try {
      await page.waitForSelector("#form-popup-login #email, #form-popup-login input[name='login[username]']", {
        state: "visible",
        timeout: 15000,
      });
    } catch {
      logger.warn("Email pas encore visible, attente supplémentaire…");
      await page.waitForTimeout(3000);
    }

    logger.info("Saisie des identifiants…");
    // Cibler explicitement le formulaire de la modale (pas le formulaire register)
    const scopedEmail = [
      "#form-popup-login #email",
      "#form-popup-login input[name='login[username]']",
      ...EMAIL_SELECTORS,
    ];
    const scopedPwd = [
      "#form-popup-login #pass",
      "#form-popup-login input[name='login[password]']",
      ...PASSWORD_SELECTORS,
    ];
    const scopedSubmit = [
      "#form-popup-login #send2",
      "#form-popup-login button.action.login",
      "#form-popup-login button[type='submit']",
      ...SUBMIT_SELECTORS,
    ];

    await fillFirst(page, scopedEmail, email);
    await fillFirst(page, scopedPwd, password);

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null),
      clickFirst(page, scopedSubmit),
    ]);
    await page.waitForTimeout(2000);

    await waitForCloudflare(page, logger, 20000);

    // Vérification post-login
    const valid = await isSessionValid(context);
    if (!valid) {
      // Capture une trace pour debug
      const html = await page.content();
      const dump = path.join(
        path.dirname(context._authFile || "."),
        "logs",
        `login-fail-${Date.now()}.html`,
      );
      try {
        fs.mkdirSync(path.dirname(dump), { recursive: true });
        fs.writeFileSync(dump, html);
        logger.error(`Login échoué — HTML sauvegardé dans ${dump}`);
      } catch {}
      throw new Error("Login Utopya échoué (identifiants invalides ou Cloudflare)");
    }
    logger.info("✓ Connecté à Utopya.");
  } finally {
    await page.close();
  }
}

// Anti-détection agressif : masque les signaux d'automation classiques que Cloudflare scanne.
// Patches : webdriver, languages, plugins, chrome obj, permissions, WebGL, hardware specs,
// audio context, canvas noise, screen properties, runtime properties.
const STEALTH_INIT = `
  // 1. webdriver flag → undefined
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // 2. Languages plausibles
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR','fr','en-US','en'] });

  // 3. Plugins fake (un browser sans plugins est suspect)
  const fakePlugin = (name, desc, filename) => ({ name, description: desc, filename, length: 1, item: () => null, namedItem: () => null });
  const pluginsList = [
    fakePlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
    fakePlugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
    fakePlugin('Chromium PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
    fakePlugin('Microsoft Edge PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
    fakePlugin('WebKit built-in PDF', 'Portable Document Format', 'internal-pdf-viewer'),
  ];
  pluginsList.length = 5;
  pluginsList.item = (i) => pluginsList[i] || null;
  pluginsList.namedItem = (n) => pluginsList.find(p => p.name === n) || null;
  Object.defineProperty(navigator, 'plugins', { get: () => pluginsList });
  Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type:'application/pdf', description:'Portable Document Format', suffixes:'pdf' }] });

  // 4. Chrome runtime (présent dans Chrome réel)
  window.chrome = {
    runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
    loadTimes: () => ({ requestTime: Date.now()/1000, startLoadTime: Date.now()/1000, commitLoadTime: Date.now()/1000 }),
    csi: () => ({ pageT: Date.now(), startE: Date.now(), tran: 15 }),
    app: { isInstalled: false, InstallState: {}, RunningState: {} },
  };

  // 5. Permissions (Notification permission cohérent)
  const _origQuery = navigator.permissions && navigator.permissions.query;
  if (_origQuery) {
    navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : _origQuery.call(navigator.permissions, p);
  }

  // 6. Hardware (un Chrome sur Mac a typiquement 8 CPU + 8GB RAM)
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

  // 7. Platform / vendor
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });

  // 8. Screen properties cohérentes
  Object.defineProperty(screen, 'colorDepth', { get: () => 30 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 30 });

  // 9. WebGL renderer/vendor (Cloudflare check) → simule Apple GPU
  const _getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return 'Apple Inc.';                    // UNMASKED_VENDOR_WEBGL
    if (p === 37446) return 'Apple M1';                      // UNMASKED_RENDERER_WEBGL
    return _getParameter.call(this, p);
  };
  if (window.WebGL2RenderingContext) {
    const _getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Apple Inc.';
      if (p === 37446) return 'Apple M1';
      return _getParameter2.call(this, p);
    };
  }

  // 10. Audio context (souvent utilisé pour fingerprinter)
  const _createOscillator = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function() {
    const osc = _createOscillator.call(this);
    return osc;
  };

  // 11. Canvas : ajoute du bruit minime sur les empreintes
  const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const ctx = this.getContext('2d');
    if (ctx && this.width > 16 && this.height > 16) {
      const data = ctx.getImageData(0, 0, this.width, this.height);
      // jitter sur 1 px (imperceptible visuellement, change l'empreinte)
      const i = Math.floor(Math.random() * data.data.length / 4) * 4;
      if (data.data[i] > 0) data.data[i] -= 1;
      ctx.putImageData(data, 0, 0);
    }
    return _toDataURL.apply(this, args);
  };

  // 12. Connection (un Mac sur fibre a typiquement 4g)
  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt',          { get: () => 50 });
    Object.defineProperty(navigator.connection, 'downlink',     { get: () => 10 });
    Object.defineProperty(navigator.connection, 'effectiveType',{ get: () => '4g' });
  }

  // 13. iframe contentWindow (Cloudflare check Function.toString.call)
  // Pas de spoof — laisser tel quel évite le faux positif.
`;

export async function ensureLoggedIn({
  chromium,
  userDataDir,
  authFile,
  email,
  password,
  logger,
  headless,
}) {
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1366, height: 820 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
      "--no-default-browser-check",
      "--no-first-run",
      // ─── Optimisations RAM (utiles sur hébergeurs avec peu de mémoire) ───
      "--disable-dev-shm-usage",       // évite /dev/shm overflow sur containers
      "--disable-gpu",                 // pas de GPU acceleration utile en headless
      "--disable-extensions",
      "--disable-plugins",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-domain-reliability",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees",
      "--disable-ipc-flooding-protection",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-pings",
      "--password-store=basic",
      "--use-mock-keychain",
      // Mode single-process : tout dans un seul process Chrome (très agressif RAM)
      // Activé uniquement si BOT_LOW_MEM=1 pour ne pas péter le scraper local
      ...(process.env.BOT_LOW_MEM === "1"
        ? ["--single-process", "--no-zygote", "--disable-software-rasterizer"]
        : []),
    ],
  });
  context._authFile = authFile;
  await context.addInitScript(STEALTH_INIT);

  // 1) Si on a déjà une session valide (cookies dans user-data-dir), on s'arrête là.
  let ok = await isSessionValid(context);
  if (ok) {
    logger.info("✓ Session existante valide (user-data-dir).");
    return context;
  }

  // 2) Sinon, tenter d'injecter un storage state pré-validé (auth.json) si présent
  if (authFile && fs.existsSync(authFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(authFile, "utf8"));
      const cookies = (state.cookies || []).filter(c => /utopya\.fr$/i.test(c.domain || '') || /utopya\.fr/i.test(c.domain || ''));
      if (cookies.length) {
        await context.addCookies(cookies);
        logger.info(`✓ ${cookies.length} cookies utopya.fr injectés depuis ${authFile}`);
        ok = await isSessionValid(context);
        if (ok) {
          logger.info("✓ Session restaurée via storage state — bypass Cloudflare/login");
          return context;
        }
        logger.warn("Storage state injecté mais session invalide (cookies expirés ?)");
      }
    } catch (e) {
      logger.warn(`Storage state load fail : ${e.message}`);
    }
  }

  logger.warn("Pas de session valide, login en cours…");
  await login(context, { email, password, logger });
  // storageState sauvegardé pour info, mais la vraie persistence est dans user-data-dir
  try {
    await context.storageState({ path: authFile });
  } catch {}
  logger.info(`✓ Session persistée dans ${userDataDir}`);
  return context;
}
