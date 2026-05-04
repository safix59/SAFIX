// Découverte auto des URLs Utopya correspondant à un pattern.
// Stratégie : 1) sitemap.xml  2) fallback : recherche via la session connectée.
//
// Usage :
//   node discover.js                           # mode service-packs (défaut)
//   node discover.js --pattern "batterie-iphone"
//   node discover.js --merge                   # fusionne dans links.json existant
//   node discover.js --dry                     # n'écrit rien, juste affiche

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import dotenv from "dotenv";
import { ensureLoggedIn } from "./lib/auth.js";
import { Logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const args = process.argv.slice(2);
const flags = {
  dry: args.includes("--dry"),
  merge: args.includes("--merge"),
  pattern: null,
  repairId: null,
  category: "repair",
  priority: null,
  note: null,
  searchQuery: null,
};
const pIdx = args.indexOf("--pattern");
if (pIdx !== -1) flags.pattern = args[pIdx + 1];
const rIdx = args.indexOf("--repair-id");
if (rIdx !== -1) flags.repairId = args[rIdx + 1];
const cIdx = args.indexOf("--category");
if (cIdx !== -1) flags.category = args[cIdx + 1];
const prIdx = args.indexOf("--priority");
if (prIdx !== -1) flags.priority = Number(args[prIdx + 1]);
const nIdx = args.indexOf("--note");
if (nIdx !== -1) flags.note = args[nIdx + 1];
const sIdx = args.indexOf("--search");
if (sIdx !== -1) flags.searchQuery = args[sIdx + 1];

// Mode par défaut : service packs (= écrans originaux Apple).
// Combine les 2 patterns Utopya (français "ecran-complet" + allemand "displayeinheit").
const PATTERN =
  flags.pattern ||
  "(?:ecran-complet|displayeinheit)-iphone-[\\w-]*service-pack";
const REPAIR_ID = flags.repairId || "ecran_original";
const CATEGORY = flags.category;

const logger = new Logger(path.join(__dirname, process.env.LOG_DIR || "logs"));

const SITEMAPS_TO_TRY = [
  "https://www.utopya.fr/media/sitemap/sitemap.xml",
  "https://www.utopya.fr/media/sitemap.xml",
  "https://www.utopya.fr/sitemap.xml",
  "https://www.utopya.fr/sitemap_index.xml",
];

// ─────────────────────────────────────────────────────────────────────────────
// Mapping slug → modèle exact de l'index.html
// ─────────────────────────────────────────────────────────────────────────────
const MODELS = [
  // Plus spécifique d'abord !
  { re: /iphone-17e\b/, name: "iPhone 17e" },
  { re: /iphone-17-pro-max\b/, name: "iPhone 17 Pro Max" },
  { re: /iphone-17-pro\b/, name: "iPhone 17 Pro" },
  { re: /iphone-17-air\b/, name: "iPhone 17 Air" },
  { re: /iphone-air\b/, name: "iPhone 17 Air" }, // Utopya nomme "iphone-air" sans 17
  { re: /iphone-17\b/, name: "iPhone 17" },
  { re: /iphone-16e\b/, name: "iPhone 16e" },
  { re: /iphone-16-pro-max\b/, name: "iPhone 16 Pro Max" },
  { re: /iphone-16-pro\b/, name: "iPhone 16 Pro" },
  { re: /iphone-16-plus\b/, name: "iPhone 16 Plus" },
  { re: /iphone-16\b/, name: "iPhone 16" },
  { re: /iphone-15-pro-max\b/, name: "iPhone 15 Pro Max" },
  { re: /iphone-15-pro\b/, name: "iPhone 15 Pro" },
  { re: /iphone-15-plus\b/, name: "iPhone 15 Plus" },
  { re: /iphone-15\b/, name: "iPhone 15" },
  { re: /iphone-14-pro-max\b/, name: "iPhone 14 Pro Max" },
  { re: /iphone-14-pro\b/, name: "iPhone 14 Pro" },
  { re: /iphone-14-plus\b/, name: "iPhone 14 Plus" },
  { re: /iphone-14\b/, name: "iPhone 14" },
  { re: /iphone-se-?(?:2022|3|3eme|3e)\b/, name: "iPhone SE (2022)" },
  { re: /iphone-13-pro-max\b/, name: "iPhone 13 Pro Max" },
  { re: /iphone-13-pro\b/, name: "iPhone 13 Pro" },
  { re: /iphone-13-mini\b/, name: "iPhone 13 mini" },
  { re: /iphone-13\b/, name: "iPhone 13" },
  { re: /iphone-12-pro-max\b/, name: "iPhone 12 Pro Max" },
  { re: /iphone-12-pro\b/, name: "iPhone 12 Pro" },
  { re: /iphone-12-mini\b/, name: "iPhone 12 mini" },
  { re: /iphone-12\b/, name: "iPhone 12" },
  { re: /iphone-se-?(?:2020|2|2eme|2e)\b/, name: "iPhone SE (2020)" },
  { re: /iphone-11-pro-max\b/, name: "iPhone 11 Pro Max" },
  { re: /iphone-11-pro\b/, name: "iPhone 11 Pro" },
  { re: /iphone-11\b/, name: "iPhone 11" },
  { re: /iphone-xs-max\b/, name: "iPhone XS Max" },
  { re: /iphone-xs\b/, name: "iPhone XS" },
  { re: /iphone-xr\b/, name: "iPhone XR" },
  { re: /iphone-x\b/, name: "iPhone X" },
  { re: /iphone-8-plus\b/, name: "iPhone 8 Plus" },
  { re: /iphone-8\b/, name: "iPhone 8" },
  { re: /iphone-7-plus\b/, name: "iPhone 7 Plus" },
  { re: /iphone-7\b/, name: "iPhone 7" },
  { re: /iphone-6s-plus\b/, name: "iPhone 6s Plus" },
  { re: /iphone-6s\b/, name: "iPhone 6s" },
  { re: /iphone-6-plus\b/, name: "iPhone 6 Plus" },
  { re: /iphone-6\b/, name: "iPhone 6" },
];

function detectModel(url) {
  const slug = url.toLowerCase();
  for (const m of MODELS) {
    if (m.re.test(slug)) return m.name;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sitemap
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSitemapUrls(page, sitemapUrl, depth = 0) {
  if (depth > 3) return [];
  try {
    const resp = await page.goto(sitemapUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!resp || !resp.ok()) return [];
    const xml = await page.content();
    // Sub-sitemaps ?
    const subs = [...xml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    if (subs.length) {
      logger.info(`  sitemap index → ${subs.length} sub-sitemaps`);
      const all = [];
      for (const sub of subs) {
        const u = await fetchSitemapUrls(page, sub, depth + 1);
        all.push(...u);
      }
      return all;
    }
    // URLs simples
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    return urls;
  } catch (e) {
    logger.warn(`  sitemap KO ${sitemapUrl} : ${e.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Crawler de recherche Utopya (pagination incluse)
// ─────────────────────────────────────────────────────────────────────────────
async function crawlSearchResults(page, query, maxPages = 10) {
  const found = new Set();
  for (let p = 1; p <= maxPages; p++) {
    const url = `https://www.utopya.fr/catalogsearch/result/?q=${encodeURIComponent(query)}&p=${p}`;
    logger.info(`  search p=${p} → ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    } catch (e) {
      logger.warn(`  ✗ ${e.message}`);
      break;
    }
    const links = await page.$$eval(
      'a.product-item-link, .product-item a[href], a[href*=".html"]',
      (els) => els.map((e) => e.href).filter(Boolean),
    );
    const before = found.size;
    links.forEach((u) => found.add(u));
    if (found.size === before) {
      logger.info(`  page vide, arrêt pagination.`);
      break;
    }
  }
  return [...found];
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  logger.info(`=== DÉCOUVERTE Utopya — pattern="${PATTERN}" repair_id="${REPAIR_ID}" ===`);

  const ctx = await ensureLoggedIn({
    chromium,
    userDataDir: path.join(__dirname, ".user-data"),
    authFile: path.join(__dirname, "auth.json"),
    email: process.env.UTOPYA_EMAIL,
    password: process.env.UTOPYA_PASSWORD,
    logger,
    headless: true,
  });
  const page = await ctx.newPage();

  // 1) Récupérer toutes les URLs via les sitemaps
  let allUrls = [];
  for (const sm of SITEMAPS_TO_TRY) {
    logger.info(`  → ${sm}`);
    const urls = await fetchSitemapUrls(page, sm);
    if (urls.length) {
      allUrls = urls;
      logger.info(`  ✓ ${urls.length} URLs sitemap`);
      break;
    }
  }

  // 2) Compléter avec une recherche Utopya (capte les produits absents du sitemap)
  let searchQuery = flags.searchQuery;
  if (!searchQuery && REPAIR_ID === "ecran_original") searchQuery = "ecran service pack iphone";
  if (!searchQuery && REPAIR_ID === "batterie_original") searchQuery = "batterie iphone service pack";
  if (searchQuery) {
    logger.info(`  → recherche Utopya : "${searchQuery}"`);
    const searchUrls = await crawlSearchResults(page, searchQuery, 10);
    logger.info(`  ✓ ${searchUrls.length} URLs via recherche`);
    allUrls = [...new Set([...allUrls, ...searchUrls])];
  }

  if (!allUrls.length) {
    logger.error("Aucune URL exploitable trouvée (sitemap + recherche).");
    await ctx.close();
    process.exit(1);
  }

  // 2) Filtrer par pattern
  const re = new RegExp(PATTERN, "i");
  const matched = allUrls
    .filter((u) => /^https?:\/\/(www\.)?utopya\.fr\//i.test(u))
    .filter((u) => re.test(u));
  logger.info(`  ${matched.length} URLs matchent le pattern "${PATTERN}"`);

  // 3) Construire les entries avec détection de modèle
  const entries = [];
  const unknown = [];
  for (const url of matched) {
    const model = detectModel(url);
    if (!model) {
      unknown.push(url);
      continue;
    }
    const e = {
      url,
      repair_id: REPAIR_ID,
      model,
      category: CATEGORY,
      note: flags.note || `auto-discovered ${REPAIR_ID}`,
    };
    if (flags.priority != null) e.priority = flags.priority;
    entries.push(e);
  }

  // 4) Dédoublonner par (repair_id, model, priority) — clé incluant la priorité
  //    pour conserver les variantes (PRIME, HAUTE CAPACITE TI, TI…).
  //    Quand 2 URLs partagent la même clé, on garde celle avec ID numérique.
  function urlScore(url) {
    let s = 0;
    if (/-\d+\.html$/.test(url)) s += 10;
    if (/\/catalog\/product\/view\/id\//.test(url)) s += 8;
    if (/displayeinheit/.test(url)) s += 1;
    return s;
  }
  const dedup = new Map();
  for (const e of entries) {
    const key = `${e.repair_id}__${e.model}__p${e.priority ?? "x"}`;
    const prev = dedup.get(key);
    if (!prev || urlScore(e.url) > urlScore(prev.url)) {
      dedup.set(key, e);
    }
  }
  const finalEntries = [...dedup.values()];
  logger.info(`  ${finalEntries.length} couples (repair_id, modèle) uniques après dédup.`);
  if (unknown.length) {
    logger.warn(`  ⚠ ${unknown.length} URLs avec modèle non identifié (ignorées) :`);
    unknown.slice(0, 5).forEach((u) => logger.warn(`     - ${u}`));
    if (unknown.length > 5) logger.warn(`     ... +${unknown.length - 5} autres`);
  }

  // 5) Affichage
  console.log("\n=== ENTRÉES DÉTECTÉES ===");
  finalEntries
    .sort((a, b) => a.model.localeCompare(b.model))
    .forEach((e, i) =>
      console.log(`  ${String(i + 1).padStart(3)}. ${e.model.padEnd(22)} → ${e.url}`),
    );

  // 6) Écriture
  const linksFile = path.join(__dirname, process.env.LINKS_FILE || "links.json");
  if (flags.dry) {
    logger.info("--dry : aucun fichier écrit.");
  } else {
    let existing = [];
    if (flags.merge && fs.existsSync(linksFile)) {
      existing = JSON.parse(fs.readFileSync(linksFile, "utf8"));
      logger.info(`  fusion avec ${existing.length} entrées existantes.`);
    }
    // Dédupliquer par (repair_id, model, priority) — préserve les variantes de
    // priorités différentes (PRIME, HC TI, TI…) sur un même modèle.
    const merged = new Map();
    for (const e of [...existing, ...finalEntries]) {
      merged.set(`${e.repair_id}__${e.model}__p${e.priority ?? "x"}`, e);
    }
    const out = [...merged.values()];
    fs.writeFileSync(linksFile, JSON.stringify(out, null, 2));
    logger.info(`✓ ${out.length} entrées écrites dans ${linksFile}`);
  }

  await ctx.close();
}

main().catch((err) => {
  logger.error("Crash", err);
  process.exit(1);
});
