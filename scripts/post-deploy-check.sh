#!/bin/bash
# Vérifications automatiques après chaque deploy Vercel
# Usage : ./scripts/post-deploy-check.sh [URL]
# Sortie code 0 si tout OK, 1 si un check échoue.
set -e

URL="${1:-https://safix59.fr}"
ERRORS=0
echo "═══ POST-DEPLOY CHECK pour $URL ═══"

check() {
  local name="$1"
  local cmd="$2"
  local expected="$3"
  local result=$(eval "$cmd")
  if [[ "$result" == *"$expected"* ]]; then
    echo "  ✅ $name (got $result)"
  else
    echo "  ❌ $name : got '$result', expected '$expected'"
    ERRORS=$((ERRORS+1))
  fi
}

check "Site front"        "curl -s -o /dev/null -w '%{http_code}' $URL/"                                          "200"
check "API checkout"      "curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' -H 'Content-Type: application/json' $URL/api/create-checkout-session" "400"
check "API payment intent" "curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' -H 'Content-Type: application/json' $URL/api/create-payment-intent" "400"
check "API webhook"        "curl -s -o /dev/null -w '%{http_code}' -X POST $URL/api/stripe-webhook"               "400"
check "Prices JSON"        "curl -s -o /dev/null -w '%{http_code}' $URL/scraper/prices.json"                       "200"
check "Links JSON"         "curl -s -o /dev/null -w '%{http_code}' $URL/scraper/links.json"                        "200"
check "Manifest"           "curl -s -o /dev/null -w '%{http_code}' $URL/manifest.json"                            "200"

# Taille prices.json
PRICES_SIZE=$(curl -s "$URL/scraper/prices.json" | wc -c)
if [ "$PRICES_SIZE" -lt 10000 ]; then
  echo "  ❌ Prices JSON trop petit ($PRICES_SIZE bytes) — données manquantes"
  ERRORS=$((ERRORS+1))
else
  echo "  ✅ Prices JSON taille OK ($PRICES_SIZE bytes)"
fi

# Au moins 100 prix actifs
HAS_PRICES=$(curl -s "$URL/scraper/prices.json" | python3 -c "
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
print(ok)
")
if [ "$HAS_PRICES" -gt "100" ]; then
  echo "  ✅ Prices count OK ($HAS_PRICES prix actifs)"
else
  echo "  ❌ Trop peu de prix actifs ($HAS_PRICES) — relance scraper requise"
  ERRORS=$((ERRORS+1))
fi

# Bot Render
BOT_HEALTH=$(curl -s --max-time 10 https://safix-bot.onrender.com/ | head -c 50)
if [[ "$BOT_HEALTH" == *'"ok":true'* ]]; then
  echo "  ✅ Bot Render"
else
  echo "  ⚠️  Bot Render KO ou mise en veille (Free tier sleeps après 15 min) : $BOT_HEALTH"
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ TOUTES VÉRIFICATIONS OK"
  exit 0
else
  echo "❌ $ERRORS ERREURS — INVESTIGUER"
  exit 1
fi
