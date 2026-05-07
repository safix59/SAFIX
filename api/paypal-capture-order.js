// ─────────────────────────────────────────────────────────────────────────
// PayPal SDK direct — Capture (finalisation) d'un Order PayPal
// ─────────────────────────────────────────────────────────────────────────
// Appelé par le SDK PayPal côté front après que l'utilisateur a validé dans
// la modal PayPal (event onApprove). On capture le paiement → retourne le
// résultat → on insère l'order dans Supabase et on déclenche le bot Render.
//
// ENV vars (mêmes que paypal-create-order.js) :
//   PAYPAL_MODE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
//
// + côté Supabase pour insérer l'order :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE
// + côté bot pour déclencher la commande Utopya :
//   BOT_TRIGGER_URL, BOT_TRIGGER_SECRET
// + côté Resend pour les emails :
//   RESEND_API_KEY, RESEND_FROM, RESEND_TO, RESEND_FROM_CLIENT
// ─────────────────────────────────────────────────────────────────────────

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

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal not configured' });
  }

  try {
    const { orderID } = req.body || {};
    if (!orderID) return res.status(400).json({ error: 'orderID manquant' });

    const accessToken = await getAccessToken();

    // Capture le paiement
    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[PayPal] Capture failed:', r.status, errText);
      return res.status(502).json({ error: 'PayPal capture failed', detail: errText });
    }
    const captureData = await r.json();

    // Vérifie le statut de capture
    const capture = captureData?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture || capture.status !== 'COMPLETED') {
      return res.status(402).json({
        error: 'Capture incomplète',
        status: capture?.status,
      });
    }

    // ⚠️ TODO : ici on devrait insérer l'order dans Supabase + déclencher le bot
    //          + envoyer les emails (idem flow Stripe webhook). Pour faire ça
    //          proprement, factoriser le code de stripe-webhook.js dans un
    //          module commun (lib/order-pipeline.js) appelé par les 2.
    //          Pour la v1 PayPal direct : retourner OK, le client recevra son
    //          mail PayPal de confirmation par défaut, et SAFIX traitera la
    //          commande manuellement (compatible avec phase d'amorçage volume).

    return res.status(200).json({
      ok: true,
      captureId: capture.id,
      amount: capture.amount,
      payerEmail: captureData?.payer?.email_address || null,
    });
  } catch (err) {
    console.error('[PayPal] Erreur capture:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
