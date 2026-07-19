// ─────────────────────────────────────────────────────────────────────────
// Backend serverless pour créer un PaymentIntent Stripe
// (utilisé par le Payment Request Button — Apple Pay / Google Pay direct)
//
// Flow :
//   1. Front demande create-payment-intent avec les line items
//   2. Backend crée le PaymentIntent avec amount + currency + metadata
//   3. Front utilise client_secret pour confirmer le paiement (Apple Pay sheet)
//   4. Webhook Stripe (existant) reçoit checkout.session.completed OU payment_intent.succeeded
// ─────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import { loadPrices, enforcePrices, loadCardsCfg } from './_prices.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// CORS durci : reflet limité à nos origines (aligné sur les autres endpoints
// de paiement — l'ancien repli '*' était le seul grand ouvert par défaut).
const CORS_ALLOWED = ['https://safix59.fr', 'https://www.safix59.fr'];
function withCors(res, req) {
  const origin = req && req.headers ? req.headers.origin : undefined;
  const allowOrigin = process.env.ALLOWED_ORIGIN || (CORS_ALLOWED.includes(origin) ? origin : 'https://safix59.fr');
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

export default async function handler(req, res) {
  withCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      email,
      total,         // en euros (ex: 89)
      lineItems,     // [{ name, price, qty }]
      delivery,
      paymentFees,
      orderMeta,
    } = req.body || {};

    if (!Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'lineItems vide' });
    }

    // ── ANTI-FRAUDE (même garde que la Carte) : Apple Pay / Google Pay
    // passaient ici SANS aucune validation de prix → on recalcule.
    const PRICES = await loadPrices();
    const CARDS = await loadCardsCfg();
    const chk = enforcePrices(PRICES, lineItems, CARDS);
    if (chk.error) {
      return res.status(chk.error === 'out_of_stock' ? 409 : 400)
        .json({ error: chk.error, item: chk.item, model: chk.model });
    }
    // Montant recalculé serveur depuis les prix validés (plus de confiance
    // aveugle au `total` client). Livraison/frais bornés inchangés.
    const itemsEuros = lineItems.reduce((s, it) => s + Number(it.price) * (it.qty || 1), 0);
    // Plancher 0 : un montant négatif (livraison/frais trafiqués) réduirait
    // frauduleusement le total recalculé serveur.
    const delivEuros = Math.max(0, Number(delivery && delivery.price) || 0);
    const feeEuros   = Math.max(0, Number(paymentFees) || 0);
    const amountCents = Math.round((itemsEuros + delivEuros + feeEuros) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 100) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    // Description lisible pour le statement bancaire et le Payment Sheet
    const itemNames = lineItems.map(i => i.name).join(', ').slice(0, 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      receipt_email: email,
      description: `SAFIX — ${itemNames}`,
      statement_descriptor_suffix: 'SAFIX',
      metadata: {
        platform: 'safix',
        // Stripe refuse toute valeur metadata > 500 car. → borne à 490
        // (sinon gros panier = PaymentIntent rejeté = paiement impossible).
        total_announced: String(total).slice(0, 490),
        ...(orderMeta && {
          model:    String(orderMeta.model    || '').slice(0, 490),
          phone:    String(orderMeta.phone    || '').slice(0, 490),
          snap:     String(orderMeta.snap     || '').slice(0, 490),
          delivery: String(orderMeta.delivery || '').slice(0, 490),
          addr:     String(orderMeta.addr     || '').slice(0, 490),
          apptDate: String(orderMeta.apptDate || '').slice(0, 490),
          apptSlot: String(orderMeta.apptSlot || '').slice(0, 490),
          lang:     String(orderMeta.lang     || 'fr').slice(0, 490),
          cart:     String(orderMeta.cart     || '').slice(0, 490),
        }),
      },
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    console.error('[Stripe] Erreur création PaymentIntent :', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
