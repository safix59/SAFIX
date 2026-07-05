// ─────────────────────────────────────────────────────────────────────────
// Fonction admin CONSOLIDÉE (1 seule fonction serverless → limite Vercel free).
// Actions via ?action= : login | logout | data | visits.
// Sécurité : login vérifié côté serveur, cookie httpOnly signé ; data/visits
// exigent le cookie ; clé Supabase jamais exposée au navigateur.
// ─────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { issueToken, cookieHeader, clearCookieHeader, requireAuth } from './_admin-auth.js';

const ORIGIN = 'https://safix59.fr';
const FLAGSHIP = [
  'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro',
  'iPhone 16', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15',
  'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14', 'iPhone 13', 'iPhone 12', 'iPhone 11',
];

async function getJson(path, ms = 8000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(ORIGIN + path, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(to); }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = (req.query && req.query.action) || (req.body && req.body.action) || '';

  // ── LOGIN ──
  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const pw = (req.body && req.body.password) != null ? String(req.body.password) : '';
    const real = process.env.ADMIN_PASSWORD || '';
    let ok = false;
    if (real.length > 0) {
      const a = Buffer.from(pw), b = Buffer.from(real);
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    await new Promise(r => setTimeout(r, 400));
    if (!ok) return res.status(401).json({ error: 'bad_password' });
    res.setHeader('Set-Cookie', cookieHeader(issueToken()));
    return res.status(200).json({ ok: true });
  }

  // ── LOGOUT ──
  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearCookieHeader());
    return res.status(200).json({ ok: true });
  }

  // ── (tout le reste exige l'authentification) ──
  if (!requireAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  const SUPA = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;

  // ── LIVE (temps réel : qui est en ligne maintenant) ──
  if (action === 'live') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false });
    const since = new Date(Date.now() - 50 * 1000).toISOString(); // fenêtre 50 s
    try {
      const r = await fetch(`${SUPA}/rest/v1/visits?select=session,path,country,device,ts&ts=gte.${since}&order=ts.desc&limit=800`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.status === 404 || !r.ok) return res.status(200).json({ ready: false });
      const rows = await r.json();
      const seen = new Map();
      for (const v of (Array.isArray(rows) ? rows : [])) {
        const key = v.session || v.ts;
        if (!seen.has(key)) seen.set(key, { path: v.path, country: v.country, device: v.device, ts: v.ts });
      }
      return res.status(200).json({ ready: true, online: seen.size, visitors: [...seen.values()].slice(0, 60) });
    } catch { return res.status(200).json({ ready: false }); }
  }

  // ── VISITS ──
  if (action === 'visits') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false, reason: 'supabase_absent' });
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    let rows;
    try {
      const r = await fetch(`${SUPA}/rest/v1/visits?select=ts,hour,source,device,country,path,day,kind&ts=gte.${since}&order=ts.desc&limit=20000`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.status === 404) return res.status(200).json({ ready: false, reason: 'table_absente' });
      if (!r.ok) return res.status(200).json({ ready: false, reason: 'http_' + r.status });
      rows = await r.json();
    } catch (e) { return res.status(200).json({ ready: false, reason: e.message }); }
    if (!Array.isArray(rows)) rows = [];
    const today = new Date().toISOString().slice(0, 10);
    const byHour = Array(24).fill(0);
    const bySource = {}, byDevice = {}, byCountry = {}, byDay = {}, byPath = {};
    let todayCount = 0;
    for (const v of rows) {
      if (v.kind === 'ping') continue;   // les battements présence ne comptent pas comme des visites
      if (v.day === today) todayCount++;
      if (typeof v.hour === 'number' && v.hour >= 0 && v.hour < 24) byHour[v.hour]++;
      bySource[v.source || 'direct'] = (bySource[v.source || 'direct'] || 0) + 1;
      byDevice[v.device || 'desktop'] = (byDevice[v.device || 'desktop'] || 0) + 1;
      if (v.country) byCountry[v.country] = (byCountry[v.country] || 0) + 1;
      if (v.day) byDay[v.day] = (byDay[v.day] || 0) + 1;
      const p = v.path || '/'; byPath[p] = (byPath[p] || 0) + 1;
    }
    const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
    return res.status(200).json({
      ready: true, total_30d: rows.length, today: todayCount, by_hour: byHour,
      by_source: topN(bySource, 8), by_device: topN(byDevice, 4), by_country: topN(byCountry, 10),
      by_path: topN(byPath, 10), by_day: Object.entries(byDay).sort().slice(-30).map(([k, v]) => ({ k, v })),
    });
  }

  // ── DATA (défaut) ──
  const alerts = [];
  const [ordersRaw, pricesDoc, links, hist] = await Promise.all([
    (async () => {
      if (!SUPA || !KEY) { alerts.push({ level: 'warn', msg: 'Supabase non configuré — commandes indisponibles.' }); return []; }
      try {
        const r = await fetch(`${SUPA}/rest/v1/orders?select=id,created_at,customer_email,total_cents,currency,status,utopya_order_id,line_items,metadata,error_message,stripe_payment_intent&order=created_at.desc&limit=500`,
          { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        if (!r.ok) { alerts.push({ level: 'error', msg: `Supabase HTTP ${r.status} — base injoignable.` }); return []; }
        const j = await r.json(); return Array.isArray(j) ? j : [];
      } catch (e) { alerts.push({ level: 'error', msg: 'Supabase injoignable : ' + e.message }); return []; }
    })(),
    getJson('/scraper/prices.json'), getJson('/scraper/links.json'), getJson('/scraper/price-history.json'),
  ]);

  const orders = ordersRaw || [];
  const prices = (pricesDoc && pricesDoc.prices) || {};
  const priceOf = (rid, model) => (prices?.[rid]?.[model] || prices?.[rid]?.default) || null;

  // Détail fiable des pièces d'une commande : d'abord metadata.cart (compact,
  // écrit pour le bot), sinon line_items s'ils portent le repair_id.
  const itemsOf = (o) => {
    const m = o.metadata || {};
    try { const c = JSON.parse(m.cart || 'null'); if (Array.isArray(c) && c.length) return c.map(x => ({ rid: x.r, mdl: x.m || 'default', q: x.q || 1 })); } catch {}
    const li = Array.isArray(o.line_items) ? o.line_items : [];
    if (li.some(x => x.repair_id || x.repairId)) return li.map(x => ({ rid: x.repair_id || x.repairId, mdl: x.model || 'default', q: x.qty || 1 }));
    return null;
  };

  const now = new Date(); const d30 = new Date(now.getTime() - 30 * 864e5);
  let revenue = 0, revenue30 = 0, count30 = 0, partsCost = 0, gain = 0, cost30 = 0, gain30 = 0, costUnknown = 0;
  const upcoming = [];
  for (const o of orders) {
    const tot = o.total_cents || 0; revenue += tot;
    const recent = o.created_at && new Date(o.created_at) >= d30;
    if (recent) { revenue30 += tot; count30++; }
    // Coût pièces Utopya (basePrice) — connu seulement si TOUS les articles sont reliés
    const its = itemsOf(o);
    let cost = 0, known = false;
    if (its) {
      known = true;
      for (const it of its) { const p = priceOf(it.rid, it.mdl); if (p && typeof p.basePrice === 'number') cost += Math.round(p.basePrice * 100) * it.q; else known = false; }
    }
    o._cost_cents = known ? cost : null;
    o._gain_cents = known ? (tot - cost) : null;
    if (known) { partsCost += cost; gain += (tot - cost); if (recent) { cost30 += cost; gain30 += (tot - cost); } }
    else costUnknown++;
    const m = o.metadata || {};
    if (m.apptDate) { const ad = new Date(m.apptDate); if (ad >= new Date(now.toDateString())) upcoming.push({ id: o.id, date: m.apptDate, slot: m.apptSlot || null, addr: m.addr || null, email: o.customer_email, model: m.model || null }); }
  }
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  let combos = 0, inStock = 0, oos = 0, broken = 0; const overCeiling = [], brokenItems = [];
  for (const [rid, models] of Object.entries(prices)) {
    for (const [mdl, e] of Object.entries(models)) {
      if (!e || typeof e !== 'object') continue; combos++;
      if (e.overCeiling) overCeiling.push({ repairId: rid, model: mdl, final: e.final, ceiling: e.ceiling });
      if (e.outOfStock) oos++;
      else if (e.final == null) { broken++; brokenItems.push({ repairId: rid, model: mdl, url: e.url || null }); }
      else inStock++;
    }
  }
  const coverage = [], modelGaps = [];
  if (Array.isArray(links)) {
    const byType = {}, byModel = {};
    for (const l of links) { if (!l.model || l.model === 'default') continue; (byType[l.repair_id] ||= new Set()).add(l.model); (byModel[l.model] ||= new Set()).add(l.repair_id); }
    const allTypes = Object.keys(byType);
    for (const t of allTypes.sort()) coverage.push({ repairId: t, models: byType[t].size });
    for (const model of FLAGSHIP) {
      const have = byModel[model];
      if (!have) { modelGaps.push({ model, missing: ['(modèle absent)'] }); continue; }
      const missing = allTypes.filter(t => !have.has(t)); if (missing.length) modelGaps.push({ model, missing });
    }
  }
  const genAt = pricesDoc?.generatedAt ? new Date(pricesDoc.generatedAt) : null;
  const ageH = genAt ? (now - genAt) / 36e5 : null;
  const stale = ageH != null && ageH > 24 * 5;
  if (!pricesDoc) alerts.push({ level: 'error', msg: 'Fichier de prix injoignable.' });
  else if (stale) alerts.push({ level: 'warn', msg: `Prix figés depuis ${Math.round(ageH / 24)} j — le rafraîchissement a peut-être échoué.` });
  if (broken > 0) alerts.push({ level: 'warn', msg: `${broken} lien(s) sans prix — à vérifier chez Utopya.` });
  if (overCeiling.length) alerts.push({ level: 'warn', msg: `${overCeiling.length} produit(s) dépassent le prix Apple.` });
  const orderErrors = orders.filter(o => o.status === 'error' || o.error_message).map(o => ({ id: o.id, email: o.customer_email, created_at: o.created_at, error: o.error_message || 'statut error', total: o.total_cents }));
  if (orderErrors.length) alerts.push({ level: 'error', msg: `${orderErrors.length} commande(s) en erreur — action requise.` });
  const paidNotOrdered = orders.filter(o => o.status === 'paid' && !o.utopya_order_id).length;
  const changes = (hist && Array.isArray(hist.changes)) ? hist.changes : [];
  const c30 = { up: 0, down: 0, oos: 0, restock: 0 };
  for (const c of changes) if (new Date(c.t) >= d30 && c30[c.kind] != null) c30[c.kind]++;

  return res.status(200).json({
    orders,
    stats: {
      total_orders: orders.length, orders_30d: count30,
      encaisse_cents: revenue, encaisse_30d_cents: revenue30,
      cout_pieces_cents: partsCost, benefice_cents: gain,
      cout_30d_cents: cost30, benefice_30d_cents: gain30,
      cost_unknown_orders: costUnknown,
      upcoming_appointments: upcoming.slice(0, 40),
    },
    catalog: { combos, in_stock: inStock, out_of_stock: oos, broken, prices_generated_at: pricesDoc?.generatedAt || null, prices_age_hours: ageH, over_ceiling: overCeiling, broken_items: brokenItems.slice(0, 60), coverage, model_gaps: modelGaps },
    price_changes: { updatedAt: hist?.updatedAt || null, total: changes.length, recent: changes.slice(0, 60), counts_30d: c30 },
    health: { supabase_ok: !!(SUPA && KEY) && !alerts.some(a => a.level === 'error' && /Supabase/.test(a.msg)), prices_ok: !!pricesDoc && !stale, order_errors: orderErrors, paid_not_ordered: paidNotOrdered, alerts },
    serverTime: now.toISOString(),
  });
}
