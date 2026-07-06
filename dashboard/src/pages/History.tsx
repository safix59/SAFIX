import { useMemo, useState } from 'react';
import type { DashboardData } from '../lib/api';
import { num, fDT, ago } from '../lib/format';
import { Card, Kpi, CountUp, Empty, Segmented, Badge } from '../components';
import { Icon, type IconName } from '../icons';

const REPAIR_LABEL: Record<string, string> = {
  ecran: 'Écran', batterie: 'Batterie', 'vitre-arriere': 'Vitre arrière',
  'connecteur-charge': 'Connecteur de charge', camera: 'Caméra',
};
const rlabel = (r: string) => REPAIR_LABEL[r] || r;

type Kind = 'up' | 'down' | 'oos' | 'restock';
const KIND: Record<Kind, { label: string; icon: IconName; tone: 'warn' | 'ok' | 'danger' | 'accent'; cls: string }> = {
  up: { label: 'Hausse', icon: 'trendUp', tone: 'warn', cls: 'bg-warn/12 text-warn' },
  down: { label: 'Baisse', icon: 'trendDown', tone: 'ok', cls: 'bg-ok/12 text-ok' },
  oos: { label: 'Rupture', icon: 'package', tone: 'danger', cls: 'bg-danger/12 text-danger' },
  restock: { label: 'Réappro.', icon: 'refresh', tone: 'accent', cls: 'bg-accent/12 text-accentFg' },
};

type Filter = 'all' | Kind;

export function History({ data }: { data: DashboardData }) {
  const pc = data.price_changes;
  const [filter, setFilter] = useState<Filter>('all');
  const c30 = pc.counts_30d || {};

  const rows = useMemo(
    () => (filter === 'all' ? pc.recent : pc.recent.filter((r) => r.kind === filter)),
    [pc.recent, filter],
  );

  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi icon="history" label="Changements suivis" value={<CountUp value={pc.total} format={num} />} sub={pc.updatedAt ? ago(pc.updatedAt) : undefined} />
        <Kpi icon="trendUp" label="Hausses · 30 j" value={<CountUp value={c30.up || 0} format={num} />} tone="warn" />
        <Kpi icon="trendDown" label="Baisses · 30 j" value={<CountUp value={c30.down || 0} format={num} />} tone="ok" />
        <Kpi icon="package" label="Ruptures · 30 j" value={<CountUp value={c30.oos || 0} format={num} />} tone="danger" sub={`${num(c30.restock || 0)} réappros`} />
      </div>

      <Card className="mt-3.5">
        <div className="flex flex-wrap items-center gap-2.5 p-3.5 border-b border-line">
          <div className="text-[14px] font-semibold tracking-tight flex items-center gap-2">
            <Icon name="history" size={16} className="text-fg2" /> Journal des prix
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Tout' },
              { value: 'up', label: 'Hausses' },
              { value: 'down', label: 'Baisses' },
              { value: 'oos', label: 'Ruptures' },
              { value: 'restock', label: 'Réappros' },
            ]}
          />
          <Badge tone="neutral" >{rows.length} événements</Badge>
        </div>

        {rows.length ? (
          <div className="p-2 max-h-[560px] overflow-auto no-scrollbar">
            {rows.map((r, i) => {
              const k = KIND[(r.kind as Kind)] || KIND.up;
              const delta =
                r.oldFinal != null && r.newFinal != null ? r.newFinal - r.oldFinal : null;
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-fg/[0.03] transition-colors">
                  <span className={`grid place-items-center h-9 w-9 rounded-xl shrink-0 ${k.cls}`}>
                    <Icon name={k.icon} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{rlabel(r.repairId)} · {r.model}</div>
                    <div className="text-[11.5px] text-fg3">{fDT(r.t)} · {ago(r.t)}</div>
                  </div>
                  <div className="text-right shrink-0 tnum">
                    {r.kind === 'oos' ? (
                      <span className="text-[12.5px] text-danger font-medium">En rupture</span>
                    ) : r.kind === 'restock' ? (
                      <span className="text-[12.5px] text-accentFg font-medium">De retour{r.newFinal != null ? ` · ${r.newFinal} €` : ''}</span>
                    ) : (
                      <div className="flex items-center gap-1.5 justify-end">
                        {r.oldFinal != null && <span className="text-[12px] text-fg3 line-through">{r.oldFinal} €</span>}
                        <span className="text-[13px] font-semibold">{r.newFinal != null ? `${r.newFinal} €` : '—'}</span>
                        {delta != null && (
                          <span className={`text-[11px] font-semibold ${delta > 0 ? 'text-warn' : 'text-ok'}`}>
                            {delta > 0 ? '+' : ''}{delta} €
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty icon="history" title="Aucun changement">Aucun mouvement de prix pour ce filtre.</Empty>
        )}
      </Card>
    </div>
  );
}
