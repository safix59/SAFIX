// ─────────────────────────────────────────────────────────────────────────
// Données admin (protégé) — centre de contrôle complet.
// Agrège : commandes + finances, santé catalogue (liens manquants/cassés,
// ruptures, dépassements prix Apple), historique des prix, alertes/pannes.
// La clé service_role reste 100 % côté serveur.
// ─────────────────────────────────────────────────────────────────────────
import { requireAuth } from './_admin-auth.js';

const ORIGIN = 'https://safix59.fr';

// Réparations « phares » à surveiller pour les trous de catalogue
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
  if (!requireAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  const SUPA = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  const alerts = [];

  // ── Chargements en parallèle ──
  const [ordersRaw, pricesDoc, links, hist] = await Promise.all([
    (async () => {
      if (!SUPA || !KEY) { alerts.push({ level: 'warn', msg: 'Supabase non configuré — commandes indisponibles.' }); return []; }
      try {
        const r = await fetch(`${SUPA}/rest/v1/orders?select=id,created_at,customer_email,total_cents,currency,status,utopya_order_id,line_items,metadata,error_message,stripe_payment_intent&order=created_at.desc&limit=500`,
          { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        if (!r.ok) { alerts.push({ level: 'error', msg: `Supabase HTTP ${r.status} — base injoignable.` }); return []; }
        const j = await r.json();
        return Array.isArray(j) ? j : [];
      } catch (e) { alerts.push({ level: 'error', msg: 'Supabase injoignable : ' + e.message }); return []; }
    })(),
    getJson('/scraper/prices.json'),
    getJson('/scraper/links.json'),
    getJson('/scraper/price-history.json'),
  ]);

  const orders = ordersRaw || [];
  const prices = (pricesDoc && pricesDoc.prices) || {};

  // ── Index coût (basePrice) + prix (final) par repair/model ──
  const priceOf = (rid, model) => {
    const e = prices?.[rid]?.[model] || prices?.[rid]?.default;
    return e || null;
  };

  // ── FINANCES ──
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 864e5);
  let revenue = 0, revenue30 = 0, count30 = 0, partsCost = 0;
  const upcoming = [];
  for (const o of orders) {
    revenue += (o.total_cents || 0);
    if (o.created_at && new Date(o.created_at) >= d30) { revenue30 += (o.total_cents || 0); count30++; }
    // coût pièces estimé (basePrice Utopya) si on peut relier les articles
    const items = Array.isArray(o.line_items) ? o.line_items : [];
    for (const it of items) {
      const rid = it.repair_id || it.repairId;
      const mdl = it.model || 'default';
      if (rid) {
        const p = priceOf(rid, mdl);
        if (p && typeof p.basePrice === 'number') partsCost += Math.round(p.basePrice * 100) * (it.qty || 1);
      }
    }
    const m = o.metadata || {};
    if (m.apptDate) {
      const ad = new Date(m.apptDate);
      if (ad >= new Date(now.toDateString())) upcoming.push({ id: o.id, date: m.apptDate, slot: m.apptSlot || null, addr: m.addr || null, email: o.customer_email, model: m.model || null });
    }
  }
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  const marginEst = revenue - partsCost;

  // ── SANTÉ CATALOGUE ──
  let combos = 0, inStock = 0, oos = 0, broken = 0;
  const overCeiling = [], brokenItems = [];
  for (const [rid, models] of Object.entries(prices)) {
    for (const [mdl, e] of Object.entries(models)) {
      if (!e || typeof e !== 'object') continue;
      combos++;
      if (e.overCeiling) overCeiling.push({ repairId: rid, model: mdl, final: e.final, ceiling: e.ceiling });
      if (e.outOfStock) { oos++; }
      else if (e.final == null) { broken++; brokenItems.push({ repairId: rid, model: mdl, url: e.url || null, lastError: e.lastError || 'no_price' }); }
      else inStock++;
    }
  }

  // Couverture par type + trous sur modèles phares (depuis links.json)
  const coverage = [], modelGaps = [];
  if (Array.isArray(links)) {
    const byType = {}, byModel = {};
    for (const l of links) {
      if (!l.model || l.model === 'default') continue;
      (byType[l.repair_id] ||= new Set()).add(l.model);
      (byModel[l.model] ||= new Set()).add(l.repair_id);
    }
    const allTypes = Object.keys(byType);
    for (const t of allTypes.sort()) coverage.push({ repairId: t, models: byType[t].size });
    for (const model of FLAGSHIP) {
      const have = byModel[model];
      if (!have) { modelGaps.push({ model, missing: ['(modèle absent du catalogue)'] }); continue; }
      const missing = allTypes.filter(t => !have.has(t));
      if (missing.length) modelGaps.push({ model, missing });
    }
  }

  // Fraîcheur des prix (scraper mort ?)
  const genAt = pricesDoc?.generatedAt ? new Date(pricesDoc.generatedAt) : null;
  const ageH = genAt ? (now - genAt) / 36e5 : null;
  const stale = ageH != null && ageH > 24 * 5; // > 5 jours
  if (!pricesDoc) alerts.push({ level: 'error', msg: 'Fichier de prix injoignable — le site ne peut pas afficher de tarifs.' });
  else if (stale) alerts.push({ level: 'warn', msg: `Prix figés depuis ${Math.round(ageH / 24)} j — le rafraîchissement automatique a peut-être échoué.` });
  if (broken > 0) alerts.push({ level: 'warn', msg: `${broken} lien(s) ne renvoient plus de prix — à vérifier chez Utopya.` });
  if (overCeiling.length) alerts.push({ level: 'warn', msg: `${overCeiling.length} produit(s) dépassent le prix Apple — à ajuster.` });

  // ── PANNES / COMMANDES EN ERREUR ──
  const orderErrors = orders.filter(o => o.status === 'error' || o.error_message)
    .map(o => ({ id: o.id, email: o.customer_email, created_at: o.created_at, error: o.error_message || 'statut error', total: o.total_cents }));
  if (orderErrors.length) alerts.push({ level: 'error', msg: `${orderErrors.length} commande(s) en erreur (commande fournisseur non passée ?) — action requise.` });
  const paidNotOrdered = orders.filter(o => o.status === 'paid' && !o.utopya_order_id).length;

  // ── HISTORIQUE PRIX ──
  const changes = (hist && Array.isArray(hist.changes)) ? hist.changes : [];
  const recent = changes.slice(0, 60);
  const c30 = { up: 0, down: 0, oos: 0, restock: 0 };
  for (const c of changes) { if (new Date(c.t) >= d30 && c30[c.kind] != null) c30[c.kind]++; }

  return res.status(200).json({
    orders,
    stats: {
      total_orders: orders.length,
      revenue_cents: revenue, revenue_30d_cents: revenue30, orders_30d: count30,
      parts_cost_cents_est: partsCost, margin_cents_est: marginEst,
      upcoming_appointments: upcoming.slice(0, 40),
    },
    catalog: {
      combos, in_stock: inStock, out_of_stock: oos, broken,
      prices_generated_at: pricesDoc?.generatedAt || null, prices_age_hours: ageH,
      over_ceiling: overCeiling, broken_items: brokenItems.slice(0, 60),
      coverage, model_gaps: modelGaps,
    },
    price_changes: { updatedAt: hist?.updatedAt || null, total: changes.length, recent, counts_30d: c30 },
    health: {
      supabase_ok: !!(SUPA && KEY) && !alerts.some(a => a.level === 'error' && /Supabase/.test(a.msg)),
      prices_ok: !!pricesDoc && !stale,
      order_errors: orderErrors, paid_not_ordered: paidNotOrdered,
      alerts,
    },
    serverTime: now.toISOString(),
  });
}
