import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './lib/api';
import type { DashboardData, LiveData, VisitsData, SessionsData } from './lib/api';
import { useHotkey, useLocalStorage, useNow } from './lib/hooks';
import { Icon, type IconName } from './icons';
import { Badge, Dot, IconButton, Modal, ToastHost, useToast } from './components';
import { euro, ago } from './lib/format';
import { itemsText } from './lib/derive';
import { Overview } from './pages/Overview';
import { Orders } from './pages/Orders';
import { Finance } from './pages/Finance';
import { Visitors } from './pages/Visitors';
import { Catalog } from './pages/Catalog';
import { Cartes } from './pages/Cartes';
import { History } from './pages/History';
import { System } from './pages/System';
import { Settings } from './pages/Settings';
import { Messages } from './pages/Messages';
import { Emails } from './pages/Emails';

type Section = 'home' | 'orders' | 'finance' | 'visitors' | 'messages' | 'emails' | 'catalog' | 'cards' | 'history' | 'system' | 'settings';

const NAV: { key: Section; label: string; icon: IconName; sub: string }[] = [
  { key: 'home', label: "Vue d'ensemble", icon: 'overview', sub: "Résumé de l'activité" },
  { key: 'orders', label: 'Commandes', icon: 'orders', sub: 'Toutes les commandes' },
  { key: 'finance', label: 'Finances', icon: 'finance', sub: 'Chiffre d’affaires, coûts et marge' },
  { key: 'visitors', label: 'Visiteurs', icon: 'visitors', sub: 'Fréquentation en temps réel' },
  { key: 'messages', label: 'Messages', icon: 'chat', sub: 'Conversations avec les visiteurs' },
  { key: 'emails', label: 'E-mails support', icon: 'inbox', sub: 'Messages reçus sur support@safix59.fr' },
  { key: 'catalog', label: 'Catalogue & prix', icon: 'catalog', sub: 'Stock, couverture et tarifs' },
  { key: 'cards', label: 'Cartes', icon: 'cards', sub: 'Visibilité, promos et contenu du site' },
  { key: 'history', label: 'Historique prix', icon: 'history', sub: 'Mouvements de prix' },
  { key: 'system', label: 'Système & santé', icon: 'system', sub: 'État technique et alertes' },
  { key: 'settings', label: 'Réglages', icon: 'gear', sub: 'Zone d’intervention et préférences' },
];
const NAV_GROUPS: { title: string; keys: Section[] }[] = [
  { title: 'Pilotage', keys: ['home'] },
  { title: 'Support', keys: ['messages', 'emails'] },
  { title: 'Activité', keys: ['orders', 'finance', 'visitors'] },
  { title: 'Catalogue', keys: ['catalog', 'cards', 'history'] },
  { title: 'Système', keys: ['system', 'settings'] },
];

type Theme = 'dark' | 'light';

export default function App() {
  return (
    <ToastHost>
      <Shell />
    </ToastHost>
  );
}

