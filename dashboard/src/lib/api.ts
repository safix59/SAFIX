// Client API du dashboard. Même origine que le site → cookie d'auth sécurisé.
// Toutes les routes passent par la fonction serverless unique /api/admin.
//
// En développement (import.meta.env.DEV), on sert des données de démonstration
// pour concevoir/vérifier l'UI sans backend. En production, comportement 100 %
// réseau, inchangé.

export interface OrderMeta {
  model?: string;
  phone?: string;
  snap?: string;
  delivery?: string;
  apptDate?: string;
  apptSlot?: string;
  addr?: string;
  cart?: string;
}
export interface LineItem { name?: string; repair_id?: string; model?: string; qty?: number; }
export interface Order {
  id: number;
  created_at: string;
  customer_email: string | null;
  total_cents: number;
  status: string;
  utopya_order_id?: string | null;
  line_items?: LineItem[];
  metadata?: OrderMeta;
  error_message?: string | null;
  _cost_cents?: number | null;
  _gain_cents?: number | null;
}
export interface Appointment { id: number; date: string; slot: string | null; addr: string | null; email: string | null; model: string | null; }
export interface Stats {
  total_orders: number;
  orders_30d: number;
  encaisse_cents: number;
  encaisse_30d_cents: number;
  cout_pieces_cents: number;
  benefice_cents: number;
  cout_30d_cents: number;
  benefice_30d_cents: number;
  cost_unknown_orders: number;
  upcoming_appointments: Appointment[];
}
export interface Alert { level: 'error' | 'warn' | 'ok'; msg: string; }
export interface Health {
  supabase_ok: boolean;
  prices_ok: boolean;
  order_errors: { id: number; email: string | null; created_at: string; error: string; total: number }[];
  paid_not_ordered: number;
  alerts: Alert[];
}
export interface Catalog {
  combos: number;
  in_stock: number;
  out_of_stock: number;
  broken: number;
  prices_generated_at: string | null;
  prices_age_hours: number | null;
  over_ceiling: { repairId: string; model: string; final: number; ceiling: number }[];
  broken_items: { repairId: string; model: string; url: string | null }[];
  coverage: { repairId: string; models: number }[];
  model_gaps: { model: string; missing: string[] }[];
}
export interface PriceChanges {
  updatedAt: string | null;
  total: number;
  recent: { t: string; repairId: string; model: string; oldFinal: number | null; newFinal: number | null; oldOOS: boolean; newOOS: boolean; kind: string }[];
  counts_30d: { up?: number; down?: number; oos?: number; restock?: number };
}
export interface DashboardData {
  orders: Order[];
  stats: Stats;
  catalog: Catalog;
  price_changes: PriceChanges;
  health: Health;
  serverTime: string;
}
export interface LiveVisitor { path: string; country: string | null; city: string | null; device: string | null; device_model: string | null; ts: string; }
export interface LiveData { ready: boolean; online: number; visitors: LiveVisitor[]; }
export interface Bar { k: string; v: number; }
export interface VisitsData {
  ready: boolean;
  reason?: string;
  total_30d: number;
  today: number;
  by_hour: number[];
  by_source: Bar[];
  by_device: Bar[];
  by_country: Bar[];
  by_city: Bar[];
  by_path: Bar[];
  geo: { lat: number; lng: number; city: string | null }[];
  by_day: { k: string; v: number }[];
}

export interface JourneyStep { path: string; ts: string; }
export interface VisitorSession {
  id: string;
  lat: number | null;
  lng: number | null;
  first_ts: string;
  last_ts: string;
  duration_s: number;
  page_count: number;
  hits: number;
  live: boolean;
  journey: JourneyStep[];
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  device_model: string | null;
  source: string | null;
  browser: string | null;
  os: string | null;
  lang: string | null;
  ref_host: string | null;
}
export interface SessionsData {
  ready: boolean;
  reason?: string;
  now?: string;
  online?: number;
  total?: number;
  sessions: VisitorSession[];
}

export interface ChatMessage { id: number; sender: 'user' | 'admin'; body: string; name?: string | null; created_at: string; }
export interface MsgThread { session: string; name: string | null; last_body: string; last_sender: string; last_ts: string; unread: number; count: number; }
export interface ThreadsData { ready: boolean; threads: MsgThread[]; total_unread: number; }

export interface GeoConfig {
  enabled: boolean;
  lat: number;
  lng: number;
  radiusKm: number;
  city: string;
}

