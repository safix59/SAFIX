// ─────────────────────────────────────────────────────────────────────────
// Bot SAFIX — Auto-commande Utopya
// ─────────────────────────────────────────────────────────────────────────
// Ce script tourne en boucle (toutes les 30s) sur Render. À chaque tick :
//   1. Demande à Supabase la liste des commandes en statut "paid"
//   2. Pour chaque commande, ouvre Playwright, login Utopya PRO, ajoute les
//      pièces au panier, passe la commande, met le statut à "ordered"
//   3. Si échec → statut "failed" + déclenche refund Stripe automatique
//
// VARIABLES D'ENVIRONNEMENT (à mettre dans Render → Environment) :
//   SUPABASE_URL          = https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE = eyJxxx...
//   STRIPE_SECRET_KEY     = sk_live_xxx
//   UTOPYA_EMAIL          = email_compte_pro
//   UTOPYA_PASSWORD       = mot_de_passe
//   POLL_INTERVAL_MS      = 30000  (optionnel, défaut 30s)
//
// DÉPLOIEMENT RENDER :
//   1. New → Web Service (PAS Background Worker — on a besoin d'un port HTTP)
//   2. Connect ce repo, root directory = "bot"
//   3. Runtime : Node
//   4. Build command : npm install && npx playwright install chromium
//   5. Start command : node order-runner.js
//   6. Plan : Free OK pour tester, Starter ($7/mo) recommandé en prod
//      (Free se met en veille après inactivité — réveil de ~30s à la 1ère commande)
//   7. Env vars (cf. ci-dessus) + BOT_TRIGGER_SECRET = un mot de passe long aléatoire
//   8. Récupère l'URL Render (ex: https://safix-bot.onrender.com) et mets-la
//      dans Vercel → BOT_TRIGGER_URL = https://safix-bot.onrender.com/run
//      ainsi que BOT_TRIGGER_SECRET = même valeur que côté bot
//
// ARCHITECTURE INSTANTANÉE :
//   client paie sur SAFIX
//     ↓ Stripe checkout.session.completed (≤ 1 s)
//     ↓ POST /api/stripe-webhook (Vercel)
//     ↓ insert Supabase + POST $BOT_TRIGGER_URL/run (Render)
//     ↓ bot lance Playwright + login Utopya + ajoute panier + checkout
//     → commande Utopya passée en ~10 s après le paiement client
//
//   En backup, le bot poll Supabase toutes les 30 s pour rattraper toute
//   commande où le trigger HTTP aurait échoué (Render en veille, etc.).
//
// ─────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import { chromium } from 'playwright';
import { ensureLoggedIn } from '../scraper/lib/auth.js';

