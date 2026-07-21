// ─────────────────────────────────────────────────────────────────────────
// CARTES — CMS du contenu du site : visibilité, promotions, textes, prix,
// ordre, création/duplication de cartes. Zéro code : tout est stocké dans
// settings/cards_config (Supabase) et appliqué par le site (≤ 90 s) ET par
// le serveur de paiement (_prices.js) → affiché = facturé, toujours.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { CardModelOverride, CardOverride, CardPromo, CardsHistorySnap, CardsMap, PriceEntry } from '../lib/api';
import { Badge, Button, Card, Empty, Modal, SearchInput, Segmented, Switch, useToast } from '../components';
import { Icon, type IconName } from '../icons';

// Catalogue de base du site (miroir de index.html — les cartes « natives »).
// Les cartes créées depuis cette page s'y ajoutent avec custom:true.
const BASE: { id: string; name: string; desc: string; cat: string }[] = [
  { id: 'ecran_original', name: 'Écran Original', desc: 'Pièce Apple® certifiée', cat: 'Réparations' },
  { id: 'ecran_premium', name: 'Écran Premium', desc: 'Meilleure qualité', cat: 'Réparations' },
  { id: 'ecran_standard', name: 'Écran Standard', desc: 'Meilleur rapport qualité/prix', cat: 'Réparations' },
  { id: 'ecran_eco', name: 'Écran Éco', desc: 'Idéal pour petit budget', cat: 'Réparations' },
  { id: 'vitre_arriere', name: 'Châssis', desc: 'Le dos de votre appareil est fissuré', cat: 'Réparations' },
  { id: 'batterie_original', name: 'Batterie Original', desc: 'Pièce Apple® certifiée', cat: 'Réparations' },
  { id: 'batterie', name: 'Batterie', desc: "Perte d'autonomie partielle ou totale", cat: 'Réparations' },
  { id: 'connecteur_de_charge', name: 'Connecteur de charge', desc: 'Problème de charge ou connexion PC', cat: 'Réparations' },
  { id: 'camera_arriere', name: 'Caméra arrière', desc: 'Photos floues ou caméra HS', cat: 'Réparations' },
  { id: 'camera_avant', name: 'Caméra avant', desc: 'Selfies impossibles', cat: 'Réparations' },
  { id: 'lentille_camera_arriere', name: 'Lentille caméra', desc: 'Vitre de protection caméra brisée', cat: 'Réparations' },
  { id: 'ecouteur_interne', name: 'Écouteur interne', desc: "N'entend plus ses interlocuteurs", cat: 'Réparations' },
  { id: 'haut_parleur', name: 'Haut-parleur', desc: 'Son faible ou inexistant', cat: 'Réparations' },
  { id: 'micro', name: 'Micro', desc: 'Vos interlocuteurs ne vous entendent plus', cat: 'Réparations' },
  { id: 'vibreur', name: 'Vibreur', desc: 'Ne vibre plus', cat: 'Réparations' },
  { id: 'bouton_power', name: 'Bouton power', desc: 'Bouton allumage HS', cat: 'Réparations' },
  { id: 'bouton_volume', name: 'Bouton volume', desc: 'Boutons volume HS', cat: 'Réparations' },
  { id: 'verre_trempe_classique', name: 'Verre Trempé Classique', desc: 'Protection contre impacts et rayures', cat: 'Protections' },
  { id: 'verre_trempe_anti_espion', name: 'Verre Trempé Anti-Espion', desc: 'Confidentialité sous tous les angles', cat: 'Protections' },
  { id: 'diagnostic_expert', name: 'Diagnostic expert', desc: 'Panne inconnue ? On identifie le problème', cat: 'Services' },
  { id: 'deblocage_bootloop', name: 'Déblocage bootloop', desc: 'iPhone bloqué sur la pomme', cat: 'Services' },
  { id: 'restauration_usine', name: 'Restauration usine', desc: 'Remise à zéro complète', cat: 'Services' },
  { id: 'recuperation_de_donnees', name: 'Récupération de données', desc: 'Photos, contacts, documents', cat: 'Services' },
  { id: 'reparation_express', name: 'Réparation Express', desc: 'Votre réparation en priorité absolue', cat: 'Services' },
];
const CATS = ['Réparations', 'Protections', 'Services', 'Accessoires'];
const PROMO_COLORS = ['#0A84FF', '#FF3B30', '#FF9500', '#30D158', '#BF5AF2', '#FF2D55'];
// Alias d'icônes (miroir de index.html) : certaines cartes réutilisent
// l'icône d'une autre (ex. Batterie Original → Batterie).
const ICON_ALIAS: Record<string, string> = { batterie_original: 'batterie' };
const iconUrl = (id: string) => `https://safix59.fr/Icon/${ICON_ALIAS[id] || id}.webp`;

type Row = { id: string; name: string; desc: string; cat: string; custom: boolean; ov: CardOverride | null; baseIdx: number };

function promoIsLive(p?: CardPromo | null): boolean {
  if (!p || !p.active) return false;
  const n = Date.now();
  if (p.start && n < Date.parse(p.start)) return false;
  if (p.end && n > Date.parse(p.end) + 86399999) return false;
  return true;
}
function promoLabel(p: CardPromo): string {
  return p.label || (p.type === 'percent' ? `-${p.value ?? 0} %` : p.type === 'amount' ? `-${p.value ?? 0} €` : 'PROMO');
}

// ─── Briques UI de l'éditeur (style Réglages iOS : sobre, aéré, lisible) ───
const INPUT = 'w-full h-10 px-3 rounded-ctl bg-panel2 border border-line text-[13.5px] text-fg placeholder:text-fg3 outline-none transition-all duration-150 focus:border-accent/60 focus:shadow-focus';

// Pastille « Hérité » : le champ suit le réglage général tant qu'il n'est
// pas personnalisé pour le modèle choisi.
function InheritChip() {
  return (
    <span className="inline-flex items-center px-1.5 py-px rounded-full bg-panel2 border border-line text-[9.5px] font-bold uppercase tracking-wider text-fg3">
      Hérité
    </span>
  );
}

// Champ labellisé : libellé net + contrôle + aide discrète en dessous.
function Field({ label, inherited, hint, children }: {
  label: string; inherited?: boolean; hint?: ReactNode; children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-fg2">
        {label}
        {inherited && <InheritChip />}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-fg3 leading-relaxed">{hint}</p>}
    </label>
  );
}

