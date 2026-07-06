import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './lib/api';
import type { DashboardData, LiveData } from './lib/api';
import { Icon } from './ui';
import { Overview, Placeholder } from './pages';

type Section = 'home' | 'orders' | 'finance' | 'visitors' | 'catalog' | 'history' | 'system';
const NAV: { key: Section; label: string; icon: string }[] = [
  { key: 'home', label: 'Vue d’ensemble', icon: 'home' },
  { key: 'orders', label: 'Commandes', icon: 'orders' },
  { key: 'finance', label: 'Finances', icon: 'finance' },
  { key: 'visitors', label: 'Visiteurs', icon: 'visitors' },
  { key: 'catalog', label: 'Catalogue & Prix', icon: 'catalog' },
  { key: 'history', label: 'Historique prix', icon: 'history' },
  { key: 'system', label: 'Système & santé', icon: 'system' },
];
const SUBTITLE: Record<Section, string> = {
  home: 'Résumé de l’activité', orders: 'Toutes les commandes', finance: 'Chiffre d’affaires, coûts et marge',
  visitors: 'Fréquentation du site', catalog: 'Disponibilité, liens et prix', history: 'Évolution des prix', system: 'État technique et alertes',
};

type Theme = 'dark' | 'light';

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('sfx_theme') as Theme) || 'dark');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [visitsToday, setVisitsToday] = useState<number | null>(null);
  const [section, setSection] = useState<Section>('home');
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('dark', 'light');
    el.classList.add(theme);
    localStorage.setItem('sfx_theme', theme);
  }, [theme]);

  async function loadData() {
    try {
      const res = await api.data();
      // Seul un 200 avec données = connecté. 401/404/erreur → écran de connexion.
      if (res.status === 200 && res.data) { setData(res.data); setAuthed(true); }
      else { setAuthed(false); }
    } catch { setAuthed(false); }
  }
  async function loadLive() { const res = await api.live(); setLive(res.data); }
  async function loadVisits() { const res = await api.visits(); if (res.data?.ready) setVisitsToday(res.data.today); }

  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    if (!authed) return;
    void loadLive(); void loadVisits();
    const t1 = window.setInterval(() => void loadLive(), 10000);
    const t2 = window.setInterval(() => void loadData(), 45000);
    return () => { window.clearInterval(t1); window.clearInterval(t2); };
  }, [authed]);

  if (authed === null) return <SplashScreen />;
  if (authed === false) return <Login onSuccess={() => void loadData()} />;

  const errors = data?.health.order_errors.length ?? 0;

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[248px_1fr] bg-bg">
      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 z-40 h-screen w-[260px] md:w-auto bg-bg2 border-r border-line flex flex-col p-3.5 transition-transform ${drawer ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-5 text-[19px] font-extrabold tracking-tight">
          <span><span className="text-accent">SA</span>FIX</span>
          <span className="ml-auto text-[10px] font-semibold text-fg3 tracking-[0.14em] uppercase">Admin</span>
        </div>
        <nav className="flex flex-col gap-0.5 flex-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => { setSection(n.key); setDrawer(false); }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[11px] text-[14.5px] font-medium transition-colors border ${section === n.key ? 'bg-fg/[0.06] text-fg border-line' : 'text-fg2 hover:bg-fg/[0.04] hover:text-fg border-transparent'}`}
            >
              <Icon name={n.icon} />
              {n.label}
              {n.key === 'system' && errors > 0 && <span className="ml-auto text-[11px] font-bold text-white bg-danger rounded-full px-2 min-w-[20px] text-center">{errors}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-line pt-3.5 mt-2 flex items-center gap-2.5 text-[12.5px] text-fg3">
          <HealthDot data={data} />
          <button onClick={() => { void api.logout().then(() => setAuthed(false)); }} className="ml-auto text-fg2 border border-line rounded-[9px] px-3 py-1.5 hover:border-line2 hover:text-fg">Quitter</button>
        </div>
      </aside>

      {drawer && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawer(false)} />}

      {/* Main */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3.5 px-4 md:px-7 py-4 bg-bg/70 backdrop-blur-xl border-b border-line">
          <button className="md:hidden bg-panel border border-line rounded-[10px] w-[38px] h-[38px] flex items-center justify-center" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
          <div>
            <div className="text-[20px] font-bold tracking-tight">{NAV.find((n) => n.key === section)?.label}</div>
            <div className="text-[12.5px] text-fg3">{SUBTITLE[section]}</div>
          </div>
          <div className="flex-1" />
          <LiveBadge live={live} />
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="bg-panel border border-line text-fg2 w-[38px] h-[38px] rounded-[10px] flex items-center justify-center hover:border-line2 hover:text-fg" title="Thème clair / sombre">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <button onClick={() => void loadData()} className="bg-panel border border-line text-fg2 w-[38px] h-[38px] rounded-[10px] flex items-center justify-center hover:border-line2 hover:text-fg" title="Rafraîchir"><Icon name="refresh" size={16} /></button>
        </header>

        <main className="p-4 md:p-7 pb-20 max-w-[1160px] w-full">
          {!data ? <PageSkeleton /> : section === 'home' ? (
            <Overview data={data} live={live} visitsToday={visitsToday} />
          ) : (
            <Placeholder title={NAV.find((n) => n.key === section)?.label ?? ''} />
          )}
        </main>
      </div>
    </div>
  );
}

