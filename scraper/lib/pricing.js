// Logique de calcul du prix final SAFIX :
//   1. base = prix PRO Utopya HT (ou TTC selon ce qu'affiche Utopya connecté)
//   2. step1 = ceil(base * 1.20)            -> +20 %, arrondi à l'euro supérieur
//   3. final = step1 + marge selon catégorie / repair / modèle
//
// Marges (avril 2026) :
//   - Batterie / Batterie Original :
//       iPhone 12 et plus récent : +50 €
//       iPhone 11 et plus ancien : +35 €
//   - Autres réparations (écran, micro, connecteur, caméra…) : +25 €
//   - Accessoires / Protections / Services : 0 € (prix brut conservé)

export const VAT_MULTIPLIER = 1.20;

// Modèles considérés comme "iPhone 12+" (marge batterie élevée)
const IPHONE_12_PLUS = new Set([
  "iPhone 12", "iPhone 12 mini", "iPhone 12 Pro", "iPhone 12 Pro Max",
  "iPhone 13", "iPhone 13 mini", "iPhone 13 Pro", "iPhone 13 Pro Max",
  "iPhone 14", "iPhone 14 Plus", "iPhone 14 Pro", "iPhone 14 Pro Max",
  "iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max",
  "iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 16e",
  "iPhone 17", "iPhone 17 Air", "iPhone 17 Pro", "iPhone 17 Pro Max", "iPhone 17e",
  "iPhone SE (2022)",
]);

function getMargin({ repairId, model, category }) {
  if (category !== "repair") return 0;
  // Batteries (normale + Apple Service Pack)
  if (repairId === "batterie" || repairId === "batterie_original") {
    return IPHONE_12_PLUS.has(model) ? 50 : 35;
  }
  return 25;
}

// Plafonds de prix (accessoires) : ne JAMAIS dépasser le prix retail Apple.
// Câbles = 25 € max (prix Apple). Le chargeur secteur sera ajouté plus tard.
const PRICE_CAP = {
  cable_usb_c: 25,
  cable_usb_c_lightning: 25,
};

export function computeFinal({ basePrice, category, outOfStock, repairId, model }) {
  if (outOfStock) return { final: null, outOfStock: true };
  if (basePrice == null || Number.isNaN(basePrice)) {
    return { final: null, outOfStock: false, error: "no_price" };
  }
  const step1 = Math.ceil(basePrice * VAT_MULTIPLIER);
  const margin = getMargin({ repairId, model, category });
  let final = step1 + margin;
  const cap = PRICE_CAP[repairId];
  const capped = cap != null && final > cap;
  if (capped) final = cap;
  return { final, outOfStock: false, step1, margin, capped };
}

export function parsePriceString(str) {
  if (str == null) return null;
  const cleaned = String(str)
    .replace(/ | /g, " ")
    .replace(/€|EUR/gi, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .trim();
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}
