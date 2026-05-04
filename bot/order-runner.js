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
  info:  (m) => console.log (`[${new Date().toISOString()}] [INFO]  ${m}`),
  warn:  (m) => console.warn(`[${new Date().toISOString()}] [WARN]  ${m}`),
  error: (m) => console.error(`[${new Date().toISOString()}] [ERROR] ${m}`),
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

function findUtopyaUrl(repairId, model) {
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
      await page.waitForTimeout(2000);

      // Quantité
      const qty = item.qty || 1;
      try {
        await page.fill('input#qty', String(qty));
      } catch {}

      // Variante couleur (connecteur de charge)
      if (item.color_name) {
        try {
          // Magento swatch : on clique sur la pastille avec le data-option-label correspondant
          await page.locator(`.swatch-option[data-option-label*="${item.color_name}" i]`).first().click({ timeout: 4000 });
          await page.waitForTimeout(500);
        } catch (e) {
          log.warn(`  Variante couleur "${item.color_name}" non sélectionnable, on continue`);
        }
      }

      // Ajouter au panier
      const addBtn = page.locator('#product-addtocart-button').first();
      if (!(await addBtn.count())) throw new Error(`Bouton "Ajouter au panier" introuvable sur ${url}`);
      await addBtn.click();
      // Attendre la confirmation
      try {
        await page.waitForSelector('.message-success, [data-ui-id="message-success"]', { timeout: 15000 });
      } catch {
        // Pas bloquant si la notif n'arrive pas, vérifier le panier au final
      }
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

// ─── Main loop ───────────────────────────────────────────────────────────
let context = null;
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

  // Lazy login Utopya (1ʳᵉ commande de la session)
  if (!context) {
    try {
      context = await ensureLoggedIn({
        chromium,
        userDataDir: './bot-userdata',
        authFile:    './bot-auth.json',
        email:       process.env.UTOPYA_EMAIL,
        password:    process.env.UTOPYA_PASSWORD,
        logger:      log,
        headless:    true,
      });
    } catch (e) {
      log.error('Login Utopya impossible :', e.message);
      // On ne refund pas tout de suite — Cloudflare peut juste bouder.
      return;
    }
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

  if (!context) {
    context = await ensureLoggedIn({
      chromium,
      userDataDir: './bot-userdata',
      authFile:    './bot-auth.json',
      email:       process.env.UTOPYA_EMAIL,
      password:    process.env.UTOPYA_PASSWORD,
      logger:      log,
      headless:    true,
    });
  }

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
