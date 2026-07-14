#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// Banc de test du moteur NLU de l'assistant SAFIX (botAnswer)
// ═══════════════════════════════════════════════════════════════════════
// Importe le MÊME moteur que la production (api/_bot-nlu.js) → zéro dérive :
// un cas qui passe ici passe en ligne. À relancer AVANT tout déploiement
// touchant l'assistant :  node bot/nlu-bench/run.mjs
//
// Chaque scénario : message (+ historique éventuel) → on vérifie
//   • human (true = un conseiller doit être proposé),
//   • inc  = fragments qui DOIVENT apparaître dans la réponse,
//   • exc  = fragments qui NE doivent PAS apparaître.
// Les prix sont des FIXTURES (indépendantes du catalogue réel) pour que le
// banc soit stable dans le temps.

import { botAnswer } from '../../api/_bot-nlu.js';

// ── Fixtures prix (structure identique à prices.json → prices[rid][modèle]) ──
const P = {
  ecran_eco:            { 'iPhone 13 Pro': { final: 89 }, 'iPhone 13': { final: 79 }, 'iPhone 12': { final: 69 }, 'iPhone 15': { final: 99 }, 'iPhone SE (2022)': { final: 49 } },
  ecran_standard:       { 'iPhone 13 Pro': { final: 119 }, 'iPhone 13': { final: 99 }, 'iPhone 12': { final: 89 }, 'iPhone 15': { final: 129 } },
  ecran_premium:        { 'iPhone 13 Pro': { final: 159 }, 'iPhone 13': { final: 139 } },
  ecran_original:       { 'iPhone 13 Pro': { final: 229 } },
  batterie:             { 'iPhone 13 Pro': { final: 59 }, 'iPhone 13': { final: 55 }, 'iPhone 12': { final: 49 }, 'iPhone 15': { final: 69 } },
  batterie_original:    { 'iPhone 13 Pro': { final: 89 } },
  connecteur_de_charge: { 'iPhone 12': { final: 59 }, 'iPhone 13 Pro': { final: 69 } },
  camera_arriere:       { 'iPhone 13 Pro': { final: 99 } },
  vitre_arriere:        { 'iPhone 12': { final: 129, outOfStock: true }, 'iPhone 13 Pro': { final: 149 } },
  haut_parleur:         { 'iPhone 13 Pro': { final: 45 } },
};

const U = (body) => ({ sender: 'user', body });
const A = (body) => ({ sender: 'admin', body });

