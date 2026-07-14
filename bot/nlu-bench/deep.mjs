#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// Banc de test PROFOND & ADVERSARIAL du moteur NLU SAFIX (botAnswer)
// ═══════════════════════════════════════════════════════════════════════
// ~200 scénarios conçus pour METTRE L'ASSISTANT EN DIFFICULTÉ : fautes lourdes,
// SMS, formulations naturelles, incomplet, ambigu, hors-sujet, changement de
// contexte multi-tours, multi-demandes, méta. Importe le MÊME moteur que la
// prod (api/_bot-nlu.js) → un cas qui passe ici passe en ligne.
//   node bot/nlu-bench/deep.mjs
//
// Critères (rule engine, sans clé IA) : comprendre la grande majorité des
// demandes ; pour ce qu'il ne peut pas résoudre, poser UNE question utile ou
// escalader — JAMAIS inventer, JAMAIS répondre au hasard.

import { botAnswer } from '../../api/_bot-nlu.js';

// ── Catalogue synthétique large (tous modèles × toutes réparations) ──
const MODELS = ['iPhone 11', 'iPhone 11 Pro', 'iPhone 12', 'iPhone 12 mini', 'iPhone 12 Pro',
  'iPhone 12 Pro Max', 'iPhone 13', 'iPhone 13 mini', 'iPhone 13 Pro', 'iPhone 13 Pro Max',
  'iPhone 14', 'iPhone 14 Plus', 'iPhone 15', 'iPhone 15 Pro Max', 'iPhone SE (2022)', 'iPhone XR', 'iPhone XS'];
function tbl(base, step = 10, oos = null) {
  const o = {};
  MODELS.forEach((m, i) => { o[m] = { final: base + i * step }; });
  if (oos && o[oos]) o[oos].outOfStock = true;
  return o;
}
const P = {
  ecran_eco: tbl(40), ecran_standard: tbl(80), ecran_premium: tbl(120), ecran_original: tbl(200),
  batterie: tbl(45, 5), batterie_original: tbl(75, 5),
  connecteur_de_charge: tbl(50, 3),
  camera_arriere: tbl(85, 4), camera_avant: tbl(60, 3), lentille_camera_arriere: tbl(35, 2),
  vitre_arriere: tbl(110, 6, 'iPhone 12'),
  haut_parleur: tbl(40, 2), ecouteur_interne: tbl(38, 2), micro: tbl(38, 2), vibreur: tbl(35, 2),
  verre_trempe_classique: tbl(15, 1), verre_trempe_anti_espion: tbl(25, 1),
  bouton_power: tbl(45, 2), bouton_volume: tbl(46, 2),
};

const U = (body) => ({ sender: 'user', body });
const A = (body) => ({ sender: 'admin', body });
const euroRe = /\d+\s*€/;