// ── CMS cartes (page Cartes) ──
export interface CardPromo {
  active: boolean;
  type: 'percent' | 'amount' | 'badge';
  value?: number;
  label?: string;
  color?: string;
  start?: string | null;
  end?: string | null;
}
// Couche par-modèle : un champ PRÉSENT (même null) écrase le réglage
// général de la carte pour CE modèle ; un champ absent hérite.
export interface CardModelOverride {
  hidden?: boolean;
  price?: number | null;
  title?: string | null;
  subtitle?: string | null;
  promo?: CardPromo | null;
  order?: number | null;
}
export interface CardOverride {
  hidden?: boolean;
  order?: number | null;
  title?: string | null;
  subtitle?: string | null;
  price?: number | null;
  category?: string;
  custom?: boolean;
  promo?: CardPromo | null;
  models?: Record<string, CardModelOverride>;
}
export type CardsMap = Record<string, CardOverride>;
export interface CardsHistorySnap { ts: string; note: string; count: number; }

export type Res<T> = { status: number; data: T | null };

const BASE = '/api/admin';
const DEV = import.meta.env.DEV;

async function call<T>(action: string, init?: RequestInit): Promise<Res<T>> {
  const r = await fetch(`${BASE}?action=${action}`, { credentials: 'same-origin', ...init });
  let data: T | null = null;
  try { data = (await r.json()) as T; } catch { data = null; }
  return { status: r.status, data };
}