// Section repliable (accordéon) : icône, titre, résumé de l'état visible
// même repliée (comme Réglages iOS), chevron animé, dépliage fluide via
// grid-template-rows (aucune mesure JS, hauteur naturelle).
function Section({ icon, title, summary, open, onToggle, badge, children }: {
  icon: IconName; title: string; summary?: ReactNode; badge?: ReactNode;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border transition-colors duration-200 ${open ? 'border-accent/35 bg-panel shadow-soft' : 'border-line bg-panel hover:border-line2'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl">
        <span className={`grid place-items-center h-8 w-8 rounded-[10px] shrink-0 transition-colors duration-200 ${open ? 'bg-accent/12 text-accentFg' : 'bg-panel2 text-fg3'}`}>
          <Icon name={icon} size={16} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 text-[13.5px] font-semibold leading-tight">{title}{badge}</span>
          {summary && <span className="block text-[11.5px] text-fg3 truncate mt-0.5">{summary}</span>}
        </span>
        <Icon name="chevronD" size={15} className={`text-fg3 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0.5 space-y-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Aperçu fidèle d'une carte telle qu'elle apparaît sur le site (fond sombre).
function SitePreview({ row, ov, computedBase }: { row: { name: string; desc: string }; ov: CardOverride; computedBase?: number | null }) {
  const promo = ov.promo && promoIsLive(ov.promo) ? ov.promo : null;
  // Priorité d'affichage : prix fixe > prix calculé par marge > exemple 49 €.
  const exact = ov.price != null && Number.isFinite(Number(ov.price));
  const base = exact ? Number(ov.price) : (computedBase != null ? computedBase : 49);
  const isExample = !exact && computedBase == null;
  const promoPrice = promo && promo.type === 'percent' ? Math.max(1, Math.round(base * (1 - (promo.value ?? 0) / 100)))
    : promo && promo.type === 'amount' ? Math.max(1, Math.round(base - (promo.value ?? 0))) : null;
  return (
    <div className="rounded-xl p-4" style={{ background: '#050508' }}>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#8a93a0' }}>
        Aperçu sur le site {isExample && <span className="normal-case font-medium">(prix d'exemple — le vrai prix vient du catalogue temps réel)</span>}
      </div>
      <div className="relative flex items-center gap-3 rounded-2xl px-4 py-3.5"
        style={{ background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.09)', opacity: ov.hidden ? 0.35 : 1 }}>
        {promo && (
          <span className="absolute -top-0 right-2.5 translate-y-[8px] px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider text-white"
            style={{ background: promo.color || '#0A84FF' }}>{promoLabel(promo)}</span>
        )}
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(10,132,255,.14)' }}>
          <span className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg,#0A84FF,#5AC8FA)' }} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-white truncate">{ov.title || row.name}</span>
          <span className="block text-[11.5px] truncate" style={{ color: '#98a2ae' }}>{ov.subtitle ?? row.desc}</span>
        </span>
        <span className="text-right shrink-0">
          {promoPrice != null && <span className="block text-[11px] line-through" style={{ color: '#6b7480' }}>{base} €</span>}
          <span className="text-[15px] font-bold" style={{ color: '#5AC8FA' }}>{promoPrice != null ? promoPrice : base} €</span>
        </span>
      </div>
      {ov.hidden && <div className="mt-2 text-[11px]" style={{ color: '#8a93a0' }}>Carte masquée : elle n'apparaît pas sur le site.</div>}
    </div>
  );
}

export function Cartes() {
  const toast = useToast();
  const [cfg, setCfg] = useState<CardsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('Tout');
  const [status, setStatus] = useState<'tous' | 'visibles' | 'masquées' | 'promo'>('tous');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardOverride | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [snaps, setSnaps] = useState<CardsHistorySnap[]>([]);
  // Portée d'édition : 'ALL' = réglage général, sinon un modèle précis
  // (« iPhone 13 Pro ») dont la couche écrase le général champ à champ.
  const [scope, setScope] = useState<string>('ALL');
  const [models, setModels] = useState<string[]>([]);
  // Catalogue de prix complet (prices.json) : donne, par carte et par modèle,
  // le prix fournisseur (step1), la marge scraper et le prix final — pour
  // afficher la transparence du calcul dans l'éditeur.
  const [priceDoc, setPriceDoc] = useState<Record<string, Record<string, PriceEntry>>>({});
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('https://safix59.fr/scraper/prices.json');
        const j = (await r.json()) as { prices?: Record<string, Record<string, PriceEntry>> };
        const prices = j.prices || {};
        setPriceDoc(prices);
        const set = new Set<string>();
        Object.values(prices).forEach((catMap) => Object.keys(catMap).forEach((m) => { if (m !== 'default') set.add(m); }));
        // Classement du plus récent au plus ancien. Le numéro de GÉNÉRATION
        // seulement (« iPhone 13 ») — jamais une année entre parenthèses
        // (« SE (2022) » se classait sinon tout en haut avec v=2022).
        const rank = (m: string) => {
          const s = m.toLowerCase();
          const n = /iphone\s*(\d{1,2})\b/.exec(s);
          let v = n ? Number(n[1]) : /\bx[sr]?\b/.test(s) ? 10 : /\bse\b/.test(s) ? 7 : 0;
          if (/pro max/.test(s)) v += 0.4; else if (/pro/.test(s)) v += 0.3;
          else if (/plus|max/.test(s)) v += 0.2; else if (/mini|\de\b/.test(s)) v += 0.1;
          const yr = /\((\d{4})\)/.exec(s); if (yr) v += (Number(yr[1]) % 100) / 1000; // SE (2022) > SE (2020)
          return v;
        };
        setModels([...set].sort((a, b) => rank(b) - rank(a)));
      } catch { /* liste indisponible → portée générale seulement */ }
    })();
  }, []);
  // Infos de prix scraper pour (carte, modèle). En portée générale, on prend
  // le premier modèle disponible comme exemple représentatif.
  const priceInfoFor = (repairId: string, model: string): PriceEntry | null => {
    const cat = priceDoc[repairId];
    if (!cat) return null;
    if (model && model !== 'ALL' && cat[model]) return cat[model];
    const firstModel = models.find((m) => cat[m]);
    return firstModel ? cat[firstModel] : null;
  };

  // La sauvegarde n'est autorisée qu'après un chargement RÉUSSI de la config :
  // sinon un enregistrement partirait d'un état vide et écraserait toutes les
  // cartes (promos, masquages, prix) côté serveur.
  const [cfgReady, setCfgReady] = useState(false);
  const load = async () => {
    const r = await api.cardsGet();
    if (r.status === 200 && r.data?.ok) { setCfg(r.data.cards || {}); setCfgReady(true); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  // Sauvegarde (le serveur pousse automatiquement un instantané d'historique).
  const save = async (next: CardsMap, note: string) => {
    if (!cfgReady) {
      toast({ title: 'Configuration non chargée', msg: 'Rechargez la page avant de modifier les cartes (protection anti-écrasement).', tone: 'danger' });
      return false;
    }
    setSaving(true);
    const r = await api.cardsSet(next, note);
    setSaving(false);
    if (r.status === 200 && r.data?.ok) {
      setCfg(next);
      toast({ title: note, msg: 'Visible sur le site sous ~90 s.', tone: 'ok' });
      return true;
    }
    toast({ title: 'Échec de la sauvegarde', msg: 'Réessayez dans un instant.', tone: 'danger' });
    return false;
  };

  const rows: Row[] = useMemo(() => {
    const base: Row[] = BASE.map((b, i) => ({ id: b.id, name: b.name, desc: b.desc, cat: b.cat, custom: false, ov: cfg[b.id] || null, baseIdx: i }));
    const customs: Row[] = Object.entries(cfg)
      .filter(([, o]) => o && o.custom)
      .map(([id, o], i) => ({ id, name: o.title || id, desc: o.subtitle || '', cat: o.category || 'Réparations', custom: true, ov: o, baseIdx: 500 + i }));
    let all = [...base, ...customs];
    if (cat !== 'Tout') all = all.filter((r) => r.cat === cat);
    const term = q.trim().toLowerCase();
    if (term) all = all.filter((r) => r.name.toLowerCase().includes(term) || r.id.includes(term) || r.desc.toLowerCase().includes(term));
    if (status === 'visibles') all = all.filter((r) => !r.ov?.hidden);
    if (status === 'masquées') all = all.filter((r) => !!r.ov?.hidden);
    if (status === 'promo') all = all.filter((r) => promoIsLive(r.ov?.promo));
    return all.sort((a, b) => {
      if (a.cat !== b.cat) return CATS.indexOf(a.cat) - CATS.indexOf(b.cat);
      const oa = a.ov?.order != null ? Number(a.ov.order) : a.baseIdx;
      const ob = b.ov?.order != null ? Number(b.ov.order) : b.baseIdx;
      return (oa - ob) || (a.baseIdx - b.baseIdx);
    });
  }, [cfg, q, cat, status]);

  // ── Cartes sans lien fournisseur ou sans prix, modèle par modèle ──
  // Sur le site, ces cartes sont automatiquement masquées côté client :
  // cette vue sert à les repérer d'un coup d'œil pour les compléter.
  // Les Services sont exclus (prix forfaitaire, aucun lien fournisseur requis).
  // Les ruptures de stock (prix connu, pièce indisponible) sont listées à
  // part, pour information — elles restent visibles sur le site.
  const gaps = useMemo(() => {
    const map = new Map<string, { sansLien: string[]; sansPrix: string[]; rupture: string[] }>();
    if (!models.length || !Object.keys(priceDoc).length) return map;
    BASE.filter((b) => b.cat !== 'Services').forEach((b) => {
      const entries = priceDoc[b.id] || {};
      const g = { sansLien: [] as string[], sansPrix: [] as string[], rupture: [] as string[] };
      models.forEach((m) => {
        const e = entries[m];
        if (!e) g.sansLien.push(m);
        else if (e.outOfStock) g.rupture.push(m);
        else if (typeof e.final !== 'number') g.sansPrix.push(m);
      });
      if (g.sansLien.length || g.sansPrix.length || g.rupture.length) map.set(b.id, g);
    });
    return map;
  }, [priceDoc, models]);
  const gapTotal = useMemo(() => {
    let n = 0;
    gaps.forEach((g) => { n += g.sansLien.length + g.sansPrix.length; });
    return n;
  }, [gaps]);
  const [gapsOpen, setGapsOpen] = useState(false);

  const patch = (id: string, p: Partial<CardOverride>, note: string) => {
    const next = { ...cfg, [id]: { ...(cfg[id] || {}), ...p } };
    void save(next, note);
  };
  const bulk = (p: Partial<CardOverride>, note: string) => {
    const next = { ...cfg };
    sel.forEach((id) => { next[id] = { ...(next[id] || {}), ...p }; });
    void save(next, `${note} (${sel.size} cartes)`);
    setSel(new Set());
  };
  const move = (row: Row, dir: -1 | 1) => {
    const catRows = rows.filter((r) => r.cat === row.cat);
    const idx = catRows.findIndex((r) => r.id === row.id);
    const to = idx + dir;
    if (to < 0 || to >= catRows.length) return;
    const next = { ...cfg };
    catRows.splice(idx, 1);
    catRows.splice(to, 0, row);
    catRows.forEach((r, i) => { next[r.id] = { ...(next[r.id] || {}), order: i }; });
    void save(next, `Ordre modifié — ${row.name}`);
  };
  const duplicate = (row: Row) => {
    const id = `perso_${row.id.replace(/^perso_/, '')}_${Math.random().toString(36).slice(2, 6)}`;
    const src = cfg[row.id] || {};
    const next: CardsMap = {
      ...cfg,
      [id]: { custom: true, category: row.cat, title: `${row.name} (copie)`, subtitle: src.subtitle ?? row.desc, price: src.price ?? null, hidden: true, order: (src.order ?? row.baseIdx) + 1, promo: src.promo || null },
    };
    void save(next, `Carte dupliquée — ${row.name}`);
  };
  const remove = (row: Row) => {
    const next = { ...cfg };
    delete next[row.id];
    void save(next, `Carte supprimée — ${row.name}`);
    setEditId(null); setDraft(null);
  };

  // Accordéons de l'éditeur : UNE section ouverte à la fois (re-cliquer replie).
  type SectionId = 'contenu' | 'prix' | 'promo';
  const [openSec, setOpenSec] = useState<SectionId | null>('contenu');
  const toggleSec = (s: SectionId) => setOpenSec((cur) => (cur === s ? null : s));

  const openEdit = (row: Row | null) => {
    setScope('ALL');
    setOpenSec('contenu');
    if (!row) {
      setEditId('__new__');
      setDraft({ custom: true, category: 'Réparations', title: '', subtitle: '', price: null, hidden: false, promo: null });
    } else {
      setEditId(row.id);
      setDraft({ ...(cfg[row.id] || {}), custom: row.custom, category: row.cat });
    }
  };

  // ── Édition par couche : selon la portée, on écrit soit dans le réglage
  // général (draft), soit dans draft.models[scope]. Un champ retiré de la
  // couche modèle = retour à l'héritage. ──
  const layer: Partial<CardModelOverride> = draft ? (scope === 'ALL' ? (draft as Partial<CardModelOverride>) : ((draft.models || {})[scope] || {})) : {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(layer, k);
  const setLayer = (p: Partial<CardModelOverride>, removeKeys: string[] = []) => {
    if (!draft) return;
    if (scope === 'ALL') {
      const d = { ...draft, ...p } as Record<string, unknown>;
      removeKeys.forEach((k) => { delete d[k]; });
      setDraft(d as CardOverride);
    } else {
      const cur = { ...((draft.models || {})[scope] || {}) } as Record<string, unknown>;
      Object.assign(cur, p);
      removeKeys.forEach((k) => { delete cur[k]; });
      const ms = { ...(draft.models || {}) };
      if (Object.keys(cur).length) ms[scope] = cur as CardModelOverride; else delete ms[scope];
      setDraft({ ...draft, models: ms });
    }
  };
  const pr: CardPromo | null | undefined = draft ? (scope === 'ALL' ? draft.promo : (has('promo') ? (layer.promo ?? null) : undefined)) : undefined;
  const setPromo = (p: CardPromo | null) => setLayer({ promo: p });
  // Valeurs effectives (couche modèle par-dessus le général) pour l'aperçu.
  const effPreview: CardOverride = (() => {
    if (!draft) return {};
    if (scope === 'ALL') return draft;
    const e = { ...draft } as Record<string, unknown>;
    ['hidden', 'price', 'promo', 'title', 'subtitle', 'margin'].forEach((f) => {
      if (has(f)) e[f] = (layer as Record<string, unknown>)[f];
    });
    return e as CardOverride;
  })();
  // ── Transparence du calcul de prix (marge) pour la carte + portée ──
  const priceEntry = editId && editId !== '__new__' ? priceInfoFor(editId, scope) : null;
  const supplierStep1 = priceEntry && typeof priceEntry.step1 === 'number' ? priceEntry.step1 : null;
  const scraperMargin = priceEntry && typeof priceEntry.margin === 'number' ? priceEntry.margin : null;
  const marginOverride: number | null | undefined = has('margin') ? layer.margin : (scope === 'ALL' ? draft?.margin : undefined);
  const effMargin = (marginOverride != null && Number.isFinite(Number(marginOverride)))
    ? Number(marginOverride)
    : (scope !== 'ALL' && draft?.margin != null ? Number(draft.margin) : scraperMargin);
  const computedFinal = supplierStep1 != null && effMargin != null ? supplierStep1 + effMargin : null;
  const marginExampleModel = scope === 'ALL' && priceEntry
    ? (models.find((m) => priceDoc[editId || '']?.[m]) || '')
    : '';
  const commitEdit = async () => {
    if (!draft || !editId) return;
    let id = editId;
    if (id === '__new__') {
      const t = (draft.title || '').trim();
      if (!t) { toast({ title: 'Titre manquant', msg: 'Donnez un titre à la carte.', tone: 'warn' }); return; }
      if (draft.price == null || !Number.isFinite(Number(draft.price)) || Number(draft.price) <= 0) { toast({ title: 'Prix requis', msg: 'Une carte créée doit avoir un prix.', tone: 'warn' }); return; }
      id = `perso_${t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)}_${Math.random().toString(36).slice(2, 5)}`;
    }
    const clean: CardOverride = { ...draft };
    if (clean.promo && !clean.promo.type) clean.promo = null;
    const next = { ...cfg, [id]: clean };
    const ok = await save(next, editId === '__new__' ? `Carte créée — ${draft.title}` : `Carte modifiée — ${draft.title || id}`);
    if (ok) { setEditId(null); setDraft(null); }
  };

  const openHistory = async () => {
    setHistOpen(true);
    const r = await api.cardsHistory();
    if (r.status === 200 && r.data?.ok) setSnaps(r.data.snaps);
  };
  const restore = async (ts: string) => {
    const r = await api.cardsRestore(ts);
    if (r.status === 200 && r.data?.ok) {
      setCfg(r.data.cards || {});
      toast({ title: 'Version restaurée', msg: 'Visible sur le site sous ~90 s.', tone: 'ok' });
      setHistOpen(false);
    } else toast({ title: 'Restauration impossible', tone: 'danger' });
  };

  const visibles = rows.filter((r) => !r.ov?.hidden).length;
  const promos = rows.filter((r) => promoIsLive(r.ov?.promo)).length;

  return (
    <div className="space-y-4">
      {/* En-tête + stats */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[19px] font-bold tracking-tight">Cartes du site</h1>
          <p className="text-[12.5px] text-fg3">Visibilité, promotions, textes et ordre — appliqué sur le site en ≤ 90 s, paiement aligné automatiquement.</p>
        </div>
        <Badge tone="ok">{visibles} visibles</Badge>
        <Badge tone="warn">{rows.length - visibles} masquées</Badge>
        <Badge tone="accent">{promos} en promo</Badge>
        <Button size="sm" onClick={() => void openHistory()}>Historique</Button>
        <Button size="sm" variant="primary" onClick={() => openEdit(null)}>+ Nouvelle carte</Button>
      </div>

      {/* Outils */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-60"><SearchInput value={q} onChange={setQ} placeholder="Rechercher une carte…" /></div>
          <Segmented value={cat} onChange={setCat} options={[{ value: 'Tout', label: 'Tout' }, ...CATS.map((c) => ({ value: c, label: c }))]} />
          <Segmented value={status} onChange={setStatus} options={[
            { value: 'tous', label: 'Toutes' }, { value: 'visibles', label: 'Visibles' },
            { value: 'masquées', label: 'Masquées' }, { value: 'promo', label: 'En promo' },
          ]} />
        </div>
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
            <span className="text-[12.5px] font-semibold text-fg2">{sel.size} sélectionnée{sel.size > 1 ? 's' : ''} :</span>
            <Button size="sm" onClick={() => bulk({ hidden: true }, 'Masquées')}>Masquer</Button>
            <Button size="sm" onClick={() => bulk({ hidden: false }, 'Affichées')}>Afficher</Button>
            <Button size="sm" onClick={() => bulk({ promo: null }, 'Promos retirées')}>Retirer les promos</Button>
            <Button size="sm" onClick={() => setSel(new Set())}>Annuler</Button>
          </div>
        )}
      </Card>

      {/* Cartes incomplètes : sans lien fournisseur ou sans prix (masquées côté client) */}
      {gapTotal > 0 && (
        <Card className="p-3 border-warn/40">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid place-items-center h-8 w-8 rounded-[10px] bg-warn/12 text-warn shrink-0">
              <Icon name="alert" size={16} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold">{gapTotal} carte{gapTotal > 1 ? 's' : ''}-modèle{gapTotal > 1 ? 's' : ''} sans prix ou sans lien fournisseur</div>
              <div className="text-[11.5px] text-fg3">Ces cartes s'affichent avec un « ! » à la place du prix sur le site (non commandables).</div>
            </div>
            <Button size="sm" onClick={() => setGapsOpen(true)}>Voir le détail</Button>
          </div>
        </Card>
      )}

      {/* Liste */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-fg3 text-[13px]">Chargement…</div>
        ) : rows.length === 0 ? (
          <Empty title="Aucune carte">Aucune carte ne correspond à ces filtres.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const hidden = !!r.ov?.hidden;
              const live = promoIsLive(r.ov?.promo);
              return (
                <li key={r.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-panel2/50 transition-colors ${hidden ? 'opacity-60' : ''}`}>
                  <input type="checkbox" className="accent-[#0A84FF] w-4 h-4 shrink-0" checked={sel.has(r.id)}
                    onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.id) : n.delete(r.id); setSel(n); }} />
                  <img src={iconUrl(r.id)} alt="" className="w-8 h-8 rounded-lg object-contain bg-panel2 p-1 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold truncate">{r.ov?.title || r.name}</span>
                      {r.custom && <Badge tone="accent">créée</Badge>}
                      {live && r.ov?.promo && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wide text-white"
                          style={{ background: r.ov.promo.color || '#0A84FF' }}>{promoLabel(r.ov.promo)}</span>
                      )}
                      {r.ov?.price != null && <Badge tone="neutral">{r.ov.price} €</Badge>}
                      {r.ov?.models && Object.keys(r.ov.models).length > 0 && (
                        <Badge tone="accent">{Object.keys(r.ov.models).length} modèle{Object.keys(r.ov.models).length > 1 ? 's' : ''} ⚙</Badge>
                      )}
                      {(() => {
                        const g = gaps.get(r.id);
                        const n = g ? g.sansLien.length + g.sansPrix.length : 0;
                        return n > 0 ? <Badge tone="warn">{n} sans prix</Badge> : null;
                      })()}
                    </div>
                    <div className="text-[11.5px] text-fg3 truncate">{r.cat} · {r.ov?.subtitle ?? r.desc}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="w-7 h-7 rounded-lg text-fg3 hover:text-fg hover:bg-panel2" title="Monter" onClick={() => move(r, -1)}><Icon name="arrowUp" className="w-3.5 h-3.5 mx-auto" /></button>
                    <button className="w-7 h-7 rounded-lg text-fg3 hover:text-fg hover:bg-panel2 rotate-180" title="Descendre" onClick={() => move(r, 1)}><Icon name="arrowUp" className="w-3.5 h-3.5 mx-auto" /></button>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${hidden ? 'text-warn' : 'text-ok'}`}>{hidden ? 'Masquée' : 'Visible'}</span>
                    <Switch checked={!hidden} onChange={(v) => patch(r.id, { hidden: !v }, `${v ? 'Affichée' : 'Masquée'} — ${r.name}`)} />
                  </div>
                  <Button size="sm" onClick={() => openEdit(r)}>Modifier</Button>
                  <Button size="sm" onClick={() => duplicate(r)}>Dupliquer</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ═══ Vue « Sans prix » : cartes-modèles sans lien fournisseur ou sans
           prix (masquées automatiquement côté client), + ruptures pour info ═══ */}
      <Modal open={gapsOpen} onClose={() => setGapsOpen(false)} className="max-w-[640px]">
        <div className="p-5">
          <h2 className="text-[16px] font-bold tracking-tight">Cartes sans prix ou sans lien fournisseur</h2>
          <p className="mt-1 text-[12px] text-fg3 leading-relaxed">
            Ces cartes-modèles n'ont aucun tarif : sur le site, elles affichent un <b className="text-fg2">« ! » à la place du prix</b> et
            ne sont pas commandables. Pour les compléter : ajouter le lien fournisseur (puis relever le prix), ou créer une
            carte personnalisée avec un prix fixe. Les ruptures de stock affichent « Rupture de stock ».
          </p>
          <div className="mt-4 space-y-4 max-h-[52vh] overflow-y-auto pr-1">
            {[...gaps.entries()].map(([id, g]) => {
              const b = BASE.find((x) => x.id === id);
              if (!b) return null;
              const chip = (m: string, cls: string, title: string) => (
                <span key={`${id}-${m}`} title={title}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${cls}`}>{m}</span>
              );
              return (
                <div key={id} className="rounded-xl border border-line bg-panel p-3.5">
                  <div className="flex items-center gap-2.5">
                    <img src={iconUrl(id)} alt="" className="w-7 h-7 rounded-lg object-contain bg-panel2 p-1 shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                    <span className="text-[13px] font-semibold">{b.name}</span>
                    <span className="text-[11px] text-fg3">{b.cat}</span>
                    <span className="ml-auto text-[11px] font-bold text-warn">{g.sansLien.length + g.sansPrix.length} à compléter</span>
                  </div>
                  {g.sansLien.length > 0 && (
                    <div className="mt-2.5">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-fg3 mb-1.5">Sans lien fournisseur ({g.sansLien.length})</div>
                      <div className="flex flex-wrap gap-1.5">{g.sansLien.map((m) => chip(m, 'border-danger/40 bg-danger/10 text-danger', 'Aucun lien fournisseur : jamais de prix relevé'))}</div>
                    </div>
                  )}
                  {g.sansPrix.length > 0 && (
                    <div className="mt-2.5">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-fg3 mb-1.5">Lien présent mais prix introuvable ({g.sansPrix.length})</div>
                      <div className="flex flex-wrap gap-1.5">{g.sansPrix.map((m) => chip(m, 'border-warn/40 bg-warn/10 text-warn', 'Le dernier relevé n\'a pas trouvé de prix sur la fiche fournisseur'))}</div>
                    </div>
                  )}
                  {g.rupture.length > 0 && (
                    <div className="mt-2.5">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-fg3 mb-1.5">Rupture de stock — visibles sur le site ({g.rupture.length})</div>
                      <div className="flex flex-wrap gap-1.5">{g.rupture.map((m) => chip(m, 'border-line bg-panel2 text-fg3', 'Prix connu mais pièce indisponible chez le fournisseur'))}</div>
                    </div>
                  )}
                </div>
              );
            })}
            {gaps.size === 0 && <Empty title="Tout est complet">Toutes les cartes ont un lien fournisseur et un prix.</Empty>}
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => setGapsOpen(false)}>Fermer</Button>
          </div>
        </div>
      </Modal>

      {/* ═══ Éditeur de carte — panneau premium (en-tête fixe, corps scrollable,
           aperçu en vedette, sections repliables, pied d'actions fixe) ═══ */}
      <Modal open={!!editId} onClose={() => { setEditId(null); setDraft(null); }} className="max-w-[680px] overflow-hidden">
        {draft && (() => {
          const baseRow = editId !== '__new__' ? (rows.find((r) => r.id === editId) || null) : null;
          const baseName = baseRow?.name || draft.title || 'Carte';
          const baseDesc = baseRow?.desc || '';
          // Valeurs effectives à la portée choisie (couche modèle > général > site).
          const effTitle = ((has('title') ? layer.title : draft.title) || baseName) as string;
          const effSubtitle = ((has('subtitle') ? layer.subtitle : draft.subtitle) ?? baseDesc) as string;
          const effFixedPrice = (scope === 'ALL' ? draft.price : (has('price') ? layer.price : draft.price)) ?? null;
          const fmtDate = (s?: string | null) => (s ? new Date(s.slice(0, 10)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
          // Résumés affichés sur les sections repliées (état lisible d'un coup d'œil).
          const contentSummary = `${effTitle} · ${effSubtitle || '—'}`;
          const priceSummary = effFixedPrice != null
            ? `Prix fixe : ${effFixedPrice} €`
            : draft.custom
              ? 'Prix de vente à définir (obligatoire)'
              : computedFinal != null
                ? `Automatique : ${supplierStep1} € + ${effMargin} € de marge = ${computedFinal} €`
                : 'Automatique — catalogue temps réel';
          const promoSummary = pr?.active
            ? `${promoLabel(pr)}${promoIsLive(pr) ? (pr.end ? ` · jusqu'au ${fmtDate(pr.end)}` : ' · en cours') : ' · hors période'}`
            : scope !== 'ALL' && !has('promo') && draft.promo?.active
              ? `Héritée du général : ${promoLabel(draft.promo)}`
              : 'Aucune promotion';
          const close = () => { setEditId(null); setDraft(null); };
          return (
            <div className="flex flex-col max-h-[86dvh]">
              {/* ── En-tête ── */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-line shrink-0">
                {editId !== '__new__' && !draft.custom ? (
                  <img src={iconUrl(editId!)} alt="" className="w-10 h-10 rounded-xl object-contain bg-panel2 p-1.5 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                ) : (
                  <span className="grid place-items-center w-10 h-10 rounded-xl bg-accent/12 text-accentFg shrink-0">
                    <Icon name={editId === '__new__' ? 'plus' : 'cards'} size={18} />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-[16px] font-bold tracking-tight leading-tight truncate">
                    {editId === '__new__' ? 'Nouvelle carte' : effTitle}
                  </h2>
                  <p className="text-[11.5px] text-fg3 truncate">
                    {editId === '__new__'
                      ? 'Elle s’ajoutera à la catégorie choisie sur le site'
                      : `${draft.category || baseRow?.cat || ''}${draft.custom ? ' · carte créée' : ' · carte du site'}`}
                  </p>
                </div>
                <button onClick={close} aria-label="Fermer"
                  className="grid place-items-center h-9 w-9 rounded-ctl text-fg3 hover:text-fg hover:bg-fg/[0.06] transition-colors shrink-0">
                  <Icon name="close" size={17} />
                </button>
              </div>

              {/* ── Corps scrollable ── */}
              <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-3">

                {/* Portée : général ou un modèle précis (couche qui écrase champ à champ) */}
                {editId !== '__new__' && (
                  <div className={`rounded-xl border p-3.5 space-y-2.5 transition-colors duration-200 ${scope !== 'ALL' ? 'border-accent/40 bg-accent/5' : 'border-line bg-panel'}`}>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className={`grid place-items-center h-8 w-8 rounded-[10px] shrink-0 ${scope !== 'ALL' ? 'bg-accent/12 text-accentFg' : 'bg-panel2 text-fg3'}`}>
                        <Icon name="phone" size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold leading-tight">Portée du réglage</div>
                        <div className="text-[11px] text-fg3">{scope === 'ALL' ? 'S’applique à tous les modèles' : `N’affecte que ce modèle`}</div>
                      </div>
                      <select className={`${INPUT} ml-auto h-9 w-auto max-w-[220px]`}
                        value={scope} onChange={(e) => setScope(e.target.value)}>
                        <option value="ALL">Tous les modèles</option>
                        {models.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {draft.models && Object.keys(draft.models).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-fg3">Personnalisés :</span>
                        {Object.keys(draft.models).map((m) => (
                          <span key={m}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${scope === m ? 'border-accent text-accentFg bg-accent/10' : 'border-line text-fg2 hover:border-accent/40'}`}
                            onClick={() => setScope(m)}>
                            {m}
                            <button className="opacity-50 hover:opacity-100" title="Supprimer ce réglage (revenir au général)"
                              onClick={(e) => { e.stopPropagation(); const ms = { ...(draft.models || {}) }; delete ms[m]; setDraft({ ...draft, models: ms }); if (scope === m) setScope('ALL'); }}>
                              <Icon name="close" size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Aperçu live — le retour visuel immédiat, toujours visible */}
                <div>
                  {scope !== 'ALL' && (
                    <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-accentFg">
                      <Icon name="eye" size={12} /> Aperçu pour {scope}
                    </div>
                  )}
                  <SitePreview row={{ name: baseName, desc: baseDesc }} ov={effPreview} computedBase={computedFinal} />
                </div>

                {/* Visibilité — action clé, toujours accessible */}
                <div className="rounded-xl border border-line bg-panel px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <span className="flex items-center gap-3 min-w-0">
                      <span className={`grid place-items-center h-8 w-8 rounded-[10px] shrink-0 ${(scope === 'ALL' ? !draft.hidden : !(has('hidden') ? layer.hidden : draft.hidden)) ? 'bg-ok/12 text-ok' : 'bg-panel2 text-fg3'}`}>
                        <Icon name="eye" size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold leading-tight">Visible sur le site</span>
                        <span className="block text-[11px] text-fg3 truncate">
                          {scope === 'ALL' ? 'Masquer retire la carte de toutes les pages' : `Réglage pour ${scope}`}
                        </span>
                      </span>
                    </span>
                    {scope === 'ALL' ? (
                      <Switch checked={!draft.hidden} onChange={(v) => setDraft({ ...draft, hidden: !v })} />
                    ) : (
                      <Segmented value={!has('hidden') ? 'inherit' : (layer.hidden ? 'hidden' : 'visible')}
                        onChange={(v) => v === 'inherit' ? setLayer({}, ['hidden']) : setLayer({ hidden: v === 'hidden' })}
                        options={[
                          { value: 'inherit', label: `Hériter (${draft.hidden ? 'masquée' : 'visible'})` },
                          { value: 'visible', label: 'Visible' },
                          { value: 'hidden', label: 'Masquée' },
                        ]} />
                    )}
                  </div>
                </div>

                {/* ── Section : Contenu ── */}
                <Section icon="cards" title="Contenu" summary={contentSummary}
                  open={openSec === 'contenu'} onToggle={() => toggleSec('contenu')}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <Field label="Titre" inherited={scope !== 'ALL' && !has('title')}>
                      <input className={INPUT}
                        value={(has('title') ? layer.title : (scope === 'ALL' ? draft.title : '')) ?? ''}
                        placeholder={(scope !== 'ALL' && draft.title) || baseRow?.name || 'Titre de la carte'}
                        onChange={(e) => e.target.value === '' ? setLayer({}, ['title']) : setLayer({ title: e.target.value })} />
                    </Field>
                    <Field label="Sous-titre" inherited={scope !== 'ALL' && !has('subtitle')}>
                      <input className={INPUT}
                        value={(has('subtitle') ? layer.subtitle : (scope === 'ALL' ? draft.subtitle : '')) ?? ''}
                        placeholder={(scope !== 'ALL' && (draft.subtitle || undefined)) || baseRow?.desc || 'Description courte'}
                        onChange={(e) => e.target.value === '' ? setLayer({}, ['subtitle']) : setLayer({ subtitle: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Catégorie"
                    hint={!draft.custom ? 'Fixée par le site pour les cartes d’origine.' : scope !== 'ALL' ? 'Modifiable depuis la portée générale.' : undefined}>
                    <select className={`${INPUT} disabled:opacity-55 disabled:cursor-not-allowed sm:max-w-[calc(50%-7px)]`}
                      value={draft.category || 'Réparations'} disabled={!draft.custom || scope !== 'ALL'}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                      {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </Section>

                {/* ── Section : Prix & marge ── */}
                <Section icon="euro" title="Prix & marge" summary={priceSummary}
                  open={openSec === 'prix'} onToggle={() => toggleSec('prix')}>
                  <Field label="Prix fixe" inherited={scope !== 'ALL' && !has('price') && draft.price != null}
                    hint={draft.custom && scope === 'ALL'
                      ? 'Obligatoire pour une carte créée : c’est son prix de vente.'
                      : 'Laisser vide = prix automatique du catalogue temps réel (recommandé).'}>
                    <div className="relative sm:max-w-[calc(50%-7px)]">
                      <input type="number" min={1} className={`${INPUT} pr-8`}
                        value={(has('price') ? layer.price : (scope === 'ALL' ? draft.price : '')) ?? ''}
                        placeholder={scope !== 'ALL' && draft.price != null ? String(draft.price) : 'Automatique'}
                        onChange={(e) => e.target.value === '' ? setLayer({}, ['price']) : setLayer({ price: Number(e.target.value) })} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-fg3 pointer-events-none">€</span>
                    </div>
                  </Field>

                  {supplierStep1 != null && !draft.custom && (
                    <div className="rounded-lg bg-panel2 border border-line p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[12px] font-bold uppercase tracking-wide text-fg2">Calcul automatique{scope !== 'ALL' ? ` — ${scope}` : ''}</span>
                        {scope === 'ALL' && marginExampleModel && <Badge tone="neutral">exemple : {marginExampleModel}</Badge>}
                      </div>
                      <div className="text-[12.5px] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-fg3">Prix fournisseur <span className="text-fg3/70">(Utopya +20 %)</span></span>
                          <span className="font-semibold tnum">{supplierStep1} €</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-fg3 flex items-center gap-1.5">+ Marge{scope !== 'ALL' && !has('margin') && <InheritChip />}</span>
                          <div className="relative">
                            <input type="number" className={`${INPUT} h-9 w-28 pr-7 text-right tnum`}
                              value={(marginOverride ?? '') as number | string}
                              placeholder={String(effMargin ?? scraperMargin ?? '')}
                              onChange={(e) => e.target.value === '' ? setLayer({}, ['margin']) : setLayer({ margin: Number(e.target.value) })} />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-fg3 pointer-events-none">€</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between border-t border-line pt-2">
                          <span className="font-semibold">= Prix final</span>
                          <span className="font-bold text-accentFg tnum text-[15px]">{computedFinal != null ? `${computedFinal} €` : '—'}</span>
                        </div>
                      </div>
                      <div className="text-[11px] text-fg3 leading-relaxed">
                        Marge par défaut : {scraperMargin ?? '—'} €.
                        {marginOverride != null && <span className="text-accentFg"> Marge personnalisée active.</span>}
                      </div>
                      {(has('price') || (scope === 'ALL' && draft.price != null)) && (
                        <div className="flex items-start gap-2 rounded-lg bg-warn/10 border border-warn/25 px-3 py-2 text-[11.5px] text-warn leading-snug">
                          <Icon name="alert" size={13} className="mt-px shrink-0" />
                          Un prix fixe est défini ci-dessus — il remplace ce calcul.
                        </div>
                      )}
                    </div>
                  )}
                </Section>

                {/* ── Section : Promotion ── */}
                <Section icon="sparkles" title="Promotion"
                  badge={pr?.active && promoIsLive(pr) ? <Badge tone="accent">Active</Badge> : undefined}
                  summary={promoSummary}
                  open={openSec === 'promo'} onToggle={() => toggleSec('promo')}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-panel2 border border-line px-3.5 py-2.5">
                    <span className="text-[13px] font-medium">{scope === 'ALL' ? 'Activer une promotion' : 'Promotion pour ce modèle'}</span>
                    {scope === 'ALL' ? (
                      <Switch checked={!!pr?.active} onChange={(v) => setPromo({ type: 'percent', value: 10, ...(pr || {}), active: v })} />
                    ) : (
                      <Segmented value={!has('promo') ? 'inherit' : (layer.promo ? 'custom' : 'none')}
                        onChange={(v) => v === 'inherit' ? setLayer({}, ['promo']) : v === 'none' ? setPromo(null) : setPromo({ type: 'percent', value: 10, ...(draft.promo || {}), active: true })}
                        options={[
                          { value: 'inherit', label: draft.promo?.active ? `Hériter (${promoLabel(draft.promo)})` : 'Hériter (aucune)' },
                          { value: 'custom', label: 'Spécifique' },
                          { value: 'none', label: 'Aucune' },
                        ]} />
                    )}
                  </div>

                  {pr?.active && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <Field label="Type de remise">
                          <Segmented value={pr.type} onChange={(t) => setPromo({ ...pr, type: t })}
                            options={[{ value: 'percent', label: '-X %' }, { value: 'amount', label: '-X €' }, { value: 'badge', label: 'Badge seul' }]} />
                        </Field>
                        {pr.type !== 'badge' && (
                          <Field label="Valeur">
                            <div className="relative">
                              <input type="number" min={1} className={`${INPUT} pr-9`}
                                value={pr.value ?? ''} placeholder={pr.type === 'percent' ? '10' : '5'}
                                onChange={(e) => setPromo({ ...pr, value: Number(e.target.value) })} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-fg3 pointer-events-none">{pr.type === 'percent' ? '%' : '€'}</span>
                            </div>
                          </Field>
                        )}
                      </div>
                      <Field label="Texte du badge" hint="Optionnel — sinon la remise est affichée (ex. « -10 % »).">
                        <input className={INPUT} value={pr.label ?? ''} placeholder="PROMO ÉTÉ, NOUVEAU, OFFERT…"
                          onChange={(e) => setPromo({ ...pr, label: e.target.value })} />
                      </Field>
                      <Field label="Couleur du badge">
                        <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                          {PROMO_COLORS.map((c) => {
                            const on = (pr.color || '#0A84FF') === c;
                            return (
                              <button key={c} type="button" aria-label={`Couleur ${c}`}
                                className={`relative w-7 h-7 rounded-full transition-transform duration-150 hover:scale-110 ${on ? 'ring-2 ring-offset-2 ring-offset-panel scale-105' : ''}`}
                                style={{ background: c, ...(on ? { '--tw-ring-color': c } as React.CSSProperties : {}) }}
                                onClick={() => setPromo({ ...pr, color: c })}>
                                {on && <Icon name="check" size={13} className="absolute inset-0 m-auto text-white drop-shadow" />}
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                      <div className="grid grid-cols-2 gap-3.5">
                        <Field label="Début" hint="Optionnel">
                          <input type="date" className={`${INPUT} h-9 text-[12.5px]`}
                            value={pr.start?.slice(0, 10) ?? ''} onChange={(e) => setPromo({ ...pr, start: e.target.value || null })} />
                        </Field>
                        <Field label="Fin" hint="Optionnel — incluse">
                          <input type="date" className={`${INPUT} h-9 text-[12.5px]`}
                            value={pr.end?.slice(0, 10) ?? ''} onChange={(e) => setPromo({ ...pr, end: e.target.value || null })} />
                        </Field>
                      </div>
                      {!promoIsLive(pr) && (
                        <div className="flex items-start gap-2 rounded-lg bg-warn/10 border border-warn/25 px-3 py-2 text-[11.5px] text-warn leading-snug">
                          <Icon name="alert" size={13} className="mt-px shrink-0" />
                          Hors période : cette promotion n'est pas affichée sur le site pour le moment.
                        </div>
                      )}
                    </>
                  )}
                  {scope !== 'ALL' && !has('promo') && draft.promo?.active && (
                    <p className="text-[11.5px] text-fg3">Ce modèle hérite de la promotion générale : {promoLabel(draft.promo)}.</p>
                  )}
                </Section>
              </div>

              {/* ── Pied d'actions ── */}
              <div className="flex items-center gap-2 px-5 py-3.5 border-t border-line bg-panel shrink-0">
                {editId !== '__new__' && draft.custom && (
                  <Button size="sm" variant="danger" icon="trash" onClick={() => { const r = rows.find((x) => x.id === editId); if (r) remove(r); }}>Supprimer</Button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" onClick={close}>Annuler</Button>
                  <Button variant="primary" icon="check" onClick={() => void commitEdit()} disabled={saving}>
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Historique */}
      <Modal open={histOpen} onClose={() => setHistOpen(false)} className="max-w-lg">
        <div className="space-y-3 p-1">
          <h2 className="text-[16px] font-bold">Historique des modifications</h2>
          <p className="text-[12px] text-fg3">Chaque sauvegarde crée un instantané. Restaurer = revenir à l'état complet d'avant cette sauvegarde.</p>
          {snaps.length === 0 ? (
            <div className="text-[13px] text-fg3 py-4 text-center">Aucun instantané pour le moment.</div>
          ) : (
            <ul className="divide-y divide-line max-h-80 overflow-auto">
              {snaps.map((s) => (
                <li key={s.ts} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold">{new Date(s.ts).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                    <div className="text-[11.5px] text-fg3 truncate">{s.note || '—'} · {s.count} carte{s.count > 1 ? 's' : ''} personnalisées</div>
                  </div>
                  <Button size="sm" onClick={() => void restore(s.ts)}>Restaurer</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
