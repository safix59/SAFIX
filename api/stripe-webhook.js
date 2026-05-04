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

// ─── Templates HTML (mail propre) ────────────────────────────────────────
function buildShopEmailHtml({ session, lineItems }) {
  const customer = session.customer_details || {};
  const total    = (session.amount_total / 100).toFixed(2);
  const dt       = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const itemsRows = lineItems.map(it => {
    const lt = (it.unit_amount * it.qty / 100).toFixed(2);
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;">${it.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">×${it.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">${lt} €</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SAFIX — Commande ${total} €</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.06);">
      <div style="background:linear-gradient(135deg,#0066ff 0%,#5b21b6 100%);padding:28px 24px;text-align:center;color:#fff;">
        <div style="font-size:13px;letter-spacing:2px;opacity:.85;text-transform:uppercase;font-weight:600;">SAFIX · Nouvelle commande</div>
        <div style="font-size:36px;font-weight:800;margin-top:8px;letter-spacing:-1px;">${total} €</div>
        <div style="font-size:12px;opacity:.85;margin-top:4px;">${dt}</div>
      </div>
      <div style="padding:24px;">
        <div style="font-size:13px;color:#86868b;letter-spacing:1px;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Client</div>
        <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:24px;">
          <tr><td style="padding:6px 0;color:#86868b;width:120px;">Email</td><td style="padding:6px 0;font-weight:600;"><a href="mailto:${customer.email || ''}" style="color:#0066ff;text-decoration:none;">${customer.email || session.customer_email || '—'}</a></td></tr>
          <tr><td style="padding:6px 0;color:#86868b;">Téléphone</td><td style="padding:6px 0;font-weight:600;">${customer.phone || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#86868b;vertical-align:top;">Adresse</td><td style="padding:6px 0;font-weight:600;">${customer.address ? Object.values(customer.address).filter(Boolean).join(', ') : '—'}</td></tr>
        </table>
        <div style="font-size:13px;color:#86868b;letter-spacing:1px;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Commande</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <thead><tr style="background:#f5f5f7;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#86868b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Article</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#86868b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Qté</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600;color:#86868b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Total</th>
          </tr></thead>
          <tbody>${itemsRows}</tbody>
          <tfoot><tr><td colspan="2" style="padding:14px 12px;font-weight:700;font-size:16px;">TOTAL</td><td style="padding:14px 12px;text-align:right;font-weight:800;font-size:18px;color:#0066ff;font-variant-numeric:tabular-nums;">${total} €</td></tr></tfoot>
        </table>
        <div style="margin-top:24px;padding:16px;background:#f5f5f7;border-radius:12px;font-size:13px;line-height:1.5;color:#3a3a3c;">
          <strong>Stripe</strong> session <code style="font-size:12px;background:#fff;padding:2px 6px;border-radius:4px;">${session.id.slice(-12)}</code><br>
          Paiement <code style="font-size:12px;background:#fff;padding:2px 6px;border-radius:4px;">${(session.payment_intent || '').slice(-12)}</code>
        </div>
      </div>
    </div>
    <div style="text-align:center;font-size:12px;color:#86868b;margin-top:20px;">
      SAFIX · 48 Bd Alexandre III, 59140 Dunkerque · SIREN 942 003 062
    </div>
  </div>
</body></html>`;
}

function buildClientEmailHtml({ session, lineItems }) {
  const total    = (session.amount_total / 100).toFixed(2);
  const dt       = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const itemsRows = lineItems.map(it => {
    const lt = (it.unit_amount * it.qty / 100).toFixed(2);
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;">${it.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">×${it.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">${lt} €</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SAFIX — Confirmation de commande</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;font-weight:800;color:#0066ff;letter-spacing:-1px;">SAFIX</div>
      <div style="font-size:13px;color:#86868b;margin-top:4px;">Réparation iPhone Premium</div>
    </div>
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.06);">
      <div style="background:linear-gradient(135deg,#0066ff 0%,#5b21b6 100%);padding:32px 24px;text-align:center;color:#fff;">
        <div style="font-size:48px;margin-bottom:8px;">✓</div>
        <div style="font-size:24px;font-weight:700;letter-spacing:-.5px;">Commande confirmée</div>
        <div style="font-size:14px;opacity:.85;margin-top:8px;">Merci pour votre confiance</div>
      </div>
      <div style="padding:28px 24px;">
        <p style="font-size:15px;line-height:1.6;color:#1d1d1f;margin:0 0 24px;">
          Bonjour,<br><br>
          Votre commande SAFIX a bien été reçue et le paiement est confirmé. Nous allons commander la pièce nécessaire chez notre fournisseur partenaire pour réaliser votre réparation.
        </p>
        <div style="font-size:13px;color:#86868b;letter-spacing:1px;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Détail de votre commande</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <thead><tr style="background:#f5f5f7;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#86868b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Article</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#86868b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Qté</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600;color:#86868b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Prix</th>
          </tr></thead>
          <tbody>${itemsRows}</tbody>
          <tfoot><tr><td colspan="2" style="padding:14px 12px;font-weight:700;font-size:16px;">TOTAL</td><td style="padding:14px 12px;text-align:right;font-weight:800;font-size:18px;color:#0066ff;font-variant-numeric:tabular-nums;">${total} €</td></tr></tfoot>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f5f5f7;border-radius:12px;font-size:13px;line-height:1.5;color:#3a3a3c;">
          <strong>Et maintenant ?</strong><br>
          1. Vous recevrez un mail de confirmation avec votre rendez-vous de dépôt<br>
          2. Apportez votre iPhone à l'adresse convenue<br>
          3. Réparation effectuée le jour-même dans la majorité des cas
        </div>
        <div style="margin-top:20px;padding:16px;border:1.5px solid #e5e5e5;border-radius:12px;font-size:13px;line-height:1.5;">
          <strong>Adresse de dépôt par défaut :</strong><br>
          48 Bd Alexandre III, 59140 Dunkerque<br>
          <span style="color:#86868b;">(ou autre adresse selon votre choix — nous vous recontactons)</span>
        </div>
        <div style="text-align:center;margin-top:28px;font-size:13px;color:#86868b;">
          Une question ? Réponds simplement à ce mail<br>
          <span style="color:#86868b;">ou contacte le support : <a href="mailto:fusion-laminaire-0i@icloud.com" style="color:#0066ff;text-decoration:none;">fusion-laminaire-0i@icloud.com</a></span>
        </div>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;color:#86868b;margin-top:20px;line-height:1.5;">
      SAFIX · Entreprise individuelle · 48 Bd Alexandre III, 59140 Dunkerque<br>
      SIREN 942 003 062 · TVA non applicable, art. 293 B du CGI<br>
      Reçu le ${dt}
    </div>
  </div>
</body></html>`;
}

// ─── Mail server-side : Web3Forms (try) puis Resend (fallback) ───────────
async function sendEmailToShop({ session, lineItems }) {
  const accessKey = process.env.WEB3FORMS_KEY || '7b0a17ee-8678-48f1-a0a2-f71b2455d269';
  const customer  = session.customer_details || {};
  const total     = (session.amount_total / 100).toFixed(2);
  const html      = buildShopEmailHtml({ session, lineItems });
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
          subject: `🔔 Nouvelle commande SAFIX — ${total} €`,
          text:    body,
          html,
        }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        console.log('[webhook] Mail SHOP envoyé via Resend :', j.id);
        return true;
      }
      console.warn('[webhook] Resend HTTP', r.status, await r.text());
    } catch (e) {
      console.warn('[webhook] Resend fail :', e.message);
    }
  }
  return false;
}

