// ─────────────────────────────────────────────────────────────────────────
// PayPal SDK direct — Création d'un Order PayPal (sans Stripe)
// ─────────────────────────────────────────────────────────────────────────
// Avantages vs PayPal-via-Stripe :
//   - Économie de 0,2 % + 0,10 € par transaction (frais d'orchestration Stripe)
//   - Frais PayPal seulement : 2,9 % + 0,35 €
//   - Paiement in-page natif (modal PayPal, pas de redirect Stripe Checkout)
//
// VARIABLES D'ENVIRONNEMENT REQUISES (Vercel Settings → Environment Variables) :
//   PAYPAL_MODE          = 'sandbox'  ou  'live'
//   PAYPAL_CLIENT_ID     = (côté frontend aussi — public)
//   PAYPAL_CLIENT_SECRET = (côté backend uniquement — secret)
//
// FLUX :
//   1. Front : utilisateur clique sur le bouton PayPal → SDK ouvre la modal
//   2. SDK appelle createOrder() (front) → fetch sur cette route
//   3. Backend crée l'order via API PayPal → retourne { id }
//   4. SDK redirige vers la page d'approbation PayPal (modal)
//   5. Utilisateur valide → SDK appelle onApprove() → fetch /api/paypal-capture-order
// ─────────────────────────────────────────────────────────────────────────

import { loadPrices, enforcePrices } from './_prices.js';

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status}`);
  const j = await r.json();
  return j.access_token;
}

const allowOrigin = process.env.ALLOWED_ORIGIN || '*';
function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

export default async function handler(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Vérifie config PayPal
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'PayPal not configured',
      hint: 'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Vercel env vars',
    });
  }

  try {
    const { total, lineItems, orderMeta } = req.body || {};
    if (!Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'lineItems vide' });
    }

    // ── ANTI-FRAUDE (même garde que Carte/Apple Pay) : PayPal créait
    // l'order avec les prix CLIENT sans aucune vérification → fraude.
    const PRICES = await loadPrices();
    const chk = enforcePrices(PRICES, lineItems);
    if (chk.error) {
      return res.status(chk.error === 'out_of_stock' ? 409 : 400)
        .json({ error: chk.error, item: chk.item, model: chk.model });
    }

    const accessToken = await getAccessToken();

    // Format PayPal Order : breakdown par ligne pour transparence client
    const items = lineItems.map(it => ({
      name: (it.name || 'Réparation').slice(0, 127),
      quantity: String(it.qty || 1),
      unit_amount: { currency_code: 'EUR', value: Number(it.price).toFixed(2) },
    }));
    const itemsTotal = items.reduce(
      (s, it) => s + Number(it.unit_amount.value) * Number(it.quantity), 0
    );
    const shippingTotal = (req.body.delivery && req.body.delivery.price) || 0;
    const grandTotal = itemsTotal + Number(shippingTotal);

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'safix_' + Date.now().toString(36),
        amount: {
          currency_code: 'EUR',
          value: grandTotal.toFixed(2),
          breakdown: {
            item_total: { currency_code: 'EUR', value: itemsTotal.toFixed(2) },
            ...(shippingTotal > 0 && {
              shipping: { currency_code: 'EUR', value: Number(shippingTotal).toFixed(2) }
            }),
          },
        },
        items,
        description: 'Réparation SAFIX (mandat de commande de pièce + service)',
        custom_id: JSON.stringify(orderMeta || {}).slice(0, 127),
      }],
      application_context: {
        brand_name: 'SAFIX',
        locale: 'fr-FR',
        landing_page: 'NO_PREFERENCE',
        shipping_preference: 'NO_SHIPPING',     // adresse gérée par SAFIX (RDV)
        user_action: 'PAY_NOW',
      },
    };

    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[PayPal] Create order failed:', r.status, errText);
      return res.status(502).json({ error: 'PayPal create order failed', detail: errText });
    }

    const order = await r.json();
    return res.status(200).json({ id: order.id });
  } catch (err) {
    console.error('[PayPal] Erreur create order:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
