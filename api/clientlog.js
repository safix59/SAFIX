// ─────────────────────────────────────────────────────────────────────────
// Endpoint de monitoring des erreurs JS côté client (prod).
// Pas de persistance : on écrit dans les logs runtime Vercel (visibles
// dans le dashboard → Deployments → Functions → Logs). But : ne plus
// jamais avoir un site cassé en silence (cf. panne TDZ currentLang).
// ─────────────────────────────────────────────────────────────────────────

const allowOrigin = process.env.ALLOWED_ORIGIN || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  try {
    const b = req.body || {};
    const line = {
      t:     String(b.t   || '?').slice(0, 16),
      msg:   String(b.msg || '').slice(0, 300),
      src:   String(b.src || '').slice(0, 200),
      line:  Number(b.line) || 0,
      col:   Number(b.col)  || 0,
      stack: String(b.stack || '').slice(0, 1200),
      ua:    String(b.ua  || '').slice(0, 200),
      url:   String(b.url || '').slice(0, 300),
    };
    console.error('[client-error]', JSON.stringify(line));
  } catch (e) { /* on n'échoue jamais sur un log */ }

  return res.status(204).end();
}
