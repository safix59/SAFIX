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

// ── CMS cartes (Dashboard → Cartes) : surcharges stockées dans la table
// settings, clé `cards_config`. Le SERVEUR applique les mêmes règles que
// l'affichage : carte masquée = invendable (fail-closed), promo active =
// prix officiel ajusté (sinon prix affiché ≠ prix facturé), carte custom =
// prix fixé par l'admin. Cache 60 s, fail-open (config indisponible →
// comportement d'origine, jamais de vente bloquée par le CMS).
let _cardsCache = null;
let _cardsAt = 0;
export async function loadCardsCfg() {
  if (_cardsCache !== null && Date.now() - _cardsAt < 60000) return _cardsCache;
  try {
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    if (!S || !K) return _cardsCache;
    const r = await fetch(`${S}/rest/v1/settings?select=value&key=eq.cards_config`, {
      headers: { apikey: K, Authorization: `Bearer ${K}` },
    });
    if (r.ok) {
      const rows = await r.json();
      _cardsCache = (rows && rows[0] && rows[0].value && rows[0].value.cards) || {};
      _cardsAt = Date.now();
    }
  } catch { /* fail-open */ }
  return _cardsCache;
}
export function promoActive(p, now = Date.now()) {
  if (!p || !p.active) return false;
  if (p.start && now < Date.parse(p.start)) return false;
  if (p.end && now > Date.parse(p.end) + 86399999) return false; // fin de journée incluse
  return true;
}
export function applyPromoEuros(euros, p) {
  const v = Number(p && p.value) || 0;
  if (p.type === 'percent' && v > 0) return Math.max(1, Math.round(euros * (1 - v / 100)));
  if (p.type === 'amount' && v > 0) return Math.max(1, Math.round(euros - v));
  return euros; // badge purement visuel (Nouveau, Meilleure vente…)
}
// Surcharge EFFECTIVE d'une carte pour un modèle donné : la couche
// par-modèle (ov.models["iPhone 13 Pro"]) remplace champ à champ le réglage
// général — un champ présent (même null) écrase, un champ absent hérite.
// → l'admin peut promouvoir/masquer une carte sur UN modèle sans toucher
// les autres, ou au contraire ré-afficher un modèle d'une carte masquée.
export function effectiveOv(CARDS, ridNorm, ridRaw, modelKey) {
  const base = (CARDS && (CARDS[ridNorm] || CARDS[ridRaw])) || null;
  if (!base) return null;
  const layers = base.models;
  if (!layers || !modelKey) return base;
  const mNorm = norm(modelKey);
  const mk = Object.keys(layers).find((k) => k === modelKey || norm(k) === mNorm);
  if (!mk) return base;
  const mo = layers[mk] || {};
  const eff = { ...base };
  for (const f of ['hidden', 'price', 'promo', 'title', 'subtitle', 'order']) {
    if (Object.prototype.hasOwnProperty.call(mo, f)) eff[f] = mo[f];
  }
  return eff;
}

// Ajustements CMS sur le prix officiel résolu (override admin puis promo).
function cardAdjust(euros, ov) {
  let v = euros;
  const forced = Number(ov && ov.price);
  if (Number.isFinite(forced) && forced > 0) v = forced;
  if (ov && promoActive(ov.promo)) v = applyPromoEuros(v, ov.promo);
  return v;
}

