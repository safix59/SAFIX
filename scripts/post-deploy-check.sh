#!/bin/bash
# ═════════════════════════════════════════════════════════════════════
# SMOKE TEST automatique post-deploy SAFIX
# ═════════════════════════════════════════════════════════════════════
# Vérifie EXHAUSTIVEMENT que tout est en ordre. Lance après chaque deploy.
# Sortie : code 0 si tout OK, 1 si un problème.
# ═════════════════════════════════════════════════════════════════════
# Pas de `set -e` : on veut continuer même si certaines vérifs échouent
URL="${1:-https://safix59.fr}"
SUPA_URL="${SUPABASE_URL:?SUPABASE_URL requis — export-le avant de lancer le smoke test (jamais en dur)}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE:?SUPABASE_SERVICE_ROLE requis — export-le avant de lancer (jamais en dur dans ce fichier)}"
ERRORS=0

ok()  { echo "  ✅ $1"; }
ko()  { echo "  ❌ $1"; ERRORS=$((ERRORS+1)); }
warn(){ echo "  ⚠️  $1"; }

echo "═══ SMOKE TEST SAFIX — $(date +'%H:%M') ═══"

# ─── 1. Site front ─────────────────────────────────────────
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$URL/")
[ "$code" = "200" ] && ok "Site front ($URL → $code)" || ko "Site front HTTP $code"

# ─── 2. APIs ───────────────────────────────────────────────
for endpoint in /api/create-checkout-session /api/create-payment-intent /api/stripe-webhook; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' --max-time 10 "$URL$endpoint")
  [ "$code" = "400" ] && ok "API $endpoint (400 attendu)" || ko "API $endpoint HTTP $code"
done

# ─── 3. Données critiques (prices/links) ───────────────────
for f in /scraper/prices.json /scraper/links.json; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL$f")
  [ "$code" = "200" ] && ok "Data $f" || ko "Data $f HTTP $code"
done

PRICES_SIZE=$(curl -s --max-time 10 "$URL/scraper/prices.json" | wc -c)
[ "$PRICES_SIZE" -gt 100000 ] && ok "Prices size ($PRICES_SIZE bytes)" || ko "Prices trop petit ($PRICES_SIZE)"

PRICE_COUNT=$(curl -s --max-time 10 "$URL/scraper/prices.json" | python3 -c "
import json, sys
d = json.load(sys.stdin)
prices = d.get('prices', {})
ok = 0
for cat in prices.values():
    if isinstance(cat, dict):
        for v in cat.values():
            if isinstance(v, dict):
                f = v.get('final')
                if isinstance(f, (int, float)) and f > 0: ok += 1
print(ok)")
[ "$PRICE_COUNT" -gt 100 ] && ok "Prices actifs ($PRICE_COUNT)" || ko "Prix actifs trop peu ($PRICE_COUNT)"

# ─── 4. Manifest, robots, sitemap ──────────────────────────
for f in /manifest.json /robots.txt /sitemap.xml; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL$f")
  [ "$code" = "200" ] && ok "Static $f" || warn "Static $f HTTP $code"
done

# ─── 5. Bot Render ──────────────────────────────────────────
bot=$(curl -s --max-time 15 https://safix-bot.onrender.com/ 2>/dev/null)
if [[ "$bot" == *'"ok":true'* ]]; then
  ok "Bot Render"
else
  warn "Bot Render KO ou veille (Free tier dort après 15min) : ${bot:0:60}"
fi

# ─── 6. Supabase + doublons ────────────────────────────────
supa_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  "$SUPA_URL/rest/v1/orders?select=id&limit=1")
[ "$supa_code" = "200" ] && ok "Supabase reachable" || ko "Supabase HTTP $supa_code"

# Détecte les doublons d'orders (même payment_intent)
DUPS=$(curl -s --max-time 10 \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  "$SUPA_URL/rest/v1/orders?select=stripe_payment_intent" | python3 -c "
import json, sys
from collections import Counter
d = json.load(sys.stdin)
pis = [r['stripe_payment_intent'] for r in d if r.get('stripe_payment_intent')]
c = Counter(pis)
dups = [(k,v) for k,v in c.items() if v > 1]
print(len(dups))" 2>/dev/null)
[ "$DUPS" = "0" ] && ok "Pas de doublons Supabase" || ko "$DUPS doublon(s) order détecté"

# ─── 7. Stripe webhook actif ───────────────────────────────
if [ -n "$STRIPE_SECRET_KEY" ]; then
  events=$(curl -s -u "$STRIPE_SECRET_KEY:" "https://api.stripe.com/v1/webhook_endpoints" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for w in d.get('data', []):
    if 'safix59.fr' in w['url'] and w['status'] == 'enabled':
        print(len(w.get('enabled_events', [])))
        break
else: print(0)" 2>/dev/null)
  [ "$events" -ge 4 ] && ok "Stripe webhook ($events events)" || ko "Stripe webhook KO ou manque events"
fi

# ─── 8. Domaine www + SSL ──────────────────────────────────
www_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://www.safix59.fr/)
[ "$www_code" = "200" ] && ok "www.safix59.fr" || warn "www.safix59.fr HTTP $www_code"

# ─── Résultat ──────────────────────────────────────────────
echo ""
if [ "$ERRORS" = "0" ]; then
  echo "✅ TOUT VERT ($DUPS doublons, $PRICE_COUNT prix actifs)"
  exit 0
else
  echo "❌ $ERRORS ERREURS — investigate"
  exit 1
fi
