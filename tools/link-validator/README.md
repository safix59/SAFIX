# 🔗 Validateur de liens Utopya — SAFIX

Outil interactif pour vérifier visuellement les 393 liens Utopya en ~7s/lien.

## ▶ Lancer l'outil

Le validateur fonctionne **localement** dans ton navigateur. Il faut un mini-serveur HTTP (1 commande) pour qu'il puisse charger `links.json`.

### Méthode 1 — Python (déjà installé sur Mac)

```bash
cd /Users/sami/Downloads/wIA/tools/link-validator
python3 -m http.server 8000
```

Puis ouvre : **http://localhost:8000/**

### Méthode 2 — Node (si tu as `npx`)

```bash
cd /Users/sami/Downloads/wIA/tools/link-validator
npx serve -l 8000
```

Puis ouvre : **http://localhost:8000/**

## 🎮 Comment ça marche

1. Clique **▶ Démarrer la validation**
2. Le 1er lien s'ouvre dans un onglet "safix_utopya_validator"
3. Tu as **7 secondes** pour vérifier que la pièce correspond
4. Si **bon** → ne fais rien, ça passe au suivant après 7s
5. Si **mauvais** → clique **✗ Mauvais lien** ou tape **N**
6. Besoin de plus de temps ? → **+ 7s** ou tape **Espace**

## ⌨️ Raccourcis clavier

| Touche | Action |
|---|---|
| `N` | ✗ Marquer comme mauvais |
| `Enter` | ✓ Valider maintenant (OK + suivant) |
| `Espace` | + 7 secondes |
| `←` | ← Précédent |
| `P` | ⏸ Pause / Reprendre |

## 💾 Sauvegarde automatique

Ta progression est sauvée dans `localStorage` après chaque lien. Tu peux **fermer la page et reprendre plus tard** — au prochain lancement, l'outil te proposera de reprendre où tu t'étais arrêté.

## 📤 Export final

À la fin (lien 393), l'outil affiche :
- **X liens BONS**
- **Y liens À CORRIGER**
- La liste des liens à corriger
- Un export Markdown prêt à coller dans Claude pour qu'il cherche les bonnes pièces

## 🔄 Recommencer

Bouton **↻ Tout recommencer** sur l'écran d'intro pour reset la progression.

---

**Source des données** : `links.json` (393 liens, généré depuis `NOUVEAUX_LIENS_A_VALIDER.md`)

**Pour régénérer `links.json`** après une modif du `.md` :

```bash
node -e "
const fs=require('fs');
const md=fs.readFileSync('../../NOUVEAUX_LIENS_A_VALIDER.md','utf8');
const links=[]; let cat=null;
md.split('\n').forEach(l=>{
  const c=l.match(/^###\s+(.+?)(?:\s+—.*)?\$/); if(c){cat=c[1].trim();return;}
  const i=l.match(/^-\s+\*\*([^*]+)\*\*\s+\[([^\]]+)\]\s+→\s+(https?:\/\/\S+)/);
  if(i)links.push({category:cat,model:i[1].trim(),type:i[2].trim(),url:i[3].trim()});
});
fs.writeFileSync('./links.json',JSON.stringify(links,null,2));
console.log('Generated',links.length,'links');"
```