// tag : catégorie (info) ; human/inc/exc/euro/ask = attentes.
const C = [
  // ══ 1. Demandes directes (réparation + modèle), formulations variées ══
  ['direct', { msg: 'ecran iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['direct', { msg: 'combien pour changer l ecran de mon iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['direct', { msg: 'je voudrais reparer la batterie de mon iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['direct', { msg: 'prix batterie iphone 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['direct', { msg: 'remplacement vitre arriere iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['direct', { msg: 'ma camera arriere iphone 14 est cassee', human: false, euro: true, inc: ['iPhone 14'] }],
  ['direct', { msg: 'connecteur de charge iphone 12 pro', human: false, euro: true, inc: ['iPhone 12 Pro'] }],
  ['direct', { msg: 'changer le haut parleur de mon 13 pro max', human: false, euro: true, inc: ['iPhone 13 Pro Max'] }],
  ['direct', { msg: 'micro iphone se 2022', human: false, euro: true, inc: ['iPhone SE (2022)'] }],
  ['direct', { msg: 'reparation ecran iphone xr', human: false, euro: true, inc: ['iPhone XR'] }],
  ['direct', { msg: 'je veux un verre trempe pour mon iphone 15 pro max', human: false, euro: true, inc: ['iPhone 15 Pro Max'] }],
  ['direct', { msg: 'bouton power iphone 13', human: false, euro: true, inc: ['iPhone 13'] }],
  ['direct', { msg: 'vibreur iphone 14', human: false, euro: true, inc: ['iPhone 14'] }],
  ['direct', { msg: 'caméra avant iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['direct', { msg: 'lentille camera iphone 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['direct', { msg: 'combien coute une batterie originale pour iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['direct', { msg: 'ecouteur interne iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],

  // ══ 2. Fautes d'orthographe / de frappe lourdes ══
  ['typo', { msg: 'ecrn iphon 13 pro casse', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['typo', { msg: 'baterie iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['typo', { msg: 'conecteur de charge iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['typo', { msg: 'ecran iphonne 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['typo', { msg: 'camra ariere iphone 14', human: false, euro: true, inc: ['iPhone 14'] }],
  ['typo', { msg: 'vibreure iphone 13', human: false, euro: true, inc: ['iPhone 13'] }],
  ['typo', { msg: 'micr iphone se', human: false, euro: true }],
  ['typo', { msg: 'aparei photo iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['typo', { msg: 'ecran ifone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['typo', { msg: 'batteri qui tien pas iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['typo', { msg: 'hautparleur iphone 14', human: false, euro: true, inc: ['iPhone 14'] }],
  ['typo', { msg: 'ecran cace iphone 13', human: false, euro: true, inc: ['iPhone 13'] }],

  // ══ 3. SMS / abréviations / langage familier ══
  ['sms', { msg: 'cmb pr un ecran iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['sms', { msg: 'cc jai casse mon tel ecran iphone 13', human: false, euro: true, inc: ['iPhone 13'] }],
  ['sms', { msg: 'slt combien batterie 15 pro max', human: false, euro: true, inc: ['iPhone 15 Pro Max'] }],
  ['sms', { msg: 'bjr prix ecran iphone 11 svp', human: false, euro: true, inc: ['iPhone 11'] }],
  ['sms', { msg: 'mon tel charge plus iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['sms', { msg: 'kc lecran de mon 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 4. Symptômes décrits (pas la pièce nommée) ══
  ['symptome', { msg: 'mon iphone 12 se decharge super vite', human: false, euro: true, inc: ['iPhone 12'] }],
  ['symptome', { msg: 'mon iphone 13 pro charge plus du tout', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['symptome', { msg: 'plus de son sur mon iphone 14', human: false, euro: true, inc: ['iPhone 14'] }],
  ['symptome', { msg: 'on m entend pas quand j appelle iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['symptome', { msg: 'le tactile repond plus iphone 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['symptome', { msg: 'mes photos sont floues iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['symptome', { msg: 'des lignes vertes sur l ecran de mon iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['symptome', { msg: 'ma batterie gonfle iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['symptome', { msg: 'mon iphone 13 vibre plus', human: false, euro: true, inc: ['iPhone 13'] }],
  ['symptome', { msg: 'ecran qui clignote iphone 14', human: false, euro: true, inc: ['iPhone 14'] }],

  // ══ 5. Mémoire de dialogue / slot-filling / changement de contexte ══
  ['contexte', { hist: [U('mon ecran est casse')], msg: 'iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['contexte', { hist: [A('Pour quel modèle ?'), U('la batterie est morte')], msg: 'un 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['contexte', { hist: [U('jai casse lecran de mon iphone 15')], msg: 'combien ?', human: false, euro: true, inc: ['iPhone 15'] }],
  ['contexte', { hist: [A('Écran iPhone 13 Pro dispo'), U('ecran iphone 13 pro')], msg: 'et la batterie ?', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['contexte-switch', { hist: [A('Écran iPhone 13 Pro : ...'), U('ecran 13 pro')], msg: 'et pour le 12 ?', human: false, euro: true, inc: ['iPhone 12'] }],
  ['contexte', { hist: [A('Vous parlez de quel iPhone ?'), U('mon telephone charge mal')], msg: 'le 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['contexte', { hist: [U('bonjour'), A('Bonjour 👋'), U('jai un iphone 14')], msg: 'lecran est fissure', human: false, euro: true, inc: ['iPhone 14'] }],
  ['contexte', { hist: [U('ecran 13 pro combien'), A('Écran iPhone 13 Pro : ...')], msg: 'et en original ?', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 6. Multi-demandes dans un seul message ══
  ['multi', { msg: 'ecran et batterie pour iphone 13 pro', human: false, inc: ["L'écran", 'La batterie'] }],
  ['multi', { msg: 'combien pour l ecran et la vitre arriere de mon 13 pro', human: false, inc: ["L'écran", 'vitre arrière'] }],
  ['multi', { msg: 'prix ecran iphone 15 et delai de livraison', human: false, euro: true, inc: ['iPhone 15', 'Standard'] }],
  ['multi', { msg: 'batterie iphone 12 c est combien et ca prend combien de temps', human: false, euro: true, inc: ['iPhone 12'] }],

  // ══ 7. Ambigu / incomplet → UNE question utile (pas d'abandon) ══
  ['ambigu', { msg: 'jai un souci avec mon telephone', human: false, inc: ['modèle'], ask: true }],
  ['ambigu', { msg: 'mon iphone marche plus', human: false, ask: true }],
  ['ambigu', { msg: 'bonjour jai un probleme', human: false, ask: true }],
  ['ambigu', { msg: 'iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['ambigu', { msg: 'combien ca coute ?', human: false, inc: ['modèle'] }],
  ['ambigu', { msg: 'je veux reparer mon iphone', human: false, inc: ['modèle'] }],
  ['ambigu', { msg: 'mon ecran', human: false, inc: ['modèle'], ask: true }],
  ['ambigu', { msg: 'ca urge', human: true }],

  // ══ 8. Hors-sujet / méta / small-talk ══
  ['meta', { msg: 'tu es un robot ?', human: false, inc: ['assistant'] }],
  ['meta', { msg: 'est ce que tu es une vraie personne ?', human: false, inc: ['assistant'] }],
  ['meta', { msg: 'c est un humain qui me parle ?', human: false, inc: ['assistant'] }],
  ['meta', { msg: 'es tu une ia ?', human: false, inc: ['assistant'] }],
  ['smalltalk', { msg: 'ca va ?', human: false, inc: ['SAFIX'] }],
  ['smalltalk', { msg: 'coucou comment vas tu', human: false }],
  ['hors-sujet', { msg: 'raconte moi une blague', human: false, inc: ['iPhone'] }],
  ['hors-sujet', { msg: 'quelle est la meteo demain ?', human: false, inc: ['iPhone'] }],
  ['hors-sujet', { msg: 'tu connais une bonne recette de pizza ?', human: false, inc: ['iPhone'] }],
  ['hors-sujet', { msg: 'qui va gagner le match de foot', human: false, inc: ['iPhone'] }],
  ['demande-conseiller', { msg: 'je veux parler a une vraie personne', human: true, inc: ['conseiller'] }],
  ['demande-conseiller', { msg: 'passez moi un humain svp', human: true, inc: ['conseiller'] }],

  // ══ 9. FAQ métier ══
  ['faq', { msg: 'vous etes ou ?', human: false, inc: ['Dunkerque'] }],
  ['faq', { msg: 'c est quoi votre adresse', human: false, inc: ['Dunkerque'] }],
  ['faq', { msg: 'vous ouvrez quand ?', human: false, inc: ['rendez-vous'] }],
  ['faq', { msg: 'ca prend combien de temps la livraison', human: false, inc: ['48'] }],
  ['faq', { msg: 'comment je paye ?', human: false, inc: ['PayPal'] }],
  ['faq', { msg: 'je paye avant ou apres avoir depose le tel ?', human: false, inc: ['au moment de la commande'] }],
  ['faq', { msg: 'vous faites un devis ?', human: false, inc: ['devis'] }],
  ['faq', { msg: 'vos ecrans sont d origine ?', human: false, inc: ['Original'] }],
  ['faq', { msg: 'quelle difference entre eco et premium', human: false, inc: ['Premium'] }],
  ['faq', { msg: 'vous vous deplacez a domicile ?', human: false, inc: ['Dunkerque'] }],
  ['faq', { msg: 'comment ca marche pour commander', human: false, inc: ['payez en ligne'] }],
  ['faq', { msg: 'comment prendre un rendez vous', human: false, inc: ['panier'] }],
  ['faq', { msg: 'je peux vous telephoner ?', human: false, inc: ['support@safix59.fr'] }],
  ['faq', { msg: 'vous reparez quels iphone ?', human: false, inc: ['modèles'] }],
  ['faq', { msg: 'vous avez une garantie sur les reparations ?', human: false, inc: ['garantie'] }],
  ['faq', { msg: 'vos horaires svp', human: false, inc: ['créneaux'] }],
  ['faq', { msg: 'quels sont vos moyens de paiement', human: false, inc: ['carte'] }],
  ['faq', { msg: 'vous reparez a lille ?', human: false, inc: ['Dunkerque'] }],

  // ══ 10. Escalade légitime (cas exceptionnels) ══
  ['escalade', { msg: 'mon iphone est tombe dans l eau', human: true, inc: ['diagnostic'] }],
  ['escalade', { msg: 'je crois quil a pris l humidite', human: true, inc: ['diagnostic'] }],
  ['escalade', { msg: 'probleme de face id', human: true }],
  ['escalade', { msg: 'mon telephone chauffe enormement', human: true, inc: ['diagnostic'] }],
  ['escalade', { msg: 'mon iphone est bloque sur la pomme', human: true }],
  ['escalade', { msg: 'plus de wifi sur mon iphone 13', human: true, inc: ['Wi-Fi'] }],
  ['escalade', { msg: 'ma carte sim est pas reconnue', human: true }],
  ['escalade', { msg: 'ou en est ma commande', human: true, inc: ['conseiller'] }],
  ['escalade', { msg: 'je veux annuler mon rendez vous', human: true, inc: ['conseiller'] }],
  ['escalade', { msg: 'je veux etre rembourse c est un scandale', human: true, inc: ['désolé'] }],
  ['escalade', { msg: 'comment sauvegarder mes photos avant le depot', human: true }],
  ['escalade', { msg: 'je peux payer en plusieurs fois ?', human: true }],

  // ══ 11. Hors périmètre marque/appareil/vente ══
  ['hors-perimetre', { msg: 'vous reparez les samsung ?', human: false, inc: ['iPhone'], exc: ['samsung', 'Samsung'] }],
  ['hors-perimetre', { msg: 'ecran ipad pro', human: false, inc: ['iPhone'] }],
  ['hors-perimetre', { msg: 'reparation macbook', human: false, inc: ['iPhone'] }],
  ['hors-perimetre', { msg: 'vous vendez des iphone reconditionnes ?', human: false, inc: ['ne proposons pas'] }],
  ['hors-perimetre', { msg: 'je peux acheter un iphone chez vous ?', human: false, inc: ['ne proposons pas'] }],
  ['hors-perimetre', { msg: 'reparation apple watch', human: false, inc: ['iPhone'] }],

  // ══ 12. Politesse ══
  ['politesse', { msg: 'bonjour', human: false, inc: ['Bonjour'] }],
  ['politesse', { msg: 'merci beaucoup', human: false, inc: ['plaisir'] }],
  ['politesse', { msg: 'ok', human: false }],
  ['politesse', { msg: 'non merci', human: false }],
  ['politesse', { msg: 'au revoir', human: false, inc: ['bientôt'] }],
  ['politesse', { msg: 'super merci', human: false, inc: ['plaisir'] }],

  // ══ 13. Rupture de stock ══
  ['rupture', { msg: 'vitre arriere iphone 12', human: true, inc: ['rupture'] }],

  // ══ 14. Formulations naturelles longues ══
  ['naturel', { msg: 'bonjour alors voila hier soir mon telephone est tombe et depuis lecran de mon iphone 13 pro est tout casse avec des traits partout, vous pourriez me dire combien ca coute pour le reparer svp ?', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['naturel', { msg: 'salut, ma copine a un iphone 11 et la batterie tient vraiment plus la journee, ce serait combien pour la changer ?', human: false, euro: true, inc: ['iPhone 11'] }],
  ['naturel', { msg: 'je sais pas trop ce qui se passe mais mon 14 se recharge plus quand je branche le cable', human: false, euro: true, inc: ['iPhone 14'] }],
  ['naturel', { msg: 'coucou est ce que vous pourriez reparer l appareil photo arriere de mon iphone 15 pro max qui est tout flou ?', human: false, euro: true, inc: ['iPhone 15 Pro Max'] }],
  ['naturel', { msg: 'en anglais: how much for a screen on iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 15. Adversarial / dégénéré ══
  ['adversarial', { msg: '', human: true }],
  ['adversarial', { msg: '???', human: true }],
  ['adversarial', { msg: 'azerty qwerty zzz', human: true }],
  ['adversarial', { msg: 'jkhgfdsqmlkj', human: true }],
  ['adversarial', { msg: '12345', human: true }],
  ['adversarial', { msg: 'iphone', human: false, inc: ['modèle'] }],
  ['adversarial', { msg: 'reparation', human: false, inc: ['modèle'] }],
  ['adversarial', { msg: 'aaaaaaaaaaaaaaa', human: true }],

  // ══ 16. Variantes de modèles (mini, Plus, Pro Max, XR/XS, 11 Pro) ══
  ['variante', { msg: 'ecran iphone 12 mini', human: false, euro: true, inc: ['iPhone 12 mini'] }],
  ['variante', { msg: 'batterie iphone 13 mini', human: false, euro: true, inc: ['iPhone 13 mini'] }],
  ['variante', { msg: 'ecran iphone 14 plus', human: false, euro: true, inc: ['iPhone 14 Plus'] }],
  ['variante', { msg: 'vitre arriere iphone 12 pro max', human: false, euro: true, inc: ['iPhone 12 Pro Max'] }],
  ['variante', { msg: 'batterie iphone 11 pro', human: false, euro: true, inc: ['iPhone 11 Pro'] }],
  ['variante', { msg: 'ecran iphone xr', human: false, euro: true, inc: ['iPhone XR'] }],
  ['variante', { msg: 'ecran iphone xs', human: false, euro: true, inc: ['iPhone XS'] }],
  ['variante', { msg: 'combien pour un ecran sur le 15 pro max', human: false, euro: true, inc: ['iPhone 15 Pro Max'] }],
  ['variante', { msg: 'jai un 12 mini lecran est casse', human: false, euro: true, inc: ['iPhone 12 mini'] }],

  // ══ 17. Garde-fous anti-collision (mots français proches de mots-clés) ══
  ['collision', { msg: 'quelle est votre adresse exacte', human: false, inc: ['Dunkerque'], exc: ['€'] }],
  ['collision', { msg: 'avez vous un autre point de depot', human: false, exc: ['€'] }],
  ['collision', { msg: 'je vous remercie pour votre aide', human: false, inc: ['plaisir'], exc: ['€'] }],
  ['collision', { msg: 'pourriez vous me donner vos horaires', human: false, inc: ['créneaux'], exc: ['€'] }],
  ['collision', { msg: 'quel est le titre de votre boutique', exc: ['€'] }],
  ['collision', { msg: 'vous etes les meilleurs bravo', human: false, exc: ['€'] }],
  ['collision', { msg: 'je passe vous voir demain matin', exc: ['€'] }],

  // ══ 18. Gammes précises (Éco / Premium / Original) ══
  ['gamme', { msg: 'ecran original iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['gamme', { msg: 'combien pour un ecran eco iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['gamme', { msg: 'ecran premium ou original pour iphone 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['gamme', { msg: 'batterie originale iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 19. Négations / nuances ══
  ['nuance', { msg: 'je veux pas reparer juste connaitre le prix ecran iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['nuance', { msg: 'ce nest pas pour moi mais pour ma fille ecran iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['nuance', { msg: 'finalement pas la batterie plutot lecran de mon 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 20. Conversations multi-tours (3 échanges) ══
  ['multitour', { hist: [A('D\'accord, quel modèle ?'), U('mon ecran est casse'), A('Bonjour 👋'), U('bonjour')], msg: 'cest un iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['multitour', { hist: [A('Écran iPhone 12 : ...'), U('12'), A('Quel modèle ?'), U('lecran est casse')], msg: 'et la batterie du coup ?', human: false, euro: true, inc: ['iPhone 12'] }],
  ['multitour', { hist: [A('Batterie iPhone 11 : ...'), U('batterie 11'), A('Bonjour'), U('bonjour')], msg: 'et le prix de lecran ?', human: false, euro: true, inc: ['iPhone 11'] }],

  // ══ 21. Entrées très courtes ══
  ['court', { msg: 'ecran 13', human: false, euro: true, inc: ['iPhone 13'] }],
  ['court', { msg: 'batterie 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['court', { msg: 'prix', human: false, inc: ['modèle'] }],
  ['court', { msg: 'ecran', human: false, inc: ['modèle'] }],
  ['court', { msg: '13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 22. Politesse + demande combinées ══
  ['combo', { msg: 'bonjour je voudrais le prix dun ecran pour iphone 14 sil vous plait', human: false, euro: true, inc: ['iPhone 14'] }],
  ['combo', { msg: 'salut ca va ? jaimerais changer ma batterie iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['combo', { msg: 'merci davance pouvez vous mindiquer le prix ecran iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],

  // ══ 23. Anglais / mixte ══
  ['anglais', { msg: 'how much for a battery iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['anglais', { msg: 'screen replacement iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['anglais', { msg: 'my iphone 11 screen is broken price ?', human: false, euro: true, inc: ['iPhone 11'] }],

  // ══ 24. Escalade / hors-catalogue supplémentaires ══
  ['escalade2', { msg: 'mon iphone a pris un choc et fait des redemarrages', human: true }],
  ['escalade2', { msg: 'plus de bluetooth sur mon 13', human: true }],
  ['escalade2', { msg: 'mon telephone chauffe des que je lutilise', human: true, inc: ['diagnostic'] }],
  ['escalade2', { msg: 'il reste bloque sur le logo apple', human: true }],
  ['escalade2', { msg: 'ma commande est en retard c est inadmissible', human: true }],

  // ══ 25. Rupture + alternative ══
  ['rupture2', { msg: 'vitre arriere iphone 12 dispo ?', human: true, inc: ['rupture'] }],

  // ══ 26. Bruit : MAJUSCULES, ponctuation, emojis ══
  ['bruit', { msg: 'ECRAN IPHONE 13 PRO', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['bruit', { msg: 'ecran!!! iphone 13 pro ???', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['bruit', { msg: 'mon ecran est casse 😭 iphone 14', human: false, euro: true, inc: ['iPhone 14'] }],
  ['bruit', { msg: 'batterie......iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['bruit', { msg: 'CoMbIeN pOuR uN eCrAn IpHoNe 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['bruit', { msg: 'ecran   iphone   13   pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 27. Persistance mémoire (réparation change, modèle conservé) ══
  ['memoire', { hist: [A('Écran iPhone 13 Pro : ...'), U('ecran 13 pro')], msg: 'et la vitre arriere ?', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['memoire', { hist: [A('Batterie iPhone 15 : ...'), U('batterie iphone 15')], msg: 'et lecran ?', human: false, euro: true, inc: ['iPhone 15'] }],
  ['memoire', { hist: [A('Quel souci ?'), U('iphone 12')], msg: 'la batterie coute combien', human: false, euro: true, inc: ['iPhone 12'] }],
  ['memoire', { hist: [A('Écran iPhone 11 : ...'), U('ecran iphone 11')], msg: 'et le connecteur de charge ?', human: false, euro: true, inc: ['iPhone 11'] }],
  ['memoire', { hist: [A('Réponse'), U('mon 14 plus a lecran casse')], msg: 'combien du coup', human: false, euro: true, inc: ['iPhone 14 Plus'] }],

  // ══ 28. Modèle seul (première phrase, sans « iphone ») ══
  ['modele-seul', { msg: 'iphone 13', human: false, euro: true, inc: ['iPhone 13'] }],
  ['modele-seul', { msg: '15 pro max', human: false, euro: true, inc: ['iPhone 15 Pro Max'] }],
  ['modele-seul', { msg: 'un iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['modele-seul', { msg: '12 mini', human: false, euro: true, inc: ['iPhone 12 mini'] }],

  // ══ 29. Appareils/marques non supportés ══
  ['non-supporte', { msg: 'reparer mes airpods', human: false, inc: ['iPhone'] }],
  ['non-supporte', { msg: 'ecran apple watch', human: false, inc: ['iPhone'] }],
  ['non-supporte', { msg: 'batterie ipad air', human: false, inc: ['iPhone'] }],
  ['non-supporte', { msg: 'mon pixel 8 a lecran casse', human: false, inc: ['iPhone'] }],

  // ══ 30. Garde-fous collisions (mots proches de micro/vibreur/bouton…) ══
  ['collision2', { msg: 'je veux vous mettre une bonne note', exc: ['€'] }],
  ['collision2', { msg: 'votre boutique est ouverte le dimanche ?', human: false, inc: ['créneaux'], exc: ['€'] }],
  ['collision2', { msg: 'quel est votre objectif de delai', exc: ['€'] }],
  ['collision2', { msg: 'je cherche une bonne adresse a dunkerque', human: false, inc: ['Dunkerque'] }],
  ['collision2', { msg: 'bonjour tout le monde', human: false, inc: ['Bonjour'] }],

  // ══ 31. Comparaisons / multi-modèles ══
  ['comparaison', { msg: 'difference de prix ecran entre 13 et 14', human: false }],
  ['comparaison', { msg: 'cest moins cher ecran 12 ou 13 ?', human: false, euro: true }],
  ['comparaison', { msg: '2 ecrans pour iphone 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],

  // ══ 32. Formulations indirectes / polies ══
  ['indirect', { msg: 'serait il possible de connaitre le tarif dun ecran pour iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],
  ['indirect', { msg: 'jaurais aime savoir combien coute une batterie 13 pro', human: false, euro: true, inc: ['iPhone 13 Pro'] }],
  ['indirect', { msg: 'auriez vous le prix pour remplacer lecran dun 15', human: false, euro: true, inc: ['iPhone 15'] }],
  ['indirect', { msg: 'je me demandais si vous changiez les batteries diphone 12', human: false, euro: true, inc: ['iPhone 12'] }],

  // ══ 33. Deux réparations, deux modèles ══
  ['double', { msg: 'ecran iphone 13 et batterie iphone 12', human: false, euro: true }],

  // ══ 34. Symptômes indirects supplémentaires ══
  ['symptome2', { msg: 'mon 14 sallume mais rien saffiche', human: false }],
  ['symptome2', { msg: 'le son est tout etouffe sur mon iphone 13', human: false, euro: true, inc: ['iPhone 13'] }],
  ['symptome2', { msg: 'ma camera avant est toute noire iphone 12', human: false, euro: true, inc: ['iPhone 12'] }],
  ['symptome2', { msg: 'le bouton du haut marche plus iphone 11', human: false, euro: true, inc: ['iPhone 11'] }],

  // ══ 35. Robustesse : messages vides de sens mais polis ══
  ['divers', { msg: 'bonjour bonsoir', human: false, inc: ['Bonjour'] }],
  ['divers', { msg: 'sil vous plait', human: true }],
  ['divers', { msg: 'daccord merci beaucoup a vous', human: false, inc: ['plaisir'] }],
  ['divers', { msg: 'ok super je vais commander alors', human: false }],

  // ══ 36. Fuzz anti-collision : phrases FR banales → JAMAIS de prix inventé ══
  ['fuzz', { msg: 'je suis tres content de votre travail', exc: ['€'] }],
  ['fuzz', { msg: 'quelle est la meilleure solution selon vous', exc: ['€'] }],
  ['fuzz', { msg: 'pouvez vous patienter un instant', exc: ['€'] }],
  ['fuzz', { msg: 'je reviens vers vous plus tard', exc: ['€'] }],
  ['fuzz', { msg: 'cette offre me convient tout a fait', exc: ['€'] }],
  ['fuzz', { msg: 'autre chose a signaler de votre cote', exc: ['€'] }],
  ['fuzz', { msg: 'quatre personnes attendent dehors', exc: ['€'] }],
  ['fuzz', { msg: 'jai pris note de tout ca', exc: ['€'] }],
  ['fuzz', { msg: 'toute la journee jai essaye', exc: ['€'] }],
  ['fuzz', { msg: 'la route etait longue jusqua dunkerque', exc: ['€'] }],
  ['fuzz', { msg: 'notre entretien sest bien passe', exc: ['€'] }],
  ['fuzz', { msg: 'je vous fais entiere confiance', exc: ['€'] }],
  ['fuzz', { msg: 'cest entre nous que ca se joue', exc: ['€'] }],
  ['fuzz', { msg: 'le titre de la chanson mechappe', exc: ['€'] }],
  ['fuzz', { msg: 'vous faites du bon travail vraiment', exc: ['€'] }],
  ['fuzz', { msg: 'il faut que je reflechisse encore un peu', exc: ['€'] }],
  ['fuzz', { msg: 'mille mercis pour votre patience', human: false, inc: ['plaisir'], exc: ['€'] }],
  ['fuzz', { msg: 'peut etre une autre fois merci', exc: ['€'] }],
  ['fuzz', { msg: 'je nai pas encore decide', exc: ['€'] }],
  ['fuzz', { msg: 'bonne continuation a vous', exc: ['€'] }],
];

let pass = 0;
const fails = [];
for (const [tag, c] of C) {
  let res;
  try { res = botAnswer(c.msg, c.hist || [], P); }
  catch (e) { fails.push(`[${tag}] EXCEPTION sur « ${c.msg} » : ${e.message}`); continue; }
  const reply = String(res && res.reply || '');
  const errs = [];
  if (!reply.trim()) errs.push('réponse vide');
  if (typeof c.human === 'boolean' && !!res.human !== c.human) errs.push(`human=${!!res.human} (attendu ${c.human})`);
  if (c.euro && !euroRe.test(reply)) errs.push('aucun prix (€) alors qu\'un prix était attendu');
  if (c.ask && !reply.includes('?')) errs.push('devrait poser une question (?)');
  for (const frag of (c.inc || [])) if (!reply.includes(frag)) errs.push(`manque « ${frag} »`);
  for (const frag of (c.exc || [])) if (reply.includes(frag)) errs.push(`ne doit PAS contenir « ${frag} »`);
  if (errs.length) fails.push(`✗ [${tag}] « ${c.msg || '(vide)'} »\n     → « ${reply} »\n     ${errs.join(' | ')}`);
  else pass++;
}

console.log(`\nSAFIX NLU — banc PROFOND : ${pass}/${C.length} OK`);
if (fails.length) {
  console.log(`\n${fails.length} échec(s) :\n\n${fails.join('\n\n')}\n`);
  process.exit(1);
}
console.log('✓ Tous les scénarios adversariaux passent.\n');
