#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────
# Contrôle OBLIGATOIRE avant tout déploiement d'index.html :
#   python3 tools/check-inline-js.py
#
# Valide la syntaxe de CHAQUE bloc <script> inline (via `node --check`) et
# des blocs de données (JSON-LD / importmap, via json.loads). Une seule
# apostrophe non échappée dans un dictionnaire i18n suffit à tuer TOUT le
# script principal (~275 Ko : rendu des cartes, panier, chat, paiement) —
# et l'erreur est INVISIBLE en prod car le site neutralise console.*
# (anti-devtools). C'est arrivé le 18/07/2026 (« provider's fees » dans
# legal.cgv.p3 EN) : site en ligne mais cliquer un modèle ne faisait rien.
# ─────────────────────────────────────────────────────────────────────────
import json, re, subprocess, sys, tempfile, os

HTML = os.path.join(os.path.dirname(__file__), '..', 'index.html')
html = open(HTML, encoding='utf-8').read()
scripts = re.findall(r'<script(?![^>]*src=)([^>]*)>(.*?)</script>', html, re.S)

fail = 0
for i, (attrs, body) in enumerate(scripts):
    if not body.strip():
        continue
    if 'ld+json' in attrs or 'importmap' in attrs:
        try:
            json.loads(body)
            print(f"  bloc {i} (données) : JSON OK")
        except Exception as e:
            fail += 1
            print(f"  bloc {i} (données) : ❌ JSON invalide — {e}")
        continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(body)
        path = f.name
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    os.unlink(path)
    if r.returncode == 0:
        print(f"  bloc {i} : {len(body)} caractères → OK")
    else:
        fail += 1
        err = next((l for l in r.stderr.split('\n') if 'SyntaxError' in l), r.stderr.strip())
        print(f"  bloc {i} : ❌ {err}")

if fail:
    print(f"\n❌ {fail} bloc(s) en erreur — NE PAS DÉPLOYER.")
    sys.exit(1)
print("\n✅ Tous les scripts inline d'index.html sont valides.")
