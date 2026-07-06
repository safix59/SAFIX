// ─────────────────────────────────────────────────────────────────────────
// Analytics 1ʳᵉ partie — enregistre une visite (agrégable), SANS cookie ni IP.
// Données stockées : jour/heure, page, source (qr/recherche/social/direct),
// hôte référent, type d'appareil, pays (en-tête géo Vercel), langue.
// Aucune donnée personnelle → conforme RGPD, pas de bandeau nécessaire.
// ─────────────────────────────────────────────────────────────────────────
const SEARCH = /google\.|bing\.|duckduckgo|yahoo|ecosia|qwant|yandex|baidu/i;
const SOCIAL = /instagram|facebook|fb\.|snapchat|tiktok|twitter|t\.co|x\.com|youtube|pinterest|reddit|linkedin/i;

function deviceOf(ua) {
  const u = (ua || '').toLowerCase();
  if (/iphone/.test(u)) return 'iPhone';
  if (/ipad/.test(u)) return 'iPad';
  if (/ipod/.test(u)) return 'iPod';
  if (/android/.test(u)) return /mobile/.test(u) ? 'Android' : 'Tablette Android';
  if (/windows phone/.test(u)) return 'Windows Phone';
  if (/macintosh|mac os x/.test(u)) return 'Mac';
  if (/windows/.test(u)) return 'Windows';
  if (/cros/.test(u)) return 'Chromebook';
  if (/linux/.test(u)) return 'Linux';
  return 'Autre';
}
function isBot(ua) {
  return /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest\/|preview|monitor|lighthouse|headless|dataprovider|ahrefs|semrush|python-requests|curl\//i.test(ua || '');
}
// Navigateur & système depuis l'UA (déductions non identifiantes, comme device).
function browserOf(ua) {
  const u = (ua || '').toLowerCase();
  if (/edg(a|ios)?\//.test(u)) return 'Edge';
  if (/opr\/|opera/.test(u)) return 'Opera';
  if (/samsungbrowser/.test(u)) return 'Samsung Internet';
  if (/firefox|fxios/.test(u)) return 'Firefox';
  if (/crios|chrome/.test(u)) return 'Chrome';
  if (/safari/.test(u)) return 'Safari';
  return 'Autre';
}
function osOf(ua) {
  const u = (ua || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(u)) return 'iOS';
  if (/android/.test(u)) return 'Android';
  if (/cros/.test(u)) return 'ChromeOS';
  if (/windows nt 10/.test(u)) return 'Windows 10/11';
  if (/windows/.test(u)) return 'Windows';
  if (/mac os x/.test(u)) return 'macOS';
  if (/linux/.test(u)) return 'Linux';
  return 'Autre';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(204).end();

  const ua = req.headers['user-agent'] || '';
  if (isBot(ua)) return res.status(204).end();

  const SUPA = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPA || !KEY) return res.status(204).end();

  try {
    const b = req.body || {};
    const q = String(b.q || '').toLowerCase();
    const ref = String(b.ref || '');
    let refHost = '';
    try { refHost = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch {}

    // Source : QR d'abord (marqueur ?source=qr / utm_source=qr), sinon référent
    let source = 'direct';
    if (/[?&](source|utm_source)=qr/.test(q)) source = 'qr';
    else if (!refHost) source = 'direct';
    else if (SEARCH.test(refHost)) source = 'search';
    else if (SOCIAL.test(refHost)) source = 'social';
    else if (refHost.includes('safix59.fr')) source = 'interne';
    else source = 'referral';

    // Géoloc approximative fournie par le réseau Vercel (pas d'IP stockée).
    const H = req.headers;
    const dec = (v) => { try { return decodeURIComponent(String(v || '')); } catch { return String(v || ''); } };
    const city = dec(H['x-vercel-ip-city']).slice(0, 60) || null;
    const region = dec(H['x-vercel-ip-country-region']).slice(0, 40) || null;
    const lat = parseFloat(H['x-vercel-ip-latitude']); const lng = parseFloat(H['x-vercel-ip-longitude']);

    // Modèle Android quand présent dans l'UA (Apple ne donne jamais son modèle).
    let deviceModel = null;
    const mAnd = (ua || '').match(/android[\d.\s]*;\s*([^);]+?)(?:\s+build|;|\))/i);
    if (mAnd && mAnd[1]) { const mm = mAnd[1].trim(); if (mm && !/^[a-z]$/i.test(mm)) deviceModel = mm.slice(0, 50); }

    const now = new Date();
    const row = {
      ts: now.toISOString(),
      day: now.toISOString().slice(0, 10),
      hour: now.getUTCHours(),
      session: String(b.session || '').slice(0, 40) || null,
      kind: b.hb ? 'ping' : 'view',   // 'ping' = battement présence, 'view' = vue de page
      path: String(b.path || '/').slice(0, 120),
      source,
      ref_host: refHost.slice(0, 80) || null,
      device: deviceOf(ua),
      device_model: deviceModel,
      browser: browserOf(ua),
      os: osOf(ua),
      country: (H['x-vercel-ip-country'] || '').slice(0, 4) || null,
      city, region,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      lang: String(b.lang || '').slice(0, 5) || null,
    };

    // On ATTEND l'insertion (sinon la fonction serverless peut être gelée après
    // la réponse et l'écriture annulée). RÉSILIENT : si les colonnes géo/modèle
    // n'existent pas encore, on réessaie avec les colonnes de base → jamais de
    // visite perdue, et la géoloc « s'allume » dès que le SQL des colonnes est passé.
    const post = (payload) => fetch(`${SUPA}/rest/v1/visits`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    let r = await post(row).catch(() => null);
    if (!r || !r.ok) {
      const { device_model, city, region, lat, lng, browser, os, ...base } = row;
      await post(base).catch(() => {});
    }
  } catch {}

  return res.status(204).end();
}