// ─── Couche de démonstration (dev uniquement) ───
let devAuthed = false;
let devGeo: GeoConfig = { enabled: true, lat: 51.0344, lng: 2.3768, radiusKm: 30, city: 'Dunkerque' };
let devMaint = false;
let devCards: CardsMap = {};
const devSnaps: CardsHistorySnap[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function devCall<T>(
  kind: 'login' | 'logout' | 'data' | 'live' | 'visits' | 'sessions' | 'del' | 'geo' | 'geo-set' | 'msg-threads' | 'msg-thread' | 'msg-reply' | 'msg-del' | 'msg-del-thread' | 'suggest' | 'admin-ping' | 'maintenance-get' | 'maintenance-set' | 'cards-get' | 'cards-set' | 'cards-history' | 'cards-restore',
  pw?: string,
  payload?: unknown,
): Promise<Res<T>> {
  const m = await import('./mock');
  await wait(kind === 'data' ? 480 : 200);
  if (kind === 'login') { devAuthed = (pw || '').length > 0; return { status: devAuthed ? 200 : 401, data: { ok: devAuthed } as unknown as T }; }
  if (kind === 'logout') { devAuthed = false; return { status: 200, data: { ok: true } as unknown as T }; }
  if (kind === 'geo') return { status: 200, data: { ok: true, geo: devGeo } as unknown as T };
  if (kind === 'del') return { status: 200, data: { ok: true } as unknown as T };
  if (!devAuthed) return { status: 401, data: null };
  if (kind === 'geo-set') { devGeo = { ...devGeo, ...(payload as Partial<GeoConfig>) }; return { status: 200, data: { ok: true, geo: devGeo } as unknown as T }; }
  if (kind === 'msg-threads') return { status: 200, data: m.mockThreads() as unknown as T };
  if (kind === 'msg-thread') return { status: 200, data: { messages: m.mockThread(String((payload as { session: string }).session)) } as unknown as T };
  if (kind === 'msg-reply') { const p = payload as { session: string; body: string }; m.mockReply(p.session, p.body); return { status: 200, data: { ok: true } as unknown as T }; }
  if (kind === 'admin-ping') return { status: 200, data: { ok: true } as unknown as T };
  if (kind === 'msg-del' || kind === 'msg-del-thread') return { status: 200, data: { ok: true } as unknown as T };
  if (kind === 'suggest') return { status: 200, data: { ready: false, suggestions: [] } as unknown as T };
  if (kind === 'maintenance-get') return { status: 200, data: { ok: true, on: devMaint } as unknown as T };
  if (kind === 'maintenance-set') { devMaint = !!(payload as { on: boolean }).on; return { status: 200, data: { ok: true, on: devMaint } as unknown as T }; }
  if (kind === 'cards-get') return { status: 200, data: { ok: true, cards: devCards } as unknown as T };
  if (kind === 'cards-set') { devSnaps.unshift({ ts: new Date().toISOString(), note: '', count: Object.keys(devCards).length }); devCards = (payload as { cards: CardsMap }).cards; return { status: 200, data: { ok: true } as unknown as T }; }
  if (kind === 'cards-history') return { status: 200, data: { ok: true, snaps: devSnaps } as unknown as T };
  if (kind === 'cards-restore') return { status: 200, data: { ok: true, cards: devCards } as unknown as T };
  if (kind === 'data') return { status: 200, data: m.MOCK_DATA as unknown as T };
  if (kind === 'live') return { status: 200, data: m.MOCK_LIVE as unknown as T };
  if (kind === 'sessions') return { status: 200, data: m.mockSessions() as unknown as T };
  return { status: 200, data: m.MOCK_VISITS as unknown as T };
}

export const api = {
  login: (password: string): Promise<Res<{ ok: boolean }>> =>
    DEV ? devCall('login', password) : call('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }),
  logout: (): Promise<Res<{ ok: boolean }>> => (DEV ? devCall('logout') : call('logout', { method: 'POST' })),
  data: (): Promise<Res<DashboardData>> => (DEV ? devCall('data') : call('data')),
  live: (): Promise<Res<LiveData>> => (DEV ? devCall('live') : call('live')),
  visits: (): Promise<Res<VisitsData>> => (DEV ? devCall('visits') : call('visits')),
  sessions: (): Promise<Res<SessionsData>> => (DEV ? devCall('sessions') : call('sessions')),
  geo: (): Promise<Res<{ ok: boolean; geo: GeoConfig }>> => (DEV ? devCall('geo') : call('geo')),
  geoSet: (cfg: GeoConfig): Promise<Res<{ ok: boolean; geo: GeoConfig }>> =>
    DEV ? devCall('geo-set', undefined, cfg) : call('geo-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }),
  msgThreads: (): Promise<Res<ThreadsData>> => (DEV ? devCall('msg-threads') : call('msg-threads')),
  msgThread: (session: string): Promise<Res<{ messages: ChatMessage[] }>> =>
    DEV ? devCall('msg-thread', undefined, { session }) : call(`msg-thread&session=${encodeURIComponent(session)}`),
  msgReply: (session: string, body: string, image?: string | null): Promise<Res<{ ok: boolean }>> =>
    DEV ? devCall('msg-reply', undefined, { session, body }) : call('msg-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, body, image: image || null }) }),
  msgDel: (ids: number[]): Promise<Res<{ ok: boolean }>> =>
    DEV ? devCall('msg-del', undefined, { ids }) : call('msg-del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }),
  msgDelThread: (session: string): Promise<Res<{ ok: boolean }>> =>
    DEV ? devCall('msg-del-thread', undefined, { session }) : call('msg-del-thread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session }) }),
  msgSuggest: (session: string): Promise<Res<{ ready: boolean; suggestions: string[] }>> =>
    DEV ? devCall('suggest', undefined, { session }) : call('suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session }) }),
  adminPing: (): Promise<Res<{ ok: boolean }>> => (DEV ? devCall('admin-ping') : call('admin-ping', { method: 'POST' })),
  maintenanceGet: (): Promise<Res<{ ok: boolean; on: boolean; since?: string | null }>> =>
    DEV ? devCall('maintenance-get') : call('maintenance-get'),
  maintenanceSet: (on: boolean): Promise<Res<{ ok: boolean; on: boolean }>> =>
    DEV ? devCall('maintenance-set', undefined, { on }) : call('maintenance-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) }),
  deleteOrder: (id: number): Promise<Res<{ ok: boolean }>> =>
    DEV ? devCall('del') : call(`order-del&id=${encodeURIComponent(id)}`, { method: 'POST' }),
  cardsGet: (): Promise<Res<{ ok: boolean; cards: CardsMap; updated_at?: string }>> =>
    DEV ? devCall('cards-get') : call('cards'),
  cardsSet: (cards: CardsMap, note?: string): Promise<Res<{ ok: boolean }>> =>
    DEV ? devCall('cards-set', undefined, { cards }) : call('cards-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards, note: note || '' }) }),
  cardsHistory: (): Promise<Res<{ ok: boolean; snaps: CardsHistorySnap[] }>> =>
    DEV ? devCall('cards-history') : call('cards-history'),
  cardsRestore: (ts: string): Promise<Res<{ ok: boolean; cards: CardsMap }>> =>
    DEV ? devCall('cards-restore', undefined, { ts }) : call('cards-restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts }) }),
};
