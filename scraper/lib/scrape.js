import { parsePriceString } from "./pricing.js";

// Sélecteurs ordonnés du PLUS spécifique (zone produit principal) au plus large.
// Le scraper scope d'abord à un container produit principal pour éviter de
// matcher des prix de produits associés / slider en bas de page.
const MAIN_SCOPES = [
  ".product-info-main",
  ".product-info-price",
  ".product-shop",
  ".product.info.detailed",
  ".page-main .product",
  "main",
];

const PRICE_SELECTORS = [
  '[data-price-type="finalPrice"] [data-price-amount]',
  '[data-price-type="finalPrice"] .price',
  ".price-box .special-price .price",
  ".price-box .regular-price .price",
  ".price-box > span.price",
  ".price-box span.price",
  ".price-wrapper .price",
  ".price-final_price > .price",
  ".price",
];

const PRICE_AMOUNT_ATTR_SELECTORS = [
  '[data-price-type="finalPrice"][data-price-amount]',
  '.price-final_price [data-price-amount]',
  '[data-price-amount]',
];

const STOCK_OUT_PATTERNS = [
  /rupture/i,
  /épuisé/i,
  /épuise/i,
  /indisponible/i,
  /out\s*of\s*stock/i,
  /non\s*disponible/i,
  /plus\s*en\s*stock/i,
  /réappro/i,        // "En réappro" / "réapprovisionnement" Utopya
  /reappro/i,
  /prévenez[- ]moi/i, // bouton "Prévenez-moi" = produit OOS
];

const STOCK_IN_PATTERNS = [
  /en\s*stock/i,
  /disponible/i,
  /in\s*stock/i,
];

async function extractFromJsonLd(page, diag) {
  const blobs = await page.$$eval(
    'script[type="application/ld+json"]',
    (nodes) => nodes.map((n) => n.textContent || ""),
  );
  diag.jsonLdCount = blobs.length;
  for (const raw of blobs) {
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(json) ? json : [json];
    for (const c of candidates) {
      if (!c || typeof c !== "object") continue;
      const type = c["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      const offers = c.offers
        ? Array.isArray(c.offers)
          ? c.offers[0]
          : c.offers
        : null;
      if (!offers) continue;
      const price = offers.price != null ? parseFloat(offers.price) : null;
      const availability = String(offers.availability || "");
      const oos = /OutOfStock|SoldOut/i.test(availability);
      const ins = /InStock/i.test(availability);
      diag.jsonLdHit = { price, availability };
      return {
        price: Number.isFinite(price) ? price : null,
        outOfStock: oos ? true : ins ? false : null,
        source: "jsonld",
      };
    }
  }
  return null;
}

async function findScope(page) {
  for (const scopeSel of MAIN_SCOPES) {
    const el = await page.$(scopeSel);
    if (el) {
      const visible = await el.isVisible().catch(() => false);
      if (visible) return { handle: el, sel: scopeSel };
    }
  }
  return null;
}

async function extractFromDom(page, diag) {
  diag.attrTried = [];
  diag.textTried = [];

  // 0) Localiser le container produit principal pour scoper la recherche
  const scope = await findScope(page);
  diag.scope = scope ? scope.sel : null;
  const root = scope ? scope.handle : page;

  // 1) data-price-amount dans le scope
  for (const sel of PRICE_AMOUNT_ATTR_SELECTORS) {
    const els = await root.$$(sel);
    if (!els.length) {
      diag.attrTried.push({ sel, found: false });
      continue;
    }
    for (const el of els) {
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const attr = await el.getAttribute("data-price-amount");
      const n = attr != null ? parseFloat(attr) : null;
      diag.attrTried.push({ sel, found: true, raw: attr, parsed: n });
      if (Number.isFinite(n) && n > 0) {
        return { price: n, source: `attr:${sel}` };
      }
    }
  }

  // 2) sélecteurs prix dans le scope (premier résultat visible non-trivial)
  for (const sel of PRICE_SELECTORS) {
    const els = await root.$$(sel);
    if (!els.length) {
      diag.textTried.push({ sel, found: false });
      continue;
    }
    for (const el of els) {
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const text = ((await el.textContent()) || "").trim().slice(0, 80);
      const n = parsePriceString(text);
      diag.textTried.push({ sel, found: true, text, parsed: n });
      if (Number.isFinite(n) && n > 0) {
        return { price: n, source: `scope:${diag.scope || "page"}|text:${sel}` };
      }
    }
  }

  // 3) Fallback : chercher hors scope mais en se limitant aux prix dans la
  //    moitié supérieure de la page (les sliders sont en bas).
  if (scope) {
    const candidates = await page.$$eval(".price-box span.price, span.price", (els) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            text: (e.textContent || "").trim(),
            visible: r.width > 0 && r.height > 0,
            parent: e.parentElement?.className || "",
          };
        })
        .filter((c) => c.visible && /\d/.test(c.text))
        .sort((a, b) => a.y - b.y),
    );
    diag.fallbackCandidates = candidates.slice(0, 5);
    for (const c of candidates) {
      if (c.y > 1000) break; // skip sliders/footer
      const n = parsePriceString(c.text);
      if (Number.isFinite(n) && n > 0) {
        return { price: n, source: `fallback:top-of-page:y=${Math.round(c.y)}` };
      }
    }
  }

  return { price: null, source: "none" };
}

