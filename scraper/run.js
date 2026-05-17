import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pLimit from "p-limit";
import dotenv from "dotenv";

import { Logger } from "./lib/logger.js";
import { ensureLoggedIn } from "./lib/auth.js";
import { scrapeProduct } from "./lib/scrape.js";
import { computeFinal } from "./lib/pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const args = process.argv.slice(2);
const flags = {
  loginOnly: args.includes("--login-only"),
  headed: args.includes("--headed"),
  test: args.includes("--test"),
  url: null,
};
const urlIdx = args.indexOf("--url");
if (urlIdx !== -1) flags.url = args[urlIdx + 1];

const CONFIG = {
  email: process.env.UTOPYA_EMAIL,
  password: process.env.UTOPYA_PASSWORD,
  concurrency: Number(process.env.SCRAPE_CONCURRENCY || 3),
  timeout: Number(process.env.SCRAPE_TIMEOUT_MS || 45000),
  linksFile: path.join(__dirname, process.env.LINKS_FILE || "links.json"),
  outputFile: path.join(__dirname, process.env.OUTPUT_FILE || "prices.json"),
  authFile: path.join(__dirname, process.env.AUTH_FILE || "auth.json"),
  userDataDir: path.join(__dirname, process.env.USER_DATA_DIR || ".user-data"),
  logDir: path.join(__dirname, process.env.LOG_DIR || "logs"),
};

const logger = new Logger(CONFIG.logDir);

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function printDiagBlock(i, total, link, result, computed) {
  const ok = result.ok && result.basePrice != null;
  const oos = result.ok && result.outOfStock;
  const head = `[${i}/${total}] ${link.model} — ${link.repair_id}`;
  console.log("");
  console.log(`${C.bold}${C.cyan}━━━ ${head} ━━━${C.reset}`);
  console.log(`  URL          : ${C.dim}${link.url}${C.reset}`);
  console.log(`  Catégorie    : ${link.category} ${link.category === "repair" ? "(marge +25€)" : "(pas de marge fixe)"}`);

  if (!result.ok) {
    console.log(`  ${C.red}✗ ÉCHEC${C.reset} : ${result.reason}`);
  } else {
    const base = result.basePrice;
    const stockTxt = oos
      ? `${C.red}RUPTURE DE STOCK${C.reset}`
      : `${C.green}EN STOCK${C.reset}`;
    console.log(`  Prix UTOPYA  : ${base != null ? `${base.toFixed(2)} €` : "—"}`);
    if (base != null) {
      const step1 = Math.ceil(base * 1.20);
      const margin = computed?.margin ?? 0;
      const final = step1 + margin;
      const marginNote = margin === 0
        ? C.dim + "(prix brut)" + C.reset
        : C.dim + `(${link.repair_id})` + C.reset;
      console.log(`  +20 %        : ${(base * 1.20).toFixed(4)} → arrondi sup. = ${C.bold}${step1} €${C.reset}`);
      console.log(`  +${margin} € marge   : ${step1} + ${margin} = ${C.bold}${C.green}${final} €${C.reset} ${marginNote}`);
    }
    console.log(`  Stock        : ${stockTxt}`);
    console.log(`  Source prix  : ${result.priceSource || "—"}`);
  }

  // Diagnostic des sélecteurs
  const d = result.diag || {};
  if (!ok) {
    console.log(`  ${C.yellow}┊ DIAGNOSTIC SÉLECTEURS${C.reset}`);
    console.log(`  ┊ HTTP        : ${d.httpStatus ?? "?"}`);
    console.log(`  ┊ JSON-LD     : ${d.jsonLdCount ?? 0} bloc(s)${d.jsonLdHit ? ` → prix=${d.jsonLdHit.price} avail=${d.jsonLdHit.availability}` : " → aucun Product trouvé"}`);
    console.log(`  ┊ data-price-amount :`);
    (d.attrTried || []).forEach(t => {
      const status = t.found ? (t.parsed ? `${C.green}✓ ${t.parsed}${C.reset}` : `${C.yellow}trouvé mais parse=${t.raw}${C.reset}`) : `${C.dim}absent${C.reset}`;
      console.log(`  ┊   ${status}  ${C.dim}${t.sel}${C.reset}`);
    });
    console.log(`  ┊ texte CSS :`);
    (d.textTried || []).forEach(t => {
      const status = t.found ? (t.parsed ? `${C.green}✓ ${t.parsed}${C.reset}` : `${C.yellow}trouvé mais texte="${t.text}"${C.reset}`) : `${C.dim}absent${C.reset}`;
      console.log(`  ┊   ${status}  ${C.dim}${t.sel}${C.reset}`);
    });
    console.log(`  ┊ stock explicit DOM : ${d.stockExplicit === null ? "indéterminé" : d.stockExplicit ? "RUPTURE" : "EN STOCK"}`);
    console.log(`  ${C.yellow}┊ → Si AUCUN sélecteur ne renvoie un prix : ouvrez la page Utopya dans Chrome,${C.reset}`);
    console.log(`  ${C.yellow}┊   inspectez la zone prix (clic droit > Inspecter), copiez le sélecteur CSS,${C.reset}`);
    console.log(`  ${C.yellow}┊   et ajoutez-le en TÊTE du tableau PRICE_SELECTORS dans lib/scrape.js.${C.reset}`);
  }
}

