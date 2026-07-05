// Statistiques visiteurs (protégé) — agrège la table `visits` sans exposer de
// données personnelles. Lecture serveur avec la clé service_role.
import { requireAuth } from './_admin-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  const SUPA = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPA || !KEY) return res.status(200).json({ ready: false, reason: 'supabase_absent' });

  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  let rows;
  try {
    const r = await fetch(
      `${SUPA}/rest/v1/visits?select=ts,hour,source,device,country,path,day&ts=gte.${since}&order=ts.desc&limit=20000`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    if (r.status === 404) return res.status(200).json({ ready: false, reason: 'table_absente' });
    if (!r.ok) return res.status(200).json({ ready: false, reason: 'http_' + r.status });
    rows = await r.json();
  } catch (e) {
    return res.status(200).json({ ready: false, reason: e.message });
  }
  if (!Array.isArray(rows)) rows = [];

  const today = new Date().toISOString().slice(0, 10);
  const byHour = Array(24).fill(0);
  const bySource = {}, byDevice = {}, byCountry = {}, byDay = {}, byPath = {};
  let todayCount = 0;
  for (const v of rows) {
    if (v.day === today) todayCount++;
    if (typeof v.hour === 'number' && v.hour >= 0 && v.hour < 24) byHour[v.hour]++;
    bySource[v.source || 'direct'] = (bySource[v.source || 'direct'] || 0) + 1;
    byDevice[v.device || 'desktop'] = (byDevice[v.device || 'desktop'] || 0) + 1;
    if (v.country) byCountry[v.country] = (byCountry[v.country] || 0) + 1;
    if (v.day) byDay[v.day] = (byDay[v.day] || 0) + 1;
    const p = v.path || '/'; byPath[p] = (byPath[p] || 0) + 1;
  }
  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));

  return res.status(200).json({
    ready: true,
    total_30d: rows.length,
    today: todayCount,
    by_hour: byHour,
    by_source: topN(bySource, 8),
    by_device: topN(byDevice, 4),
    by_country: topN(byCountry, 10),
    by_path: topN(byPath, 10),
    by_day: Object.entries(byDay).sort().slice(-30).map(([k, v]) => ({ k, v })),
    serverTime: new Date().toISOString(),
  });
}
