// ════════════════════════════════════════════════════════════════════
// Données de démonstration — UNIQUEMENT en développement (import.meta.env.DEV).
// Elles permettent de concevoir et vérifier chaque écran sans toucher à
// l'API réelle. En production, api.ts ignore totalement ce fichier.
// ════════════════════════════════════════════════════════════════════
import type {
  DashboardData,
  LiveData,
  Order,
  VisitsData,
} from './api';

const MODELS = [
  'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 14 Pro',
  'iPhone 14', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 12', 'iPhone 11', 'iPhone SE',
];
const REPAIRS = [
  { r: 'ecran', name: 'Écran' },
  { r: 'batterie', name: 'Batterie' },
  { r: 'vitre-arriere', name: 'Vitre arrière' },
  { r: 'connecteur-charge', name: 'Connecteur de charge' },
  { r: 'camera', name: 'Caméra' },
];
const EMAILS = [
  'lucas.martin', 'emma.dubois', 'nathan.leroy', 'chloe.moreau', 'hugo.simon',
  'lea.laurent', 'jules.michel', 'manon.garcia', 'louis.bernard', 'sarah.petit',
  'noah.robert', 'jade.richard', 'gabriel.durand', 'alice.moreau', 'raphael.fabre',
];
const SLOTS = ['morning', 'afternoon', 'evening'];

let seed = 20260706;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const between = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo));

function makeOrders(n: number): Order[] {
  const out: Order[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const daysAgo = Math.floor(Math.pow(rnd(), 1.5) * 60);
    const created = new Date(now - daysAgo * 864e5 - between(0, 20) * 36e5);
    const model = pick(MODELS);
    const nItems = rnd() > 0.78 ? 2 : 1;
    const items = Array.from({ length: nItems }, () => pick(REPAIRS));
    const total = items.reduce((s, it) => {
      const base = it.r === 'ecran' ? 12900 : it.r === 'batterie' ? 6900 : 8900;
      return s + base + between(-1000, 2000);
    }, 0);
    const cost = Math.round(total * (0.42 + rnd() * 0.16));
    const rStatus = rnd();
    const status = rStatus > 0.93 ? 'error' : rStatus > 0.55 ? 'ordered' : 'paid';
    const hasAppt = rnd() > 0.55;
    const apptDate = hasAppt
      ? new Date(now + between(1, 16) * 864e5).toISOString()
      : undefined;
    const email = `${pick(EMAILS)}@${pick(['gmail.com', 'outlook.fr', 'orange.fr', 'icloud.com'])}`;
    out.push({
      id: 10480 - i,
      created_at: created.toISOString(),
      customer_email: email,
      total_cents: total,
      status,
      utopya_order_id: status === 'ordered' || status === 'paid' ? (rnd() > 0.3 ? 'UT' + between(80000, 99999) : null) : null,
      line_items: items.map((it) => ({ name: it.name, repair_id: it.r, model, qty: 1 })),
      metadata: {
        model,
        cart: JSON.stringify(items.map((it) => ({ r: it.r, m: model, q: 1 }))),
        apptDate,
        apptSlot: hasAppt ? pick(SLOTS) : undefined,
        addr: rnd() > 0.5 ? 'other' : 'shop',
      },
      error_message: status === 'error' ? 'Paiement capturé mais commande Utopya refusée (stock).' : null,
      _cost_cents: status === 'error' ? null : cost,
      _gain_cents: status === 'error' ? null : total - cost,
    });
  }
  return out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

const orders = makeOrders(64);
const d30 = Date.now() - 30 * 864e5;
const in30 = orders.filter((o) => +new Date(o.created_at) >= d30);
const sum = (a: Order[], f: (o: Order) => number) => a.reduce((s, o) => s + f(o), 0);

const upcoming = orders
  .filter((o) => o.metadata?.apptDate)
  .map((o) => ({
    id: o.id,
    date: o.metadata!.apptDate!,
    slot: o.metadata!.apptSlot || null,
    addr: o.metadata!.addr || null,
    email: o.customer_email,
    model: o.metadata!.model || null,
  }))
  .sort((a, b) => +new Date(a.date) - +new Date(b.date))
  .slice(0, 8);

export const MOCK_DATA: DashboardData = {
  orders,
  stats: {
    total_orders: orders.length,
    orders_30d: in30.length,
    encaisse_cents: sum(orders, (o) => o.total_cents),
    encaisse_30d_cents: sum(in30, (o) => o.total_cents),
    cout_pieces_cents: sum(orders, (o) => o._cost_cents || 0),
    benefice_cents: sum(orders, (o) => o._gain_cents || 0),
    cout_30d_cents: sum(in30, (o) => o._cost_cents || 0),
    benefice_30d_cents: sum(in30, (o) => o._gain_cents || 0),
    cost_unknown_orders: orders.filter((o) => o._cost_cents == null).length,
    upcoming_appointments: upcoming,
  },
  catalog: {
    combos: 742,
    in_stock: 689,
    out_of_stock: 41,
    broken: 12,
    prices_generated_at: new Date(Date.now() - 6 * 36e5).toISOString(),
    prices_age_hours: 6,
    over_ceiling: [
      { repairId: 'ecran', model: 'iPhone 15 Pro Max', final: 339, ceiling: 329 },
      { repairId: 'vitre-arriere', model: 'iPhone 14 Pro', final: 179, ceiling: 169 },
    ],
    broken_items: [
      { repairId: 'camera', model: 'iPhone 13 mini', url: 'https://utopya.fr/x' },
      { repairId: 'connecteur-charge', model: 'iPhone 12 Pro', url: null },
    ],
    coverage: [
      { repairId: 'ecran', models: 38 },
      { repairId: 'batterie', models: 41 },
      { repairId: 'vitre-arriere', models: 29 },
      { repairId: 'camera', models: 22 },
      { repairId: 'connecteur-charge', models: 18 },
    ],
    model_gaps: [
      { model: 'iPhone 17 Pro Max', missing: ['vitre-arriere', 'camera'] },
      { model: 'iPhone 16e', missing: ['connecteur-charge'] },
    ],
  },
  price_changes: {
    updatedAt: new Date(Date.now() - 6 * 36e5).toISOString(),
    total: 214,
    recent: Array.from({ length: 24 }, (_, i) => {
      const kinds = ['up', 'down', 'oos', 'restock'];
      const kind = pick(kinds);
      const model = pick(MODELS);
      const rep = pick(REPAIRS);
      const oldF = between(60, 300);
      return {
        t: new Date(Date.now() - i * 5 * 36e5).toISOString(),
        repairId: rep.r,
        model,
        oldFinal: kind === 'restock' ? null : oldF,
        newFinal: kind === 'oos' ? null : oldF + (kind === 'up' ? between(2, 20) : -between(2, 20)),
        oldOOS: kind === 'restock',
        newOOS: kind === 'oos',
        kind,
      };
    }),
    counts_30d: { up: 87, down: 64, oos: 33, restock: 30 },
  },
  health: {
    supabase_ok: true,
    prices_ok: true,
    order_errors: orders
      .filter((o) => o.status === 'error')
      .map((o) => ({
        id: o.id,
        email: o.customer_email,
        created_at: o.created_at,
        error: o.error_message || 'erreur',
        total: o.total_cents,
      })),
    paid_not_ordered: orders.filter((o) => o.status === 'paid' && !o.utopya_order_id).length,
    alerts: [
      { level: 'warn', msg: '2 produits dépassent le prix public Apple — à vérifier.' },
      { level: 'error', msg: `${orders.filter((o) => o.status === 'error').length} commande(s) en erreur — action requise.` },
    ],
  },
  serverTime: new Date().toISOString(),
};

const COUNTRIES = ['FR', 'FR', 'FR', 'FR', 'BE', 'CH', 'FR', 'FR', 'MA', 'FR'];
const CITIES = [
  'Lille (FR)', 'Roubaix (FR)', 'Tourcoing (FR)', 'Villeneuve-d\'Ascq (FR)',
  'Paris (FR)', 'Douai (FR)', 'Lens (FR)', 'Bruxelles (BE)', 'Valenciennes (FR)',
  'Dunkerque (FR)', 'Arras (FR)', 'Genève (CH)',
];
const DEVICES = ['iPhone', 'iPhone', 'Android', 'Mac', 'Windows', 'iPad'];
const SOURCES = ['direct', 'search', 'social', 'qr', 'referral'];
const PATHS = ['/', '/#reparations', '/#tarifs', '/#rdv', '/#contact', '/#avis'];

export const MOCK_LIVE: LiveData = {
  ready: true,
  online: 7,
  visitors: Array.from({ length: 7 }, () => ({
    path: pick(PATHS),
    country: pick(COUNTRIES),
    city: pick(CITIES).replace(/ \(.*\)/, ''),
    device: pick(DEVICES),
    device_model: null,
    ts: new Date(Date.now() - between(0, 45) * 1000).toISOString(),
  })),
};

const byCount = (arr: string[], n: number) => {
  const m: Record<string, number> = {};
  for (let i = 0; i < n; i++) m[pick(arr)] = (m[pick(arr)] || 0) + 1;
  return Object.entries(m)
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);
};

