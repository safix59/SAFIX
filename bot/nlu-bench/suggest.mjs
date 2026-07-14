#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// Banc de test des SUGGESTIONS ADMIN (botSuggest) — suivi SAV slot-aware
// ═══════════════════════════════════════════════════════════════════════
// Règle d'or : ne JAMAIS redemander une information déjà fournie par le
// client. Si le modèle est connu → aucune suggestion ne doit demander le
// modèle ; si la panne est connue → aucune ne doit demander la panne. Les
// suggestions doivent FAIRE AVANCER (confirmer, estimer, proposer un RDV…).
//   node bot/nlu-bench/suggest.mjs

import { botSuggest, conversationState } from '../../api/_bot-nlu.js';

const MODELS = ['iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 14', 'iPhone 15', 'iPhone 15 Pro Max', 'iPhone SE (2022)'];
function tbl(base, step = 10, oos = null) { const o = {}; MODELS.forEach((m, i) => { o[m] = { final: base + i * step }; }); if (oos && o[oos]) o[oos].outOfStock = true; return o; }
const P = {
  ecran_eco: tbl(40), ecran_standard: tbl(80), ecran_premium: tbl(120), ecran_original: tbl(200),
  batterie: tbl(45, 5), batterie_original: tbl(75, 5), connecteur_de_charge: tbl(50, 3),
  camera_arriere: tbl(85, 4), vitre_arriere: tbl(110, 6), haut_parleur: tbl(40, 2),
};
const U = (body) => ({ sender: 'user', body });
const A = (body) => ({ sender: 'admin', body });

// Détecteurs de « redemande » interdite (regex sur la suggestion complète).
const ASKS_MODEL = /quel(?:le)?\s+(?:est\s+(?:le|votre)\s+)?mod[eè]le|quel iphone|votre mod[eè]le|le mod[eè]le exact|quel est le mod|quel appareil/i;
const ASKS_PANNE = /quelle?\s+(?:est\s+)?(?:la\s+)?panne|quel\s+(?:est\s+)?(?:le\s+)?probl[eè]me|qu.?est-?ce qui ne va|quel souci|pr[eé]cisez.*(panne|souci|probl)|d[eé]crivez.*(souci|panne|probl)|ce qui ne va pas/i;

const cases = [
  {
    n: 'Modèle + panne connus (via 2 messages) → NE PAS redemander',
    hist: [A('Bonjour 👋'), U('mon ecran est casse'), U('jai un iphone 13 pro')],
    model: 'iPhone 13 Pro', repair: true, noAskModel: true, noAskPanne: true, incAny: ['13 Pro'],
  },
  {
    n: 'Modèle + panne dans le MÊME message → NE PAS redemander',
    hist: [U('lecran de mon iphone 12 est casse combien')],
    model: 'iPhone 12', repair: true, noAskModel: true, noAskPanne: true,
  },
  {
    n: 'Modèle connu, panne inconnue → demander SEULEMENT la panne',
    hist: [U('bonjour jai un iphone 14')],
    model: 'iPhone 14', repair: false, noAskModel: true, mustAskPanne: true,
  },
  {
    n: 'Panne connue, modèle inconnu → demander SEULEMENT le modèle',
    hist: [U('ma batterie est morte elle tient plus')],
    repair: true, noAskPanne: true, mustAskModel: true,
  },
  {
    n: 'Rien de connu (ouverture) → peut demander les deux, avec bonjour',
    hist: [U('bonjour')],
    incAny: ['modèle'],
  },
  {
    n: 'Prix déjà annoncé par l\'admin → proposer la suite (RDV/commande), pas re-demander',
    hist: [A('::bot::Oui ✅ L\'écran de l\'iPhone 13 Pro est disponible : Standard 119 € tout compris.'), U('ecran iphone 13 pro')],
    model: 'iPhone 13 Pro', repair: true, noAskModel: true, noAskPanne: true, incAny: ['créneau', 'commande', 'fiche', 'rendez'],
  },
  {
    n: 'Symptôme (charge) + modèle → panne réputée connue',
    hist: [U('mon iphone 11 charge plus')],
    model: 'iPhone 11', repair: true, noAskModel: true, noAskPanne: true,
  },
  {
    n: 'Slot-filling multi-tours : modèle donné au 2e tour',
    hist: [A('Pour quel modèle ?'), U('mon ecran est casse'), A('Bonjour'), U('bonjour')].reverse ? undefined : null,
  },
  {
    n: 'Dernier message = question garantie → proposer la réponse garantie',
    hist: [U('vous avez une garantie ?'), A('::bot::Écran iPhone 13 Pro : 119 €'), U('ecran 13 pro')],
    model: 'iPhone 13 Pro', incAny: ['garantie', 'pièces neuves', 'CGV'], noAskModel: true,
  },
  {
    n: 'Dernier message = question délai → proposer la réponse délai',
    hist: [U('ca prend combien de temps ?'), A('::bot::Écran iPhone 12 : 89 €'), U('ecran iphone 12')],
    model: 'iPhone 12', incAny: ['48', 'Standard', 'Express'], noAskModel: true,
  },
];

// Cas construit proprement (le .reverse ci-dessus était un garde) :
cases[7] = {
  n: 'Slot-filling multi-tours : modèle au dernier tour, panne au tour précédent',
  hist: [U('cest un iphone 13 pro'), A('Pour quel modèle ?'), U('mon ecran est casse'), A('Bonjour'), U('bonjour')],
  model: 'iPhone 13 Pro', repair: true, noAskModel: true, noAskPanne: true,
};

let pass = 0; const fails = [];
for (const c of cases) {
  const st = conversationState(c.hist, P);
  const sugg = botSuggest(c.hist, P, null);
  const joined = sugg.join('  ||  ');
  const errs = [];
  if (sugg.length < 1) errs.push('aucune suggestion');
  if (c.model && st.model !== c.model) errs.push(`état: modèle détecté « ${st.model} » ≠ attendu « ${c.model} »`);
  if (c.repair === true && !st.repair) errs.push('état: panne/réparation NON détectée alors qu\'attendue');
  if (c.noAskModel && ASKS_MODEL.test(joined)) errs.push('REDEMANDE le modèle (déjà connu) ✗');
  if (c.noAskPanne && ASKS_PANNE.test(joined)) errs.push('REDEMANDE la panne (déjà connue) ✗');
  if (c.mustAskModel && !ASKS_MODEL.test(joined)) errs.push('devrait demander le modèle (manquant)');
  if (c.mustAskPanne && !ASKS_PANNE.test(joined)) errs.push('devrait demander la panne (manquante)');
  for (const frag of (c.incAny ? [c.incAny] : [])) if (!frag.some((f) => joined.includes(f))) errs.push(`aucune suggestion ne contient l'un de : ${frag.join(' / ')}`);
  if (errs.length) fails.push(`✗ ${c.n}\n     état={model:${st.model}, repair:${st.repairLabel}, priceQuoted:${st.priceQuoted}, rdv:${st.rdvMentioned}}\n     ${sugg.map((s, i) => `(${i + 1}) ${s}`).join('\n     ')}\n     → ${errs.join(' | ')}`);
  else pass++;
}

console.log(`\nSAFIX — suggestions admin (slot-aware) : ${pass}/${cases.length} OK`);
if (fails.length) { console.log('\n' + fails.join('\n\n') + '\n'); process.exit(1); }
console.log('✓ Aucune redite : les suggestions ne redemandent jamais une info connue.\n');
