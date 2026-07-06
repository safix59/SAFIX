// Client API du dashboard. Même origine que le site → cookie d'auth sécurisé.
// Toutes les routes passent par la fonction serverless unique /api/admin.

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

const BASE = '/api/admin';

async function call<T>(action: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  const r = await fetch(`${BASE}?action=${action}`, { credentials: 'same-origin', ...init });
  let data: T | null = null;
  try { data = (await r.json()) as T; } catch { data = null; }
  return { status: r.status, data };
}

export const api = {
  login: (password: string) =>
    call<{ ok: boolean }>('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }),
  logout: () => call<{ ok: boolean }>('logout', { method: 'POST' }),
  data: () => call<DashboardData>('data'),
  live: () => call<LiveData>('live'),
  visits: () => call<VisitsData>('visits'),
  deleteOrder: (id: number) => call<{ ok: boolean }>(`order-del&id=${encodeURIComponent(id)}`, { method: 'POST' }),
};