function Shell() {
  const [theme, setTheme] = useLocalStorage<Theme>('sfx_theme', 'dark');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [visits, setVisits] = useState<VisitsData | null>(null);
  const [sessions, setSessions] = useState<SessionsData | null>(null);
  const [msgUnread, setMsgUnread] = useState(0);
  const prevUnread = useRef<number | null>(null);
  const [emailUnread, setEmailUnread] = useState(0);
  const prevEmailUnread = useRef<number | null>(null);
  // Hash validé : un hash inconnu (#foo, ancien lien) aboutissait à
  // NAV.find(...)! → undefined → TypeError → écran blanc. Fallback « home ».
  const [section, setSection] = useState<Section>(() => {
    const h = location.hash.slice(1);
    return NAV.some((n) => n.key === h) ? (h as Section) : 'home';
  });
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('dark', 'light');
    el.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    if (section) location.hash = section;
  }, [section]);

  // Bouton Retour/Avant du navigateur : suivre le hash (avant, l'URL changeait
  // sans que la page affichée ne bouge).
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (NAV.some((n) => n.key === h)) setSection(h as Section);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  async function loadData() {
    setRefreshing(true);
    try {
      const res = await api.data();
      if (res.status === 200 && res.data) {
        setData(res.data);
        setAuthed(true);
        setLastUpdated(Date.now());
      } else if (res.status === 401) {
        // Session réellement expirée → retour au login.
        setAuthed(false);
      } else {
        // Statut 5xx/transitoire : si l'admin était DÉJÀ connecté, on garde
        // la session affichée (cookie toujours valide) au lieu de l'éjecter
        // à chaque hoquet du polling ; au premier chargement → login.
        setAuthed((prev) => (prev === true ? prev : false));
      }
    } catch {
      setAuthed((prev) => (prev === true ? prev : false));
    } finally {
      setRefreshing(false);
    }
  }
  async function loadLive() {
    try {
      const res = await api.live();
      if (res.status === 200) setLive(res.data);
    } catch { /* silencieux */ }
  }
  async function loadVisits() {
    try {
      const res = await api.visits();
      if (res.status === 200) setVisits(res.data);
    } catch { /* silencieux */ }
  }
  async function loadSessions() {
    try {
      const res = await api.sessions();
      if (res.status === 200) setSessions(res.data);
    } catch { /* silencieux */ }
  }
  async function loadMsgUnread() {
    try {
      const res = await api.msgThreads();
      if (res.status === 200 && res.data) {
        const n = res.data.total_unread || 0;
        // Notification temps réel : toast quand un nouveau message arrive.
        if (prevUnread.current != null && n > prevUnread.current) {
          toast({ title: 'Nouveau message visiteur', msg: 'Ouvrez l’onglet Messages pour répondre.', tone: 'accent' });
        }
        prevUnread.current = n;
        setMsgUnread(n);
      }
    } catch { /* silencieux */ }
  }
  async function loadEmailUnread() {
    try {
      const res = await api.emails();
      if (res.status === 200 && res.data && res.data.ready) {
        const n = res.data.unread || 0;
        // Notification temps réel : toast à l'arrivée d'un nouvel e-mail support.
        if (prevEmailUnread.current != null && n > prevEmailUnread.current) {
          toast({ title: 'Nouvel e-mail support', msg: 'Un message est arrivé sur support@safix59.fr.', tone: 'accent' });
        }
        prevEmailUnread.current = n;
        setEmailUnread(n);
      }
    } catch { /* silencieux */ }
  }

  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    if (!authed) return;
    void loadLive();
    void loadVisits();
    void loadSessions();
    void loadMsgUnread();
    void loadEmailUnread();
    const t1 = window.setInterval(() => void loadLive(), 10000);
    const t2 = window.setInterval(() => void loadData(), 45000);
    const t3 = window.setInterval(() => void loadVisits(), 60000);
    const t4 = window.setInterval(() => void loadSessions(), 15000);
    const t5 = window.setInterval(() => void loadMsgUnread(), 15000);
    const t6 = window.setInterval(() => void loadEmailUnread(), 15000);
    return () => { [t1, t2, t3, t4, t5, t6].forEach(window.clearInterval); };
  }, [authed]);

  // Titre d'onglet : compteur global des non-lus (messages + e-mails support).
  useEffect(() => {
    const n = msgUnread + emailUnread;
    document.title = n > 0 ? `(${n}) SAFIX · Administration` : 'SAFIX · Administration';
  }, [msgUnread, emailUnread]);

  useHotkey('k', (e) => { e.preventDefault(); setPalette((p) => !p); }, { meta: true });

  const goto = (s: Section) => { setSection(s); setDrawer(false); setPalette(false); };
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const logout = async () => {
    await api.logout();
    setAuthed(false);
    setData(null);
    toast({ title: 'Déconnecté', msg: 'À bientôt.', tone: 'neutral' });
  };

  if (authed === null) return <Splash />;
  if (authed === false) return <Login onSuccess={() => void loadData()} theme={theme} />;

  const nav = NAV.find((n) => n.key === section)!;
  const alerts = data?.health.alerts ?? [];
  const errorCount = data?.health.order_errors.length ?? 0;

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[256px_1fr] bg-bg">
      {/* ─── Sidebar ─── */}
      <aside
        className={`fixed md:sticky top-0 z-50 h-screen w-[264px] md:w-auto bg-bg2 border-r border-line flex flex-col transition-transform duration-300 ${
          drawer ? 'translate-x-0 shadow-pop' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-2 px-5 h-[60px] shrink-0">
          <div className="grid place-items-center h-8 w-8 rounded-[10px] bg-accent text-white font-bold text-[15px] shadow-soft">S</div>
          <div className="text-[17px] font-bold tracking-tight leading-none">
            <span className="text-accent">SA</span>FIX
          </div>
          <span className="ml-1 text-[9.5px] font-semibold text-fg3 tracking-[0.14em] uppercase border border-line rounded px-1.5 py-0.5">Console</span>
          <button className="md:hidden ml-auto text-fg3 hover:text-fg" onClick={() => setDrawer(false)} aria-label="Fermer"><Icon name="close" size={18} /></button>
        </div>

        <button
          onClick={() => setPalette(true)}
          className="mx-3 mb-2 flex items-center gap-2.5 h-9 px-3 rounded-ctl bg-panel border border-line text-fg3 hover:border-line2 hover:text-fg2 transition-colors"
        >
          <Icon name="search" size={15} />
          <span className="text-[13px]">Rechercher…</span>
          <kbd className="ml-auto text-[10px] font-sans font-medium text-fg3 border border-line rounded px-1.5 py-0.5">⌘K</kbd>
        </button>

        <nav className="flex-1 overflow-y-auto no-scrollbar px-3 pb-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mb-1">
              <div className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg3">{g.title}</div>
              {g.keys.map((k) => {
                const n = NAV.find((x) => x.key === k)!;
                const active = section === k;
                return (
                  <button
                    key={k}
                    onClick={() => goto(k)}
                    className={`relative w-full flex items-center gap-3 h-10 px-3 rounded-ctl text-[13.5px] font-medium transition-all duration-150 ${
                      active ? 'bg-fg/[0.06] text-fg' : 'text-fg2 hover:text-fg hover:bg-fg/[0.035]'
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-accent" />}
                    <span className={active ? 'text-accentFg' : 'text-fg3'}><Icon name={n.icon} size={18} /></span>
                    {n.label}
                    {k === 'messages' && msgUnread > 0 && (
                      <span className="ml-auto text-[10.5px] font-bold text-white bg-danger rounded-full min-w-[18px] h-[18px] grid place-items-center px-1">{msgUnread}</span>
                    )}
                    {k === 'emails' && emailUnread > 0 && (
                      <span className="ml-auto text-[10.5px] font-bold text-white bg-danger rounded-full min-w-[18px] h-[18px] grid place-items-center px-1">{emailUnread}</span>
                    )}
                    {k === 'system' && errorCount > 0 && (
                      <span className="ml-auto text-[10.5px] font-bold text-white bg-danger rounded-full min-w-[18px] h-[18px] grid place-items-center px-1">{errorCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3 flex items-center gap-2.5">
          <div className="grid place-items-center h-9 w-9 rounded-full bg-panel2 text-fg2 shrink-0"><Icon name="user" size={16} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold leading-tight">Administrateur</div>
            <div className="text-[11px] text-fg3 flex items-center gap-1.5">
              <Dot tone={alerts.some((a) => a.level === 'error') ? 'danger' : alerts.some((a) => a.level === 'warn') ? 'warn' : 'ok'} />
              {alerts.length ? `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}` : 'Tout va bien'}
            </div>
          </div>
          <button onClick={logout} title="Se déconnecter" className="grid place-items-center h-9 w-9 rounded-ctl text-fg3 hover:text-fg hover:bg-fg/[0.06] transition-colors">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>

      {drawer && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden animate-fade-in" onClick={() => setDrawer(false)} />}

      {/* ─── Main ─── */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 px-4 md:px-7 h-[60px] glass border-b border-line">
          <button className="md:hidden grid place-items-center h-10 w-10 rounded-ctl bg-panel border border-line text-fg2" onClick={() => setDrawer(true)} aria-label="Menu"><Icon name="menu" size={18} /></button>
          <div className="min-w-0">
            <div className="text-[16px] md:text-[17px] font-bold tracking-tight leading-tight truncate">{nav.label}</div>
            <div className="text-[11.5px] text-fg3 truncate hidden sm:block">{nav.sub}</div>
          </div>
          <div className="flex-1" />
          <LastUpdated at={lastUpdated} refreshing={refreshing} />
          <LiveBadge live={live} />
          <NotificationBell data={data} onGoto={() => goto('system')} />
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Thème clair / sombre" onClick={toggleTheme} />
          <IconButton icon="refresh" label="Rafraîchir" onClick={() => void loadData()} className={refreshing ? 'animate-pulse2' : ''} />
        </header>

        <main className="p-4 md:p-7 pb-24 w-full max-w-[1280px] mx-auto" key={section}>
          {!data ? (
            <PageSkeleton />
          ) : section === 'home' ? (
            <Overview data={data} live={live} visits={visits} />
          ) : section === 'orders' ? (
            <Orders data={data} onRefresh={() => void loadData()} />
          ) : section === 'finance' ? (
            <Finance data={data} />
          ) : section === 'visitors' ? (
            <Visitors visits={visits} live={live} sessions={sessions} />
          ) : section === 'messages' ? (
            <Messages />
          ) : section === 'emails' ? (
            <Emails onChanged={() => void loadEmailUnread()} />
          ) : section === 'catalog' ? (
            <Catalog data={data} />
          ) : section === 'cards' ? (
            <Cartes />
          ) : section === 'history' ? (
            <History data={data} />
          ) : section === 'system' ? (
            <System data={data} serverTime={data.serverTime} />
          ) : (
            <Settings />
          )}
        </main>
      </div>

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        data={data}
        onGoto={goto}
        onToggleTheme={() => { toggleTheme(); setPalette(false); }}
        onLogout={() => { setPalette(false); void logout(); }}
      />
    </div>
  );
}

// ─── Topbar bits ───
function LastUpdated({ at, refreshing }: { at: number | null; refreshing: boolean }) {
  useNow(15000); // re-render pour rafraîchir « il y a … »
  if (!at) return null;
  return (
    <span className="hidden lg:flex items-center gap-1.5 text-[11.5px] text-fg3 mr-1">
      <Icon name="clock" size={13} />
      {refreshing ? 'mise à jour…' : `maj ${ago(new Date(at).toISOString())}`}
    </span>
  );
}

function LiveBadge({ live }: { live: LiveData | null }) {
  const on = live?.ready ? live.online : null;
  return (
    <span className={`hidden sm:inline-flex items-center gap-2 text-[12px] rounded-full border border-line px-2.5 h-8 ${on ? 'text-fg2' : 'text-fg3'}`}>
      <Dot tone={on ? 'ok' : 'neutral'} ping={!!on} />
      {on == null ? '—' : <><b className="text-fg tnum">{on}</b> en ligne</>}
    </span>
  );
}

function NotificationBell({ data, onGoto }: { data: DashboardData | null; onGoto: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const alerts = data?.health.alerts ?? [];
  const count = alerts.length;
  const hasError = alerts.some((a) => a.level === 'error');
  useEffect(() => {
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid place-items-center h-10 w-10 rounded-ctl bg-panel border border-line text-fg2 hover:text-fg hover:border-line2 transition-all"
        aria-label="Notifications"
      >
        <Icon name="bell" size={17} />
        {count > 0 && (
          <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${hasError ? 'bg-danger' : 'bg-warn'}`} />
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[320px] bg-panel border border-line2 rounded-card shadow-pop overflow-hidden animate-scale-in z-50">
          <div className="px-4 py-3 border-b border-line flex items-center">
            <span className="text-[13px] font-semibold">Notifications</span>
            <span className="ml-auto"><Badge tone={hasError ? 'danger' : count ? 'warn' : 'ok'}>{count}</Badge></span>
          </div>
          {count ? (
            <div className="max-h-[300px] overflow-auto no-scrollbar p-1.5">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl hover:bg-fg/[0.03]">
                  <span className={a.level === 'error' ? 'text-danger' : a.level === 'warn' ? 'text-warn' : 'text-ok'}><Icon name={a.level === 'ok' ? 'checkCircle' : 'alert'} size={15} /></span>
                  <span className="text-[12.5px] text-fg2 leading-snug">{a.msg}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[12.5px] text-fg3">Rien à signaler ✨</div>
          )}
          <button onClick={() => { setOpen(false); onGoto(); }} className="w-full px-4 py-3 border-t border-line text-[12.5px] font-medium text-accentFg hover:bg-fg/[0.03] transition-colors">
            Ouvrir le centre système
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Command palette (⌘K) ───
function CommandPalette({
  open,
  onClose,
  data,
  onGoto,
  onToggleTheme,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  data: DashboardData | null;
  onGoto: (s: Section) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => { if (open) { setQ(''); setActive(0); } }, [open]);

  type Item = { id: string; icon: IconName; label: string; hint?: string; run: () => void };
  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const navItems: Item[] = NAV.map((n) => ({ id: 'nav-' + n.key, icon: n.icon, label: n.label, hint: 'Aller à', run: () => onGoto(n.key) }));
    const actions: Item[] = [
      { id: 'act-theme', icon: 'moon', label: 'Basculer le thème clair / sombre', hint: 'Action', run: onToggleTheme },
      { id: 'act-logout', icon: 'logout', label: 'Se déconnecter', hint: 'Action', run: onLogout },
    ];
    const orderItems: Item[] = term && data
      ? data.orders
          .filter((o) => (o.customer_email || '').toLowerCase().includes(term) || (o.metadata?.model || '').toLowerCase().includes(term) || String(o.id).includes(term))
          .slice(0, 5)
          .map((o) => ({ id: 'ord-' + o.id, icon: 'orders', label: `#${o.id} · ${o.metadata?.model || '—'}`, hint: `${euro(o.total_cents)} · ${itemsText(o)}`, run: () => onGoto('orders') }))
      : [];
    const all = [...navItems, ...actions, ...orderItems];
    if (!term) return all;
    return all.filter((i) => i.label.toLowerCase().includes(term) || (i.hint || '').toLowerCase().includes(term));
  }, [q, data, onGoto, onToggleTheme, onLogout]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-[560px]">
      <div className="flex items-center gap-3 px-4 h-[52px] border-b border-line">
        <Icon name="search" size={18} className="text-fg3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Rechercher une page, une commande, une action…"
          className="flex-1 bg-transparent outline-none text-[14px] text-fg placeholder:text-fg3"
        />
        <kbd className="text-[10px] font-medium text-fg3 border border-line rounded px-1.5 py-0.5">Esc</kbd>
      </div>
      <div className="max-h-[52vh] overflow-auto no-scrollbar p-2">
        {items.length ? (
          items.map((it, i) => (
            <button
              key={it.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => it.run()}
              className={`w-full flex items-center gap-3 px-3 h-11 rounded-ctl text-left transition-colors ${i === active ? 'bg-accent/12' : 'hover:bg-fg/[0.03]'}`}
            >
              <span className={i === active ? 'text-accentFg' : 'text-fg3'}><Icon name={it.icon} size={17} /></span>
              <span className="text-[13.5px] font-medium truncate flex-1">{it.label}</span>
              {it.hint && <span className="text-[11px] text-fg3 truncate max-w-[220px]">{it.hint}</span>}
              {i === active && <Icon name="chevronR" size={14} className="text-fg3" />}
            </button>
          ))
        ) : (
          <div className="px-4 py-10 text-center text-[13px] text-fg3">Aucun résultat pour « {q} »</div>
        )}
      </div>
    </Modal>
  );
}

// ─── Skeleton, Splash, Login ───
function PageSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[108px] skeleton" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <div className="h-[320px] skeleton lg:col-span-2" />
        <div className="h-[320px] skeleton" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-3.5">
        <div className="h-[240px] skeleton" />
        <div className="h-[240px] skeleton" />
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="min-h-screen grid place-items-center bg-bg">
      <div className="flex flex-col items-center gap-3 animate-fade-in">
        <div className="grid place-items-center h-12 w-12 rounded-2xl bg-accent text-white font-bold text-xl shadow-soft animate-pulse2">S</div>
        <div className="text-[13px] text-fg3">Chargement de la console…</div>
      </div>
    </div>
  );
}

function Login({ onSuccess, theme }: { onSuccess: () => void; theme: Theme }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const res = await api.login(pw);
    setBusy(false);
    if (res.status === 200) { setPw(''); onSuccess(); }
    else if (res.status === 429) {
      // Verrouillage anti force-brute : dire « mot de passe incorrect » à
      // l'admin qui tape le BON mot de passe l'induirait en erreur.
      const mins = (res.data as { retry_minutes?: number } | null)?.retry_minutes;
      setErr(`Trop de tentatives — réessayez dans ${mins || 15} min.`);
    } else if (res.status >= 500) {
      setErr('Serveur indisponible — réessayez dans un instant.');
    } else { setErr('Mot de passe incorrect'); }
  }
  return (
    <div className="min-h-screen grid place-items-center p-6 relative overflow-hidden bg-bg">
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div
        className="absolute inset-x-0 -top-40 h-[420px] pointer-events-none"
        style={{ background: 'radial-gradient(600px 300px at 50% 0%, var(--accent-soft), transparent 70%)' }}
      />
      <form onSubmit={submit} className="relative w-full max-w-[380px] animate-scale-in">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="grid place-items-center h-14 w-14 rounded-2xl bg-accent text-white font-bold text-2xl shadow-pop mb-4">S</div>
          <div className="text-[26px] font-bold tracking-tight"><span className="text-accent">SA</span>FIX</div>
          <div className="text-[12.5px] text-fg3 mt-1 tracking-wide uppercase">Console d'administration</div>
        </div>
        <div className="bg-panel border border-line rounded-card shadow-soft p-5">
          <label className="text-[12px] font-medium text-fg2 mb-1.5 block">Mot de passe</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg3"><Icon name="shield" size={16} /></span>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••••"
              autoComplete="current-password"
              autoFocus
              className="w-full h-11 bg-panel2 border border-line rounded-ctl pl-9 pr-3 text-[14px] text-fg placeholder:text-fg3 outline-none focus:border-accent focus:shadow-focus transition-all"
            />
          </div>
          <button
            disabled={busy || !pw}
            className="w-full h-11 mt-3 bg-accent text-white rounded-ctl text-[14px] font-semibold hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none transition shadow-soft flex items-center justify-center gap-2"
          >
            {busy ? 'Connexion…' : <>Se connecter <Icon name="chevronR" size={15} /></>}
          </button>
          <div className="text-danger text-[12.5px] min-h-[18px] mt-2.5 text-center flex items-center justify-center gap-1.5">
            {err && <><Icon name="xCircle" size={14} /> {err}</>}
          </div>
        </div>
        <div className="text-center text-[11px] text-fg3 mt-5 flex items-center justify-center gap-1.5">
          <Icon name="shield" size={12} /> Connexion chiffrée · accès réservé
          <span className="opacity-40">· {theme === 'dark' ? '🌙' : '☀️'}</span>
        </div>
      </form>
    </div>
  );
}
