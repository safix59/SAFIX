import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MsgThread, ChatMessage } from '../lib/api';
import { ago, fTime } from '../lib/format';
import { SearchInput, Empty, Skeleton, Button, Modal, useToast, AlertBanner } from '../components';
import { Icon } from '../icons';

const threadName = (t: MsgThread) => t.name || 'Visiteur ' + t.session.slice(-4);
const initialOf = (t: MsgThread) => (threadName(t)[0] || 'V').toUpperCase();

// ─── Marqueurs internes (partagés avec le widget du site) ───
type Parsed =
  | { kind: 'human' }
  | { kind: 'img'; bot: boolean; url: string; caption: string }
  | { kind: 'text'; bot: boolean; text: string };
function parseBody(body: string): Parsed {
  let b = String(body || '');
  if (b === '::human::') return { kind: 'human' };
  let bot = false;
  if (b.startsWith('::bot::')) { bot = true; b = b.slice(7); }
  if (b.startsWith('::img::')) {
    const rest = b.slice(7);
    const nl = rest.indexOf('\n');
    return { kind: 'img', bot, url: nl === -1 ? rest : rest.slice(0, nl), caption: nl === -1 ? '' : rest.slice(nl + 1) };
  }
  return { kind: 'text', bot, text: b };
}
const previewText = (body: string): string => {
  const p = parseBody(body);
  if (p.kind === 'human') return '🙋 Demande de conseiller';
  if (p.kind === 'img') return '📷 Photo' + (p.caption ? ' · ' + p.caption : '');
  return (p.bot ? '🤖 ' : '') + p.text;
};

// ─── Suggestions IA (déterministes : catalogue réel + modèles de réponses) ───
let _prices: Record<string, Record<string, { final?: number | null; outOfStock?: boolean }>> | null = null;
async function loadPrices() {
  if (_prices) return _prices;
  try {
    const r = await fetch('/scraper/prices.json', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); _prices = j?.prices || null; }
  } catch { /* suggestions génériques */ }
  return _prices;
}
// Identifiants RÉELS de prices.json (gammes de qualité incluses).
const REPAIRS: { rx: RegExp; ids: [string, string][]; label: string }[] = [
  { rx: /écran|ecran|screen|vitre avant/i, label: "l'écran", ids: [['ecran_eco', 'Éco'], ['ecran_standard', 'Standard'], ['ecran_premium', 'Premium'], ['ecran_original', 'Original']] },
  { rx: /batterie|battery/i, label: 'la batterie', ids: [['batterie', 'Standard'], ['batterie_original', 'Original']] },
  { rx: /vitre arri|arriere|back ?glass/i, label: 'la vitre arrière', ids: [['vitre_arriere', '']] },
  { rx: /cam[ée]ra|appareil photo/i, label: 'la caméra arrière', ids: [['camera_arriere', '']] },
  { rx: /connecteur|charge/i, label: 'le connecteur de charge', ids: [['connecteur_de_charge', '']] },
];
const normTxt = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
async function buildSuggestions(lastUserMsg: string, visitorName: string | null): Promise<string[]> {
  const t = normTxt(lastUserMsg);
  const hello = visitorName ? `Bonjour ${visitorName} !` : 'Bonjour !';
  const out: string[] = [];
  const prices = await loadPrices();
  const rep = REPAIRS.find((r) => r.rx.test(lastUserMsg));
  const mm = /iphone\s*(se|xr|xs max|xs|x|\d{1,2})\s*(pro max|pro|plus|mini|e)?/.exec(t.replace(/promax/g, 'pro max'));
  if (rep && mm && prices) {
    const wanted = normTxt('iphone ' + mm[1] + (mm[2] ? ' ' + mm[2] : '')).replace(/(\d+) e\b/, '$1e');
    const tiers: string[] = [];
    let modelKey: string | null = null;
    for (const [id, tier] of rep.ids) {
      const table = prices[id];
      if (!table) continue;
      const key = Object.keys(table).find((k) => k !== 'default' && (normTxt(k) === wanted || normTxt(k).startsWith(wanted)));
      if (!key) continue;
      modelKey = modelKey || key;
      const e = table[key];
      if (e && typeof e.final === 'number' && !e.outOfStock) tiers.push(tier ? `${tier} ${e.final} €` : `${e.final} €`);
    }
    if (tiers.length && modelKey)
      out.push(`${hello} Oui, ${rep.label} de l'${modelKey} est disponible : ${tiers.join(' · ')} tout compris (pièce neuve + pose). Commande directe depuis la fiche « ${modelKey} » du site 👍`);
    else if (modelKey)
      out.push(`${hello} ${rep.label.charAt(0).toUpperCase() + rep.label.slice(1)} de l'${modelKey} est actuellement en rupture chez notre fournisseur. Je vous préviens dès son retour en stock si vous le souhaitez.`);
  }
  if (/rendez|rdv|deposer|apporter|quand/.test(t))
    out.push(`${hello} Vous pouvez réserver votre créneau directement dans le panier : lieu de dépôt, date (dès demain) et créneau (matin, après-midi ou soir).`);
  if (/prix|tarif|combien/.test(t) && out.length === 0)
    out.push(`${hello} Tous nos tarifs sont affichés en temps réel sur la fiche de votre modèle. Dites-moi votre modèle exact et la panne, je vous confirme le prix immédiatement.`);
  if (/livraison|delai|rapide/.test(t))
    out.push(`La pièce arrive en Standard (sous 48 h) ou Express (dès le lendemain 15h) — c'est ce qui fixe la date de la réparation. Le détail exact s'affiche dans le panier.`);
  out.push(`${hello} Merci pour votre message — je regarde ça et je reviens vers vous au plus vite.`);
  out.push(`Pouvez-vous me préciser le modèle exact de votre iPhone et la panne constatée ? Je vous confirme prix et disponibilité dans la foulée.`);
  return out.slice(0, 3);
}

