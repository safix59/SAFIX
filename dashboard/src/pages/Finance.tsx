import { useMemo, useState } from 'react';
import type { DashboardData } from '../lib/api';
import { euro, euroShort, num } from '../lib/format';
import { ordersDaily, periodDelta, dayLabel } from '../lib/derive';
import { Card, CardHead, Kpi, CountUp, Meter, AlertBanner, Segmented, Badge } from '../components';
import { AreaChart, Donut } from '../charts';

export function Finance({ data }: { data: DashboardData }) {
  const s = data.stats;
  const daily = useMemo(() => ordersDaily(data.orders, 30), [data.orders]);
  const [metric, setMetric] = useState<'revenue' | 'benefit'>('revenue');

  const knownRevenue = s.benefice_cents + s.cout_pieces_cents;
  const marginRate = knownRevenue > 0 ? (s.benefice_cents / knownRevenue) * 100 : 0;
  const costPart = s.encaisse_cents > 0 ? (s.cout_pieces_cents / s.encaisse_cents) * 100 : 0;

  const series = daily[metric];

  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi icon="euro" label="Chiffre d'affaires" value={<CountUp value={s.encaisse_cents} format={euroShort} />} delta={periodDelta(data.orders, 'revenue')} sub={`${euro(s.encaisse_30d_cents)} sur 30 j`} />
        <Kpi icon="package" label="Coût des pièces" value={<CountUp value={s.cout_pieces_cents} format={euroShort} />} sub={`${Math.round(costPart)} % du CA`} tone="warn" />
        <Kpi icon="trendUp" label="Bénéfice net" value={<CountUp value={s.benefice_cents} format={euroShort} />} delta={periodDelta(data.orders, 'benefit')} sub={`${euro(s.benefice_30d_cents)} sur 30 j`} tone="ok" />
        <Kpi icon="finance" label="Taux de marge" value={<CountUp value={marginRate} format={(n) => n.toFixed(1) + ' %'} />} sub="sur commandes chiffrées" tone="ok" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Card className="lg:col-span-2">
          <CardHead
            title="Flux financier"
            icon="finance"
            sub="Du chiffre d'affaires au bénéfice net"
            action={<Segmented value={metric} onChange={setMetric} options={[{ value: 'revenue', label: 'CA' }, { value: 'benefit', label: 'Bénéfice' }]} />}
          />
          <div className="px-3 py-4">
            <AreaChart
              data={series}
              color={metric === 'benefit' ? 'var(--ok)' : 'var(--accent)'}
              format={(n) => euro(n)}
              labelFor={(i) => dayLabel(daily.days[i])}
            />
            <div className="flex justify-between px-3 mt-1 text-[10.5px] text-fg3 tnum">
              <span>{dayLabel(daily.days[0])}</span>
              <span>{dayLabel(daily.days[daily.days.length - 1])}</span>
            </div>
          </div>
          <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-line pt-4">
            <FlowRow label="Chiffre d'affaires" value={s.encaisse_cents} pct={100} tone="accent" />
            <FlowRow label="Coût des pièces" value={-s.cout_pieces_cents} pct={costPart} tone="warn" />
            <FlowRow label="Bénéfice net" value={s.benefice_cents} pct={100 - costPart} tone="ok" />
          </div>
        </Card>

        <Card>
          <CardHead title="Répartition" icon="layers" sub="Où va chaque euro encaissé" />
          <div className="p-5 grid place-items-center">
            <Donut
              size={168}
              thickness={18}
              data={[
                { label: 'Bénéfice', value: s.benefice_cents, color: 'var(--ok)' },
                { label: 'Coût pièces', value: s.cout_pieces_cents, color: 'var(--warn)' },
              ]}
              center={
                <div>
                  <div className="text-[11px] text-fg3">Marge</div>
                  <div className="text-[22px] font-semibold tnum text-ok">{marginRate.toFixed(0)} %</div>
                </div>
              }
            />
            <div className="w-full mt-5 flex flex-col gap-2.5">
              <Legend color="var(--ok)" label="Bénéfice net" value={euro(s.benefice_cents)} />
              <Legend color="var(--warn)" label="Coût des pièces" value={euro(s.cout_pieces_cents)} />
            </div>
          </div>
        </Card>
      </div>

      {s.cost_unknown_orders > 0 && (
        <div className="mt-3.5">
          <AlertBanner level="info">
            {s.cost_unknown_orders} commande(s) sans coût de pièces connu (article non relié au catalogue Utopya) — elles sont exclues du calcul de marge pour rester exactes.
          </AlertBanner>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-3.5">
        <PeriodCard title="30 derniers jours" revenue={s.encaisse_30d_cents} cost={s.cout_30d_cents} benefit={s.benefice_30d_cents} count={s.orders_30d} />
        <PeriodCard title="Depuis le lancement" revenue={s.encaisse_cents} cost={s.cout_pieces_cents} benefit={s.benefice_cents} count={s.total_orders} />
      </div>
    </div>
  );
}

function FlowRow({ label, value, pct, tone }: { label: string; value: number; pct: number; tone: 'accent' | 'warn' | 'ok' }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-fg3">{label}</span>
        <span className={`text-[13.5px] font-semibold tnum ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-fg'}`}>{euro(value)}</span>
      </div>
      <Meter value={pct} tone={tone} />
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-[12.5px] text-fg2">{label}</span>
      <span className="ml-auto text-[13px] font-semibold tnum">{value}</span>
    </div>
  );
}

function PeriodCard({ title, revenue, cost, benefit, count }: { title: string; revenue: number; cost: number; benefit: number; count: number }) {
  const margin = revenue > 0 ? (benefit / (benefit + cost || 1)) * 100 : 0;
  return (
    <Card>
      <CardHead title={title} icon="calendar" action={<Badge tone="neutral">{num(count)} cmd</Badge>} />
      <div className="p-5 grid grid-cols-3 gap-4">
        <Metric label="CA" value={euroShort(revenue)} tone="text-fg" />
        <Metric label="Coût" value={euroShort(cost)} tone="text-warn" />
        <Metric label="Bénéfice" value={euroShort(benefit)} tone="text-ok" />
      </div>
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between text-[12px] text-fg3 mb-1.5">
          <span>Taux de marge</span>
          <span className="text-ok font-semibold tnum">{margin.toFixed(1)} %</span>
        </div>
        <Meter value={margin} tone="ok" />
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[11px] text-fg3">{label}</div>
      <div className={`text-[19px] font-semibold tracking-tight tnum ${tone}`}>{value}</div>
    </div>
  );
}
