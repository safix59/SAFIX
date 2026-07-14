# Activer la « vraie » IA de l'assistant SAFIX — 100 % gratuit

L'assistant fonctionne **déjà** sans rien faire : un moteur de compréhension
maison (fautes, abréviations SMS, mémoire de conversation, 55 scénarios testés)
répond à la grande majorité des messages. Mais pour une compréhension **de
niveau IA** (n'importe quelle formulation, raisonnement, nuances), il suffit
d'ajouter **une clé gratuite**. Le site la détecte automatiquement.

Le système est une **cascade** : il utilise la première IA disponible et
bascule tout seul sur la suivante en cas de souci. Tu peux en mettre une seule.

## ⭐ Recommandé : Groq (gratuit, rapide, sans carte bancaire)

Groq fait tourner **Llama 3.3 70B** — très bon en français — gratuitement.

1. Va sur **console.groq.com** → connecte-toi (Google suffit).
2. Menu **API Keys** → **Create API Key** → donne un nom (« safix ») → **copie** la clé (commence par `gsk_…`).
3. Envoie-moi la clé : je l'installe dans Vercel en une commande et je teste en direct.
   *(Ou toi-même : Vercel → projet safix → Settings → Environment Variables → `GROQ_API_KEY` = la clé → Production → Redeploy.)*

## Alternative : Google Gemini (gratuit aussi)

1. Va sur **aistudio.google.com/apikey** → **Create API key**.
2. Copie la clé → variable Vercel `GEMINI_API_KEY`.

## Variables reconnues (une seule suffit)

| Variable | Fournisseur | Coût | Note |
|----------|-------------|------|------|
| `GROQ_API_KEY` | Groq (Llama 3.3 70B) | Gratuit | ⭐ recommandé, rapide |
| `GEMINI_API_KEY` | Google Gemini | Gratuit | bon secours |
| `MISTRAL_API_KEY` | Mistral (français) | Gratuit | optionnel |
| `ANTHROPIC_API_KEY` | Claude | Payant | qualité maximale si un jour souhaité |

Réglages avancés facultatifs : `GROQ_MODEL`, `GEMINI_MODEL`, `MISTRAL_MODEL`,
`ANTHROPIC_MODEL` pour changer de modèle sans toucher au code.

## Ce que la clé change concrètement

- **Côté client** (bulle de chat) : l'assistant comprend les formulations
  compliquées, raisonne sur le contexte, et n'escalade vers un conseiller que
  si c'est vraiment nécessaire.
- **Côté admin** (onglet Messages) : les 3 suggestions de réponse deviennent
  réellement contextuelles (jamais de « Bonjour » en pleine conversation,
  s'appuient sur le modèle et la panne déjà évoqués).

Sans clé, ces deux surfaces restent fonctionnelles grâce au moteur maison —
la clé les fait juste passer au niveau supérieur.

## Garde-fou

Quelle que soit l'IA branchée, elle ne reçoit **que des faits vérifiés**
(catalogue temps réel + informations du site) et a **interdiction d'inventer**
un prix, un délai ou une disponibilité. En cas de doute, elle passe la main à
un conseiller.

## Le moteur maison (sans clé) — solidité prouvée

Même **sans aucune clé**, l'assistant comprend la grande majorité des messages :
fautes d'orthographe/frappe, abréviations SMS, symptômes décrits avec ses mots,
mémoire de la conversation (modèle/panne déjà donnés), méta (« es-tu un
robot ? »), hors-sujet (redirection douce), et il **escalade honnêtement**
quand c'est hors catalogue (dégât liquide, Face ID, réseau…) au lieu d'inventer.

Deux bancs de test protègent ce moteur contre toute régression (**291
scénarios**, dont des centaines de cas adversariaux) :

```bash
node bot/nlu-bench/run.mjs    # 55 scénarios « cœur »
node bot/nlu-bench/deep.mjs   # 236 scénarios profonds / adversariaux
```

À **relancer avant tout déploiement** touchant l'assistant : les deux doivent
afficher 100 %.