// history = du PLUS RÉCENT au plus ancien (comme la prod : order desc).
const CASES = [
  // ── Compréhension directe (fautes, casse, modèle+réparation) ──
  { n: 'Faute + casse', msg: 'ecran cassé iphone 13 pro', human: false, inc: ['iPhone 13 Pro', '119 €'] },
  { n: 'Typo iphonne', msg: 'ecran iphonne 13', human: false, inc: ['iPhone 13', '99 €'] },
  { n: 'SMS cmb + faute baterie', msg: 'cmb pr une baterie iphone 12', human: false, inc: ['iPhone 12', '49 €'] },
  { n: 'Langage courant', msg: 'salut, mon iphone 15 a besoin d une batterie neuve', human: false, inc: ['iPhone 15', '69 €'] },
  { n: 'Multi-réparations', msg: 'ecran et batterie pour iphone 13', human: false, inc: ["L'écran", 'La batterie', '55 €'] },

  // ── Symptômes décrits (pas la pièce nommée) ──
  { n: 'Symptôme charge', msg: 'mon iphone 12 charge plus', human: false, inc: ['iPhone 12', '59 €'] },
  { n: 'Symptôme son', msg: 'plus de son sur mon iphone 13 pro', human: false, inc: ['iPhone 13 Pro', '45 €'] },
  { n: 'Symptôme tactile', msg: 'le tactile repond plus au doigt sur mon 13 pro', human: false, inc: ['iPhone 13 Pro'] },

  // ── Mémoire de dialogue / slot-filling ──
  { n: 'Slot-filling modèle après panne', hist: [U('mon ecran est casse')], msg: '13 pro', human: false, inc: ['iPhone 13 Pro', '119 €'] },
  { n: 'Slot-filling « le 15 »', hist: [A('Pour quel modèle ?'), U('batterie hs')], msg: 'le 15', human: false, inc: ['iPhone 15', '69 €'] },
  { n: 'Slot-filling « combien ? » seul', hist: [U('jai casse lecran de mon iphone 12')], msg: 'combien ?', human: false, inc: ['iPhone 12', '89 €'] },
  { n: 'Contexte : et pour la batterie ?', hist: [A('Écran iPhone 13 Pro : 119 €'), U('ecran 13 pro')], msg: 'et la batterie ?', human: false, inc: ['iPhone 13 Pro', '59 €'] },

  // ── Modèle seul / réparation seule ──
  { n: 'Modèle seul → liste dispo', msg: 'iphone 13 pro', human: false, inc: ['iPhone 13 Pro', 'dès'] },
  { n: 'Réparation seule → demande modèle', msg: 'je veux changer mon ecran', human: false, inc: ['modèle'] },
  { n: 'Prix sans modèle', msg: 'combien pour un ecran ?', human: false, inc: ['modèle'] },

  // ── Rupture de stock ──
  { n: 'Rupture → conseiller', msg: 'vitre arriere iphone 12', human: true, inc: ['rupture'] },

  // ── Hors périmètre → réponses cadrées ──
  { n: 'Autre marque', msg: 'reparation samsung galaxy s23', human: false, inc: ['iPhone'], exc: ['Samsung', 'samsung'] },
  { n: 'iPad', msg: 'vous reparez les ipad ?', human: false, inc: ['iPhone'] },
  { n: 'Vente de téléphone', msg: 'vous vendez des iphones reconditionnes ?', human: false, inc: ['ne proposons pas'] },

  // ── Escalade légitime (cas exceptionnels) ──
  { n: 'Dégât liquide → humain', msg: 'mon iphone est tombe dans l eau', human: true, inc: ['diagnostic'] },
  { n: 'Face ID → humain', msg: 'probleme de face id', human: true, inc: ['conseiller'] },
  { n: 'Demande conseiller', msg: 'je veux parler a une vraie personne', human: true, inc: ['conseiller'] },
  { n: 'Frustration', msg: 'c est une honte, une arnaque !', human: true, inc: ['désolé'] },
  { n: 'Suivi commande', msg: 'ou en est ma commande ?', human: true, inc: ['conseiller'] },
  { n: 'Annulation RDV', msg: 'je veux annuler mon rendez vous', human: true, inc: ['conseiller'] },
  { n: 'Report RDV (littéral) reste escaladé', msg: 'je voudrais reporter mon rendez vous', human: true, inc: ['conseiller'] },
  { n: 'RÉPARER ≠ reporter (pas d’escalade)', msg: 'je veux reparer mon iphone 13 pro', human: false, exc: ['annuler'] },
  { n: 'Données perso', msg: 'je dois sauvegarder mes photos avant ?', human: true, inc: ['données'] },

  // ── FAQ vérifiée ──
  { n: 'Garantie', msg: 'vous offrez une garantie ?', human: false, inc: ['garantie'] },
  { n: 'Adresse', msg: 'vous etes ou exactement ?', human: false, inc: ['Dunkerque'] },
  { n: 'Horaires', msg: 'vous ouvrez a quelle heure ?', human: false, inc: ['rendez-vous'] },
  { n: 'Délai', msg: 'c est rapide ? ca prend combien de temps ?', human: false, inc: ['48'] },
  { n: 'Paiement moyens', msg: 'je paye comment ?', human: false, inc: ['PayPal'] },
  { n: 'Quand payer', msg: 'je paye avant ou apres le depot ?', human: false, inc: ['au moment de la commande'] },
  { n: 'Devis', msg: 'je voudrais un devis', human: false, inc: ['devis'] },
  { n: 'Pièces d’origine', msg: 'vos pieces sont d origine ?', human: false, inc: ['Original'] },
  { n: 'Zone / déplacement', msg: 'vous vous deplacez a lille ?', human: false, inc: ['Dunkerque'] },
  { n: 'Comment ça marche', msg: 'comment ca marche chez vous ?', human: false, inc: ['payez en ligne'] },
  { n: 'Prendre RDV', msg: 'comment prendre rendez vous ?', human: false, inc: ['panier'] },
  { n: 'Contact / appel', msg: 'je peux vous appeler ?', human: false, inc: ['support@safix59.fr'] },
  { n: 'Modèles couverts', msg: 'vous reparez quels modeles ?', human: false, inc: ['modèles'] },
  { n: 'Gammes écran', msg: 'quelle est la difference entre les gammes ?', human: false, inc: ['Premium', 'Original'] },

  // ── Politesse / micro-réponses ──
  { n: 'Bonjour seul', msg: 'bonjour', human: false, inc: ['Bonjour'] },
  { n: 'Merci', msg: 'merci beaucoup !', human: false, inc: ['plaisir'] },
  { n: 'Assentiment ok', msg: 'ok', human: false, inc: ['commander'] },
  { n: 'Refus poli', msg: 'non merci', human: false, inc: ['disponible'] },
  { n: 'Au revoir', msg: 'au revoir et bonne journee', human: false, inc: ['bientôt'] },

  // ── Ambigu → UNE question utile (pas d'abandon) ──
  { n: 'Panne vague', msg: 'jai un souci avec mon tel', human: false, inc: ['modèle'] },

  // ── Formulations naturelles variées (robustesse) ──
  { n: 'Changement d’écran formulé', msg: 'combien coute le changement d ecran de mon iphone 12', human: false, inc: ['iPhone 12', '89 €'] },
  { n: 'Réparer batterie (verbe réparer)', msg: 'jaimerai reparer la batterie de mon 15', human: false, inc: ['iPhone 15', '69 €'] },
  { n: 'Prix écran iPhone 15', msg: 'prix ecran iphone 15', human: false, inc: ['129 €'] },
  { n: 'Réparation sans modèle → demande modèle', msg: 'vous faites les vitres arrieres ?', human: false, inc: ['modèle'] },
  { n: 'Ne s’allume plus + modèle', msg: 'mon iphone 13 pro ne s allume plus', human: false, inc: ['iPhone 13 Pro'] },

  // ── Garde-fous des ajouts FAQ (« origine » ne doit pas avaler un prix) ──
  { n: 'Écran ORIGINAL + modèle → prix (pas gammes)', msg: 'ecran original pour iphone 13 pro', human: false, inc: ['229 €'] },
  { n: 'Salutation + demande → prix, pas juste bonjour', msg: 'bonjour, je voudrais reparer l ecran de mon iphone 13 pro', human: false, inc: ['119 €'] },
];

let pass = 0;
const fails = [];
for (const c of CASES) {
  let res;
  try { res = botAnswer(c.msg, c.hist || [], P); }
  catch (e) { fails.push(`${c.n} → EXCEPTION ${e.message}`); continue; }
  const reply = String(res && res.reply || '');
  const errs = [];
  if (!reply.trim()) errs.push('réponse vide');
  if (typeof c.human === 'boolean' && !!res.human !== c.human) errs.push(`human=${!!res.human} attendu ${c.human}`);
  for (const frag of (c.inc || [])) if (!reply.includes(frag)) errs.push(`manque « ${frag} »`);
  for (const frag of (c.exc || [])) if (reply.includes(frag)) errs.push(`ne doit PAS contenir « ${frag} »`);
  if (errs.length) fails.push(`✗ ${c.n}\n    msg: « ${c.msg} »\n    → « ${reply} »\n    ${errs.join(' | ')}`);
  else pass++;
}

const total = CASES.length;
console.log(`\nSAFIX NLU bench — ${pass}/${total} OK`);
if (fails.length) {
  console.log(`\n${fails.length} échec(s) :\n`);
  console.log(fails.join('\n\n'));
  process.exit(1);
}
console.log('✓ Tous les scénarios passent.\n');
