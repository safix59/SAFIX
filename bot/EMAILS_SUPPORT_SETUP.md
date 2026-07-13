# Boîte support centralisée — e-mails `support@safix59.fr`

Ce système affiche dans le Dashboard (**onglet « E-mails support »**) tous les
e-mails reçus sur `support@safix59.fr` : notification, compteur de non-lus,
badge rouge, aperçu du message, et statut (**Non lu / Lu / Traité**).

Comme `support@safix59.fr` est une **redirection OVH** (pas de boîte IMAP), on ne
peut pas « aller lire » la boîte. On procède donc dans l'autre sens : chaque
e-mail est **poussé** vers le site via un petit webhook. Rien ne change pour toi :
tu continues à recevoir les e-mails normalement sur ta boîte perso, on ajoute
seulement une **copie** vers un service qui prévient le Dashboard.

Il y a **3 étapes** (~15 min, une seule fois).

---

## Étape 1 — Créer la table dans Supabase

Supabase → **SQL Editor** → colle le bloc `support_emails` du fichier
[`SUPABASE_SCHEMA.sql`](./SUPABASE_SCHEMA.sql) (déjà prêt) → **Run**.

Tant que la table n'existe pas, l'onglet affiche un bandeau d'avertissement
(« Boîte support non initialisée ») — c'est normal.

---

## Étape 2 — Définir le jeton secret dans Vercel

Le webhook est protégé par un secret partagé pour que **seul** ton service
d'e-mail puisse déposer des messages.

Vercel → projet SAFIX → **Settings → Environment Variables** → **Add** :

| Name | Value |
|------|-------|
| `INBOUND_EMAIL_TOKEN` | `jUy7ewbexnKlPWU_rxlOdsI3lI1rkF0L` |

> Tu peux garder ce jeton suggéré ou en générer un autre (n'importe quelle
> longue chaîne aléatoire). **Applique-le à Production**, puis **redeploy** pour
> qu'il soit pris en compte.

---

## Étape 3 — Brancher la réception des e-mails vers le webhook

But : faire en sorte qu'une **copie** de chaque e-mail reçu sur
`support@safix59.fr` déclenche un appel à :

```
POST https://safix59.fr/api/admin?action=inbound-email
En-tête :  x-inbound-token: <ton INBOUND_EMAIL_TOKEN>
Corps (JSON) :
{
  "from":       "{{ expéditeur, ex. \"Julie Mercier\" <julie@gmail.com> }}",
  "subject":    "{{ objet }}",
  "text":       "{{ corps du message en texte }}",
  "date":       "{{ date de réception }}",
  "message_id": "{{ en-tête Message-Id (anti-doublon) }}"
}
```

Le point de terminaison est **tolérant** : si un champ porte un autre nom
courant (`sender`, `body`, `Subject`, `body-plain`…), il est quand même reconnu.
Seul `from` (ou `sender`) et un contenu sont vraiment utiles ; le reste est
optionnel.

### Option recommandée — Pipedream (gratuit, fiable)

1. Crée un compte sur **pipedream.com** → **New Workflow**.
2. **Trigger** : choisis **« Email »**. Pipedream te donne une adresse du type
   `xxxxxx@pipedream.net`. **Copie-la.**
3. **Étape suivante** : ajoute une action **« HTTP / Webhook → POST request »** :
   - **URL** : `https://safix59.fr/api/admin?action=inbound-email`
   - **Headers** : `x-inbound-token` = ton `INBOUND_EMAIL_TOKEN`
   - **Body** (JSON) :
     ```
     from        →  {{steps.trigger.event.headers.from}}
     subject     →  {{steps.trigger.event.subject}}
     text        →  {{steps.trigger.event.text}}
     date        →  {{steps.trigger.event.headers.date}}
     message_id  →  {{steps.trigger.event.headers["message-id"]}}
     ```
   - **Deploy**.
4. **OVH** → Emails → redirection de `support@safix59.fr` : **ajoute** l'adresse
   `xxxxxx@pipedream.net` **en plus** de ta boîte perso (OVH autorise plusieurs
   destinataires). Tu continues donc à tout recevoir chez toi, et Pipedream
   reçoit une copie qui alimente le Dashboard.

### Alternative — Cloudflare Email Workers

Si le domaine `safix59.fr` gère ses e-mails via **Cloudflare Email Routing**, tu
peux créer un **Email Worker** qui fait le `fetch()` POST directement vers le
webhook (avec l'en-tête `x-inbound-token`). C'est l'option la plus robuste, mais
elle suppose de router l'e-mail du domaine par Cloudflare.

---

## Vérifier que ça marche

Envoie un e-mail de test à `support@safix59.fr`. En quelques secondes il doit
apparaître dans **Dashboard → E-mails support**, avec :

- une **notification** (toast) « Nouvel e-mail support »,
- le **badge rouge** + compteur dans la barre latérale,
- le message en **Non lu** (gras), avec expéditeur, objet, date et aperçu.

Cliquer dessus le passe en **Lu**. Le bouton **« Marquer traité »** le clôture.
**« Répondre par e-mail »** ouvre ton client mail pré-rempli vers l'expéditeur.

---

## Test manuel du webhook (facultatif)

Depuis un terminal (remplace le jeton) :

```bash
curl -X POST "https://safix59.fr/api/admin?action=inbound-email" \
  -H "x-inbound-token: jUy7ewbexnKlPWU_rxlOdsI3lI1rkF0L" \
  -H "Content-Type: application/json" \
  -d '{"from":"\"Client Test\" <test@example.com>","subject":"Essai support","text":"Ceci est un test.","message_id":"test-001"}'
```

Réponse attendue : `{"ok":true}`. Le message doit apparaître dans le Dashboard.
