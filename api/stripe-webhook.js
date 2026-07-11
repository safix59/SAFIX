// ─────────────────────────────────────────────────────────────────────────
// Webhook Stripe — réceptionne les événements de paiement et :
//   1. envoie un mail à l'administrateur avec le récap (server-side, fiable)
//   2. (optionnel) insère la commande dans Supabase
//   3. (optionnel) trigger le bot Render pour passer la commande Utopya
// ─────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';

// Adresse de contact affichée dans les e-mails clients. Bascule vers
// support@safix59.fr (env SHOP_CONTACT_EMAIL ou défaut ici) UNIQUEMENT quand
// la boîte OVH existera — sinon les clients écriraient à une adresse qui rebondit.
const CONTACT_EMAIL = process.env.SHOP_CONTACT_EMAIL || 'fusion-laminaire-0i@icloud.com';

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

// Échappe toute valeur contrôlée par le client avant interpolation HTML (anti-injection e-mail)
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── Templates HTML (mail propre) ────────────────────────────────────────
function buildShopEmailHtml({ session, lineItems }) {
  const customer = session.customer_details || {};
  const meta     = session.metadata || {};
  const total    = (session.amount_total / 100).toFixed(2);
  const dt       = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle:'full', timeStyle:'short' });

  const SLOT_LABELS = { morning:'Matin (9h–12h)', afternoon:'Après-midi (14h–18h)', evening:'Soir (18h–20h)' };
  const slotLabel = SLOT_LABELS[meta.apptSlot] || esc(meta.apptSlot) || '—';
  const apptDateFr = meta.apptDate
    ? new Date(meta.apptDate).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : '—';
  const addrLine = meta.addr === 'other'
    ? "⚠️ Autre adresse — à fixer avec le client"
    : "48 Bd Alexandre III, 59140 Dunkerque (par défaut)";
  const deliveryLabel = meta.delivery === 'express' ? 'Express (J+1, 15h)'
                      : meta.delivery === 'standard' ? 'Standard (sous 48h)'
                      : '—';

  const itemsRows = lineItems.map(it => {
    const lt = (it.unit_amount * it.qty / 100).toFixed(2);
    return `<tr>
      <td style="padding:11px 14px;border-bottom:1px solid #eee;">${esc(it.name)}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #eee;text-align:center;color:#86868b;">×${it.qty}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${lt} €</td>
    </tr>`;
  }).join('');

  const stripeUrl = `https://dashboard.stripe.com/${session.livemode ? '' : 'test/'}checkout/sessions/${session.id}`;
  const piUrl     = `https://dashboard.stripe.com/${session.livemode ? '' : 'test/'}payments/${session.payment_intent}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SAFIX 🔔 ${total} € · ${esc(meta.model) || 'Commande'}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">

    <!-- Header alerte -->
    <div style="background:linear-gradient(135deg,#0066ff,#5b21b6);border-radius:18px;padding:28px 24px;text-align:center;color:#fff;margin-bottom:18px;box-shadow:0 8px 24px rgba(0,102,255,.25);">
      <div style="font-size:12px;letter-spacing:2.5px;opacity:.9;text-transform:uppercase;font-weight:700;">🔔 NOUVELLE COMMANDE SAFIX</div>
      <div style="font-size:42px;font-weight:800;margin-top:10px;letter-spacing:-1.5px;line-height:1;">${total} €</div>
      <div style="font-size:13px;opacity:.85;margin-top:8px;">${esc(meta.model) || 'iPhone'} · ${dt}</div>
    </div>

    <!-- ACTIONS RAPIDES -->
    <div style="background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:14px;font-size:13px;border-left:3px solid #ff9500;">
      <strong style="color:#1d1d1f;">⚡ ACTION REQUISE :</strong>
      <span style="color:#3a3a3c;">Commander la pièce/préparer le service chez Utopya · prévoir le RDV ci-dessous.</span>
    </div>

    <!-- 📅 RDV CLIENT (priorité visuelle) -->
    <div style="background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:14px;border:2px solid #0066ff;">
      <div style="font-size:11px;color:#0066ff;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">📅 RENDEZ-VOUS CLIENT</div>
      <div style="font-size:18px;font-weight:700;color:#1d1d1f;margin-bottom:4px;">${apptDateFr}</div>
      <div style="font-size:15px;color:#3a3a3c;margin-bottom:12px;">${slotLabel}</div>
      <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:6px;">📍 LIEU</div>
      <div style="font-size:14px;color:#1d1d1f;font-weight:600;">${addrLine}</div>
    </div>

    <!-- 👤 INFOS CLIENT -->
    <div style="background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:14px;">
      <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:12px;">👤 CLIENT</div>
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#86868b;width:130px;">Email</td><td style="padding:6px 0;font-weight:600;"><a href="mailto:${esc(customer.email || '')}" style="color:#0066ff;text-decoration:none;">${esc(customer.email || session.customer_email || '—')}</a></td></tr>
        <tr><td style="padding:6px 0;color:#86868b;">Téléphone</td><td style="padding:6px 0;font-weight:600;"><a href="tel:${esc(customer.phone || '')}" style="color:#0066ff;text-decoration:none;">${esc(customer.phone || meta.phone || '—')}</a></td></tr>
        <tr><td style="padding:6px 0;color:#86868b;">Snapchat</td><td style="padding:6px 0;font-weight:600;">${esc(meta.snap) || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#86868b;vertical-align:top;">Adresse facturation</td><td style="padding:6px 0;font-weight:600;font-size:13px;">${esc(customer.address ? Object.values(customer.address).filter(Boolean).join(', ') : '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#86868b;">Modèle iPhone</td><td style="padding:6px 0;font-weight:700;color:#0066ff;">${esc(meta.model) || '—'}</td></tr>
      </table>
    </div>

    <!-- 🛒 COMMANDE -->
    <div style="background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:14px;">
      <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:12px;">🛒 ARTICLES COMMANDÉS</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fafafa;border-radius:10px;overflow:hidden;">
        <thead><tr style="background:#f5f5f7;">
          <th style="padding:10px 14px;text-align:left;font-weight:700;color:#86868b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Article</th>
          <th style="padding:10px 14px;text-align:center;font-weight:700;color:#86868b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Qté</th>
          <th style="padding:10px 14px;text-align:right;font-weight:700;color:#86868b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Prix</th>
        </tr></thead>
        <tbody>${itemsRows}</tbody>
        <tfoot><tr style="background:#fff;">
          <td colspan="2" style="padding:13px 14px;font-weight:700;font-size:15px;">TOTAL ENCAISSÉ</td>
          <td style="padding:13px 14px;text-align:right;font-weight:800;font-size:18px;color:#0066ff;font-variant-numeric:tabular-nums;">${total} €</td>
        </tr></tfoot>
      </table>
      <div style="margin-top:10px;padding:10px 14px;background:#f5f5f7;border-radius:8px;font-size:12.5px;color:#3a3a3c;">
        <strong>Livraison pièce :</strong> ${deliveryLabel}
      </div>
    </div>

    <!-- 🔧 INFOS TECHNIQUES -->
    <div style="background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:14px;font-size:12.5px;color:#3a3a3c;">
      <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:12px;">🔧 RÉFÉRENCES STRIPE</div>
      <div style="line-height:1.8;">
        Session ID : <a href="${stripeUrl}" style="color:#0066ff;text-decoration:none;font-family:Menlo,Consolas,monospace;font-size:11.5px;">${session.id}</a><br>
        Payment Intent : <a href="${piUrl}" style="color:#0066ff;text-decoration:none;font-family:Menlo,Consolas,monospace;font-size:11.5px;">${session.payment_intent || '—'}</a><br>
        Mode : ${session.livemode ? '<strong style="color:#34c759;">LIVE 💰</strong>' : '<span style="color:#ff9500;">TEST</span>'}<br>
        Locale client : ${esc(meta.lang) || 'fr'}
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:11px;color:#86868b;margin-top:18px;line-height:1.6;">
      <a href="https://safix59.fr" style="color:#86868b;text-decoration:none;">safix59.fr</a> · <a href="https://dashboard.stripe.com/${session.livemode?'':'test/'}payments" style="color:#86868b;text-decoration:none;">Dashboard Stripe</a> · <a href="https://supabase.com/dashboard/project/fdirktxyipjrxcxjtnss/editor" style="color:#86868b;text-decoration:none;">Dashboard Supabase</a><br>
      <span style="opacity:.7;">Mail technique destiné au gérant SAFIX uniquement.</span>
    </div>
  </div>
</body></html>`;
}

