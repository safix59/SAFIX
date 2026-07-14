# Boîte support — voir les e-mails de `support@safix59.fr` dans le Dashboard

## ✅ Déjà en place (rien à faire)

- Le site sait **recevoir et stocker** les e-mails (aucune table à créer, rien à toucher dans Supabase).
- Le **code secret** est déjà configuré dans Vercel
  (visible dans : Vercel → projet *safix* → **Settings → Environment Variables → `INBOUND_EMAIL_TOKEN`** → œil 👁 pour l'afficher).
- L'onglet **« E-mails support »** du Dashboard est en ligne (badge rouge, compteur, aperçu, statuts Non lu / Lu / Traité).

## 👉 Il reste 2 étapes (~10 min, une seule fois)

L'adresse `support@safix59.fr` est une simple **redirection** (pas une vraie boîte),
donc le site ne peut pas « aller lire » les e-mails. La solution : envoyer une
**copie** de chaque e-mail à un petit service gratuit (Pipedream) qui prévient le
site. Tu continues à tout recevoir sur ta boîte perso comme avant.

### Étape 1 — Pipedream (le « facteur » qui prévient le site)

1. Va sur **pipedream.com** → crée un compte (gratuit).
2. Clique **New Workflow** → comme déclencheur (*trigger*), choisis **Email**.
   → Pipedream t'affiche une adresse du type `xxxx@pipedream.net` : **copie-la** (il en faut pour l'étape 2).
3. Clique **+** pour ajouter une étape → choisis **Run custom code** (Node) → efface tout et colle :

```javascript
export default defineComponent({
  async run({ steps }) {
    const e = steps.trigger.event;
    await fetch("https://safix59.fr/api/admin?action=inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbound-token": "COLLE_ICI_LE_CODE_SECRET",
      },
      body: JSON.stringify({
        from: e.headers?.from || e.from || "",
        subject: e.subject || "",
        text: e.text || e.html || "",
        date: e.headers?.date || "",
        message_id: e.headers?.["message-id"] || "",
      }),
    });
  },
});
```

4. Remplace `COLLE_ICI_LE_CODE_SECRET` par le code secret (dans Vercel, voir plus haut).
5. Clique **Deploy** (en haut à droite). C'est tout pour Pipedream.

### Étape 2 — OVH (envoyer une copie au facteur)

1. Manager OVH → **E-mails** → ton domaine `safix59.fr` → **Redirections**.
2. Sur la redirection de `support@safix59.fr` : **ajoute** l'adresse `xxxx@pipedream.net`
   (copiée à l'étape 1) comme **destinataire supplémentaire** — ne supprime pas ta boîte perso.

## 🧪 Vérifier

Envoie un e-mail à `support@safix59.fr` depuis n'importe quelle adresse.
En quelques secondes il apparaît dans **Dashboard → E-mails support**, en « Non lu »,
avec le badge rouge et une notification.
