# Archive Utopya — base de référence FIGÉE

**Ne jamais modifier ni supprimer ces fichiers.** Ils constituent la photographie
complète et définitive de ce qui a été relevé chez Utopya avant l'arrêt du
scraping (interdiction du fournisseur, 2026-07-13) et servent de référence
permanente pour :

- le **comparatif de prix** avec tout nouveau fournisseur (Mobilax…) ;
- le **re-mappage du catalogue** (savoir exactement quelle pièce/qualité
  chaque carte du site représentait chez Utopya : gammes Relife, Soft OLED,
  Service Pack…, via les URL de `links-*.json`) ;
- l'**historique de dérive des prix** (analyse marge de sécurité du 15/07/2026).

| Fichier | Contenu | Date du relevé |
|---|---|---|
| `prices-2026-07-06.json` | Dernier relevé complet : prix d'achat (`basePrice`), prix final SAFIX, ruptures — 492 fiches | 6 juil. 2026 |
| `prices-2026-05-11.json` | Relevé archivé antérieur (comparaison sur 2 mois) | 11 mai 2026 |
| `links-2026-07-05.json` | Les 690 correspondances réparation × modèle → URL produit Utopya (avec gamme/qualité en `note`) | 5 juil. 2026 |
| `price-history-2026-05-04_au_2026-07-06.json` | Journal des 408 changements de prix/stock sur 5 relevés | 4 mai → 6 juil. 2026 |

Les fichiers de travail (`scraper/links.json`, `scraper/prices.json`,
`scraper/price-history.json`) restent les fichiers VIVANTS : ils évolueront
avec la migration fournisseur. Cette archive, elle, ne bouge pas.

Analyse associée : mémoire projet `safix-pricing-analysis` + artefact
« Analyse des prix & marge de sécurité » (15/07/2026).
