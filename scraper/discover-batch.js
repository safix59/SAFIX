// Découverte multi-catégories à partir des résultats de recherche Utopya.
//
// Pour chaque catégorie :
//   1. on charge la page de recherche connecté ;
//   2. on extrait toutes les URLs produit (avec leur titre) ;
//   3. on filtre selon les RÈGLES de la catégorie (qualité, exclusion Alcalian, etc.) ;
//   4. on identifie le modèle iPhone correspondant via les regex existantes ;
//   5. on enregistre les liens avec repair_id + priorité.
//
// Usage : node discover-batch.js              (toutes les catégories)
//         node discover-batch.js ecran        (une catégorie)
//
import { chromium } from "playwright";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

const LINKS_FILE = path.resolve("./links.json");

// ─────────────────────────────────────────────────────────────────────────────
// Modèles iPhone — table de matching titre/URL → nom canonique
// ─────────────────────────────────────────────────────────────────────────────
const MODELS = [
  { re: /iphone[\s-]?17e\b/i, name: "iPhone 17e" },
  { re: /iphone[\s-]?17[\s-]?pro[\s-]?max/i, name: "iPhone 17 Pro Max" },
  { re: /iphone[\s-]?17[\s-]?pro/i, name: "iPhone 17 Pro" },
  { re: /iphone[\s-]?17[\s-]?air/i, name: "iPhone 17 Air" },
  { re: /iphone[\s-]?17\b/i, name: "iPhone 17" },
  { re: /iphone[\s-]?16e\b/i, name: "iPhone 16e" },
  { re: /iphone[\s-]?16[\s-]?pro[\s-]?max/i, name: "iPhone 16 Pro Max" },
  { re: /iphone[\s-]?16[\s-]?pro/i, name: "iPhone 16 Pro" },
  { re: /iphone[\s-]?16[\s-]?plus/i, name: "iPhone 16 Plus" },
  { re: /iphone[\s-]?16\b/i, name: "iPhone 16" },
  { re: /iphone[\s-]?15[\s-]?pro[\s-]?max/i, name: "iPhone 15 Pro Max" },
  { re: /iphone[\s-]?15[\s-]?pro/i, name: "iPhone 15 Pro" },
  { re: /iphone[\s-]?15[\s-]?plus/i, name: "iPhone 15 Plus" },
  { re: /iphone[\s-]?15\b/i, name: "iPhone 15" },
  { re: /iphone[\s-]?14[\s-]?pro[\s-]?max/i, name: "iPhone 14 Pro Max" },
  { re: /iphone[\s-]?14[\s-]?pro/i, name: "iPhone 14 Pro" },
  { re: /iphone[\s-]?14[\s-]?plus/i, name: "iPhone 14 Plus" },
  { re: /iphone[\s-]?14\b/i, name: "iPhone 14" },
  { re: /iphone[\s-]?13[\s-]?mini/i, name: "iPhone 13 mini" },
  { re: /iphone[\s-]?13[\s-]?pro[\s-]?max/i, name: "iPhone 13 Pro Max" },
  { re: /iphone[\s-]?13[\s-]?pro/i, name: "iPhone 13 Pro" },
  { re: /iphone[\s-]?13\b/i, name: "iPhone 13" },
  { re: /iphone[\s-]?12[\s-]?mini/i, name: "iPhone 12 mini" },
  { re: /iphone[\s-]?12[\s-]?pro[\s-]?max/i, name: "iPhone 12 Pro Max" },
  { re: /iphone[\s-]?12[\s-]?pro/i, name: "iPhone 12 Pro" },
  { re: /iphone[\s-]?12\b/i, name: "iPhone 12" },
  { re: /iphone[\s-]?11[\s-]?pro[\s-]?max/i, name: "iPhone 11 Pro Max" },
  { re: /iphone[\s-]?11[\s-]?pro/i, name: "iPhone 11 Pro" },
  { re: /iphone[\s-]?11\b/i, name: "iPhone 11" },
  { re: /iphone[\s-]?xs[\s-]?max/i, name: "iPhone XS Max" },
  { re: /iphone[\s-]?xs/i, name: "iPhone XS" },
  { re: /iphone[\s-]?xr/i, name: "iPhone XR" },
  { re: /iphone[\s-]?x\b/i, name: "iPhone X" },
  { re: /iphone[\s-]?se[\s-]?(2022|3e?)/i, name: "iPhone SE (2022)" },
  { re: /iphone[\s-]?se[\s-]?(2020|2e?)/i, name: "iPhone SE (2020)" },
  { re: /iphone[\s-]?8[\s-]?plus/i, name: "iPhone 8 Plus" },
  { re: /iphone[\s-]?8\b/i, name: "iPhone 8" },
  { re: /iphone[\s-]?7[\s-]?plus/i, name: "iPhone 7 Plus" },
  { re: /iphone[\s-]?7\b/i, name: "iPhone 7" },
  { re: /iphone[\s-]?6s[\s-]?plus/i, name: "iPhone 6s Plus" },
  { re: /iphone[\s-]?6s\b/i, name: "iPhone 6s" },
  { re: /iphone[\s-]?6[\s-]?plus/i, name: "iPhone 6 Plus" },
  { re: /iphone[\s-]?6\b/i, name: "iPhone 6" },
];