// ─── Compression photo (même approche que le widget client) ───
function compressImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { const k = Math.min(MAX / w, MAX / h); w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.82));
      } catch { resolve(null); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export function Messages() {
  const [threads, setThreads] = useState<MsgThread[] | null>(null);
  const [ready, setReady] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugTick, setSugTick] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDel, setConfirmDel] = useState<null | { kind: 'msgs'; ids: number[] } | { kind: 'thread' }>(null);
  const [busyDel, setBusyDel] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const loadThreads = async () => {
    const res = await api.msgThreads();
    if (res.status === 200 && res.data) { setReady(res.data.ready); setThreads(res.data.threads || []); }
  };
  const loadThread = async (s: string, spin = false) => {
    if (spin) setLoadingMsgs(true);
    const res = await api.msgThread(s);
    if (res.status === 200 && res.data) setMessages(res.data.messages || []);
    setLoadingMsgs(false);
  };

  useEffect(() => {
    void loadThreads();
    const t = setInterval(() => void loadThreads(), 10000);
    return () => clearInterval(t);
  }, []);
  // Présence : tant que l'admin est sur cette page → « en ligne » pour les visiteurs.
  useEffect(() => {
    void api.adminPing();
    const t = setInterval(() => void api.adminPing(), 25000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!active) return;
    setSelectMode(false); setSelected(new Set()); setPendingImg(null);
    void loadThread(active, true);
    const t = setInterval(() => void loadThread(active), 6000);
    return () => clearInterval(t);
  }, [active]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, active]);
  // Assistant temps réel : à chaque nouveau message client, Claude analyse la
  // conversation complète (contexte, modèle évoqué, fautes) et propose des
  // réponses prêtes à envoyer. Repli local déterministe si Claude indisponible.
  // Ne se masque que si la DERNIÈRE réponse vient de l'admin humain (les
  // réponses de l'assistant automatique ::bot:: ne bloquent pas — tu peux
  // toujours reprendre la main).
  useEffect(() => {
    const last = messages[messages.length - 1];
    const lastIsHumanAdmin = !!last && last.sender === 'admin' && !last.body.startsWith('::bot::');
    const lastUser = [...messages].reverse().find((m) => m.sender === 'user' && m.body !== '::human::' && !m.body.startsWith('::img::'));
    if (!active || !lastUser || lastIsHumanAdmin) { setSuggestions([]); setSugLoading(false); return; }
    let alive = true;
    const th = threads?.find((t) => t.session === active);
    const sessionId = active;
    // Repli local immédiat (affichage instantané), puis Claude si dispo.
    void buildSuggestions(lastUser.body, th?.name ?? null).then((s) => { if (alive) setSuggestions((cur) => (cur.length ? cur : s)); });
    setSugLoading(true);
    const t = setTimeout(() => {
      void api.msgSuggest(sessionId)
        .then((r) => {
          if (alive && r.status === 200 && r.data?.ready && r.data.suggestions.length) setSuggestions(r.data.suggestions);
        })
        .finally(() => { if (alive) setSugLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
    // sugTick force une régénération manuelle (bouton ↻ de l'assistant).
  }, [messages, active, threads, sugTick]);

  const filtered = useMemo(() => {
    const list = threads || [];
    const term = q.trim().toLowerCase();
    return term ? list.filter((t) => threadName(t).toLowerCase().includes(term) || t.last_body.toLowerCase().includes(term)) : list;
  }, [threads, q]);

  const send = async () => {
    const body = reply.trim();
    if ((!body && !pendingImg) || !active || sending) return;
    setSending(true);
    const img = pendingImg;
    setPendingImg(null);
    setMessages((m) => [...m, { id: Date.now(), sender: 'admin', body: img ? `::img::${img}${body ? '\n' + body : ''}` : body, created_at: new Date().toISOString() }]);
    setReply('');
    const res = await api.msgReply(active, body, img);
    setSending(false);
    if (res.status === 200 && res.data?.ok) { void loadThread(active); void loadThreads(); }
    else toast({ title: "Échec de l'envoi", msg: 'Réessayez dans un instant.', tone: 'danger' });
  };

  const doDelete = async () => {
    if (!confirmDel || !active) return;
    setBusyDel(true);
    const res = confirmDel.kind === 'thread' ? await api.msgDelThread(active) : await api.msgDel(confirmDel.ids);
    setBusyDel(false);
    setConfirmDel(null);
    if (res.status === 200 && res.data?.ok) {
      toast({ title: 'Supprimé', msg: confirmDel.kind === 'thread' ? 'Conversation supprimée.' : 'Message(s) supprimé(s).', tone: 'ok' });
      setSelected(new Set()); setSelectMode(false);
      if (confirmDel.kind === 'thread') { setActive(null); setMessages([]); }
      else void loadThread(active);
      void loadThreads();
    } else {
      toast({ title: 'Échec de la suppression', msg: 'Réessayez dans un instant.', tone: 'danger' });
    }
  };

  const toggleSel = (id: number) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const onPickFile = async (f: File | null) => {
    if (!f) return;
    const data = await compressImage(f);
    if (data) setPendingImg(data);
    else toast({ title: 'Image non prise en charge', msg: 'Choisissez une photo JPEG/PNG/WebP.', tone: 'warn' });
  };

  if (threads && !ready) {
    return (
      <div className="stagger">
        <AlertBanner level="info">
          La messagerie nécessite la table <b>messages</b> dans Supabase. Colle ce SQL dans l'éditeur SQL, puis recharge :
          <br />
          <code className="block mt-2 text-[11.5px] font-mono text-fg2">create table if not exists messages (id bigint generated always as identity primary key, session text not null, sender text not null check (sender in ('user','admin')), body text not null, name text, created_at timestamptz default now(), read_admin boolean default false, read_user boolean default false);</code>
        </AlertBanner>
      </div>
    );
  }

  const activeThread = active ? threads?.find((t) => t.session === active) : null;

  return (
    <div className="animate-fade-in">
      <div className="bg-panel border border-line rounded-card overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr] h-[calc(100vh-190px)] min-h-[460px]">
        {/* Liste des conversations */}
        <aside className={`border-r border-line flex flex-col min-h-0 ${active ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-3 border-b border-line">
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher une conversation…" />
          </div>
          <div className="flex-1 overflow-auto no-scrollbar p-1.5">
            {threads === null ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 m-1.5" />)
            ) : filtered.length ? (
              filtered.map((t) => (
                <button
                  key={t.session}
                  onClick={() => setActive(t.session)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${active === t.session ? 'bg-accent/12' : 'hover:bg-fg/[0.03]'}`}
                >
                  <span className="relative grid place-items-center h-10 w-10 rounded-full bg-panel2 text-fg2 font-semibold shrink-0">
                    {initialOf(t)}
                    {t.unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 grid place-items-center rounded-full bg-danger text-white text-[10px] font-bold border-2 border-panel">{t.unread}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13.5px] truncate ${t.unread ? 'font-bold text-fg' : 'font-medium'}`}>{threadName(t)}</span>
                      <span className="ml-auto text-[10.5px] text-fg3 shrink-0">{ago(t.last_ts)}</span>
                    </div>
                    <div className={`text-[12px] truncate ${t.unread ? 'text-fg2' : 'text-fg3'}`}>
                      {t.last_sender === 'admin' && !t.last_body.startsWith('::bot::') && <span className="text-fg3">Vous : </span>}
                      {previewText(t.last_body)}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <Empty icon="chat" title="Aucune conversation">Les messages des visiteurs apparaîtront ici.</Empty>
            )}
          </div>
        </aside>

        {/* Conversation active */}
        <section className={`flex flex-col min-h-0 ${active ? 'flex' : 'hidden md:flex'}`}>
          {active && activeThread ? (
            <>
              <div className="flex items-center gap-3 px-4 h-[58px] border-b border-line shrink-0">
                <button onClick={() => setActive(null)} className="md:hidden text-fg2 -ml-1"><Icon name="chevronR" className="rotate-180" size={20} /></button>
                <span className="grid place-items-center h-9 w-9 rounded-full bg-panel2 text-fg2 font-semibold">{initialOf(activeThread)}</span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold truncate">{threadName(activeThread)}</div>
                  <div className="text-[11px] text-fg3 font-mono truncate">{active}</div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
                    title="Sélectionner des messages"
                    className={`grid place-items-center h-9 w-9 rounded-ctl transition-colors ${selectMode ? 'bg-accent/12 text-accentFg' : 'text-fg3 hover:text-fg hover:bg-fg/[0.06]'}`}
                  >
                    <Icon name="checkCircle" size={16} />
                  </button>
                  <button
                    onClick={() => setConfirmDel({ kind: 'thread' })}
                    title="Supprimer la conversation"
                    className="grid place-items-center h-9 w-9 rounded-ctl text-fg3 hover:text-danger hover:bg-danger/10 transition-colors"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>

              <div ref={bodyRef} className="flex-1 overflow-auto p-4 flex flex-col gap-2.5 bg-bg2">
                {loadingMsgs && !messages.length ? (
                  <div className="space-y-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className={`h-9 ${i % 2 ? 'w-2/3' : 'w-1/2 ml-auto'}`} />)}</div>
                ) : (
                  messages.map((mm) => {
                    const p = parseBody(mm.body);
                    if (p.kind === 'human') {
                      return <div key={mm.id} className="self-center text-[11.5px] text-warn bg-warn/10 border border-warn/25 rounded-full px-3.5 py-1.5">🙋 Le client demande un conseiller</div>;
                    }
                    const isAdmin = mm.sender === 'admin';
                    const bot = p.bot;
                    return (
                      <div key={mm.id} className={`group flex items-end gap-2 ${isAdmin ? 'self-end flex-row-reverse' : 'self-start'} max-w-[82%]`}>
                        <div className={`px-3.5 py-2 rounded-2xl text-[13.5px] leading-snug whitespace-pre-wrap break-words ${
                          bot ? 'bg-panel border border-accent/25 rounded-bl-md'
                          : isAdmin ? 'bg-accent text-white rounded-br-md'
                          : 'bg-panel border border-line rounded-bl-md'
                        }`}>
                          {bot && <span className="block text-[9.5px] font-extrabold uppercase tracking-wider text-accentFg mb-1">Assistant</span>}
                          {p.kind === 'img' ? (
                            <>
                              <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="Photo" className="block max-w-full rounded-lg" loading="lazy" /></a>
                              {p.caption && <span className="block mt-1.5">{p.caption}</span>}
                              <a href={p.url} download className={`inline-flex items-center gap-1 mt-1.5 text-[11px] ${isAdmin && !bot ? 'text-white/80' : 'text-fg3'} hover:underline`}>
                                <Icon name="download" size={11} /> Télécharger
                              </a>
                            </>
                          ) : (
                            p.kind === 'text' && p.text
                          )}
                          <span className={`block text-[10px] mt-1 ${isAdmin && !bot ? 'text-white/70' : 'text-fg3'}`}>{fTime(mm.created_at)}</span>
                        </div>
                        {selectMode ? (
                          <input type="checkbox" checked={selected.has(mm.id)} onChange={() => toggleSel(mm.id)} className="mb-2 h-4 w-4 accent-[color:var(--accent)]" />
                        ) : (
                          <button
                            onClick={() => setConfirmDel({ kind: 'msgs', ids: [mm.id] })}
                            className="opacity-0 group-hover:opacity-100 mb-1.5 grid place-items-center h-7 w-7 rounded-lg text-fg3 hover:text-danger hover:bg-danger/10 transition-all shrink-0"
                            title="Supprimer ce message"
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Barre de sélection multiple */}
              {selectMode && selected.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 border-t border-line bg-panel2 shrink-0 animate-fade-in">
                  <span className="text-[12.5px] text-fg2 font-medium">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
                  <Button size="sm" variant="danger" icon="trash" className="ml-auto" onClick={() => setConfirmDel({ kind: 'msgs', ids: [...selected] })}>
                    Supprimer
                  </Button>
                </div>
              )}

              {/* Assistant IA temps réel : analyse la conversation, propose des
                  réponses complètes. Clic = remplit le champ (modifiable avant envoi). */}
              {!selectMode && (suggestions.length > 0 || sugLoading) && (
                <div className="px-3 pt-2.5 pb-0.5 shrink-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-accentFg">✨ Assistant</span>
                    {sugLoading ? (
                      <span className="flex items-center gap-1.5 text-[10.5px] text-fg3">
                        <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-fg3/30 border-t-accent animate-spin" />
                        analyse la conversation…
                      </span>
                    ) : (
                      <button
                        onClick={() => setSugTick((n) => n + 1)}
                        title="Régénérer les suggestions"
                        className="text-[11px] text-fg3 hover:text-fg transition-colors leading-none"
                      >
                        ↻
                      </button>
                    )}
                    <span className="ml-auto text-[10px] text-fg3">clic = remplir le champ, modifiable avant envoi</span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-auto no-scrollbar">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setReply(s)}
                        className="text-left text-[12.5px] leading-snug text-fg2 bg-panel2 border border-line rounded-xl px-3 py-2 hover:border-accent/40 hover:text-fg hover:bg-accent/[0.04] transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Aperçu photo à envoyer */}
              {pendingImg && (
                <div className="flex items-center gap-2.5 px-3 pt-2 shrink-0">
                  <img src={pendingImg} alt="Aperçu" className="h-12 w-12 object-cover rounded-lg border border-line2" />
                  <button onClick={() => setPendingImg(null)} className="grid place-items-center h-6 w-6 rounded-full bg-panel2 text-fg2 hover:text-fg text-[11px]">✕</button>
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-center gap-2.5 p-3 border-t border-line shrink-0">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => fileRef.current?.click()} title="Envoyer une photo"
                  className="grid place-items-center h-11 w-11 rounded-ctl bg-panel2 border border-line text-fg2 hover:text-fg hover:border-line2 shrink-0 transition-colors">
                  <Icon name="catalog" size={17} />
                </button>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Votre réponse…"
                  className="flex-1 h-11 bg-panel2 border border-line rounded-full px-4 text-[14px] text-fg placeholder:text-fg3 outline-none focus:border-line2 focus:shadow-focus transition-all"
                />
                <button type="submit" disabled={(!reply.trim() && !pendingImg) || sending} className="grid place-items-center h-11 w-11 rounded-full bg-accent text-white shrink-0 hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none transition">
                  <Icon name="send" size={17} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 grid place-items-center">
              <Empty icon="chat" title="Sélectionnez une conversation">Choisissez un visiteur à gauche pour lire et répondre.</Empty>
            </div>
          )}
        </section>
      </div>

      {/* Confirmation de suppression */}
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)}>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center h-10 w-10 rounded-xl bg-danger/12 text-danger"><Icon name="trash" size={18} /></span>
            <div>
              <div className="text-[15px] font-semibold">
                {confirmDel?.kind === 'thread' ? 'Supprimer toute la conversation ?' : `Supprimer ${confirmDel?.kind === 'msgs' && confirmDel.ids.length > 1 ? `${confirmDel.ids.length} messages` : 'ce message'} ?`}
              </div>
              <div className="text-[12.5px] text-fg3">Action définitive et irréversible.</div>
            </div>
          </div>
          <div className="flex gap-2.5 mt-5">
            <Button className="flex-1" onClick={() => setConfirmDel(null)}>Annuler</Button>
            <Button variant="danger" className="flex-1" icon="trash" disabled={busyDel} onClick={() => void doDelete()}>
              {busyDel ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