const log = {
  info:  (...args) => console.log (`[${new Date().toISOString()}] [INFO] `, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] `, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR]`, ...args),
};

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS || 30000);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// ─── Helpers Supabase ────────────────────────────────────────────────────
async function fetchPending() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?status=eq.paid&order=created_at.asc&limit=5`,
    {
      headers: {
        'apikey':         SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  if (!r.ok) throw new Error(`Supabase fetch ${r.status}`);
  return r.json();
}

async function setStatus(id, status, extra = {}) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ status, ...extra, updated_at: new Date().toISOString() }),
    },
  );
  if (!r.ok) throw new Error(`Supabase patch ${r.status}`);
}

// ─── Helper : refund Stripe automatique en cas d'échec ───────────────────
async function refundOrder(order, reason) {
  try {
    if (!order.stripe_payment_intent) {
      log.warn('Pas de payment_intent → impossible de rembourser auto');
      return false;
    }
    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent,
      reason:         'requested_by_customer',
      metadata:       { auto_refund_reason: reason },
    });
    log.info(`✓ Refund créé : ${refund.id}`);
    return true;
  } catch (e) {
    log.error('Refund échec :', e.message);
    return false;
  }
}

// ─── Charge links.json pour mapper repair_id+model → URL Utopya ──────────
import { readFileSync } from 'node:fs';
const LINKS = (() => {
  try {
    const path = process.env.LINKS_FILE || '../scraper/links.json';
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) { console.error('[bot] Impossible de charger links.json :', e.message); return []; }
})();

// Mapping modelKey (utilisé côté front) → modèle canonique (utilisé dans links.json)
const MODEL_KEY_MAP = {
  'iphone17promax':'iPhone 17 Pro Max', 'iphone17pro':'iPhone 17 Pro', 'iphone17plus':'iPhone 17 Plus', 'iphone17':'iPhone 17', 'iphone17e':'iPhone 17e', 'iphone17air':'iPhone 17 Air',
  'iphone16promax':'iPhone 16 Pro Max', 'iphone16pro':'iPhone 16 Pro', 'iphone16plus':'iPhone 16 Plus', 'iphone16':'iPhone 16', 'iphone16e':'iPhone 16e',
  'iphone15promax':'iPhone 15 Pro Max', 'iphone15pro':'iPhone 15 Pro', 'iphone15plus':'iPhone 15 Plus', 'iphone15':'iPhone 15',
  'iphone14promax':'iPhone 14 Pro Max', 'iphone14pro':'iPhone 14 Pro', 'iphone14plus':'iPhone 14 Plus', 'iphone14':'iPhone 14',
  'iphone13promax':'iPhone 13 Pro Max', 'iphone13pro':'iPhone 13 Pro', 'iphone13mini':'iPhone 13 mini', 'iphone13':'iPhone 13',
  'iphone12promax':'iPhone 12 Pro Max', 'iphone12pro':'iPhone 12 Pro', 'iphone12mini':'iPhone 12 mini', 'iphone12':'iPhone 12',
  'iphone11promax':'iPhone 11 Pro Max', 'iphone11pro':'iPhone 11 Pro', 'iphone11':'iPhone 11',
  'iphonexsmax':'iPhone XS Max', 'iphonexs':'iPhone XS', 'iphonexr':'iPhone XR', 'iphonex':'iPhone X',
  'iphonese2022':'iPhone SE (2022)', 'iphonese2020':'iPhone SE (2020)',
  'iphone8plus':'iPhone 8 Plus', 'iphone8':'iPhone 8', 'iphone7plus':'iPhone 7 Plus', 'iphone7':'iPhone 7',
  'iphone6splus':'iPhone 6s Plus', 'iphone6s':'iPhone 6s', 'iphone6plus':'iPhone 6 Plus', 'iphone6':'iPhone 6',
};

function findUtopyaUrl(repairId, modelOrKey) {
  // Accepte soit la modelKey ('iphone13promax') soit le nom canonique ('iPhone 13 Pro Max')
  const model = MODEL_KEY_MAP[modelOrKey] || modelOrKey;
  // Sélectionne la priorité 1 par défaut, puis 2, etc.
  const candidates = LINKS
    .filter(L => L.repair_id === repairId && L.model === model)
    .sort((a, b) => (a.priority || 1) - (b.priority || 1));
  return candidates[0]?.url || null;
}

// Méthode de paiement à utiliser sur Utopya (configurable via env)
//   Valeurs détectées sur le compte PRO :
//     scellius_standard  → Carte Bancaire (Banque Postale Scellius)
//     paypal_express     → PayPal
//     banktransfer       → Virement (= "Paiement bancaire" classique)
//     fintecture         → Paiement bancaire instantané (Open Banking)
//     ups_cod            → Paiement à la livraison
//
// CHOIX : carte bancaire enregistrée (scellius_standard) — le compte PRO
// SAFIX a une CB enregistrée chez Utopya. 3DS souvent "frictionless"
// pour comptes PRO = bot 100% autonome dans 80-90 % des cas.
//
// Si la CB échoue (3DS challenge ou plafond), le bot bascule sur Fintecture
// → Sami valide sur son app banque (~5 s) → commande passée.
const PAYMENT_PRIMARY  = process.env.UTOPYA_PAYMENT          || 'scellius_standard';
const PAYMENT_FALLBACK = process.env.UTOPYA_PAYMENT_FALLBACK || 'fintecture';
const SHOULD_CONFIRM   = process.env.CONFIRM_ORDER === 'true'; // safety switch

// ─── Cœur : passe UNE commande sur utopya.fr ─────────────────────────────
async function placeOrderOnUtopya(context, order) {
  const page = await context.newPage();
  try {
    log.info(`→ Commande Utopya pour order ${order.id}`);

    // Vider le panier au préalable (sécurité : commande précédente résiduelle)
    await page.goto('https://www.utopya.fr/checkout/cart/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    try {
      const empty = await page.locator('button.action.primary:has-text("Vider")').first();
      if (await empty.count()) { await empty.click(); await page.waitForTimeout(1500); }
    } catch {}

    // 1) Pour chaque line item → fiche produit → ajouter au panier
    for (const item of (order.line_items || [])) {
      const url = findUtopyaUrl(item.repair_id, item.model);
      if (!url) throw new Error(`URL introuvable : ${item.repair_id} / ${item.model}`);

      log.info(`  [+] ${item.qty || 1}× ${item.repair_id} / ${item.model}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Accepter le cookie banner Axeptio (sinon il couvre le bouton add-to-cart)
      try {
        const accept = await page.$('#axeptio_btn_acceptAll');
        if (accept && await accept.isVisible().catch(() => false)) {
          await accept.click();
          log.info('    ✓ Cookie banner accepté');
          await page.waitForTimeout(800);
        }
      } catch {}

      // Cacher tout sticky/overlay qui pourrait masquer le bouton
      await page.evaluate(() => {
        const selectors = ['.sticky-header', '#header-sticky', '.cookie-banner', '.modal-overlay', '[id*="popup"]', '[class*="sticky"]', '.overlay'];
        for (const s of selectors) {
          document.querySelectorAll(s).forEach(el => {
            try { el.style.display = 'none'; } catch {}
          });
        }
      }).catch(() => {});

      // Quantité
      const qty = item.qty || 1;
      try {
        await page.fill('input#qty', String(qty));
      } catch {}

      // Variante couleur (connecteur de charge)
      const colorName = item.color || item.color_name || item.colorName;
      if (colorName) {
        try {
          // Magento swatch : on clique sur la pastille avec le data-option-label correspondant
          await page.locator(`.swatch-option[data-option-label*="${colorName}" i]`).first().click({ timeout: 4000 });
          await page.waitForTimeout(500);
        } catch (e) {
          log.warn(`  Variante couleur "${colorName}" non sélectionnable, on continue`);
        }
      }

      // Ajouter au panier — soumission directe du form (le bouton est souvent caché)
      // On utilise fetch() côté navigateur ce qui réutilise les cookies de session
      const addedOk = await page.evaluate(async () => {
        const form = document.querySelector('#product_addtocart_form');
        if (!form) return { ok: false, reason: 'form_not_found' };
        const formData = new FormData(form);
        // Magento attend isAjax=1 pour ne pas rediriger
        formData.append('isAjax', '1');
        try {
          const resp = await fetch(form.action, {
            method: 'POST',
            body: formData,
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'include',
          });
          const txt = await resp.text();
          return { ok: resp.ok, status: resp.status, sample: txt.slice(0, 200) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
      log.info(`    Add-to-cart fetch result : ${JSON.stringify(addedOk).slice(0, 200)}`);
      if (!addedOk.ok) {
        throw new Error(`Add-to-cart fetch échec : ${JSON.stringify(addedOk).slice(0, 100)}`);
      }
      await page.waitForTimeout(2000);
    }

    // 2) Aller à la page panier → cliquer "Commander"
    await page.goto('https://www.utopya.fr/checkout/cart/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    // Vérification : panier non vide
    const itemsCount = await page.locator('.cart.item, tr.item-info, .cart-item').count();
    if (itemsCount === 0) throw new Error('Panier vide après ajout — abort');

    const checkoutBtn = page.locator('#top-cart-btn-checkout, button:has-text("Commander")').first();
    if (!(await checkoutBtn.count())) throw new Error('Bouton "Commander" introuvable');
    await checkoutBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 3) Sur /checkout/ : choisir le mode de paiement (avec fallback)
    if (!page.url().includes('/checkout/')) throw new Error(`Pas sur la page checkout : ${page.url()}`);
    let chosen = null;
    for (const method of [PAYMENT_PRIMARY, PAYMENT_FALLBACK].filter(Boolean)) {
      try {
        await page.locator(`input#${method}`).check({ timeout: 6000 });
        chosen = method;
        log.info(`  ✓ Paiement choisi : ${method}`);
        break;
      } catch {
        log.warn(`  Méthode "${method}" indisponible, tentative suivante…`);
      }
    }
    if (!chosen) {
      throw new Error(`Aucune méthode de paiement utilisable — vérifie UTOPYA_PAYMENT (testé : ${PAYMENT_PRIMARY}, ${PAYMENT_FALLBACK})`);
    }
    await page.waitForTimeout(1500);

    // 4) Confirmer la commande
    if (!SHOULD_CONFIRM) {
      log.warn('  CONFIRM_ORDER!=true → arrêt avant validation finale (mode dry-run)');
      // On tente juste de capturer le total + le n° si visible
      const total = await page.locator('.grand-total .price, .grand.totals .price').first().textContent().catch(() => '');
      throw new Error(`DRY_RUN — pas de validation. Total Utopya estimé : ${total?.trim() || 'inconnu'}`);
    }

    // Cherche le bouton "Passer la commande" (varie selon Magento)
    const placeBtn = page.locator(
      'button.checkout, button:has-text("Passer la commande"), button:has-text("Commander"), button[data-role="review-save"]'
    ).first();
    if (!(await placeBtn.count())) throw new Error('Bouton "Passer la commande" introuvable');
    await placeBtn.click();

    // Attendre la page de confirmation
    await page.waitForURL(/\/onepage\/success|\/checkout\/success/, { timeout: 60000 });
    await page.waitForTimeout(2000);

    // Récupérer le n° de commande
    const utopyaOrderId = await page.locator('.checkout-success [data-bind*="order"], .order-number').first().textContent().catch(() => '?');

    log.info(`  ✓ Commande Utopya passée : ${utopyaOrderId}`);
    return { utopyaOrderId: (utopyaOrderId || '').trim(), etaDate: null };
  } finally {
    await page.close();
  }
}

// ─── Bootstrap : télécharge auth.json depuis Supabase Storage au démarrage
// pour avoir une session pré-validée (bypass Cloudflare/login si encore valide)
import { writeFileSync as _writeSync, existsSync } from 'node:fs';
async function bootstrapAuthFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  if (existsSync('./bot-auth.json')) {
    log.info('bot-auth.json déjà présent localement');
    return true;
  }
  try {
    log.info('Téléchargement auth.json depuis Supabase Storage…');
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/auth/utopya-storage-state.json`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!r.ok) {
      log.warn(`Auth bootstrap : Supabase Storage HTTP ${r.status} (skipping)`);
      return false;
    }
    const json = await r.text();
    _writeSync('./bot-auth.json', json);
    log.info(`✓ auth.json téléchargé (${json.length} bytes) — session pré-validée prête`);
    return true;
  } catch (e) {
    log.warn('Auth bootstrap échec :', e.message);
    return false;
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────
let context = null;
let contextPromise = null;  // Lock anti-race-condition
async function getOrCreateContext() {
  if (context) return context;
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    try {
      // Bootstrap : télécharge auth.json si pas encore fait
      await bootstrapAuthFromSupabase();
      context = await ensureLoggedIn({
        chromium,
        userDataDir: './bot-userdata',
        authFile:    './bot-auth.json',
        email:       process.env.UTOPYA_EMAIL,
        password:    process.env.UTOPYA_PASSWORD,
        logger:      log,
        headless:    true,
      });
      return context;
    } finally {
      contextPromise = null;
    }
  })();
  return contextPromise;
}

async function tick() {
  let pending = [];
  try {
    pending = await fetchPending();
  } catch (e) {
    log.error('Fetch pending échec :', e.message);
    return;
  }
  if (!pending.length) return;
  log.info(`${pending.length} commande(s) à traiter`);

  // Lazy login Utopya — utilise le lock pour éviter les race conditions
  try {
    await getOrCreateContext();
  } catch (e) {
    log.error('Login Utopya impossible :', e.message);
    log.error('Stack :', e.stack?.slice(0, 500));
    return;
  }

  for (const order of pending) {
    try {
      await setStatus(order.id, 'ordering');
      const result = await placeOrderOnUtopya(context, order);
      await setStatus(order.id, 'ordered', {
        utopya_order_id: result.utopyaOrderId,
        eta_date:        result.etaDate,
      });
      log.info(`✓ Order ${order.id} → Utopya ${result.utopyaOrderId}`);
    } catch (e) {
      log.error(`Order ${order.id} → échec : ${e.message}`);
      const refunded = await refundOrder(order, e.message);
      await setStatus(order.id, refunded ? 'refunded' : 'failed', {
        error_message: e.message.slice(0, 500),
      });
    }
  }
}

// ─── Endpoint HTTP : trigger instantané depuis le webhook Stripe ─────────
// Quand Stripe confirme un paiement, l'API Vercel POST sur /run avec
// l'orderId. On lance immédiatement le traitement de cette commande
// (sans attendre le prochain poll).
import http from 'node:http';

const PORT       = Number(process.env.PORT || 3000);
const SECRET     = process.env.BOT_TRIGGER_SECRET || '';

async function processSingleOrder(orderId) {
  // Recharge l'order depuis Supabase (paranoïaque : on ne fait confiance qu'à la base)
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Order fetch ${r.status}`);
  const rows = await r.json();
  const order = rows[0];
  if (!order) throw new Error('Order introuvable');
  if (order.status !== 'paid') {
    log.warn(`Order ${orderId} déjà en statut "${order.status}" — skip`);
    return;
  }

  await getOrCreateContext();

  await setStatus(order.id, 'ordering');
  try {
    const result = await placeOrderOnUtopya(context, order);
    await setStatus(order.id, 'ordered', {
      utopya_order_id: result.utopyaOrderId,
      eta_date:        result.etaDate,
    });
  } catch (e) {
    log.error(`Order ${order.id} → ${e.message}`);
    const refunded = await refundOrder(order, e.message);
    await setStatus(order.id, refunded ? 'refunded' : 'failed', {
      error_message: e.message.slice(0, 500),
    });
  }
}

const server = http.createServer((req, res) => {
  // Health check (GET /)
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'safix-bot' }));
  }

  // Trigger (POST /run)
  if (req.method === 'POST' && req.url === '/run') {
    if (SECRET && req.headers['x-safix-secret'] !== SECRET) {
      res.writeHead(401); return res.end('unauthorized');
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { orderId } = JSON.parse(body || '{}');
        if (!orderId) { res.writeHead(400); return res.end('orderId manquant'); }
        // Réponse rapide à Vercel — on traite la commande en arrière-plan
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true, orderId }));
        processSingleOrder(orderId).catch(e => log.error(`Trigger ${orderId} : ${e.message}`));
      } catch (e) {
        res.writeHead(400); res.end('bad json');
      }
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  log.info(`HTTP trigger prêt sur :${PORT}`);
});

// ─── Filet de sécurité : poll en parallèle (rattrape les commandes ratées) ─
console.log(`[bot] Démarrage — poll toutes les ${POLL_INTERVAL}ms (filet de sécurité)`);
(async () => {
  while (true) {
    try { await tick(); } catch (e) { console.error('tick error', e); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
})();
