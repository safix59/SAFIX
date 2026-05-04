// Vérifie que la formule appliquée est exactement :
//   Prix final = ceil(prix_utopya × 1.20) + 25€   (réparations)
//   Prix final = ceil(prix_utopya × 1.20)         (accessoires)
//
// Lance : npm run verify-formula

import { computeFinal } from "./lib/pricing.js";

const cases = [
  // [base, category, expectedStep1, expectedFinal, label]
  [14.80, "repair", 18, 43, "exemple cahier des charges (14.80 → 18 → 43)"],
  [10.00, "repair", 12, 37, "10€ réparation → 12 +25 = 37"],
  [10.01, "repair", 13, 38, "10.01€ réparation (arrondi sup) → 13 +25 = 38"],
  [50.00, "repair", 60, 85, "50€ réparation → 60 +25 = 85"],
  [123.45, "repair", 149, 174, "123.45€ → 148.14 → 149 +25 = 174"],
  [0.83, "repair", 1, 26, "0.83€ → 0.996 → 1 +25 = 26"],
  [10.00, "accessory", 12, 12, "10€ accessoire → 12 (pas de +25)"],
  [4.16, "accessory", 5, 5, "4.16€ accessoire → 5"],
];

let pass = 0;
let fail = 0;
console.log("Vérification formule : ceil(base × 1.20) + 25€ (repair) | + 0€ (accessory)\n");
for (const [base, cat, eStep, eFinal, label] of cases) {
  const r = computeFinal({ basePrice: base, category: cat, outOfStock: false });
  const okStep = r.step1 === eStep;
  const okFinal = r.final === eFinal;
  const ok = okStep && okFinal;
  if (ok) pass++;
  else fail++;
  const tag = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`${tag} ${label}`);
  console.log(`    base=${base}€ cat=${cat}  → step1=${r.step1} (attendu ${eStep})  final=${r.final}€ (attendu ${eFinal}€)`);
}

// Cas rupture
const oos = computeFinal({ basePrice: 50, category: "repair", outOfStock: true });
const oosOk = oos.final === null && oos.outOfStock === true;
if (oosOk) pass++; else fail++;
console.log(`${oosOk ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} rupture de stock → final=null`);

// Cas pas de prix
const noPrice = computeFinal({ basePrice: null, category: "repair" });
const noPriceOk = noPrice.final === null && noPrice.error === "no_price";
if (noPriceOk) pass++; else fail++;
console.log(`${noPriceOk ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} prix introuvable → final=null + error="no_price"`);

console.log(`\n${pass} OK / ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
