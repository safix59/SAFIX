// ─────────────────────────────────────────────────────────────────────────
// Endpoint public — Expose la config PayPal au frontend (client_id seulement,
// jamais le client_secret). Le frontend appelle cette route au chargement
// pour savoir s'il doit injecter le SDK PayPal.
// ─────────────────────────────────────────────────────────────────────────

// CORS durci : reflet limité à nos origines (l'app iOS ignore CORS).
const CORS_ALLOWED = ['https://safix59.fr', 'https://www.safix59.fr'];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowOrigin = process.env.ALLOWED_ORIGIN || (CORS_ALLOWED.includes(origin) ? origin : 'https://safix59.fr');
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'public, max-age=60'); // 1 min cache

  const enabled  = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  const clientId = enabled ? process.env.PAYPAL_CLIENT_ID : null;
  const mode     = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';

  return res.status(200).json({ enabled, clientId, mode });
}
