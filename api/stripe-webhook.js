// ─────────────────────────────────────────────────────────────────────────
// Webhook Stripe — réceptionne les événements de paiement et :
//   1. envoie un mail à Sami avec le récap (server-side, fiable)
//   2. (optionnel) insère la commande dans Supabase
//   3. (optionnel) trigger le bot Render pour passer la commande Utopya
// ─────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// IMPORTANT : Vercel passe par défaut le body parsé. Pour vérifier la signature
// Stripe il faut le body BRUT. On désactive donc le parser ici.
export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── Mail server-side : Web3Forms (try) puis Resend (fallback) ───────────
async function sendEmailToShop({ session, lineItems }) {
  const accessKey = process.env.WEB3FORMS_KEY || '7b0a17ee-8678-48f1-a0a2-f71b2455d269';
  const customer  = session.customer_details || {};
  const meta      = session.metadata || {};
  const total     = (session.amount_total / 100).toFixed(2);
  const lines = lineItems
    .map(it => `${it.name} ×${it.qty} = ${(it.unit_amount * it.qty / 100).toFixed(2)} €`)
    .join('\n');
  const body = `Nouvelle commande SAFIX (paiement Stripe confirmé)

Client
------
Email    : ${customer.email || session.customer_email || '—'}
Téléphone: ${customer.phone || '—'}

Commande Stripe
---------------
Session  : ${session.id}
Payment  : ${session.payment_intent}

Items
-----
${lines || '—'}

TOTAL : ${total} €
Méta : ${JSON.stringify(meta)}
Reçu le : ${new Date().toLocaleString('fr-FR')}`;

  // 1) Web3Forms (si Pro plan) — sinon refusé en server-side
  try {
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_key: accessKey,
        subject:    `Nouvelle commande SAFIX — ${total} €`,
        from_name:  'SAFIX',
        email:      customer.email || 'noreply@safix59.fr',
        message:    body,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.success) { console.log('[webhook] Mail envoyé via Web3Forms'); return true; }
    console.warn('[webhook] Web3Forms refusé :', j.message);
  } catch (e) {
    console.warn('[webhook] Web3Forms fail :', e.message);
  }

  // 2) Resend (server-friendly, free tier 100/day) — PRIMAIRE en prod
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    process.env.RESEND_FROM || 'SAFIX <onboarding@resend.dev>',
          to:      [process.env.RESEND_TO || 'chafiai.travail@gmail.com'],
          subject: `Nouvelle commande SAFIX — ${total} €`,
          text:    body,
          html:    body.replace(/\n/g, '<br>'),
        }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        console.log('[webhook] Mail envoyé via Resend :', j.id);
        return true;
      }
      console.warn('[webhook] Resend HTTP', r.status, await r.text());
    } catch (e) {
      console.warn('[webhook] Resend fail :', e.message);
    }
  }
  return false;
}

async function insertOrder(order) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.log('[webhook] Supabase non configuré — pas de persistence');
    return { ok: false, reason: 'supabase_missing' };
  }
  const resp = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'apikey':          key,
      'Authorization':  `Bearer ${key}`,
      'Prefer':         'return=representation',
    },
    body: JSON.stringify(order),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error('[webhook] Supabase insert KO', resp.status, t);
    return { ok: false, reason: 'supabase_error' };
  }
  const data = await resp.json();
  return { ok: true, row: data?.[0] || null };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Récupère les line_items
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

    // 1) Mail à Sami (best-effort, ne bloque pas le reste)
    sendEmailToShop({ session, lineItems }).catch(e => console.warn('mail', e.message));

    // 2) Persistence Supabase (si configurée)
    const order = {
      stripe_session_id:     session.id,
      stripe_payment_intent: session.payment_intent,
      customer_email:        session.customer_details?.email || session.customer_email,
      total_cents:           session.amount_total,
      currency:              session.currency,
      status:                'paid',
      line_items:            lineItems,
      metadata:              session.metadata || {},
      created_at:            new Date().toISOString(),
    };
    const result = await insertOrder(order);

    // 3) Trigger bot Render (commande Utopya immédiate, si configuré)
    const botUrl    = process.env.BOT_TRIGGER_URL;
    const botSecret = process.env.BOT_TRIGGER_SECRET;
    if (botUrl && result.ok && result.row?.id) {
      fetch(botUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SAFIX-Secret': botSecret || '' },
        body: JSON.stringify({ orderId: result.row.id }),
      }).then(r => console.log('[webhook] Bot trigger HTTP', r.status))
        .catch(e => console.warn('[webhook] Bot trigger fail :', e.message));
    }

    return res.status(200).json({ received: true, orderId: result.row?.id });
  }

  if (event.type === 'checkout.session.expired') {
    console.log('[webhook] Session expirée :', event.data.object.id);
  } else if (event.type === 'payment_intent.payment_failed') {
    console.log('[webhook] Paiement échoué :', event.data.object.id);
  }

  return res.status(200).json({ received: true });
}
