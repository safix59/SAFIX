import type { Order } from './api';

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export interface DailySeries {
  days: string[];
  revenue: number[]; // cents
  count: number[];
  benefit: number[]; // cents
}

// Séries quotidiennes (n derniers jours) calculées côté client depuis les commandes.
export function ordersDaily(orders: Order[], n: number): DailySeries {
  const days: string[] = [];
  const idx = new Map<string, number>();
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 864e5));
    idx.set(k, days.length);
    days.push(k);
  }
  const revenue = Array(n).fill(0);
  const count = Array(n).fill(0);
  const benefit = Array(n).fill(0);
  for (const o of orders) {
    const k = (o.created_at || '').slice(0, 10);
    const i = idx.get(k);
    if (i == null) continue;
    revenue[i] += o.total_cents || 0;
    count[i] += 1;
    benefit[i] += o._gain_cents || 0;
  }
  return { days, revenue, count, benefit };
}

type Field = 'revenue' | 'count' | 'benefit';
const val = (o: Order, f: Field): number =>
  f === 'revenue' ? o.total_cents || 0 : f === 'count' ? 1 : o._gain_cents || 0;

// Variation période sur période : n derniers jours vs les n précédents. null si base nulle.
export function periodDelta(orders: Order[], f: Field, n = 30): number | null {
  const now = Date.now();
  const a = now - n * 864e5;
  const b = now - 2 * n * 864e5;
  let cur = 0;
  let prev = 0;
  for (const o of orders) {
    const t = new Date(o.created_at).getTime();
    if (t >= a) cur += val(o, f);
    else if (t >= b) prev += val(o, f);
  }
  if (prev === 0) return cur > 0 ? 100 : null;
  return ((cur - prev) / prev) * 100;
}

// Label court d'un jour ISO (« 12 juin »).
export const dayLabel = (iso: string): string => {
  try {
    return new Date(iso + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
};

// Détail lisible des pièces d'une commande.
export function itemsText(o: Order): string {
  const li = o.line_items;
  if (!Array.isArray(li) || !li.length) return '—';
  return li
    .map((it) => (it.name || it.repair_id || '') + ((it.qty ?? 1) > 1 ? ` ×${it.qty}` : ''))
    .filter(Boolean)
    .join(' · ');
}
