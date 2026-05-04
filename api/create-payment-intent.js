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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

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

    const amountCents = Math.round(Number(total) * 100);
    if (!amountCents || amountCents < 100) {
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
        total_announced: String(total),
        ...(orderMeta && {
          model:    String(orderMeta.model    || ''),
          phone:    String(orderMeta.phone    || ''),
          snap:     String(orderMeta.snap     || ''),
          delivery: String(orderMeta.delivery || ''),
          addr:     String(orderMeta.addr     || ''),
          apptDate: String(orderMeta.apptDate || ''),
          apptSlot: String(orderMeta.apptSlot || ''),
          lang:     String(orderMeta.lang     || 'fr'),
          cart:     String(orderMeta.cart     || ''),
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