function printDiagSummary(report) {
  console.log("");
  console.log(`${C.bold}${C.magenta}═══ RÉSUMÉ DIAGNOSTIC ═══${C.reset}`);
  const ok = report.filter(r => r.result.ok && r.result.basePrice != null && !r.result.outOfStock);
  const oos = report.filter(r => r.result.ok && r.result.outOfStock);
  const fail = report.filter(r => !r.result.ok || r.result.basePrice == null && !r.result.outOfStock);
  console.log(`  ${C.green}✓ Prix OK    : ${ok.length}${C.reset}`);
  console.log(`  ${C.red}⊘ Rupture    : ${oos.length}${C.reset}`);
  console.log(`  ${C.yellow}✗ Échec      : ${fail.length}${C.reset}`);
  console.log("");
  console.log(`${C.bold}Tableau récapitulatif :${C.reset}`);
  console.log(`  ${"#".padEnd(3)} ${"modèle".padEnd(20)} ${"réparation".padEnd(22)} ${"base".padStart(8)} ${"+20%".padStart(7)} ${"final".padStart(8)} ${"stock".padStart(10)}`);
  console.log(`  ${"─".repeat(3)} ${"─".repeat(20)} ${"─".repeat(22)} ${"─".repeat(8)} ${"─".repeat(7)} ${"─".repeat(8)} ${"─".repeat(10)}`);
  report.forEach((r, i) => {
    const base = r.result.basePrice != null ? `${r.result.basePrice.toFixed(2)}€` : "—";
    const step = r.computed.step1 != null ? `${r.computed.step1}€` : "—";
    const fin = r.computed.final != null ? `${r.computed.final}€` : (r.result.outOfStock ? "RUPT" : "—");
    const stock = !r.result.ok ? "ERR" : (r.result.outOfStock ? "RUPTURE" : "OK");
    const stockColor = !r.result.ok || r.result.outOfStock ? C.red : C.green;
    console.log(`  ${String(i + 1).padEnd(3)} ${r.link.model.padEnd(20)} ${r.link.repair_id.padEnd(22)} ${base.padStart(8)} ${step.padStart(7)} ${fin.padStart(8)} ${stockColor}${stock.padStart(10)}${C.reset}`);
  });
  console.log("");
  if (fail.length > 0) {
    console.log(`${C.yellow}⚠ ${fail.length} lien(s) en échec — voir le bloc DIAGNOSTIC SÉLECTEURS plus haut pour identifier les sélecteurs à ajouter dans lib/scrape.js.${C.reset}`);
  } else {
    console.log(`${C.green}✓ Tous les liens scrappés. Vous pouvez lancer "npm run scrape" en production.${C.reset}`);
  }
}

