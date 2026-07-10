# SAFIX × Utopya — Scraper de prix automatisé

Récupère les prix **PRO connectés** sur [utopya.fr](https://www.utopya.fr), applique la marge :

```
final = ceil(prix_utopya × 1.20) + 25€  (réparations)
final = ceil(prix_utopya × 1.20)        (accessoires)
```

…et écrit `prices.json`. Le `index.html` SAFIX charge ce fichier au démarrage et patche dynamiquement ses prix internes. Les produits en rupture sur Utopya s'affichent automatiquement **« Rupture de stock »** en rouge sur le site.

---

## 1. Installation (une seule fois)

```bash
cd scraper
npm install            # installe playwright + dépendances + Chromium headless
cp .env.example .env   # crée votre fichier d'identifiants
```

Ouvrez `.env` et renseignez :

```
UTOPYA_EMAIL=votre.email@exemple.fr
UTOPYA_PASSWORD=votre_mot_de_passe
```

> 🔐 `.env` et `auth.json` sont **ignorés par git** (voir `.gitignore`). Vos identifiants ne quittent jamais votre machine.

---

## 2. Premier login (obligatoire)

```bash
npm run login
```

Le scraper ouvre Chromium en arrière-plan, se connecte à Utopya, et sauvegarde la session dans `auth.json`. Les exécutions suivantes réutiliseront cette session sans re-login (jusqu'à expiration).

Si Cloudflare ou Utopya bloque, lancez en mode visible pour debug :

```bash
node run.js --login-only --headed
```

---

## 3. Configurer les liens (`links.json`)

Format : tableau d'objets, **un par couple (réparation, modèle iPhone)**.

```json
[
  {
    "url": "https://www.utopya.fr/ecran-complet-iphone-14-pro.html",
    "repair_id": "ecran_premium",
    "model": "iPhone 14 Pro",
    "category": "repair"
  },
  {
    "url": "https://www.utopya.fr/batterie-iphone-13-haute-capacite-ti.html",
    "repair_id": "batterie",
    "model": "iPhone 13",
    "category": "repair"
  }
]
```

### Champs

| Champ | Obligatoire | Valeurs | Rôle |
|---|---|---|---|
| `url` | ✅ | URL Utopya complète | Page produit à scraper |
| `repair_id` | ✅ | doit correspondre à un `id` du `index.html` (ex `ecran_premium`, `batterie`, `connecteur_de_charge`…) | Lien avec votre site |
| `model` | ✅ | nom exact du modèle dans `index.html` (ex `iPhone 14 Pro`) | Lien avec votre site |
| `category` | ✅ | `"repair"` ou `"accessory"` | Détermine si la marge fixe +25€ s'applique |
| `note` | ❌ | texte libre | Aide-mémoire interne |

### IDs de réparations valides (extraits de `index.html`)

**Réparations (`category: "repair"`)** :
`ecran_original`, `ecran_premium`, `ecran_standard`, `ecran_eco`, `vitre_arriere`, `batterie`, `connecteur_de_charge`, `micro`, `haut_parleur`, `camera_arriere`, `camera_avant`, `ecouteur_interne`, `bouton_volume`, `bouton_power`, `vibreur`, `lentille_camera_arriere`

**Accessoires (`category: "accessory"`)** :
`verre_trempe_classique`, `verre_trempe_anti_espion`, `cable_usb_c`, `cable_usb_c_lightning`, `adaptateur_secteur_usb_c`

> ⚠️ Si vous ajoutez un nouvel ID dans `links.json`, il sera ignoré par le front (sauf si l'ID existe aussi dans `data.repairs[].repairs[]` du `index.html`).

---

## 4. Lancer le scraping

```bash
npm run scrape
```

Sortie : `scraper/prices.json` + logs dans `scraper/logs/`.

### Tester un seul lien (debug rapide)

```bash
node run.js --url "https://www.utopya.fr/ecran-complet-iphone-14-pro.html"
```

Affiche le prix scrappé brut sans modifier `prices.json`.

### Mode visible (voir le navigateur)

```bash
node run.js --headed
```

---

## 5. Automatisation (cron)

### macOS / Linux

Toutes les 6 heures, par exemple :

```bash
crontab -e
```

Ajouter :

```
0 */6 * * * cd ~/SAFIX/scraper && /usr/local/bin/node run.js >> logs/cron.log 2>&1
```

(Adaptez `/usr/local/bin/node` au chemin réel — `which node` pour le trouver.)

### macOS launchd (alternative recommandée)

Voir Apple TN — un fichier plist dans `~/Library/LaunchAgents/`.

### GitHub Actions

Si vous versionnez le projet, vous pouvez planifier un workflow `cron` qui pousse `prices.json` au repo. Identifiants à mettre en **secrets** GitHub (`UTOPYA_EMAIL`, `UTOPYA_PASSWORD`).

---

## 6. Format de `prices.json`

```json
{
  "generatedAt": "2026-04-28T16:30:00.000Z",
  "finishedAt":  "2026-04-28T16:31:42.000Z",
  "source": "utopya.fr (PRO)",
  "stats": { "ok": 87, "oos": 5, "fail": 2, "changed": 12, "fallback": 1 },
  "prices": {
    "ecran_premium": {
      "iPhone 14 Pro": {
        "url": "https://www.utopya.fr/ecran-complet-iphone-14-pro.html",
        "category": "repair",
        "basePrice": 14.80,
        "outOfStock": false,
        "step1": 18,
        "margin": 25,
        "final": 43,
        "priceSource": "attr:[data-price-amount]",
        "checkedAt": "2026-04-28T16:30:12.000Z"
      }
    },
    "batterie": {
      "iPhone 13": {
        "outOfStock": true,
        "final": null,
        ...
      }
    }
  }
}
```

Chaque entrée contient :
- `basePrice` : prix scrapé Utopya brut
- `step1` : `ceil(base × 1.20)`
- `margin` : 25 (repair) ou 0 (accessory)
- `final` : prix affiché sur le site SAFIX
- `outOfStock` : true → carte rouge "Rupture de stock"
- `fallback: true` : valeur précédente conservée car scraping KO

---

## 7. Logs

`scraper/logs/` :
- `run-<timestamp>.log` — log complet de chaque exécution
- `errors.log` — erreurs cumulées
- `changes.log` — uniquement les variations de prix / stock détectées

---

## 8. Comportement de fallback

- Prix introuvable + valeur précédente existante → conserve l'ancienne valeur, marque `fallback: true`
- Prix introuvable + aucune valeur précédente → entrée avec `final: null`, le front retombera sur le prix codé en dur du `index.html`
- Session expirée → re-login automatique au prochain run

---

## 9. Anti-blocage

- Concurrence par défaut limitée à **3 requêtes simultanées** (réglable via `SCRAPE_CONCURRENCY` dans `.env`)
- Chromium réel → bypass Cloudflare naturel
- Session persistée → pas de login répété
- Si vous traitez 200+ liens, baisser à `SCRAPE_CONCURRENCY=2` et planifier la nuit

---

## 10. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `Login Utopya échoué` | Identifiants ou Cloudflare | `node run.js --login-only --headed` pour voir |
| Tous les prix `null` | Sélecteurs Utopya ont bougé | Ouvrir un produit dans le navigateur, inspecter, ajuster `lib/scrape.js` |
| Site SAFIX ignore le `prices.json` | Fichier non servi (CORS / file://) | Servir via `python3 -m http.server` ou un serveur local |
| `auth.json: cannot be opened` | Premier run | Lancer `npm run login` une fois |

---

## Architecture des fichiers

```
wIA/
├── index.html            ← site SAFIX (charge prices.json au boot)
├── images/               ← icônes/visuels
└── scraper/
    ├── package.json
    ├── .env              ← VOS identifiants (ignoré git)
    ├── .env.example
    ├── .gitignore
    ├── links.json        ← config des URLs à scraper
    ├── prices.json       ← sortie auto (consommée par index.html)
    ├── auth.json         ← session Utopya (ignoré git)
    ├── run.js            ← orchestrateur
    ├── lib/
    │   ├── auth.js       ← login + session
    │   ├── scrape.js     ← extraction prix + stock
    │   ├── pricing.js    ← formule +20% +25€ ceil
    │   └── logger.js     ← logs run/changes/errors
    ├── logs/
    └── README.md
```
