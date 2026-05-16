// ─────────────────────────────────────────────────────────────────────────
// Helper anti-fraude partagé par TOUS les chemins de paiement
// (create-checkout-session, create-payment-intent, paypal-create-order).
//
// Origine prices.json PINNÉE en dur → on ne dérive JAMAIS l'URL d'un
// header de requête (sinon Host spoofing = bypass anti-fraude / SSRF).
// Fichier préfixé "_" → Vercel ne l'expose pas comme route, mais il est
// importable comme module par les autres handlers.
//
// PRINCIPE FAIL-CLOSED : un article du catalogue (pièce/protection/
// accessoire = présent dans prices.json, OU service à prix plancher fixe)
// DOIT résoudre un prix officiel. S'il ne résout pas (modèle inconnu,
// casse/espaces trafiqués, prix null, repairId hors catalogue) on REFUSE
// la transaction au lieu de faire confiance au prix client. Seule
// exception : prices.json totalement indisponible → on ne bloque pas la
// vente (choix de disponibilité assumé, fenêtre étroite, origine pinnée).
// ─────────────────────────────────────────────────────────────────────────

const PRICES_URL = 'https://safix59.fr/scraper/prices.json';
let _cache = null;
let _cacheAt = 0;

// Services : pas dans prices.json, prix plancher câblé dans le catalogue
// front (index.html → data.repairs "Services"). Source de vérité dupliquée
// ici volontairement : le client ne doit JAMAIS pouvoir payer en dessous.
const SERVICE_FLOORS = {
  diagnostic_expert: 20,
  deblocage_bootloop: 30,
  restauration_usine: 30,
  recuperation_de_donnees: 50,
  reparation_express: 10,
};

// Normalisation tolérante : NFKC, espaces compactés, casse ignorée.
// Neutralise "iphone 11", "iPhone 11 ", "iPhone  11" → même clé.
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Index normalisé construit une seule fois par objet PRICES (WeakMap →
// libéré quand le cache est remplacé). { repairIdNorm -> {
//   id: repairIdRéel, models: Map<modelNorm, entry> } }
const _idxCache = new WeakMap();
function getIndex(PRICES) {
  let idx = _idxCache.get(PRICES);
  if (idx) return idx;
  idx = new Map();
  for (const rid of Object.keys(PRICES)) {
    const models = new Map();
    const bucket = PRICES[rid] || {};
    for (const mk of Object.keys(bucket)) models.set(norm(mk), bucket[mk]);
    idx.set(norm(rid), { id: rid, models });
  }
  _idxCache.set(PRICES, idx);
  return idx;
}

export async function loadPrices() {
  if (_cache && Date.now() - _cacheAt < 60000) return _cache;
  try {
    const r = await fetch(PRICES_URL, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      _cache = j.prices || null;
      _cacheAt = Date.now();
      // Signal SOFT (jamais bloquant) : prices.json périmé = scraper en
      // panne. Visible dans les logs Vercel pour réagir sans couper la vente.
      const gen = Date.parse(j.generatedAt || '');
      if (Number.isFinite(gen)) {
        const ageH = Math.round((Date.now() - gen) / 3600000);
        if (ageH > 72) console.warn(`[prices] STALE ${ageH}h (generatedAt=${j.generatedAt}) — cron scraper à vérifier`);
      }
    } else {
      console.warn(`[prices] fetch non-ok ${r.status} — scraper/CDN à vérifier (vente non bloquée)`);
    }
  } catch (e) {
    // Scraper/CDN injoignable : on ne bloque pas la vente, mais on TRACE
    // (sinon une panne scraper reste totalement invisible).
    console.warn(`[prices] fetch FAILED (${e && e.message}) — prix injoignables (vente non bloquée)`);
  }
  return _cache;
}

// Résout le statut/prix officiel d'une ligne. Retourne exactement un de :
//   { skip:true }              prices.json indisponible → ne pas bloquer
//   { oos:true }               rupture de stock
//   { reject:true }            catalogue mais prix introuvable → FAIL-CLOSED
//   { euros:Number, kind }     prix officiel ('catalog') ou plancher ('service')
function resolve(PRICES, it) {
  const rid = norm(it && it.repairId);

  // Service à plancher fixe (indépendant du modèle).
  if (rid && Object.prototype.hasOwnProperty.call(SERVICE_FLOORS, rid)) {
    return { euros: SERVICE_FLOORS[rid], kind: 'service' };
  }

  if (!PRICES) return { skip: true };          // catalogue down → ne pas bloquer
  if (!rid) return { reject: true };           // pas de repairId → suspect

  const idx = getIndex(PRICES);
  const ridEntry = idx.get(rid);
  if (!ridEntry) return { reject: true };      // repairId hors catalogue → FAIL-CLOSED

  const entry = ridEntry.models.get(norm(it && it.modelKey));
  if (!entry) return { reject: true };         // modèle trafiqué/inconnu → FAIL-CLOSED
  if (entry.outOfStock === true) return { oos: true };

  let v = Number(entry.final);
  if (it && it.colorName && Array.isArray(entry.colors)) {
    const want = norm(it.colorName);
    const cv = entry.colors.find(c => norm(c && c.color) === want);
    if (cv) {
      if (cv.outOfStock === true) return { oos: true };
      if (Number.isFinite(Number(cv.final))) v = Number(cv.final);
    }
  }
  if (!Number.isFinite(v) || v <= 0) return { reject: true }; // prix non résolu → FAIL-CLOSED
  return { euros: v, kind: 'catalog' };
}

// Valide + clampe lineItems EN PLACE.
//   - qty bornée [1..20] (anti qty négative/0/NaN/énorme).
//   - service : it.price = max(client, plancher) — jamais bloquant.
//   - pièce   : refuse si client < 70% officiel, sinon max(client, officiel).
//   - rupture / prix introuvable / repairId inconnu → refus (fail-closed).
// Renvoie { error, item, model } si fraude/rupture, sinon {}.
export function enforcePrices(PRICES, lineItems) {
  for (const it of lineItems) {
    it.qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty)) || 1));

    const r = resolve(PRICES, it);
    if (r.skip) continue;                       // catalogue indisponible
    if (r.oos) {
      return { error: 'out_of_stock', item: it.repairId, model: it.modelKey };
    }
    if (r.reject) {
      return { error: 'price_mismatch', item: it.repairId, model: it.modelKey };
    }

    const client = Number(it.price);
    if (r.kind === 'service') {
      it.price = r.euros;            // service = prix fixe : ni sous-payé ni gonflé par le client
      continue;
    }
    // Pièce : tolérance 30% sous le prix officiel (lag scraper), sinon refus.
    if (!Number.isFinite(client) || client < r.euros * 0.7) {
      return { error: 'price_mismatch', item: it.repairId, model: it.modelKey };
    }
    it.price = Math.max(client, r.euros);       // jamais sous le prix officiel
  }
  return {};
}