function loadLinks() {
  if (!fs.existsSync(CONFIG.linksFile)) {
    throw new Error(`Fichier ${CONFIG.linksFile} introuvable.`);
  }
  const raw = fs.readFileSync(CONFIG.linksFile, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("links.json doit être un tableau.");
  const skipped = [];
  for (const [i, e] of data.entries()) {
    if (!e.url) throw new Error(`Entrée #${i} sans url`);
    if (!e.repair_id) throw new Error(`Entrée #${i} sans repair_id`);
    if (!e.model) { skipped.push(i); continue; }
    if (!e.category) e.category = "repair";
    if (!["repair", "accessory"].includes(e.category)) {
      throw new Error(
        `Entrée #${i} category="${e.category}" invalide (repair|accessory)`,
      );
    }
  }
  if (skipped.length) {
    console.warn(
      `[WARN] ${skipped.length} entrée(s) sans "model" ignorée(s) (indices ${skipped.join(", ")}) — non scrapées, comportement connu-bon`,
    );
  }
  return data.filter((e) => e.model);
}

function loadPrevious() {
  if (!fs.existsSync(CONFIG.outputFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG.outputFile, "utf8"));
  } catch {
    return null;
  }
}

function getPrevEntry(prev, repairId, model) {
  if (!prev || !prev.prices) return null;
  return prev.prices?.[repairId]?.[model] || null;
}

function setEntry(prices, repairId, model, entry) {
  if (!prices[repairId]) prices[repairId] = {};
  prices[repairId][model] = entry;
}