function buildClientEmailHtml({ session, lineItems }) {
  const meta     = session.metadata || {};
  const customer = session.customer_details || {};
  const total    = (session.amount_total / 100).toFixed(2);
  const dt       = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle:'full', timeStyle:'short' });

  const SLOT_LABELS = { morning:'Matin (9h–12h)', afternoon:'Après-midi (14h–18h)', evening:'Soir (18h–20h)' };
  const slotLabel = SLOT_LABELS[meta.apptSlot] || esc(meta.apptSlot) || '';
  const apptDateFr = meta.apptDate
    ? new Date(meta.apptDate).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : '';
  const apptLine = (apptDateFr && slotLabel) ? `${apptDateFr} · ${slotLabel}` : (apptDateFr || slotLabel || '—');
  const addrLine = meta.addr === 'other'
    ? "Adresse à convenir — nous vous recontactons rapidement par e-mail ou Snap"
    : "48 Bd Alexandre III, 59140 Dunkerque";
  const deliveryLabel = meta.delivery === 'express' ? 'Express (J+1, 15h)'
                      : meta.delivery === 'standard' ? 'Standard (sous 48h)'
                      : null;

  // Détecter le type de commande pour adapter le contenu
  const hasRepair      = lineItems.some(it => /\b(?:écran|battery|batterie|caméra|camera|haut.parleur|connecteur|vibreur|écouteur|micro|bouton|vitre)\b/i.test(it.name || ''));
  const hasService     = lineItems.some(it => /\b(?:déblocage|deblocage|désoxydation|desoxydation|diagnostic|récupération|recuperation|restauration|micro.soudure|face.id)\b/i.test(it.name || ''));
  const hasAccessory   = lineItems.some(it => /\b(?:câble|cable|adaptateur|verre|tremp|protect|chargeur)\b/i.test(it.name || ''));

  const itemsRows = lineItems.map(it => {
    const lt = (it.unit_amount * it.qty / 100).toFixed(2);
    return `<tr>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;color:#1d1d1f;">${esc(it.name)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;text-align:center;color:#86868b;font-variant-numeric:tabular-nums;">×${it.qty}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${lt} €</td>
    </tr>`;
  }).join('');

  // ETA réparation : J+0 standard / J+1 express si réparation
  let etaBlock = '';
  if (hasRepair && deliveryLabel) {
    const eta = meta.delivery === 'express' ? 'sous 48h après dépôt' : 'sous 72h après dépôt';
    etaBlock = `<div style="margin-top:16px;padding:14px 16px;background:#f0f9ff;border-left:3px solid #0066ff;border-radius:8px;font-size:13.5px;line-height:1.5;color:#1d1d1f;">
      <strong>⚡ Réparation estimée :</strong> ${eta}
    </div>`;
  }

  // Bloc RDV de dépôt (si pas que des accessoires sans réparation)
  let rdvBlock = '';
  if (hasRepair || hasService) {
    rdvBlock = `<div style="margin-top:20px;padding:18px 20px;background:#fafafa;border-radius:14px;border:1px solid #e5e5e5;">
      <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">📅 Votre rendez-vous</div>
      <div style="font-size:16px;font-weight:600;color:#1d1d1f;line-height:1.4;">${apptLine}</div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #e5e5e5;font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">📍 Lieu de dépôt</div>
      <div style="font-size:14px;color:#1d1d1f;line-height:1.5;">${addrLine}</div>
    </div>`;
  }

  // Bloc livraison accessoire (si que des accessoires)
  let accessoryBlock = '';
  if (hasAccessory && !hasRepair && !hasService) {
    accessoryBlock = `<div style="margin-top:20px;padding:18px 20px;background:#fafafa;border-radius:14px;border:1px solid #e5e5e5;">
      <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">📦 Livraison accessoire</div>
      <div style="font-size:14px;color:#1d1d1f;line-height:1.5;">L'accessoire sera commandé chez notre fournisseur partenaire et préparé pour vous. Nous vous recontactons sous 24h pour fixer la modalité de retrait ou l'envoi.</div>
    </div>`;
  }

  // Section "Et maintenant ?" adaptative
  let nextSteps = '';
  if (hasRepair) {
    nextSteps = `<ol style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7;color:#3a3a3c;">
      <li>Notre fournisseur partenaire va expédier la pièce</li>
      <li>Vous apportez votre iPhone au rendez-vous indiqué ci-dessus</li>
      <li>La réparation est effectuée pendant que vous patientez (ou dans la journée selon complexité)</li>
      <li>Vous repartez avec votre iPhone réparé + facture</li>
    </ol>`;
  } else if (hasService) {
    nextSteps = `<ol style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7;color:#3a3a3c;">
      <li>Vous apportez votre iPhone au rendez-vous indiqué ci-dessus</li>
      <li>Le service est réalisé en présentiel pendant votre attente</li>
      <li>Vous repartez avec votre iPhone et la confirmation du service</li>
    </ol>`;
  } else {
    nextSteps = `<ol style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7;color:#3a3a3c;">
      <li>Nous commandons l'accessoire chez notre fournisseur partenaire</li>
      <li>Vous êtes informé(e) dès qu'il est prêt</li>
      <li>Vous le récupérez ou nous l'envoyons selon arrangement</li>
    </ol>`;
  }

  const modelLine = meta.model ? `<div style="font-size:14px;color:#86868b;margin-top:6px;">Modèle : <strong style="color:#1d1d1f;">${esc(meta.model)}</strong></div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SAFIX — Commande confirmée</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased;">
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;">

    <!-- Header brand -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="https://safix59.fr" style="text-decoration:none;">
        <div style="font-size:34px;font-weight:800;color:#1d1d1f;letter-spacing:-1.5px;display:inline-block;">
          <span style="color:#0066ff;">SA</span>FIX
        </div>
      </a>
      <div style="font-size:12.5px;color:#86868b;margin-top:2px;letter-spacing:.5px;">Réparation iPhone · Dunkerque</div>
    </div>

    <!-- Hero confirmation -->
    <div style="background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06);">
      <div style="background:linear-gradient(135deg,#0066ff 0%,#5b21b6 100%);padding:36px 24px;text-align:center;color:#fff;">
        <div style="font-size:52px;line-height:1;margin-bottom:10px;">✓</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-.5px;">Commande confirmée</div>
        <div style="font-size:14px;opacity:.9;margin-top:6px;">Paiement reçu · ${total} €</div>
      </div>

      <div style="padding:30px 24px;">
        <p style="font-size:15px;line-height:1.65;color:#1d1d1f;margin:0 0 24px;">
          Bonjour,<br><br>
          Merci pour votre commande sur <a href="https://safix59.fr" style="color:#0066ff;text-decoration:none;font-weight:600;">safix59.fr</a>. Le paiement de <strong>${total} €</strong> a été confirmé. Voici tous les détails utiles.
        </p>

        <!-- Items -->
        <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">🛒 Votre commande</div>
        ${modelLine}
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;margin-bottom:6px;background:#fafafa;border-radius:12px;overflow:hidden;">
          <thead><tr style="background:#f5f5f7;">
            <th style="padding:10px 14px;text-align:left;font-weight:700;color:#86868b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Article</th>
            <th style="padding:10px 14px;text-align:center;font-weight:700;color:#86868b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Qté</th>
            <th style="padding:10px 14px;text-align:right;font-weight:700;color:#86868b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Prix</th>
          </tr></thead>
          <tbody>${itemsRows}</tbody>
          <tfoot><tr style="background:#fff;">
            <td colspan="2" style="padding:14px;font-weight:700;font-size:16px;color:#1d1d1f;">Total payé</td>
            <td style="padding:14px;text-align:right;font-weight:800;font-size:20px;color:#0066ff;font-variant-numeric:tabular-nums;">${total} €</td>
          </tr></tfoot>
        </table>

        ${etaBlock}
        ${rdvBlock}
        ${accessoryBlock}

        <!-- Et maintenant ? -->
        <div style="margin-top:24px;padding:18px 20px;background:linear-gradient(135deg,rgba(0,102,255,.04),rgba(91,33,182,.04));border-radius:14px;">
          <div style="font-size:11px;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">✨ Et maintenant ?</div>
          ${nextSteps}
        </div>

        <!-- Support -->
        <div style="margin-top:24px;padding:18px 20px;border-radius:14px;border:1px solid #e5e5e5;text-align:center;">
          <div style="font-size:13px;font-weight:700;color:#1d1d1f;margin-bottom:8px;">Une question ? On répond rapidement.</div>
          <div style="font-size:13px;color:#3a3a3c;line-height:1.6;">
            📧 <a href="mailto:${CONTACT_EMAIL}" style="color:#0066ff;text-decoration:none;">${CONTACT_EMAIL}</a><br>
            👻 Snapchat · <a href="https://www.snapchat.com/add/safix-support" style="color:#0066ff;text-decoration:none;">@safix-support</a><br>
            🌐 <a href="https://safix59.fr" style="color:#0066ff;text-decoration:none;">safix59.fr</a>
          </div>
        </div>

      </div>
    </div>

    <!-- Footer légal -->
    <div style="text-align:center;font-size:11px;color:#86868b;margin-top:24px;line-height:1.6;">
      SAFIX · Entreprise individuelle · 48 Bd Alexandre III, 59140 Dunkerque<br>
      SIREN 942 003 062 · SIRET 942 003 062 00018<br>
      TVA non applicable, art. 293 B du CGI<br>
      <span style="opacity:.7;">Reçu le ${dt}</span>
    </div>
  </div>
</body></html>`;
}

