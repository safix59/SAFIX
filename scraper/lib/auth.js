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

// Anti-détection : masque les signaux d'automation classiques que Cloudflare scanne.
const STEALTH_INIT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR','fr','en-US','en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  window.chrome = window.chrome || { runtime: {}, loadTimes: () => {}, csi: () => {} };
  const _origQuery = navigator.permissions && navigator.permissions.query;
  if (_origQuery) {
    navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : _origQuery.call(navigator.permissions, p);
  }
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
    ],
  });
  context._authFile = authFile;
  await context.addInitScript(STEALTH_INIT);

  // Si on a déjà une session valide (cookies dans user-data-dir), on s'arrête là.
  const ok = await isSessionValid(context);
  if (ok) {
    logger.info("✓ Session existante valide (user-data-dir).");
    return context;
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
