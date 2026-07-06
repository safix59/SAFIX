import type { DashboardData, LiveData } from './lib/api';
import { euro, fDate, SLOTS } from './lib/format';
import { AlertRow, Badge, Card, EmptyState, Kpi, SectionTitle, StatusBadge } from './ui';

function itemsText(li: DashboardData['orders'][number]['line_items']): string {
  if (!Array.isArray(li)) return '';
  return li.map((it) => (it.name || it.repair_id || '') + ((it.qty ?? 1) > 1 ? ` ×${it.qty}` : '')).join(', ');
}

export function Overview({ data, live, visitsToday }: { data: DashboardData; live: LiveData | null; visitsToday: number | null }) {
  const s = data.stats;
  const alerts = data.health.alerts || [];
  const ap = s.upcoming_appointments || [];
  const recent = (data.orders || []).slice(0, 5);
  const online = live?.ready ? live.online : null;
  return (
    <div className="animate-fade-in">
      {alerts.length > 0 && (
        <>
          <SectionTitle>À surveiller</SectionTitle>
          {alerts.map((a, i) => <AlertRow key={i} level={a.level}>{a.msg}</AlertRow>)}
        </>
      )}
      <SectionTitle>En direct</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi label="En ligne maintenant" value={online == null ? '—' : online} tone={online ? 'ok' : undefined} sub={online ? 'sur le site' : 'personne pour l’instant'} />
        <Kpi label="Visites aujourd’hui" value={visitsToday == null ? '—' : visitsToday} tone="accent" />
        <Kpi label="Commandes" value={s.total_orders ?? 0} sub={`${s.orders_30d ?? 0} sur 30 jours`} />
        <Kpi label="Bénéfice total" value={euro(s.benefice_cents)} tone="ok" />
      </div>

      <SectionTitle>Prochains rendez-vous</SectionTitle>
      {ap.length ? (
        <Card>
          {ap.map((a) => {
            const soon = new Date(a.date).getTime() - Date.now() < 3 * 864e5;
            return (
              <div key={a.id} className="flex items-center gap-3.5 px-5 py-4 border-b border-line last:border-0 hover:bg-fg/[0.03] transition-colors">
                <div className="font-semibold min-w-[140px] text-sm">
                  {fDate(a.date)} {soon && <span className="text-[10.5px] text-warn border border-warn/40 rounded-full px-2 py-px ml-1.5">bientôt</span>}
                </div>
                <div className="text-[13px] text-accent2">{SLOTS[a.slot ?? ''] || a.slot || ''} · {a.addr === 'other' ? '🏠 domicile' : '📍 dépôt'}</div>
                <div className="text-[13px] text-fg3 ml-auto text-right leading-snug">{a.model}<br />{a.email}</div>
              </div>
            );
          })}
        </Card>
      ) : <EmptyState icon="📅">Aucun rendez-vous à venir.</EmptyState>}

      <SectionTitle>Dernières commandes</SectionTitle>
      {recent.length ? (
        <Card>
          {recent.map((x) => {
            const m = x.metadata || {};
            return (
              <div key={x.id} className="flex items-center gap-3 px-5 py-4 border-b border-line last:border-0 hover:bg-fg/[0.03] transition-colors">
                <div className="font-semibold min-w-[105px] text-fg3 text-[13px]">{fDate(x.created_at)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{m.model || '—'}</div>
                  <div className="text-xs text-fg3 truncate">{itemsText(x.line_items)}</div>
                </div>
                <div className="tabular-nums font-semibold text-accent2 mx-3.5">{euro(x.total_cents)}</div>
                <StatusBadge status={x.status} />
              </div>
            );
          })}
        </Card>
      ) : <EmptyState icon="📦">Aucune commande pour le moment.</EmptyState>}
    </div>
  );
}

export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="animate-fade-in">
      <Card className="p-10 text-center">
        <div className="text-3xl mb-3">🛠️</div>
        <div className="text-lg font-semibold">{title}</div>
        <div className="mt-2 text-sm text-fg3 max-w-md mx-auto">{note || 'Ce module est en cours de portage vers la nouvelle interface. Il arrive très vite.'}</div>
        <div className="mt-4"><Badge tone="ordered">En construction</Badge></div>
      </Card>
    </div>
  );
}