// ─── Mail au client (HTML beau) ──────────────────────────────────────────
async function sendEmailToClient({ session, lineItems }) {
  const customer = session.customer_details || {};
  const customerEmail = customer.email || session.customer_email;
  if (!customerEmail) return false;
  if (!process.env.RESEND_API_KEY) return false;

  // Resend free tier limite l'envoi : tant que le domain safix59.fr n'est pas
  // vérifié dans Resend, on ne peut envoyer QU'à l'email du compte (chafiai.travail@gmail.com).
  // Stripe envoie déjà un reçu auto (configuré dans create-checkout-session via receipt_email).
  // → Quand le domain sera vérifié, on enverra ce mail HTML personnalisé en plus.
  if (!process.env.RESEND_DOMAIN_VERIFIED) {
    console.log('[webhook] Mail CLIENT skip (domain Resend non vérifié, Stripe receipt envoyé à la place)');
    return false;
  }

  const total = (session.amount_total / 100).toFixed(2);
  const html  = buildClientEmailHtml({ session, lineItems });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    process.env.RESEND_FROM_CLIENT || 'SAFIX <orders@safix59.fr>',
        to:      [customerEmail],
        subject: `✓ SAFIX — Commande confirmée (${total} €)`,
        html,
      }),
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      console.log('[webhook] Mail CLIENT envoyé via Resend :', j.id);
      return true;
    }
    console.warn('[webhook] Resend client HTTP', r.status, await r.text());
  } catch (e) {
    console.warn('[webhook] Resend client fail :', e.message);
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

    // 1) Mails (shop + client, best-effort, ne bloque pas le reste)
    sendEmailToShop({ session, lineItems }).catch(e => console.warn('mail shop', e.message));
    sendEmailToClient({ session, lineItems }).catch(e => console.warn('mail client', e.message));

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
