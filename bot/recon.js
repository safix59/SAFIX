// Reconnaissance UI Utopya — capture les sélecteurs HTML dont a besoin
// le bot auto-commande pour pouvoir ajouter au panier + checkout sans
// finaliser la commande.
//
// Usage : node recon.js [URL_PRODUIT]
//   par défaut : prend le premier lien batterie iPhone 13 de links.json

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { ensureLoggedIn } from "../scraper/lib/auth.js";
dotenv.config({ path: "../scraper/.env" });

const logger = {
  info:  (m) => console.log("[i]", m),
  warn:  (m) => console.warn("[!]", m),
  error: (m) => console.error("[x]", m),
};

const links = JSON.parse(readFileSync("../scraper/links.json", "utf8"));
const sample = process.argv[2]
  || links.find(L => L.repair_id === "batterie" && L.model === "iPhone 13")?.url
  || links[0].url;

const out = { steps: [] };
const log = (label, payload) => { out.steps.push({ label, ...payload }); console.log("→", label); };

// Profil séparé pour ne pas entrer en conflit avec run.js qui tourne déjà
const ctx = await ensureLoggedIn({
  chromium,
  userDataDir: "./.recon-userdata",
  authFile:    "./recon-auth.json",
  email:       process.env.UTOPYA_EMAIL,
  password:    process.env.UTOPYA_PASSWORD,
  logger,
  headless:    true,
});
const page = await ctx.newPage();

