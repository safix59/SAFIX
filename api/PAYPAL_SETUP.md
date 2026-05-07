# 💳 PayPal SDK direct — Guide d'activation

## Pourquoi PayPal direct (vs PayPal-via-Stripe) ?

| | PayPal via Stripe | PayPal direct |
|---|---|---|
| Frais Stripe d'orchestration | **0,2 % + 0,10 €** | 0 € |
| Frais PayPal | 2,9 % + 0,35 € | 2,9 % + 0,35 € |
| **Total** | **~3,1 % + 0,45 €** | **2,9 % + 0,35 €** |
| Économie sur 1 € | — | ~10 c/€ |
| UX | redirect Stripe Checkout | redirect PayPal direct |
| Compte requis | Stripe seul | PayPal Business + Stripe |

**Économie moyenne** : ~0,2 % + 0,10 € par transaction PayPal. Sur 100 € → 30 c économisés.

## Étapes d'activation (~10 min)

### 1. Créer un compte PayPal Business (si pas déjà fait)
- Va sur https://www.paypal.com/fr/business
- Crée un compte **Business** (pas Personnel) avec le mail `chafiai.travail@gmail.com`
- Vérifie l'email + ajoute un compte bancaire

### 2. Récupérer les credentials API
- Connexion sur https://developer.paypal.com/dashboard/applications
- **Sandbox** (test) : crée une "REST API app" → tu obtiens `CLIENT_ID` + `SECRET`
- **Live** (production, plus tard) : pareil mais en mode Live

### 3. Configurer Vercel
Dans Vercel Dashboard → Settings → Environment Variables, ajoute :
```
PAYPAL_MODE          = sandbox       # ou 'live' en prod
PAYPAL_CLIENT_ID     = AeXXXXXX...   # ton Client ID
PAYPAL_CLIENT_SECRET = ECXXXXXX...   # ton Client Secret
```

### 4. Tester en sandbox
- Endpoints disponibles :
  - `POST /api/paypal-create-order` → crée l'order PayPal
  - `POST /api/paypal-capture-order` → capture (finalise) l'order
- Test rapide avec curl :
  ```bash
  curl -X POST https://safix59.fr/api/paypal-create-order \
    -H "Content-Type: application/json" \
    -d '{"total":50,"lineItems":[{"name":"Test","price":50,"qty":1}]}'
  # → renvoie {"id":"5O190127TN364715T"}
  ```

### 5. Front-end (à wirer après config Vercel OK)
À ajouter dans `index.html` (Claude le fera quand tu confirmes les credentials Vercel set) :
```html
<!-- SDK PayPal (chargé conditionnellement) -->
<script id="paypal-sdk-loader">
  if (window.SAFIX_CONFIG?.paypal?.enabled) {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${window.SAFIX_CONFIG.paypal.clientId}&currency=EUR&intent=capture`;
    document.head.appendChild(s);
  }
</script>
```
Et adapter le click handler du bouton PayPal pour utiliser `paypal.Buttons()` ou
faire le redirect PayPal direct (`https://www.paypal.com/checkoutnow?token=ID`).

### 6. Passer en mode Live (quand tu es prêt)
- Crée une "Live REST API app" sur PayPal Developer
- Mets à jour Vercel : `PAYPAL_MODE=live` + nouveaux client_id/secret
- Re-deploy : `vercel --prod`

## Sécurité

- ✅ `PAYPAL_CLIENT_SECRET` = backend uniquement (jamais exposé au front)
- ✅ Capture côté serveur uniquement (pas de manipulation côté client)
- ✅ Vérification du statut "COMPLETED" avant trigger bot
- ✅ Mêmes mécanismes anti-replay que Stripe webhook

## TODO après activation

- Factoriser `stripe-webhook.js` → `lib/order-pipeline.js` réutilisable par
  `paypal-capture-order.js` pour : insertion Supabase + trigger bot + emails Resend
- Tester end-to-end avec un compte sandbox PayPal
- Activer le mode live en production