async function run() {
  logger.info(`=== SAFIX × Utopya scraper démarré ===`);
  logger.info(`Concurrence: ${CONFIG.concurrency} | Timeout: ${CONFIG.timeout}ms`);

  let context;
  try {
    context = await ensureLoggedIn({
      chromium,
      userDataDir: CONFIG.userDataDir,
      authFile: CONFIG.authFile,
      email: CONFIG.email,
      password: CONFIG.password,
      logger,
      headless: !flags.headed,
    });
  } catch (err) {
    logger.error("Login impossible", err);
    process.exit(1);
  }

  if (flags.loginOnly) {
    logger.info("--login-only : session sauvegardée, sortie.");
    await context.close();

    return;
  }

  // === Mode TEST : diagnostic complet de chaque lien, sans écrire prices.json ===
  if (flags.test) {
    const links = loadLinks();
    logger.info(`Mode TEST — ${links.length} lien(s) à diagnostiquer.`);
    const report = [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const result = await scrapeProduct(context, link.url, {
        timeout: CONFIG.timeout,
        logger,
      });
      const computed = result.ok
        ? computeFinal({
            basePrice: result.basePrice,
            category: link.category,
            outOfStock: result.outOfStock,
            repairId: link.repair_id,
            model: link.model,
          })
        : { final: null };
      report.push({ link, result, computed });
      printDiagBlock(i + 1, links.length, link, result, computed);
    }
    printDiagSummary(report);
    await context.close();

    return;
  }

  // Mode debug : un seul URL
  if (flags.url) {
    logger.info(`Scrape ciblé : ${flags.url}`);
    const result = await scrapeProduct(context, flags.url, {
      timeout: CONFIG.timeout,
      logger,
    });
    console.log(JSON.stringify(result, null, 2));
    await context.close();

    return;
  }

  const links = loadLinks();
  logger.info(`${links.length} liens à traiter.`);
  const prev = loadPrevious();

  const limit = pLimit(CONFIG.concurrency);
  const startedAt = new Date().toISOString();
  const prices = {};
  const stats = { ok: 0, oos: 0, fail: 0, changed: 0, fallback: 0 };

  // 1) Scraper tous les liens, collecter les résultats bruts
  const all = [];
  await Promise.all(
    links.map((link, idx) =>
      limit(async () => {
        const tag = `[${idx + 1}/${links.length}] ${link.repair_id} / ${link.model} (p${link.priority || 1})`;
        logger.info(`${tag} → ${link.url}`);
        const result = await scrapeProduct(context, link.url, {
          timeout: CONFIG.timeout,
          logger,
        });
        let entry;
        if (!result.ok) {
          entry = {
            url: link.url,
            category: link.category,
            error: result.reason,
            checkedAt: new Date().toISOString(),
            outOfStock: false,
            final: null,
            basePrice: null,
          };
        } else {
          const computed = computeFinal({
            basePrice: result.basePrice,
            category: link.category,
            outOfStock: result.outOfStock,
            repairId: link.repair_id,
            model: link.model,
          });
          entry = {
            url: link.url,
            category: link.category,
            basePrice: result.basePrice,
            outOfStock: result.outOfStock,
            final: computed.final,
            step1: computed.step1 ?? null,
            margin: computed.margin ?? 0,
            priceSource: result.priceSource,
            checkedAt: result.checkedAt,
          };
        }
        all.push({ link, result, entry });
      }),
    ),
  );

  // 2) Grouper par (repair_id, model) et choisir le meilleur selon la priorité
  //    Règle : priorité 1 > 2 > 3. À priorité égale, le 1er en stock l'emporte.
  //    Si tous OOS/KO, on garde la priorité la plus haute (= numéro le plus bas).
  const groups = new Map();
  for (const r of all) {
    const key = `${r.link.repair_id}__${r.link.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  for (const [key, items] of groups) {
    items.sort((a, b) => (a.link.priority || 1) - (b.link.priority || 1));
    const inStock = items.find(
      (i) => i.entry.final != null && !i.entry.outOfStock,
    );
    const pick = inStock || items[0];

    const winner = { ...pick.entry };
    winner.selectedPriority = pick.link.priority || 1;
    winner.selectedNote = pick.link.note || null;
    if (items.length > 1) {
      winner.variants = items.map((i) => ({
        priority: i.link.priority || 1,
        note: i.link.note || null,
        url: i.link.url,
        basePrice: i.entry.basePrice ?? null,
        final: i.entry.final ?? null,
        outOfStock: i.entry.outOfStock ?? false,
        error: i.entry.error || null,
      }));
    }

    // Couleurs : si les liens ont un attribut `color`, on expose toutes les
    // couleurs disponibles pour ce modèle (pour bulles dans l'UI).
    const hasColors = items.some((i) => i.link.color);
    if (hasColors) {
      const byColor = new Map();
      for (const i of items) {
        if (!i.link.color) continue;
        const k = i.link.color;
        // Une couleur peut avoir plusieurs priorités → garder le meilleur
        const prev = byColor.get(k);
        const inStockNow = i.entry.final != null && !i.entry.outOfStock;
        const prevInStock = prev && prev.final != null && !prev.outOfStock;
        const better = !prev || (inStockNow && !prevInStock) ||
                       (inStockNow === prevInStock && (i.link.priority || 99) < (prev.priority || 99));
        if (better) {
          byColor.set(k, {
            color: i.link.color,
            colorHex: i.link.colorHex || null,
            priority: i.link.priority || 1,
            note: i.link.note || null,
            final: i.entry.final ?? null,
            outOfStock: i.entry.outOfStock ?? false,
            url: i.link.url,
          });
        }
      }
      winner.colors = [...byColor.values()].sort((a, b) => a.color.localeCompare(b.color));
    }

    // Stats
    if (winner.error) stats.fail++;
    else if (winner.outOfStock) stats.oos++;
    else stats.ok++;

    // Détection de changement vs run précédent
    const previous = getPrevEntry(prev, pick.link.repair_id, pick.link.model);
    if (previous) {
      const before = {
        final: previous.final ?? null,
        outOfStock: !!previous.outOfStock,
        url: previous.url || null,
      };
      const after = {
        final: winner.final ?? null,
        outOfStock: !!winner.outOfStock,
        url: winner.url || null,
      };
      if (
        before.final !== after.final ||
        before.outOfStock !== after.outOfStock ||
        before.url !== after.url
      ) {
        stats.changed++;
        logger.change(pick.link.repair_id, pick.link.model, before, after);
      }
    }

    // Fallback : si erreur réseau et qu'on avait une valeur précédente, on la garde
    if (winner.error && previous) {
      stats.fallback++;
      Object.assign(winner, {
        ...previous,
        fallback: true,
        lastError: winner.error,
        lastErrorAt: new Date().toISOString(),
      });
    }

    setEntry(prices, pick.link.repair_id, pick.link.model, winner);
  }

  const output = {
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    source: "utopya.fr (PRO)",
    stats,
    prices,
  };
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
  logger.info(
    `=== Terminé : ${stats.ok} OK | ${stats.oos} rupture | ${stats.fail} KO | ${stats.changed} changements | ${stats.fallback} fallbacks ===`,
  );
  logger.info(`Sortie : ${CONFIG.outputFile}`);

  // Re-sauvegarde de la session (pour rafraîchir les cookies si Magento les a renouvelés)
  try {
    await context.storageState({ path: CONFIG.authFile });
  } catch {}

  await context.close();

}

run().catch((err) => {
  logger.error("Crash global", err);
  process.exit(1);
});
