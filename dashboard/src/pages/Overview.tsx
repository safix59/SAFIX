import { useMemo, useState } from 'react';
import type { DashboardData, LiveData, VisitsData } from '../lib/api';
import { euro, euroShort, num, fDate, fTime, ago, SLOTS, deviceMeta, flag } from '../lib/format';
import { ordersDaily, periodDelta, dayLabel, itemsText } from '../lib/derive';
import { Card, CardHead, Kpi, CountUp, AlertBanner, StatusPill, Empty, Dot, Badge, Segmented } from '../components';
import { Sparkline, AreaChart } from '../charts';
import { Icon } from '../icons';

export function Overview({
  data,
  live,
  visits,
}: {
  data: DashboardData;
  live: LiveData | null;
  visits: VisitsData | null;
}) {
  const s = data.stats;
  const alerts = data.health.alerts || [];
  const daily = useMemo(() => ordersDaily(data.orders, 30), [data.orders]);
  const online = live?.ready ? live.online : null;
  const recent = data.orders.slice(0, 6);
  const appts = s.upcoming_appointments || [];

  return (
    <div className="stagger">
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2.5 mb-2">
          {alerts.slice(0, 2).map((a, i) => (
            <AlertBanner key={i} level={a.level === 'ok' ? 'ok' : a.level}>
              {a.msg}
            </AlertBanner>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi
          icon="euro"
          label="Chiffre d'affaires"
          value={<CountUp value={s.encaisse_30d_cents} format={euroShort} />}
          delta={periodDelta(data.orders, 'revenue')}
          sub="30 derniers jours"
          spark={<Sparkline data={daily.revenue} color="var(--accent)" />}
          tone="neutral"
        />
        <Kpi
          icon="trendUp"
          label="Bénéfice net"
          value={<CountUp value={s.benefice_30d_cents} format={euroShort} />}
          delta={periodDelta(data.orders, 'benefit')}
          sub="30 derniers jours"
          spark={<Sparkline data={daily.benefit} color="var(--ok)" />}
          tone="ok"
        />
        <Kpi
          icon="orders"
          label="Commandes"
          value={<CountUp value={s.orders_30d} format={num} />}
          delta={periodDelta(data.orders, 'count')}
          sub={`${num(s.total_orders)} au total`}
          spark={<Sparkline data={daily.count} color="var(--violet)" />}
          tone="neutral"
        />
        <Kpi
          icon="visitors"
          label="En ligne maintenant"
          value={
            <span className="flex items-center gap-2.5">
              {online == null ? '—' : online}
              {!!online && <Dot tone="ok" ping />}
            </span>
          }
          sub={visits?.ready ? `${num(visits.today)} visites aujourd'hui` : 'temps réel'}
          tone={online ? 'ok' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <div className="lg:col-span-2">
          <ActivityCard daily={daily} />
        </div>
        <LivePanel live={live} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-3.5">
        <Card>
          <CardHead title="Prochains rendez-vous" icon="calendar" sub={`${appts.length} à venir`} />
          {appts.length ? (
            <div className="p-1.5">
              {appts.slice(0, 5).map((a) => {
                const soon = new Date(a.date).getTime() - Date.now() < 3 * 864e5;
                return (
                  <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-fg/[0.03] transition-colors">
                    <div className="grid place-items-center h-9 w-9 rounded-xl bg-panel2 text-fg2 shrink-0">
                      <Icon name="calendar" size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium flex items-center gap-2">
                        {fDate(a.date)}
                        {soon && <Badge tone="warn">bientôt</Badge>}
                      </div>
                      <div className="text-[12px] text-fg3 truncate">
                        {SLOTS[a.slot ?? '']?.split('·')[0] || a.slot || ''} · {a.addr === 'other' ? 'à domicile' : 'au dépôt'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12.5px] font-medium">{a.model || '—'}</div>
                      <div className="text-[11px] text-fg3 truncate max-w-[150px]">{a.email}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="calendar" title="Aucun rendez-vous à venir">Les créneaux réservés apparaîtront ici.</Empty>
          )}
        </Card>

        <Card>
          <CardHead title="Dernières commandes" icon="orders" sub={`${num(data.orders.length)} au total`} />
          {recent.length ? (
            <div className="p-1.5">
              {recent.map((o) => (
                <div key={o.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-fg/[0.03] transition-colors">
                  <div className="grid place-items-center h-9 w-9 rounded-xl bg-panel2 text-fg2 shrink-0">
                    <Icon name="phone" size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{o.metadata?.model || '—'}</div>
                    <div className="text-[12px] text-fg3 truncate">{itemsText(o)}</div>
                  </div>
                  <div className="text-[13px] font-semibold tnum shrink-0">{euro(o.total_cents)}</div>
                  <div className="shrink-0"><StatusPill status={o.status} /></div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="orders" title="Aucune commande">Les commandes payées s'afficheront ici.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}

function ActivityCard({ daily }: { daily: ReturnType<typeof ordersDaily> }) {
  const [metric, setMetric] = useState<'revenue' | 'count' | 'benefit'>('revenue');
  const series = daily[metric];
  const total = series.reduce((a, b) => a + b, 0);
  const isMoney = metric !== 'count';
  return (
    <Card className="h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
        <div>
          <div className="text-[14px] font-semibold tracking-tight">Activité · 30 jours</div>
          <div className="text-[12px] text-fg3">
            {metric === 'revenue' ? 'Chiffre d\'affaires' : metric === 'benefit' ? 'Bénéfice net' : 'Commandes'} :{' '}
            <span className="text-fg2 font-medium tnum">{isMoney ? euro(total) : num(total)}</span>
          </div>
        </div>
        <div className="ml-auto">
          <Segmented
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'revenue', label: 'CA' },
              { value: 'benefit', label: 'Bénéfice' },
              { value: 'count', label: 'Commandes' },
            ]}
          />
        </div>
      </div>
      <div className="px-3 py-4">
        <AreaChart
          data={series}
          color={metric === 'benefit' ? 'var(--ok)' : metric === 'count' ? 'var(--violet)' : 'var(--accent)'}
          format={(n) => (isMoney ? euro(n) : num(Math.round(n)))}
          labelFor={(i) => dayLabel(daily.days[i])}
        />
        <div className="flex justify-between px-3 mt-1 text-[10.5px] text-fg3 tnum">
          <span>{dayLabel(daily.days[0])}</span>
          <span>{dayLabel(daily.days[Math.floor(daily.days.length / 2)])}</span>
          <span>{dayLabel(daily.days[daily.days.length - 1])}</span>
        </div>
      </div>
    </Card>
  );
}

function LivePanel({ live }: { live: LiveData | null }) {
  const list = live?.ready ? live.visitors : [];
  return (
    <Card className="h-full flex flex-col">
      <CardHead
        title="En direct"
        icon="wifi"
        action={<Badge tone={live?.online ? 'ok' : 'neutral'}><Dot tone={live?.online ? 'ok' : 'neutral'} ping={!!live?.online} />{live?.online ?? 0}</Badge>}
      />
      {list.length ? (
        <div className="p-1.5 flex-1 overflow-auto max-h-[300px] no-scrollbar">
          {list.map((v, i) => {
            const dm = deviceMeta(v.device);
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-fg/[0.03] transition-colors">
                <span className="text-fg3"><Icon name={dm.icon} size={15} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium truncate">
                    {v.city || dm.label} <span className="text-fg3">{flag(v.country)}</span>
                  </div>
                  <div className="text-[11px] text-fg3 truncate">{v.path}</div>
                </div>
                <div className="text-[10.5px] text-fg3 shrink-0">{ago(v.ts) || fTime(v.ts)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 grid place-items-center">
          <Empty icon="visitors" title="Personne pour l'instant">Les visiteurs actifs apparaissent ici en temps réel.</Empty>
        </div>
      )}
    </Card>
  );
}