// Normalisation tolérante : NFKC, espaces compactés, casse ignorée.
// Neutralise "iphone 11", "iPhone 11 ", "iPhone  11" → même clé.
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Porté À L'IDENTIQUE du front (index.html) : le client soumet le nom de
// couleur APPLE, prices.json stocke le nom UTOPYA. Sans ce matcher flou le
// serveur ne trouvait jamais la couleur → facturait le prix de BASE au lieu
// du prix de la couleur choisie (écart silencieux, cf. revue A12).
function strNorm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function utopyaMatchesApple(utopyaName, appleName) {
  const u = strNorm(utopyaName), a = strNorm(appleName);
  if (u === a) return true;
  if (u.includes(a) || a.includes(u)) return true;
  const specials = {
    'gris sideral':['noir','gris','space gray','space grey'],
    'argent':['blanc','silver'],
    'or':['or','gold'],
    'or rose':['rose','rose gold'],
    'noir de jais':['jais','jet'],
    '(product)red':['rouge','red'],
    'minuit':['noir','midnight'],
    'lumiere stellaire':['blanc','stellaire','starlight'],
    'noir sideral':['noir','space black'],
    'violet intense':['violet','deep purple'],
    'graphite':['noir','gris','graphite'],
    'titane noir':['noir','black titanium','titane'],
    'titane blanc':['blanc','white titanium','titane'],
    'titane bleu':['bleu','blue titanium','titane'],
    'titane naturel':['naturel','natural','titane'],
    'titane sable':['sable','desert','titane'],
    'bleu pacifique':['bleu','pacifique','pacific'],
    'bleu alpin':['bleu','alpin','alpine'],
    'vert alpin':['vert','alpin','alpine'],
    'sarcelle':['teal','sarcelle','vert'],
    'outremer':['outremer','ultramarine','bleu'],
    'lavande':['lavende','violet','lavender'],
    'sauge':['vert','sage','sauge'],
    'brume':['gris','blanc','mist'],
    'bleu ciel':['bleu','sky'],
    'or clair':['or','light gold'],
    'blanc nuage':['blanc','cloud'],
    'orange cosmique':['orange','cosmic'],
    'bleu intense':['bleu','deep blue'],
    'rose pastel':['rose','pastel pink'],
  };
  const list = specials[a] || [];
  return list.some(k => u.includes(strNorm(k)));
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
function resolve(PRICES, it, CARDS) {
  const rid = norm(it && it.repairId);
  const ov = effectiveOv(CARDS, rid, String((it && it.repairId) || '').trim(), it && it.modelKey);

  // Carte masquée depuis le Dashboard → invendable (fail-closed).
  if (ov && ov.hidden) return { oos: true };

  // Carte CRÉÉE depuis le Dashboard : prix fixé par l'admin (comme un service).
  if (ov && ov.custom) {
    const v = cardAdjust(Number(ov.price), ov);
    if (!Number.isFinite(v) || v <= 0) return { reject: true };
    return { euros: v, kind: 'service' };
  }

  // Service à plancher fixe (indépendant du modèle).
  if (rid && Object.prototype.hasOwnProperty.call(SERVICE_FLOORS, rid)) {
    return { euros: cardAdjust(SERVICE_FLOORS[rid], ov), kind: 'service' };
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
    let cv = entry.colors.find(c => norm(c && c.color) === want);
    if (!cv) cv = entry.colors.find(c => c && utopyaMatchesApple(c.color, it.colorName));
    if (cv) {
      if (cv.outOfStock === true) return { oos: true };
      if (Number.isFinite(Number(cv.final))) v = Number(cv.final);
    }
  }
  if (!Number.isFinite(v) || v <= 0) return { reject: true }; // prix non résolu → FAIL-CLOSED
  return { euros: cardAdjust(v, ov), kind: 'catalog' };
}

// Valide + clampe lineItems EN PLACE.
//   - qty bornée [1..20] (anti qty négative/0/NaN/énorme).
//   - service : it.price = max(client, plancher) — jamais bloquant.
//   - pièce   : refuse si client < 70% officiel, sinon max(client, officiel).
//   - rupture / prix introuvable / repairId inconnu → refus (fail-closed).
// Renvoie { error, item, model } si fraude/rupture, sinon {}.
export function enforcePrices(PRICES, lineItems, CARDS) {
  for (const it of lineItems) {
    it.qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty)) || 1));

    const r = resolve(PRICES, it, CARDS);
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