async function detectStock(page) {
  // 1) Classes spécifiques Utopya (.stock.color-green / .stock.color-red)
  //    + classes Magento standard (.stock.unavailable / .stock.available)
  const utopyaRed = await page.$(".stock.color-red, .stock.color-orange");
  if (utopyaRed) return true;
  const utopyaGreen = await page.$(".stock.color-green");
  if (utopyaGreen) return false;

  const unavailable = await page.$(
    ".stock.unavailable, .product-info-stock-sku .unavailable, .availability.out-of-stock, .out-of-stock, [class*='out-of-stock']",
  );
  if (unavailable) return true;
  const available = await page.$(
    ".stock.available, .availability.in-stock, .in-stock",
  );
  if (available) return false;

  // 2) Scan textuel ciblé sur les zones produit (analyse du texte du .stock)
  const scopes = [
    ".product-info-stock-sku",
    ".product-info-main .stock",
    ".product-info-main .availability",
    ".stock",
    ".availability",
  ];
  for (const sel of scopes) {
    const el = await page.$(sel);
    if (!el) continue;
    const txt = ((await el.textContent()) || "").trim();
    if (!txt) continue;
    if (STOCK_OUT_PATTERNS.some((r) => r.test(txt))) return true;
    if (STOCK_IN_PATTERNS.some((r) => r.test(txt))) return false;
  }

  // 3) Bouton "ajouter au panier" : visible + non disabled = en stock
  const addToCart = await page.$("#product-addtocart-button, button.tocart");
  if (addToCart) {
    const disabled = await addToCart.getAttribute("disabled");
    if (disabled !== null) return true;
    const visible = await addToCart.isVisible().catch(() => false);
    if (!visible) return true; // bouton caché = rupture
    return false;
  }

  // 4) Form add-to-cart absent du DOM = rupture (Magento masque le form complet)
  const form = await page.$(
    "#product_addtocart_form, form[action*='checkout/cart/add']",
  );
  if (!form) return true;

  return null;
}

export async function scrapeProduct(context, url, { timeout, logger }) {
  const page = await context.newPage();
  const started = Date.now();
  const diag = { url, jsonLdCount: 0 };
  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    if (!resp) throw new Error("Pas de réponse HTTP");
    diag.httpStatus = resp.status();
    if (resp.status() === 404) {
      return { ok: false, reason: "404", url, diag };
    }
    if (!resp.ok()) {
      throw new Error(`HTTP ${resp.status()}`);
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {
      // pas grave
    }

    const ld = await extractFromJsonLd(page, diag);
    const dom = await extractFromDom(page, diag);
    const stockExplicit = await detectStock(page);
    diag.stockExplicit = stockExplicit;

    let basePrice = null;
    let priceSource = null;
    if (dom && dom.price != null) {
      basePrice = dom.price;
      priceSource = dom.source;
    } else if (ld && ld.price != null) {
      basePrice = ld.price;
      priceSource = ld.source;
    }

    let outOfStock = false;
    if (stockExplicit === true) outOfStock = true;
    else if (stockExplicit === false) outOfStock = false;
    else if (ld && ld.outOfStock === true) outOfStock = true;
    else if (basePrice == null) outOfStock = true;

    const elapsed = Date.now() - started;
    logger.info(
      `  → prix=${basePrice ?? "—"} stock=${outOfStock ? "RUPTURE" : "OK"} src=${priceSource ?? "?"} (${elapsed}ms)`,
    );

    return {
      ok: true,
      url,
      basePrice,
      outOfStock,
      priceSource,
      checkedAt: new Date().toISOString(),
      diag,
    };
  } catch (err) {
    logger.error(`  ✗ scrape KO ${url}`, err);
    return { ok: false, reason: err.message || String(err), url, diag };
  } finally {
    await page.close();
  }
}
