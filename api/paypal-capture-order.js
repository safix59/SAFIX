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

// CORS durci : reflet limité à nos origines (l'app iOS ignore CORS).
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

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal not configured' });
  }

  try {
    const { orderID } = req.body || {};
    if (!orderID) return res.status(400).json({ error: 'orderID manquant' });

    const accessToken = await getAccessToken();

    // Capture le paiement
    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[PayPal] Capture failed:', r.status, errText);
      if (/ORDER_ALREADY_CAPTURED/.test(errText)) {
        // Re-onApprove / double POST : la capture a DÉJÀ réussi (argent pris à
        // la 1re tentative). Ne PAS renvoyer 502 (le client verrait « échec »
        // sur un paiement abouti) → succès idempotent.
        return res.status(200).json({ ok: true, orderID, alreadyCaptured: true, deduped: true });
      }
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

    // ── Persistance + idempotence + bot + notif boutique ──────────────────
    //    BEST-EFFORT, JAMAIS FATAL : le paiement est déjà capturé (argent pris),
    //    le client DOIT recevoir 200 quoi qu'il arrive ; on enregistre/notifie
    //    hors-bande. (Le montant PayPal est déjà figé serveur par
    //    paypal-create-order.js via loadPrices/enforcePrices → pas de re-check.)
    //    NOTE: à tester en sandbox PayPal avant activation (custom_id PayPal
    //    limité à 127 c. → metadata RDV/adresse possiblement tronquée).
    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE;
    const dedupeRef = `paypal_${orderID}`;
    try {
      if (SUPA_URL && SUPA_KEY) {
        const ex = await fetch(
          `${SUPA_URL}/rest/v1/orders?stripe_session_id=eq.${encodeURIComponent(dedupeRef)}&select=id&limit=1`,
          { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } },
        );
        const exRows = await ex.json().catch(() => null);
        if (Array.isArray(exRows) && exRows.length > 0) {
          console.log(`[PayPal] order ${dedupeRef} déjà enregistrée (${exRows[0].id}) — skip`);
          return res.status(200).json({
            ok: true, captureId: capture.id, amount: capture.amount,
            payerEmail: captureData?.payer?.email_address || null, deduped: true,
          });
        }
        const pu = captureData?.purchase_units?.[0] || {};
        let meta = {};
        try { meta = JSON.parse(pu.custom_id || '{}'); } catch (e) {}
        const lineItems = (Array.isArray(pu.items) ? pu.items : []).map(it => ({
          name: it.name,
          qty: Number(it.quantity) || 1,
          unit_amount: Math.round(Number(it.unit_amount?.value || 0) * 100),
        }));
        const amountCents = Math.round(Number(capture.amount?.value || 0) * 100);
        const order = {
          stripe_session_id:     dedupeRef,
          stripe_payment_intent: `paypal_${capture.id}`,
          customer_email:        captureData?.payer?.email_address || meta.email || null,
          total_cents:           amountCents,
          currency:              (capture.amount?.currency_code || 'EUR').toLowerCase(),
          status:                'paid',
          line_items:            lineItems,
          metadata:              { ...meta, source: 'paypal', paypal_order: orderID, paypal_capture: capture.id },
          created_at:            new Date().toISOString(),
        };
        const ins = await fetch(`${SUPA_URL}/rest/v1/orders`, {
          method: 'POST',
          headers: {
            apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
            'Content-Type': 'application/json', Prefer: 'return=representation',
          },
          body: JSON.stringify(order),
        });
        const insRow = await ins.json().catch(() => null);
        const orderId = Array.isArray(insRow) ? insRow[0]?.id : insRow?.id;
        console.log(`[PayPal] order persistée ${dedupeRef} → ${orderId} (HTTP ${ins.status})`);

        // Tâches ATTENDUES avant la réponse (Promise.allSettled ci-dessous) :
        // en serverless, un travail lancé après la réponse peut être gelé et
        // perdu. Chaque tâche reste non-fatale.
        const pending = [];
        const botUrl = process.env.BOT_TRIGGER_URL;
        // ⛔ Bot Utopya coupé tant que UTOPYA_BOT_PAUSED='1' (demande Utopya
        // 2026-07-13) : commande fournisseur à passer manuellement.
        if (process.env.UTOPYA_BOT_PAUSED === '1' && botUrl && orderId) {
          console.warn('[PayPal] Bot Utopya EN PAUSE — commande', orderId, 'à passer manuellement.');
        } else if (botUrl && ins.ok && orderId) {
          pending.push(fetch(botUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-SAFIX-Secret': process.env.BOT_TRIGGER_SECRET || '' },
            body: JSON.stringify({ orderId }),
            signal: AbortSignal.timeout(8000),
          }).then(r => console.log('[PayPal] bot trigger HTTP', r.status))
            .catch(e => console.warn('[PayPal] bot trigger fail:', e.message)));
        }

        const RK = process.env.RESEND_API_KEY, RF = process.env.RESEND_FROM, RT = process.env.RESEND_TO;
        if (RK && RF && RT) {
          const e = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const rows = lineItems.map(li => `<tr><td>${e(li.name)}</td><td>×${li.qty}</td></tr>`).join('');
          pending.push(fetch('https://api.resend.com/emails', {
            method: 'POST',
            signal: AbortSignal.timeout(8000),
            headers: { Authorization: `Bearer ${RK}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: RF, to: RT,
              subject: `SAFIX 🔔 PayPal ${(amountCents / 100).toFixed(2)} € · ${e(meta.model || 'Commande')}`,
              html: `<h2>Nouvelle commande PayPal — ${(amountCents / 100).toFixed(2)} €</h2>
<p>Client : ${e(order.customer_email || '—')} · Modèle : ${e(meta.model || '—')} · Snap : ${e(meta.snap || '—')}</p>
<table border="1" cellpadding="6">${rows}</table>
<p>PayPal order ${e(orderID)} · capture ${e(capture.id)} · Supabase #${e(String(orderId || '?'))}</p>
<p>⚠️ custom_id PayPal limité à 127 c. → vérifier RDV/adresse avec le client.</p>`,
            }),
          }).then(r => console.log('[PayPal] mail shop HTTP', r.status))
            .catch(e2 => console.warn('[PayPal] mail shop fail:', e2.message)));
        }
        await Promise.allSettled(pending);
      } else {
        console.warn('[PayPal] Supabase non configuré — capture NON persistée (à traiter manuellement):', orderID, capture.id);
      }
    } catch (e) {
      console.error('[PayPal] Persistance non-fatale échouée (paiement OK, traiter manuellement):', e.message, 'order', orderID, 'capture', capture.id);
    }

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
