// ─────────────────────────────────────────────────────────────────────────
// Keep-alive Supabase — empêche la mise en pause automatique du projet free.
// Le free tier Supabase se met en veille après ~7 j d'inactivité ; quand il
// dort, le webhook ne persiste plus les commandes et le bot ne part pas
// (échecs silencieux best-effort). Ce endpoint fait une lecture triviale
// (1 ligne, aucune donnée renvoyée) ; il est appelé 1×/jour par un cron Vercel
// (voir vercel.json "crons"). But unique : "toucher" la base régulièrement.
// ─────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    return res.status(200).json({ ok: false, reason: 'supabase env absent' });
  }
  try {
    const r = await fetch(`${url}/rest/v1/orders?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    // 200 quoi qu'il arrive : le but est juste de solliciter le projet ;
    // une erreur ponctuelle ne doit pas faire échouer le cron en boucle.
    return res.status(200).json({ ok: r.ok, supabase: r.status, at: new Date().toISOString() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message, at: new Date().toISOString() });
  }
}
