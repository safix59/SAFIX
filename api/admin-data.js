// Données admin (protégé) : commandes Supabase + statistiques calculées.
// La clé service_role reste côté serveur ; jamais renvoyée au navigateur.
import { requireAuth } from './_admin-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return res.status(200).json({ orders: [], stats: null, warn: 'supabase_absent' });

  try {
    const r = await fetch(
      `${url}/rest/v1/orders?select=id,created_at,customer_email,total_cents,currency,status,utopya_order_id,line_items,metadata,stripe_payment_intent&order=created_at.desc&limit=300`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    const orders = await r.json();
    const list = Array.isArray(orders) ? orders : [];

    // Statistiques serveur (agrégats simples)
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 864e5);
    let revenue = 0, revenue30 = 0, count30 = 0;
    const upcoming = [];
    for (const o of list) {
      revenue += (o.total_cents || 0);
      if (o.created_at && new Date(o.created_at) >= d30) { revenue30 += (o.total_cents || 0); count30++; }
      const m = o.metadata || {};
      if (m.apptDate) {
        const ad = new Date(m.apptDate);
        if (ad >= new Date(now.toDateString())) {
          upcoming.push({ id: o.id, date: m.apptDate, slot: m.apptSlot || null, addr: m.addr || null, email: o.customer_email, model: m.model || null });
        }
      }
    }
    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.status(200).json({
      orders: list,
      stats: {
        total_orders: list.length,
        revenue_cents: revenue,
        revenue_30d_cents: revenue30,
        orders_30d: count30,
        upcoming_appointments: upcoming.slice(0, 30),
      },
      serverTime: now.toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