// ─── Mail server-side : Web3Forms (try) puis Resend (fallback) ───────────
async function sendEmailToShop({ session, lineItems }) {
  // Plus de secret en dur (était commité dans git). Si l'env n'est pas
  // défini, on saute Web3Forms et on tombe sur Resend (fallback ci-dessous).
  const accessKey = process.env.WEB3FORMS_KEY;
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

  // 1) Web3Forms (si Pro plan ET clé fournie en env) — sinon on saute → Resend
  if (accessKey) try {
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

  // Envoi via Resend depuis `onboarding@resend.dev` (gratuit, sans vérif domaine)
  // → fonctionne pour TOUS les destinataires immédiatement
  // → quand le domaine safix59.fr sera vérifié dans Resend (RESEND_FROM_CLIENT défini),
  //   on basculera sur orders@safix59.fr pour un branding parfait.
  const total = (session.amount_total / 100).toFixed(2);
  const html  = buildClientEmailHtml({ session, lineItems });
  const fromAddress = process.env.RESEND_FROM_CLIENT || 'SAFIX <onboarding@resend.dev>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    fromAddress,
        to:      [customerEmail],
        reply_to: 'fusion-laminaire-0i@icloud.com',
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
    // Déduplication : si une order existe déjà pour ce PI (cas où PI.succeeded
    // est arrivé avant la session) → on UPDATE au lieu de re-insert
    let existingOrderId = null;
    if (session.payment_intent && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE) {
      try {
        const r = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/orders?stripe_payment_intent=eq.${session.payment_intent}&select=id&limit=1`,
          { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}` } },
        );
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) existingOrderId = rows[0].id;
      } catch {}
    }

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

    // 1) Mails (shop + client) — UNIQUEMENT si order pas déjà existante (idempotence)
    // Si existingOrderId est set → l'event est un replay/retry → pas de re-mail
    if (!existingOrderId) {
      sendEmailToShop({ session, lineItems }).catch(e => console.warn('mail shop', e.message));
      sendEmailToClient({ session, lineItems }).catch(e => console.warn('mail client', e.message));
    } else {
      console.log(`[webhook] Order ${existingOrderId} déjà traitée — skip mails (event replay)`);
    }

    // 2) Persistence Supabase (si configurée)
    // Décode le cart compact (metadata.cart) pour le bot
    let cartFull = [];
    try {
      const compact = JSON.parse(session.metadata?.cart || '[]');
      cartFull = compact.map(c => ({
        repair_id: c.r,
        model:     c.m,
        qty:       c.q || 1,
        color:     c.c || null,
      }));
    } catch (e) {
      console.warn('[webhook] Cart parse error :', e.message);
    }
    const order = {
      stripe_session_id:     session.id,
      stripe_payment_intent: session.payment_intent,
      customer_email:        session.customer_details?.email || session.customer_email,
      total_cents:           session.amount_total,
      currency:              session.currency,
      status:                'paid',
      line_items:            cartFull.length ? cartFull : lineItems,
      metadata:              session.metadata || {},
      created_at:            new Date().toISOString(),
    };

    // Si une order partielle existe (PI.succeeded est arrivé avant) → UPDATE
    let result;
    if (existingOrderId) {
      const upd = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${existingOrderId}`,
        {
          method: 'PATCH',
          headers: {
            apikey:        process.env.SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            stripe_session_id: session.id,
            line_items:        order.line_items,
            metadata:          order.metadata,
            updated_at:        new Date().toISOString(),
          }),
        },
      );
      const data = await upd.json().catch(() => null);
      console.log(`[webhook] PI ${session.payment_intent} → order ${existingOrderId} UPDATED (was inserted by PI.succeeded)`);
      result = { ok: upd.ok, row: data?.[0] || { id: existingOrderId } };
    } else {
      result = await insertOrder(order);
    }

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

  // Paiement direct via Payment Intent (Apple Pay direct, Express Checkout)
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    // Déduplication : si une commande existe déjà pour ce PI dans Supabase → skip
    // (cas typique : checkout.session.completed est arrivé avant et a déjà tout traité)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE) {
      try {
        const r = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/orders?stripe_payment_intent=eq.${pi.id}&select=id&limit=1`,
          {
            headers: {
              apikey:        process.env.SUPABASE_SERVICE_ROLE,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
            },
          },
        );
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) {
          console.log(`[webhook] PI ${pi.id} déjà géré (order ${rows[0].id}) — skip`);
          return res.status(200).json({ received: true, skipped: true, existing: rows[0].id });
        }
      } catch (e) {
        console.warn('[webhook] Dedup check failed :', e.message);
      }
    }

    // Reconstruire l'objet "session-like" pour réutiliser sendEmailToShop/Client
    const fakeSession = {
      id: pi.id,
      payment_intent: pi.id,
      amount_total: pi.amount,
      currency: pi.currency,
      customer_email: pi.receipt_email,
      customer_details: {
        email: pi.receipt_email,
        phone: pi.shipping?.phone || null,
        address: pi.shipping?.address || null,
      },
      metadata: pi.metadata || {},
      livemode: pi.livemode,
    };
    // Reconstruire lineItems depuis metadata.cart
    let lineItems = [];
    try {
      const compact = JSON.parse(pi.metadata?.cart || '[]');
      lineItems = compact.map(c => ({
        name: `${c.r} ${c.m}`,  // approximation, le nom pretty est dans la metadata model
        qty: c.q || 1,
        unit_amount: 0,  // pas critique, total déjà dans pi.amount
      }));
    } catch {}

    sendEmailToShop({ session: fakeSession, lineItems }).catch(e => console.warn('mail shop pi', e.message));
    sendEmailToClient({ session: fakeSession, lineItems }).catch(e => console.warn('mail client pi', e.message));

    // Persistence Supabase
    let cartFull = [];
    try {
      const compact = JSON.parse(pi.metadata?.cart || '[]');
      cartFull = compact.map(c => ({ repair_id: c.r, model: c.m, qty: c.q || 1, color: c.c || null }));
    } catch {}
    const order = {
      stripe_session_id:     pi.id,  // utilise pi.id comme clé unique
      stripe_payment_intent: pi.id,
      customer_email:        pi.receipt_email || 'unknown@safix59.fr',
      total_cents:           pi.amount,
      currency:              pi.currency,
      status:                'paid',
      line_items:            cartFull,
      metadata:              pi.metadata || {},
      created_at:            new Date().toISOString(),
    };
    const result = await insertOrder(order);

    // Trigger bot Render
    const botUrl    = process.env.BOT_TRIGGER_URL;
    const botSecret = process.env.BOT_TRIGGER_SECRET;
    if (botUrl && result.ok && result.row?.id) {
      fetch(botUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SAFIX-Secret': botSecret || '' },
        body: JSON.stringify({ orderId: result.row.id }),
      }).catch(e => console.warn('[webhook] Bot trigger fail :', e.message));
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
