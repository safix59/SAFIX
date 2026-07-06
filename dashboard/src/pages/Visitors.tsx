import type { LiveData, VisitsData } from '../lib/api';
import { num, ago, fTime, deviceMeta, sourceMeta, flag, countryName } from '../lib/format';
import { Card, CardHead, Kpi, CountUp, Empty, Badge, Dot, Skeleton } from '../components';
import { AreaChart, BarList, ColumnChart, Donut } from '../charts';
import { FranceMap } from '../map';
import { Icon } from '../icons';

const DEVICE_COLOR: Record<string, string> = {
  iPhone: 'var(--accent)',
  Android: 'var(--violet)',
  Mac: 'var(--teal)',
  Windows: 'var(--warn)',
  iPad: 'var(--pink)',
};
const deviceColor = (k: string) => DEVICE_COLOR[k] || 'var(--fg3)';

export function Visitors({ visits, live }: { visits: VisitsData | null; live: LiveData | null }) {
  if (!visits) return <VisitorsSkeleton />;
  if (!visits.ready)
    return (
      <Card className="mt-1">
        <Empty icon="visitors" title="Statistiques en préparation">
          La collecte de fréquentation démarre dès les premières visites. Revenez bientôt : tout s'affichera ici automatiquement.
        </Empty>
      </Card>
    );

  const online = live?.ready ? live.online : 0;
  const topDevice = visits.by_device[0];
  const dayData = visits.by_day.map((d) => d.v);
  const peakHour = visits.by_hour.indexOf(Math.max(...visits.by_hour));

  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi icon="visitors" label="Visites · 30 jours" value={<CountUp value={visits.total_30d} format={num} />} tone="neutral" />
        <Kpi icon="calendar" label="Aujourd'hui" value={<CountUp value={visits.today} format={num} />} tone="neutral" />
        <Kpi
          icon="wifi"
          label="En ligne maintenant"
          value={<span className="flex items-center gap-2.5">{online}{!!online && <Dot tone="ok" ping />}</span>}
          tone={online ? 'ok' : 'neutral'}
        />
        <Kpi
          icon={topDevice ? deviceMeta(topDevice.k).icon : 'phone'}
          label="Appareil dominant"
          value={topDevice ? deviceMeta(topDevice.k).label : '—'}
          sub={topDevice ? `${Math.round((topDevice.v / (visits.total_30d || 1)) * 100)} % des visites` : undefined}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Card className="lg:col-span-2">
          <CardHead title="Trafic · 30 jours" icon="trendUp" sub={`${num(visits.total_30d)} visites au total`} />
          <div className="px-3 py-4">
            <AreaChart data={dayData} color="var(--accent)" format={(n) => num(Math.round(n)) + ' visites'} labelFor={(i) => dayLbl(visits.by_day[i]?.k)} />
            <div className="flex justify-between px-3 mt-1 text-[10.5px] text-fg3 tnum">
              <span>{dayLbl(visits.by_day[0]?.k)}</span>
              <span>{dayLbl(visits.by_day[visits.by_day.length - 1]?.k)}</span>
            </div>
          </div>
        </Card>
        <LiveFeed live={live} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Card className="lg:col-span-2">
          <CardHead title="Provenance géographique" icon="pin" sub="Regroupement par localisation approximative" />
          <div className="p-4">
            {visits.geo.length ? (
              <FranceMap points={visits.geo} />
            ) : (
              <Empty icon="globe" title="Pas encore de localisation">Les coordonnées apparaissent dès les premières visites géolocalisées.</Empty>
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Villes & régions" icon="pin" />
          <div className="p-2.5">
            {visits.by_city.length ? (
              <BarList items={visits.by_city.slice(0, 9).map((c) => ({ k: <span className="truncate">{c.k}</span>, v: c.v }))} tone="var(--accent)" format={(n) => num(n)} />
            ) : (
              <Empty icon="pin" title="Aucune donnée" />
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Card>
          <CardHead title="Par appareil" icon="phone" />
          <div className="p-5 flex flex-col items-center">
            <Donut
              size={150}
              data={visits.by_device.map((d) => ({ label: deviceMeta(d.k).label, value: d.v, color: deviceColor(d.k) }))}
              center={
                <div>
                  <div className="text-[19px] font-semibold tnum">{num(visits.total_30d)}</div>
                  <div className="text-[10.5px] text-fg3">visites</div>
                </div>
              }
            />
            <div className="w-full mt-4 flex flex-col gap-2">
              {visits.by_device.map((d) => (
                <div key={d.k} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: deviceColor(d.k) }} />
                  <span className="text-fg3"><Icon name={deviceMeta(d.k).icon} size={13} /></span>
                  <span className="text-[12.5px] text-fg2">{deviceMeta(d.k).label}</span>
                  <span className="ml-auto text-[12.5px] font-semibold tnum">{num(d.v)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Par source" icon="route" sub="Comment on arrive sur le site" />
          <div className="p-2.5">
            <BarList
              items={visits.by_source.map((s) => ({
                k: (
                  <span className="flex items-center gap-2">
                    <Icon name={sourceMeta(s.k).icon} size={14} className="text-fg3" />
                    {sourceMeta(s.k).label}
                  </span>
                ),
                v: s.v,
              }))}
              tone="var(--violet)"
              format={(n) => num(n)}
            />
          </div>
        </Card>

        <Card>
          <CardHead title="Affluence par heure" icon="clock" sub={`Pic à ${peakHour}h`} />
          <div className="p-5">
            <ColumnChart
              data={visits.by_hour}
              height={150}
              color="var(--teal)"
              highlight={peakHour}
              labelFor={(i) => `${i}h`}
              format={(n) => `${n} visites`}
            />
            <div className="flex justify-between mt-2 text-[10.5px] text-fg3 tnum">
              <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-3.5">
        <Card>
          <CardHead title="Pages les plus vues" icon="eye" />
          <div className="p-2.5">
            <BarList items={visits.by_path.slice(0, 8).map((p) => ({ k: <span className="font-mono text-[12px] truncate">{p.k}</span>, v: p.v }))} tone="var(--accent)" format={(n) => num(n)} />
          </div>
        </Card>
        <Card>
          <CardHead title="Par pays" icon="globe" />
          <div className="p-2.5">
            <BarList
              items={visits.by_country.map((c) => ({
                k: (
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] leading-none">{flag(c.k)}</span>
                    {countryName(c.k)}
                  </span>
                ),
                v: c.v,
              }))}
              tone="var(--teal)"
              format={(n) => num(n)}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function LiveFeed({ live }: { live: LiveData | null }) {
  const list = live?.ready ? live.visitors : [];
  return (
    <Card className="h-full flex flex-col">
      <CardHead
        title="Visiteurs en direct"
        icon="wifi"
        action={<Badge tone={live?.online ? 'ok' : 'neutral'}><Dot tone={live?.online ? 'ok' : 'neutral'} ping={!!live?.online} />{live?.online ?? 0}</Badge>}
      />
      {list.length ? (
        <div className="p-1.5 flex-1 overflow-auto max-h-[290px] no-scrollbar">
          {list.map((v, i) => {
            const dm = deviceMeta(v.device);
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-fg/[0.03] transition-colors">
                <span className="grid place-items-center h-7 w-7 rounded-lg bg-panel2 text-fg2 shrink-0"><Icon name={dm.icon} size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium truncate">{v.city || dm.label} <span className="text-fg3">{flag(v.country)}</span></div>
                  <div className="text-[11px] text-fg3 truncate font-mono">{v.path}</div>
                </div>
                <div className="text-[10.5px] text-fg3 shrink-0">{ago(v.ts) || fTime(v.ts)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 grid place-items-center">
          <Empty icon="visitors" title="Personne pour l'instant">Le direct s'anime dès qu'un visiteur arrive.</Empty>
        </div>
      )}
    </Card>
  );
}

const dayLbl = (iso?: string) => {
  if (!iso) return '';
  try {
    return new Date(iso + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
};

function VisitorsSkeleton() {
  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Skeleton className="h-[300px] lg:col-span-2" />
        <Skeleton className="h-[300px]" />
      </div>
    </div>
  );
}