export const MOCK_VISITS: VisitsData = {
  ready: true,
  total_30d: 1284,
  today: 63,
  by_hour: Array.from({ length: 24 }, (_, h) => {
    const peak = Math.exp(-Math.pow(h - 18, 2) / 26) + Math.exp(-Math.pow(h - 12, 2) / 30);
    return Math.round(peak * 70 + rnd() * 8);
  }),
  by_source: byCount(SOURCES, 200),
  by_device: byCount(DEVICES, 200),
  by_country: byCount(COUNTRIES, 200),
  by_city: byCount(CITIES, 200).slice(0, 10),
  by_path: byCount(PATHS, 200),
  geo: [
    { lat: 50.63, lng: 3.06, city: 'Lille' },
    { lat: 50.69, lng: 3.18, city: 'Roubaix' },
    { lat: 50.72, lng: 3.16, city: 'Tourcoing' },
    { lat: 48.85, lng: 2.35, city: 'Paris' },
    { lat: 50.29, lng: 3.1, city: 'Douai' },
    { lat: 50.43, lng: 2.83, city: 'Lens' },
    { lat: 50.85, lng: 4.35, city: 'Bruxelles' },
    { lat: 50.36, lng: 3.52, city: 'Valenciennes' },
    { lat: 51.03, lng: 2.38, city: 'Dunkerque' },
    { lat: 46.2, lng: 6.14, city: 'Genève' },
    { lat: 50.29, lng: 2.78, city: 'Arras' },
    { lat: 43.6, lng: 1.44, city: 'Toulouse' },
  ],
  by_day: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 864e5);
    const base = 30 + Math.sin(i / 4) * 12 + i * 0.6;
    return { k: d.toISOString().slice(0, 10), v: Math.round(base + rnd() * 14) };
  }),
};
