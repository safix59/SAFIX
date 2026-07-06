import { useMemo, useState } from 'react';
import type { LiveData, VisitsData, SessionsData, VisitorSession } from '../lib/api';
import { num, ago, deviceMeta, sourceMeta, flag, countryName } from '../lib/format';
import { Card, CardHead, Kpi, CountUp, Empty, Badge, Dot, Skeleton } from '../components';
import { AreaChart, BarList, ColumnChart, Donut } from '../charts';
import { WorldMap } from '../worldmap';
import { VisitorFiche } from '../visitorfiche';
import { Icon } from '../icons';

const DEVICE_COLOR: Record<string, string> = {
  iPhone: 'var(--accent)',
  Android: 'var(--violet)',
  Mac: 'var(--teal)',
  Windows: 'var(--warn)',
  iPad: 'var(--pink)',
};
const deviceColor = (k: string) => DEVICE_COLOR[k] || 'var(--fg3)';

export function Visitors({
  visits,
  live,
  sessions,
}: {
  visits: VisitsData | null;
  live: LiveData | null;
  sessions: SessionsData | null;
}) {
  const [selected, setSelected] = useState<VisitorSession | null>(null);

  const list = useMemo(() => {
    const arr = sessions?.sessions ?? [];
    return [...arr].sort((a, b) => (Number(b.live) - Number(a.live)) || (+new Date(b.last_ts) - +new Date(a.last_ts)));
  }, [sessions]);
  const onlineNow = sessions?.online ?? (live?.ready ? live.online : 0);

  if (!visits) return <VisitorsSkeleton />;

  const topDevice = visits.ready ? visits.by_device[0] : null;
  const dayData = visits.ready ? visits.by_day.map((d) => d.v) : [];
  const peakHour = visits.ready ? visits.by_hour.indexOf(Math.max(...visits.by_hour)) : 0;

  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi icon="visitors" label="Visites · 30 jours" value={<CountUp value={visits.ready ? visits.total_30d : 0} format={num} />} />
        <Kpi icon="calendar" label="Aujourd'hui" value={<CountUp value={visits.ready ? visits.today : 0} format={num} />} />
        <Kpi
          icon="wifi"
          label="En ligne maintenant"
          value={<span className="flex items-center gap-2.5">{onlineNow}{!!onlineNow && <Dot tone="ok" ping />}</span>}
          tone={onlineNow ? 'ok' : 'neutral'}
        />
        <Kpi
          icon={topDevice ? deviceMeta(topDevice.k).icon : 'phone'}
          label="Appareil dominant"
          value={topDevice ? deviceMeta(topDevice.k).label : '—'}
          sub={topDevice ? `${Math.round((topDevice.v / (visits.total_30d || 1)) * 100)} % des visites` : undefined}
        />
      </div>

      {/* Carte de supervision mondiale */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Card className="lg:col-span-2">
          <CardHead
            title="Supervision mondiale"
            icon="globe"
            sub="Molette / pincer pour zoomer · glisser pour naviguer · cliquer un visiteur pour sa fiche"
            action={<Badge tone={onlineNow ? 'ok' : 'neutral'}><Dot tone={onlineNow ? 'ok' : 'neutral'} ping={!!onlineNow} />{onlineNow} en direct</Badge>}
          />
          <div className="p-3">
            {list.length ? (
              <WorldMap sessions={list} onSelect={setSelected} selectedId={selected?.id} />
            ) : (
              <Empty icon="globe" title="Aucun visiteur géolocalisé">Les visiteurs apparaîtront sur la carte dès les premières connexions.</Empty>
            )}
          </div>
        </Card>

        <SessionsList list={list} online={onlineNow} onSelect={setSelected} selectedId={selected?.id} />
      </div>

      {visits.ready ? (
        <>
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
                  center={<div><div className="text-[19px] font-semibold tnum">{num(visits.total_30d)}</div><div className="text-[10.5px] text-fg3">visites</div></div>}
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
                  items={visits.by_source.map((s) => ({ k: <span className="flex items-center gap-2"><Icon name={sourceMeta(s.k).icon} size={14} className="text-fg3" />{sourceMeta(s.k).label}</span>, v: s.v }))}
                  tone="var(--violet)"
                  format={(n) => num(n)}
                />
              </div>
            </Card>

            <Card>
              <CardHead title="Affluence par heure" icon="clock" sub={`Pic à ${peakHour}h`} />
              <div className="p-5">
                <ColumnChart data={visits.by_hour} height={150} color="var(--teal)" highlight={peakHour} labelFor={(i) => `${i}h`} format={(n) => `${n} visites`} />
                <div className="flex justify-between mt-2 text-[10.5px] text-fg3 tnum"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
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
                  items={visits.by_country.map((c) => ({ k: <span className="flex items-center gap-2"><span className="text-[15px] leading-none">{flag(c.k)}</span>{countryName(c.k)}</span>, v: c.v }))}
                  tone="var(--teal)"
                  format={(n) => num(n)}
                />
              </div>
            </Card>
          </div>
        </>
      ) : (
        <Card className="mt-3.5">
          <Empty icon="visitors" title="Statistiques en préparation">La collecte démarre dès les premières visites. Tout s'affichera ici automatiquement.</Empty>
        </Card>
      )}

      <VisitorFiche session={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SessionsList({
  list,
  online,
  onSelect,
  selectedId,
}: {
  list: VisitorSession[];
  online: number;
  onSelect: (s: VisitorSession) => void;
  selectedId?: string | null;
}) {
  return (
    <Card className="flex flex-col">
      <CardHead
        title="Visiteurs récents"
        icon="visitors"
        sub="Cliquez pour la fiche complète"
        action={<Badge tone={online ? 'ok' : 'neutral'}><Dot tone={online ? 'ok' : 'neutral'} ping={!!online} />{online}</Badge>}
      />
      {list.length ? (
        <div className="p-1.5 flex-1 overflow-auto max-h-[520px] no-scrollbar">
          {list.slice(0, 60).map((s) => {
            const dm = deviceMeta(s.device);
            const sel = selectedId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${sel ? 'bg-accent/12' : 'hover:bg-fg/[0.03]'}`}
              >
                <span className="relative grid place-items-center h-8 w-8 rounded-lg bg-panel2 text-fg2 shrink-0">
                  <Icon name={dm.icon} size={15} />
                  {s.live && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-ok border-2 border-panel" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium truncate flex items-center gap-1.5">
                    {s.city || countryName(s.country)} <span>{flag(s.country)}</span>
                  </div>
                  <div className="text-[11px] text-fg3 truncate">{dm.label} · {s.page_count} page{s.page_count > 1 ? 's' : ''}</div>
                </div>
                <div className="text-[10.5px] text-fg3 shrink-0 text-right">
                  {s.live ? <span className="text-ok font-medium">en ligne</span> : ago(s.last_ts)}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 grid place-items-center">
          <Empty icon="visitors" title="Aucun visiteur récent">Les sessions s'afficheront ici.</Empty>
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
        <Skeleton className="h-[440px] lg:col-span-2" />
        <Skeleton className="h-[440px]" />
      </div>
    </div>
  );
}
