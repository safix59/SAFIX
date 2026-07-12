// ─────────────────────────────────────────────────────────────────────────
// Backend serverless pour créer une session Stripe Checkout
// ─────────────────────────────────────────────────────────────────────────
// COMPATIBLE :
//   - Vercel  (Node Serverless Functions)
//   - Netlify (en renommant `default export` → `exports.handler`)
//   - Cloudflare Workers (avec adaptation mineure)
//
// VARIABLES D'ENVIRONNEMENT (à configurer dans le dashboard de l'hébergeur) :
//   STRIPE_SECRET_KEY = sk_live_xxx  (ou sk_test_xxx)
//   ALLOWED_ORIGIN    = https://safix59.fr   (ton domaine final)
//
// COMMENT DÉPLOYER (Vercel — le plus simple) :
//   1. Crée un compte sur vercel.com (gratuit pour ton volume)
//   2. Connecte ce repo Git (ou drag-and-drop le dossier wIA/)
//   3. Dans Settings → Environment Variables, ajoute STRIPE_SECRET_KEY et ALLOWED_ORIGIN
//   4. C'est tout. L'URL devient https://safix59.fr/api/create-checkout-session
//   5. Mets cette URL dans SAFIX_CONFIG.stripe.createSessionUrl côté front (index.html)
// ─────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import { loadPrices, enforcePrices, loadCardsCfg } from './_prices.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// CORS durci : reflet limité à nos origines (l'app iOS native n'envoie pas
// d'en-tête Origin et ignore CORS — aucun impact hors navigateur).
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
      delivery,      // { name, price } — coût livraison
      paymentFees,   // en euros (ex: 1.59)
      orderMeta,     // { model, phone, snap, delivery, addr, apptDate, apptSlot, lang }
      success_url,
      cancel_url,
    } = req.body || {};

    if (!Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'lineItems vide' });
    }

    // ── ANTI-FRAUDE (helper partagé, origine prices.json PINNÉE → plus
    // de SSRF/bypass par Host). Refuse OOS + prix sous-évalué, facture
    // le prix officiel. Services/livraison hors prices.json inchangés.
    const PRICES = await loadPrices();
    const CARDS = await loadCardsCfg();
    const chk = enforcePrices(PRICES, lineItems, CARDS);
    if (chk.error) {
      return res.status(chk.error === 'out_of_stock' ? 409 : 400)
        .json({ error: chk.error, item: chk.item, model: chk.model });
    }

    // Construit les line_items au format Stripe (montants en centimes)
    const stripeItems = lineItems.map(it => ({
      quantity: it.qty || 1,
      price_data: {
        currency: 'eur',
        product_data: {
          name: it.name,
          description: 'Réparation SAFIX — mandat de commande de pièce + service',
        },
        unit_amount: Math.round(Number(it.price) * 100),
      },
    }));
    // Ajoute la livraison comme line item si > 0
    if (delivery && Number(delivery.price) > 0) {
      stripeItems.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          product_data: { name: delivery.name || 'Livraison', description: 'Frais de livraison de la pièce' },
          unit_amount: Math.round(Number(delivery.price) * 100),
        },
      });
    }
    // Ajoute les frais de paiement Stripe (ligne séparée, transparent pour le client)
    if (Number(paymentFees) > 0) {
      stripeItems.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Frais de paiement',
            description: 'Couvre strictement les frais du processeur de paiement (Stripe : 1,5 % + 0,25 €). Ne revient pas au réparateur.',
          },
          unit_amount: Math.round(Number(paymentFees) * 100),
        },
      });
    }

    // Méthodes de paiement selon le choix client (Apple Pay/Carte → card, PayPal → paypal+card)
    // 'card' active automatiquement Apple Pay / Google Pay sur les appareils compatibles
    const paymentChoice = (orderMeta && orderMeta.paymentMethod) || 'card';
    const stripeMethods = paymentChoice === 'paypal' ? ['paypal', 'card'] : ['card'];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: stripeMethods,
      customer_email: email,
      line_items: stripeItems,
      success_url: success_url || `${allowOrigin}/?paid=1&session={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${allowOrigin}/?cancel=1`,
      // Reçu automatique au client (Stripe envoie un email avec le détail de la commande)
      payment_intent_data: {
        receipt_email: email,
        description: 'Réparation SAFIX (mandat de commande de pièce + service)',
        statement_descriptor_suffix: 'SAFIX',
      },
      // Phone number collection (utile pour le suivi commande)
      phone_number_collection: { enabled: true },
      // Adresse facturation auto
      billing_address_collection: 'auto',
      // Locale FR par défaut
      locale: 'fr',
      metadata: {
        platform: 'safix',
        total_announced: String(total).slice(0, 490),
        // Métadonnées commande (mail client + bot). Stripe REFUSE toute
        // valeur > 500 car. → un gros panier rendait la commande IMPAYABLE
        // en silence. On borne chaque valeur à 490 (O1/F-wave).
        ...(orderMeta && {
          model:    String(orderMeta.model    || '').slice(0, 490),
          phone:    String(orderMeta.phone    || '').slice(0, 490),
          snap:     String(orderMeta.snap     || '').slice(0, 490),
          delivery: String(orderMeta.delivery || '').slice(0, 490),
          addr:     String(orderMeta.addr     || '').slice(0, 490),
          apptDate: String(orderMeta.apptDate || '').slice(0, 490),
          apptSlot: String(orderMeta.apptSlot || '').slice(0, 490),
          lang:     String(orderMeta.lang     || 'fr').slice(0, 490),
          cart:     String(orderMeta.cart     || '').slice(0, 490),  // JSON compact pour bot
        }),
      },
    });

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,                 // redirection directe (plus simple côté front)
    });
  } catch (err) {
    console.error('[Stripe] Erreur création session :', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