try {
  log("login", { ok: true, note: "via ensureLoggedIn (scraper helper)" });

  // ─── ÉTAPE 1 : Fiche produit ────────────────────────────────────────
  console.log("\n=== Fiche produit ===");
  console.log("URL :", sample);
  await page.goto(sample, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  const productTitle = await page.title();
  log("product_loaded", { url: sample, title: productTitle });

  // Chercher tous les boutons "Ajouter au panier"
  const addToCartCandidates = await page.evaluate(() => {
    const sels = [
      'button[id*="cart"]', 'button[name*="cart"]', 'button[title*="anier" i]',
      'button:has-text("Ajouter au panier")', '.add-to-cart', '#product-addtocart-button',
      'button.tocart', 'button.action.tocart', 'button.btn-cart',
    ];
    const found = [];
    document.querySelectorAll('button, a.button, input[type=submit]').forEach(el => {
      const txt = (el.textContent || el.value || '').trim();
      const id = el.id || '';
      const cls = el.className || '';
      if (/panier|cart|tocart/i.test(txt) || /cart|tocart/i.test(id + ' ' + cls)) {
        found.push({
          tag: el.tagName.toLowerCase(),
          id, className: cls,
          text: txt.slice(0, 60),
          name: el.name || '',
          type: el.type || '',
          visible: el.offsetParent !== null,
        });
      }
    });
    return found;
  });
  log("add_to_cart_candidates", { count: addToCartCandidates.length, items: addToCartCandidates });

  // Variantes / options (ex. couleur)
  const optionsBlocks = await page.evaluate(() => {
    const blocks = [];
    document.querySelectorAll('.product-options-wrapper .swatch-attribute, .product-options-wrapper select').forEach(el => {
      blocks.push({
        tag: el.tagName.toLowerCase(),
        id: el.id, className: el.className,
        attrCode: el.getAttribute('data-attribute-code') || el.name || '',
        outerHTML: el.outerHTML.slice(0, 400),
      });
    });
    return blocks;
  });
  log("product_options", { count: optionsBlocks.length, items: optionsBlocks });

  // ─── ÉTAPE 2 : Tenter d'ajouter au panier ───────────────────────────
  console.log("\n=== Ajout au panier (test) ===");
  const addBtn = await page.locator('#product-addtocart-button, button[name="add"], button.tocart, button.action.tocart').first();
  const exists = await addBtn.count();
  if (exists) {
    try {
      await addBtn.click({ timeout: 8000 });
      log("clicked_add_to_cart", { ok: true });
      await page.waitForTimeout(3000);
      // Détection notif succès
      const notif = await page.locator('.message-success, .messages .message, [data-ui-id="message-success"]').first();
      if (await notif.count()) {
        const txt = await notif.textContent();
        log("cart_added", { msg: (txt || '').trim().slice(0, 200) });
      } else {
        log("cart_added", { msg: "Pas de message succès détecté" });
      }
    } catch (e) {
      log("clicked_add_to_cart", { ok: false, error: e.message });
    }
  } else {
    log("clicked_add_to_cart", { ok: false, error: "Bouton introuvable" });
  }

  // ─── ÉTAPE 3 : Page panier ──────────────────────────────────────────
  console.log("\n=== Page panier ===");
  await page.goto("https://www.utopya.fr/checkout/cart/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const cartItems = await page.evaluate(() => {
    const rows = document.querySelectorAll('.cart.item, tr.item-info, .cart-item');
    return Array.from(rows).map(r => ({
      text: (r.textContent || '').trim().slice(0, 200),
      html_snippet: r.outerHTML.slice(0, 300),
    }));
  });
  log("cart_page", { url: page.url(), items: cartItems });

  const checkoutBtnCandidates = await page.evaluate(() => {
    const found = [];
    document.querySelectorAll('button, a').forEach(el => {
      const txt = (el.textContent || '').trim();
      if (/passer.*commande|commander|checkout|valider/i.test(txt)) {
        found.push({
          tag: el.tagName.toLowerCase(),
          id: el.id, className: el.className,
          text: txt.slice(0, 60),
          href: el.href || '',
        });
      }
    });
    return found;
  });
  log("checkout_buttons", { count: checkoutBtnCandidates.length, items: checkoutBtnCandidates });

  // ─── ÉTAPE 4 : Page checkout ────────────────────────────────────────
  console.log("\n=== Page checkout ===");
  await page.goto("https://www.utopya.fr/checkout/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3500);
  const checkoutFields = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('input, select, textarea').forEach(el => {
      list.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || '', name: el.name || '', id: el.id || '',
        className: el.className || '',
        placeholder: el.placeholder || '',
        value: (el.value || '').slice(0, 60),
        visible: el.offsetParent !== null,
      });
    });
    return list.filter(x => x.visible);
  });
  log("checkout_fields", { url: page.url(), count: checkoutFields.length, items: checkoutFields });

  // Méthodes de livraison + paiement disponibles
  const shippingMethods = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[name*="shipping_method"], .shipping-method, [data-bind*="shippingMethod"]').forEach(el => {
      out.push({ id: el.id, value: el.value || '', text: (el.closest('tr,.shipping-method')?.textContent || '').trim().slice(0, 100) });
    });
    return out;
  });
  const paymentMethods = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[name="payment[method]"], .payment-method').forEach(el => {
      out.push({ id: el.id, value: el.value || '', text: (el.closest('.payment-method')?.textContent || '').trim().slice(0, 150) });
    });
    return out;
  });
  log("shipping_methods", { items: shippingMethods });
  log("payment_methods",  { items: paymentMethods  });

  // Bouton "Passer la commande" final
  const placeOrderBtn = await page.evaluate(() => {
    const found = [];
    document.querySelectorAll('button').forEach(el => {
      const txt = (el.textContent || '').trim();
      if (/passer.*commande|placer.*commande|place.*order|valider.*commande/i.test(txt)) {
        found.push({ id: el.id, className: el.className, text: txt.slice(0, 80) });
      }
    });
    return found;
  });
  log("place_order_button", { items: placeOrderBtn });

  // Sauvegarde HTML brut du checkout pour analyse manuelle
  const checkoutHtml = await page.content();
  writeFileSync("./recon-checkout.html", checkoutHtml);
  log("checkout_html_dump", { file: "./recon-checkout.html", bytes: checkoutHtml.length });

  // NE CONFIRME PAS LA COMMANDE — on s'arrête là.
  console.log("\n✓ Reconnaissance terminée — aucune commande passée.");
} catch (e) {
  log("FATAL", { error: e.message, stack: e.stack?.slice(0, 500) });
  console.error("Erreur :", e.message);
} finally {
  writeFileSync("./recon-result.json", JSON.stringify(out, null, 2));
  console.log("\nRésultats : ./recon-result.json");
  await ctx.close();
}
