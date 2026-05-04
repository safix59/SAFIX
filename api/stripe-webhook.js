// ─────────────────────────────────────────────────────────────────────────
// Webhook Stripe — réceptionne les événements de paiement et enclenche la
// commande automatique chez le fournisseur (Utopya).
// ─────────────────────────────────────────────────────────────────────────
//
// FLUX :
//   1. Client paie via Stripe Checkout
//   2. Stripe POST sur /api/stripe-webhook avec event = checkout.session.completed
//   3. On vérifie la signature (sécurité critique)
//   4. On insère la commande dans Supabase (statut: paid)
//   5. Le bot Render (séparé) poll Supabase pour les commandes statut "paid"
//      et passe la commande sur utopya.fr puis met à jour le statut
//
// VARIABLES D'ENVIRONNEMENT (dashboard Vercel → Settings → Env Variables) :
//   STRIPE_SECRET_KEY      = sk_live_xxx  (déjà utilisé par create-checkout-session.js)
//   STRIPE_WEBHOOK_SECRET  = whsec_xxx    (donné par Stripe quand tu crées le webhook)
//   SUPABASE_URL           = https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE  = eyJxxx...  (clé service_role, PAS la anon)
//
// COMMENT CRÉER LE WEBHOOK STRIPE :
//   1. Dashboard Stripe → Developers → Webhooks → Add endpoint
//   2. URL : https://safix.fr/api/stripe-webhook  (ou ton domaine Vercel)
//   3. Events à écouter :
//        - checkout.session.completed
//        - checkout.session.expired
//        - payment_intent.payment_failed
//   4. Récupère le "Signing secret" (whsec_...) → mets-le dans STRIPE_WEBHOOK_SECRET
//
// ─────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// IMPORTANT : Vercel passe par défaut le body parsé. Pour vérifier la signature
// Stripe il faut le body BRUT. On désactive donc le parser ici.
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper : lit le body brut depuis req
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Helper : insère une commande dans Supabase via l'API REST
async function insertOrder(order) {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.error('[webhook] Supabase non configuré — commande non persistée');
    return { ok: false, reason: 'supabase_missing' };
  }
  const resp = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         key,
      'Authorization': `Bearer ${key}`,
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(order),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error('[webhook] Supabase insert KO', resp.status, t);
    return { ok: false, reason: 'supabase_error', detail: t };
  }
  const data = await resp.json();
  return { ok: true, row: data?.[0] || null };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET manquant');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('[webhook] Signature invalide :', err.message);
    return res.status(400).json({ error: `Webhook signature: ${err.message}` });
  }

  // ─── checkout.session.completed : paiement réussi ─────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // On récupère les line_items pour reconstituer la commande
    let lineItems = [];
    try {
      const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
      lineItems = li.data.map(item => ({
        name:        item.description,
        qty:         item.quantity,
        unit_amount: item.amount_total / item.quantity, // centimes
      }));
    } catch (e) {
      console.warn('[webhook] listLineItems échec :', e.message);
    }

    const order = {
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent,
      customer_email:    session.customer_details?.email || session.customer_email,
      total_cents:       session.amount_total,
      currency:          session.currency,
      status:            'paid',          // → bot Render poll les "paid"
      line_items:        lineItems,
      metadata:          session.metadata || {},
      created_at:        new Date().toISOString(),
    };

    const result = await insertOrder(order);
    if (!result.ok) {
      // On répond 500 → Stripe va réessayer le webhook plus tard
      return res.status(500).json({ error: 'Persist failed', reason: result.reason });
    }
    console.log('[webhook] Commande persistée :', result.row?.id || '?');
    return res.status(200).json({ received: true, orderId: result.row?.id });
  }

  // ─── Autres événements : on log et on accuse réception ────────────────
  if (event.type === 'checkout.session.expired') {
    console.log('[webhook] Session expirée :', event.data.object.id);
  } else if (event.type === 'payment_intent.payment_failed') {
    console.log('[webhook] Paiement échoué :', event.data.object.id);
  }

  return res.status(200).json({ received: true });
}