function HealthDot({ data }: { data: DashboardData | null }) {
  const alerts = data?.health.alerts ?? [];
  const lvl = alerts.some((a) => a.level === 'error') ? 'danger' : alerts.some((a) => a.level === 'warn') ? 'warn' : 'ok';
  const cls = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' }[lvl];
  const txt = lvl === 'ok' ? 'Tout va bien' : `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}`;
  return <><span className={`h-2 w-2 rounded-full ${cls}`} />{txt}</>;
}

function LiveBadge({ live }: { live: LiveData | null }) {
  const on = live?.ready ? live.online : null;
  return (
    <span className={`hidden sm:inline-flex items-center gap-2 text-[12.5px] rounded-full border border-line px-3 py-1.5 ${on ? 'text-fg2' : 'text-fg3'}`}>
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-ok animate-pulse2' : 'bg-fg3'}`} />
      {on == null ? 'hors-ligne' : <><b className="text-fg">{on}</b> en ligne</>}
    </span>
  );
}

function SplashScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-fg">
      <div className="text-2xl font-extrabold tracking-tight animate-pulse2"><span className="text-accent">SA</span>FIX</div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="h-3 w-24 skeleton rounded mb-4" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] skeleton" />)}
      </div>
      <div className="h-3 w-32 skeleton rounded my-4" />
      <div className="h-40 skeleton" />
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const res = await api.login(pw);
    setBusy(false);
    if (res.status === 200) { setPw(''); onSuccess(); }
    else setErr('Mot de passe incorrect');
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, rgba(10,132,255,.12), transparent 60%)' }}>
      <form onSubmit={submit} className="w-full max-w-[360px] text-center">
        <div className="text-[34px] font-extrabold tracking-tight"><span className="text-accent">SA</span>FIX</div>
        <div className="text-[13.5px] text-fg3 mt-1.5 mb-7 tracking-wide uppercase">Espace administrateur</div>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe" autoComplete="current-password"
          className="w-full bg-panel border border-line rounded-xl text-fg text-base px-4 py-3.5 outline-none focus:border-accent transition-colors" />
        <button disabled={busy} className="w-full mt-3 bg-accent text-white rounded-xl text-base font-semibold py-3.5 hover:brightness-110 disabled:opacity-60 transition">
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <div className="text-danger text-[13px] min-h-[18px] mt-2.5">{err}</div>
      </form>
    </div>
  );
}