function detectModel(text) {
  for (const m of MODELS) if (m.re.test(text)) return m.name;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Définition des catégories à découvrir
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = {
  ecran_premium: {
    repairId: "ecran_premium",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=iPhone+%C3%A9cran&cat=4191&product_list_limit=72",
    pageCount: 4,
    rules: [
      { priority: 1, name: "Relife", titleRe: /\(relife\)/i },
      { priority: 1, name: "Soft OLED Prime", titleRe: /soft\s*oled.*\(prime\)/i },
      { priority: 2, name: "Soft OLED BOLT", titleRe: /soft\s*oled.*\(bolt\)/i },
    ],
  },
  ecran_eco: {
    repairId: "ecran_eco",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=iPhone+%C3%A9cran&cat=4191&product_list_limit=72",
    pageCount: 4,
    rules: [
      { priority: 1, name: "LTPS Prime", titleRe: /ltps.*\(prime\)/i },
      { priority: 2, name: "LTPS SPARK", titleRe: /ltps.*\(spark\)/i },
    ],
  },
  ecran_standard: {
    repairId: "ecran_standard",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=iPhone+%C3%A9cran&cat=4191&product_list_limit=72",
    pageCount: 4,
    rules: [{ priority: 1, name: "Hard OLED", titleRe: /hard\s*oled/i }],
  },
  micro: {
    repairId: "micro",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=Micro+iphone&cat=4191&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Micro", titleRe: /^(?!.*alcalian).*micro/i }],
  },
  connecteur_de_charge: {
    repairId: "connecteur_de_charge",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=Connecteur+de+charge+iphone&cat=4191&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Connecteur", titleRe: /connecteur.*charge/i }],
    captureColor: true,
  },
  haut_parleur: {
    repairId: "haut_parleur",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/?q=haut+parleur+iphone&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Haut-Parleur", titleRe: /haut.parleur|speaker/i }],
  },
  camera_arriere: {
    repairId: "camera_arriere",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/?q=camera+arri%C3%A8re+iphone&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Caméra Arrière", titleRe: /cam[ée]ra\s+arri[èe]re/i }],
  },
  camera_avant: {
    repairId: "camera_avant",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/?q=camera+avant+iphone&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Caméra Avant", titleRe: /cam[ée]ra\s+avant/i }],
  },
  ecouteur_interne: {
    repairId: "ecouteur_interne",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/?q=%C3%89couteurs+interne+iphone&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Écouteur Interne", titleRe: /[ée]couteur.*interne|earpiece/i }],
  },
  vibreur: {
    repairId: "vibreur",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=vibreur+iphones&cat=4191&product_list_limit=72",
    pageCount: 2,
    rules: [{ priority: 1, name: "Vibreur", titleRe: /vibreur/i }],
  },
  lentille_camera_arriere: {
    repairId: "lentille_camera_arriere",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=lentille+camera+iphones&cat=4191&product_list_limit=72",
    pageCount: 2,
    rules: [{ priority: 1, name: "Lentille Caméra", titleRe: /lentille/i }],
  },
  verre_trempe_classique: {
    repairId: "verre_trempe_classique",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=verre+tremp%C3%A9+iPhone&cat=4822&product_list_limit=72",
    pageCount: 3,
    rules: [
      { priority: 1, name: "Full Cover", titleRe: /full\s*cover/i },
      { priority: 2, name: "Clear", titleRe: /\bclear\b/i },
    ],
  },
  verre_trempe_anti_espion: {
    repairId: "verre_trempe_anti_espion",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=verre+tremp%C3%A9+iPhone&cat=4822&product_list_limit=72",
    pageCount: 3,
    rules: [{ priority: 1, name: "Privacy", titleRe: /privacy/i }],
  },
  // ─── Catégories à 0/43 — à découvrir en priorité ──────────────────────
  ecran_original: {
    repairId: "ecran_original",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=%C3%A9cran+complet+service+pack+iphone&cat=4191&product_list_limit=72",
    pageCount: 3,
    rules: [
      { priority: 1, name: "Service Pack", titleRe: /service\s*pack/i },
    ],
  },
  batterie: {
    repairId: "batterie",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=batterie+iphone&cat=4191&product_list_limit=72",
    pageCount: 3,
    // Pas Service Pack (= original) → titre commençant par "batterie iphone X" sans suffixe -SP
    rules: [
      { priority: 1, name: "TI", titleRe: /^batterie.*\b(ti|tianma)\b/i },
      { priority: 2, name: "Standard", titleRe: /^batterie\s+iphone\s+(?!.*service)/i },
    ],
  },
  batterie_original: {
    repairId: "batterie_original",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=batterie+iphone+service+pack&cat=4191&product_list_limit=72",
    pageCount: 3,
    rules: [
      { priority: 1, name: "Service Pack", titleRe: /(akku|batterie).*service\s*pack/i },
    ],
  },
  vitre_arriere: {
    repairId: "vitre_arriere",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=ch%C3%A2ssis+iphone&cat=4191&product_list_limit=72",
    pageCount: 3,
    rules: [
      { priority: 1, name: "Châssis complet", titleRe: /ch[âa]ssis|back\s*cover|vitre\s*arri[èe]re/i },
    ],
  },
  bouton_volume: {
    repairId: "bouton_volume",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=bouton+volume+iphone&cat=4191&product_list_limit=72",
    pageCount: 2,
    rules: [
      { priority: 1, name: "Bouton volume", titleRe: /bouton.*volume|volume.*button|nappe.*volume/i },
    ],
  },
  bouton_power: {
    repairId: "bouton_power",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=bouton+power+iphone&cat=4191&product_list_limit=72",
    pageCount: 2,
    rules: [
      { priority: 1, name: "Bouton power", titleRe: /bouton.*(power|allumage|on.?off)|nappe.*power/i },
    ],
  },
  // Accessoires — Apple cables et chargeurs (regex larges, accessoire universel)
  cable_usb_c: {
    repairId: "cable_usb_c",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=c%C3%A2ble+usb-c&product_list_limit=72",
    pageCount: 2,
    rules: [
      { priority: 1, name: "Câble USB-C", titleRe: /c[âa]ble.*usb.?c|usb.?c.*c[âa]ble/i },
    ],
    universalAccessory: true,
  },
  adaptateur_secteur_usb_c: {
    repairId: "adaptateur_secteur_usb_c",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=adaptateur+secteur&product_list_limit=72",
    pageCount: 2,
    rules: [
      { priority: 1, name: "Adaptateur secteur USB-C", titleRe: /adaptateur.*secteur|chargeur.*usb.?c/i },
    ],
    universalAccessory: true,
  },
  cable_usb_c_lightning: {
    repairId: "cable_usb_c_lightning",
    searchUrl:
      "https://www.utopya.fr/catalogsearch/result/index/?q=c%C3%A2ble+lightning&product_list_limit=72",
    pageCount: 2,
    rules: [
      { priority: 1, name: "USB-C → Lightning", titleRe: /usb.?c.*lightning|lightning.*usb.?c/i },
    ],
    universalAccessory: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Couleurs (pour connecteur de charge)
// ─────────────────────────────────────────────────────────────────────────────
// Mapping mots-clés → couleur canonique + #hex
const COLORS = [
  { re: /noir|sid[ée]ral|midnight|graphite|space\s*gray|space\s*grey/i, name: "Noir", hex: "#0a0a0a" },
  { re: /blanc|silver|argent|starlight|stell?aire/i, name: "Blanc", hex: "#f4f4f1" },
  { re: /\bor\b|gold|jaune/i, name: "Or", hex: "#e7c89a" },
  { re: /rose|pink/i, name: "Rose", hex: "#ffd1d6" },
  { re: /bleu|blue/i, name: "Bleu", hex: "#5b8cc8" },
  { re: /vert|green/i, name: "Vert", hex: "#7fb088" },
  { re: /violet|mauve|purple|deep\s*purple/i, name: "Violet", hex: "#9479c6" },
  { re: /rouge|red\b|product/i, name: "Rouge", hex: "#c43a3a" },
  { re: /titane|titanium/i, name: "Titane", hex: "#a8a89c" },
  { re: /naturel|natural/i, name: "Titane Naturel", hex: "#b3a98e" },
  { re: /d[ée]sert/i, name: "Titane Désert", hex: "#c1a37b" },
];

function detectColor(text) {
  for (const c of COLORS) if (c.re.test(text)) return { name: c.name, hex: c.hex };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentification Utopya (charge auth.json si présent)
// ─────────────────────────────────────────────────────────────────────────────
async function buildAuthedContext() {
  const userData = path.resolve(".user-data");
  const ctx = await chromium.launchPersistentContext(userData, {
    headless: true,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape des résultats de recherche (avec pagination)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeSearch(page, baseUrl, maxPages = 4) {
  const results = []; // { url, title }
  for (let p = 1; p <= maxPages; p++) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = p === 1 ? baseUrl : `${baseUrl}${sep}p=${p}`;
    console.log(`    p=${p} → ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    // collecter (titre, url) des produits
    const items = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll(".product-item a.product-item-link").forEach((a) => {
        const href = a.href;
        const title = (a.textContent || "").trim().replace(/\s+/g, " ");
        if (href && /utopya\.fr/.test(href)) out.push({ url: href, title });
      });
      return out;
    });
    if (!items.length) {
      console.log(`    (page ${p} vide → arrêt pagination)`);
      break;
    }
    results.push(...items);
  }
  // dédup par URL
  const seen = new Map();
  for (const r of results) if (!seen.has(r.url)) seen.set(r.url, r);
  return [...seen.values()];
}

function urlScore(u) {
  let s = 0;
  if (/-\d+\.html$/.test(u)) s += 10;
  if (/\/catalog\/product\/view\/id\//.test(u)) s += 8;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Découverte d'une catégorie
// ─────────────────────────────────────────────────────────────────────────────
async function discoverCategory(page, key, def) {
  console.log(`\n=== ${key.toUpperCase()} ===`);
  const items = await scrapeSearch(page, def.searchUrl, def.pageCount);
  console.log(`  ${items.length} produits collectés`);
  // Filtrer Alcalian
  const filtered = items.filter((i) => !/alcalian/i.test(i.title) && !/alcalian/i.test(i.url));
  console.log(`  ${filtered.length} après exclusion Alcalian`);

  const entries = [];
  // Modèles iPhone USB-C (pour les accessoires universels USB-C)
  const USB_C_MODELS = [
    "iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max",
    "iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 16e",
    "iPhone 17", "iPhone 17 Air", "iPhone 17 Pro", "iPhone 17 Pro Max", "iPhone 17e",
  ];
  // Modèles iPhone Lightning (avant USB-C)
  const LIGHTNING_MODELS = [
    "iPhone 14", "iPhone 14 Plus", "iPhone 14 Pro", "iPhone 14 Pro Max",
    "iPhone SE (2022)", "iPhone SE (2020)",
    "iPhone 13", "iPhone 13 mini", "iPhone 13 Pro", "iPhone 13 Pro Max",
    "iPhone 12", "iPhone 12 mini", "iPhone 12 Pro", "iPhone 12 Pro Max",
    "iPhone 11", "iPhone 11 Pro", "iPhone 11 Pro Max",
    "iPhone X", "iPhone XR", "iPhone XS", "iPhone XS Max",
    "iPhone 8", "iPhone 8 Plus", "iPhone 7", "iPhone 7 Plus",
  ];
  function universalModelsFor(repairId) {
    if (repairId === "cable_usb_c" || repairId === "adaptateur_secteur_usb_c") {
      // Câble USB-C / chargeur : utilisable par tous les iPhone USB-C ET Lightning
      // (Lightning pour les anciens via adaptateur, mais on attribue surtout aux USB-C)
      return USB_C_MODELS;
    }
    if (repairId === "cable_usb_c_lightning") {
      // Câble USB-C → Lightning : seulement les iPhone Lightning
      return LIGHTNING_MODELS;
    }
    return [];
  }
  for (const it of filtered) {
    const text = `${it.title} ${it.url}`;
    if (def.universalAccessory) {
      // Accessoire universel : on essaie chaque règle, et si elle matche
      // on génère une entrée par modèle iPhone applicable.
      for (const rule of def.rules) {
        if (!rule.titleRe.test(it.title)) continue;
        const targets = universalModelsFor(def.repairId);
        for (const m of targets) {
          entries.push({
            url: it.url,
            repair_id: def.repairId,
            model: m,
            category: "accessory",
            priority: rule.priority,
            note: rule.name,
          });
        }
        break; // une seule règle par produit
      }
      continue;
    }
    const model = detectModel(text);
    if (!model) continue;
    for (const rule of def.rules) {
      if (!rule.titleRe.test(it.title)) continue;
      const e = {
        url: it.url,
        repair_id: def.repairId,
        model,
        category: "repair",
        priority: rule.priority,
        note: rule.name,
      };
      if (def.captureColor) {
        const col = detectColor(it.title);
        if (col) {
          e.color = col.name;
          e.colorHex = col.hex;
        }
      }
      entries.push(e);
    }
  }

  // Dédup (repair_id, model, priority [, color]) — garde meilleure URL
  const dedup = new Map();
  for (const e of entries) {
    const k = `${e.repair_id}__${e.model}__p${e.priority}__${e.color || ""}`;
    const prev = dedup.get(k);
    if (!prev || urlScore(e.url) > urlScore(prev.url)) dedup.set(k, e);
  }
  const finalEntries = [...dedup.values()];
  console.log(`  → ${finalEntries.length} entrées retenues`);

  // Affiche un résumé compact par modèle
  const byModel = {};
  finalEntries.forEach((e) => {
    if (!byModel[e.model]) byModel[e.model] = [];
    byModel[e.model].push(`p${e.priority} ${e.note}${e.color ? " (" + e.color + ")" : ""}`);
  });
  Object.entries(byModel)
    .sort()
    .slice(0, 8)
    .forEach(([m, vs]) => console.log(`    ${m.padEnd(22)} ${vs.join(" / ")}`));
  if (Object.keys(byModel).length > 8) {
    console.log(`    … et ${Object.keys(byModel).length - 8} autres modèles`);
  }

  return finalEntries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
const wantedKey = process.argv[2];

const ctx = await buildAuthedContext();
const page = await ctx.newPage();

// Login Utopya si nécessaire (réutilise la session persistante .user-data si elle existe)
const E = process.env.UTOPYA_EMAIL;
const P = process.env.UTOPYA_PASSWORD;
if (E && P) {
  try {
    await page.goto("https://www.utopya.fr/customer/account/login/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const stillOnLogin = page.url().includes("/login");
    if (stillOnLogin) {
      console.log("Connexion Utopya en cours…");
      await page.fill("input#email", E).catch(() => {});
      await page.fill("input#pass", P).catch(() => {});
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        page.click("button.login").catch(() => page.click('button[name="send"]').catch(() => {})),
      ]);
      console.log("Login → OK");
    } else {
      console.log("Session Utopya déjà active");
    }
  } catch (e) {
    console.log("(Avertissement login Utopya :", e.message, ")");
  }
}

const allNew = [];
const keys = wantedKey ? [wantedKey] : Object.keys(CATEGORIES);
for (const k of keys) {
  if (!CATEGORIES[k]) {
    console.error(`Catégorie inconnue : ${k}`);
    process.exit(1);
  }
  const entries = await discoverCategory(page, k, CATEGORIES[k]);
  allNew.push(...entries);
}

await ctx.close();

// ─────────────────────────────────────────────────────────────────────────────
// Merge avec links.json existant — les nouvelles entrées remplacent les
// anciennes pour les mêmes (repair_id, model, priority, color)
// ─────────────────────────────────────────────────────────────────────────────
let existing = [];
if (existsSync(LINKS_FILE)) {
  existing = JSON.parse(readFileSync(LINKS_FILE, "utf8"));
}
// On retire les anciennes entrées des repair_ids qu'on a redécouvert
const touchedRepairs = new Set(allNew.map((e) => e.repair_id));
const kept = existing.filter((e) => !touchedRepairs.has(e.repair_id));
const merged = [...kept, ...allNew];
writeFileSync(LINKS_FILE, JSON.stringify(merged, null, 2));
console.log(
  `\n✓ links.json mis à jour : ${kept.length} conservées + ${allNew.length} nouvelles = ${merged.length} total`,
);
