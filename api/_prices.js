// ─────────────────────────────────────────────────────────────────────────
// Helper anti-fraude partagé par TOUS les chemins de paiement
// (create-checkout-session, create-payment-intent, paypal-create-order).
//
// Origine prices.json PINNÉE en dur → on ne dérive JAMAIS l'URL d'un
// header de requête (sinon Host spoofing = bypass anti-fraude / SSRF).
// Fichier préfixé "_" → Vercel ne l'expose pas comme route, mais il est
// importable comme module par les autres handlers.
// ─────────────────────────────────────────────────────────────────────────

const PRICES_URL = 'https://safix59.fr/scraper/prices.json';
let _cache = null;
let _cacheAt = 0;

export async function loadPrices() {
  if (_cache && Date.now() - _cacheAt < 60000) return _cache;
  try {
    const r = await fetch(PRICES_URL, { cache: 'no-store' });
    if (r.ok) {
      _cache = (await r.json()).prices || null;
      _cacheAt = Date.now();
    }
  } catch (e) { /* indispo → null : on ne bloque pas la vente */ }
  return _cache;
}

// Prix officiel (€) d'une ligne, ou { oos:true }, ou null si hors prices.json
// (Services / inconnu → on ne touche pas, ils sont bornés et faibles).
export function officialUnitEuros(PRICES, it) {
  if (!PRICES || !it || !it.repairId || !it.modelKey) return null;
  const entry = PRICES[it.repairId] && PRICES[it.repairId][it.modelKey];
  if (!entry) return null;
  if (entry.outOfStock === true) return { oos: true };
  let v = Number(entry.final);
  if (it.colorName && Array.isArray(entry.colors)) {
    const cv = entry.colors.find(c => c.color === it.colorName);
    if (cv) {
      if (cv.outOfStock === true) return { oos: true };
      if (Number.isFinite(Number(cv.final))) v = Number(cv.final);
    }
  }
  return Number.isFinite(v) && v > 0 ? { euros: v } : null;
}

// Valide + clampe lineItems EN PLACE (it.price = max(client, officiel)).
// Renvoie { error, item, model } si fraude/rupture, sinon {}.
export function enforcePrices(PRICES, lineItems) {
  for (const it of lineItems) {
    const off = officialUnitEuros(PRICES, it);
    if (!off) continue;                       // Service/inconnu → inchangé
    if (off.oos) {
      return { error: 'out_of_stock', item: it.repairId, model: it.modelKey };
    }
    const client = Number(it.price);
    if (!Number.isFinite(client) || client < off.euros * 0.7) {
      return { error: 'price_mismatch', item: it.repairId, model: it.modelKey };
    }
    it.price = Math.max(client, off.euros);   // jamais sous le prix officiel
  }
  return {};
}
