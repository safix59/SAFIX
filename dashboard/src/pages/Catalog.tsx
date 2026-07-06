import type { DashboardData } from '../lib/api';
import { num, ageLabel } from '../lib/format';
import { Card, CardHead, Kpi, CountUp, Empty, Badge, AlertBanner, Meter } from '../components';
import { Donut, BarList } from '../charts';
import { Icon } from '../icons';

const REPAIR_LABEL: Record<string, string> = {
  ecran: 'Écran',
  batterie: 'Batterie',
  'vitre-arriere': 'Vitre arrière',
  'connecteur-charge': 'Connecteur de charge',
  camera: 'Caméra',
  'face-id': 'Face ID',
  'haut-parleur': 'Haut-parleur',
};
const rlabel = (r: string) => REPAIR_LABEL[r] || r;

export function Catalog({ data }: { data: DashboardData }) {
  const c = data.catalog;
  const inStockPct = c.combos > 0 ? (c.in_stock / c.combos) * 100 : 0;
  const fresh = (c.prices_age_hours ?? 999) < 30;

  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi icon="layers" label="Combinaisons" value={<CountUp value={c.combos} format={num} />} sub="modèle × réparation" />
        <Kpi icon="checkCircle" label="En stock" value={<CountUp value={c.in_stock} format={num} />} tone="ok" sub={`${Math.round(inStockPct)} % du catalogue`} />
        <Kpi icon="package" label="En rupture" value={<CountUp value={c.out_of_stock} format={num} />} tone="warn" />
        <Kpi icon="alert" label="Sans prix" value={<CountUp value={c.broken} format={num} />} tone={c.broken ? 'danger' : 'neutral'} sub="liens à vérifier" />
      </div>

      <div className="mt-3.5">
        <AlertBanner level={fresh ? 'ok' : 'warn'}>
          Prix mis à jour {ageLabel(c.prices_age_hours)}{' '}
          {c.prices_generated_at && (
            <span className="text-fg3">
              ({new Date(c.prices_generated_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})
            </span>
          )}
          {fresh ? ' — le catalogue est à jour.' : ' — le rafraîchissement automatique a peut-être échoué.'}
        </AlertBanner>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Card>
          <CardHead title="État du stock" icon="package" />
          <div className="p-5 flex flex-col items-center">
            <Donut
              size={158}
              data={[
                { label: 'En stock', value: c.in_stock, color: 'var(--ok)' },
                { label: 'Rupture', value: c.out_of_stock, color: 'var(--warn)' },
                { label: 'Sans prix', value: c.broken, color: 'var(--danger)' },
              ]}
              center={
                <div>
                  <div className="text-[20px] font-semibold tnum text-ok">{Math.round(inStockPct)} %</div>
                  <div className="text-[10.5px] text-fg3">disponibles</div>
                </div>
              }
            />
            <div className="w-full mt-4 flex flex-col gap-2">
              <LegendRow color="var(--ok)" label="En stock" value={num(c.in_stock)} />
              <LegendRow color="var(--warn)" label="En rupture" value={num(c.out_of_stock)} />
              <LegendRow color="var(--danger)" label="Sans prix" value={num(c.broken)} />
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead title="Couverture par réparation" icon="catalog" sub="Nombre de modèles couverts par type" />
          <div className="p-2.5">
            {c.coverage.length ? (
              <BarList
                items={c.coverage
                  .slice()
                  .sort((a, b) => b.models - a.models)
                  .slice(0, 8)
                  .map((r) => ({ k: rlabel(r.repairId), v: r.models }))}
                tone="var(--accent)"
                format={(n) => `${n} modèles`}
              />
            ) : (
              <Empty icon="catalog" title="Couverture indisponible" />
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-3.5">
        <Card>
          <CardHead
            title="Réparations manquantes"
            icon="alert"
            sub="Modèles phares sans certaines pièces"
            action={<Badge tone={c.model_gaps.length ? 'warn' : 'ok'}>{c.model_gaps.length}</Badge>}
          />
          {c.model_gaps.length ? (
            <div className="p-2 max-h-[320px] overflow-auto no-scrollbar">
              {c.model_gaps.map((g, i) => (
                <div key={i} className="px-3 py-2.5 rounded-xl hover:bg-fg/[0.03] transition-colors">
                  <div className="text-[13px] font-medium">{g.model}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {g.missing.map((m, j) => (
                      <span key={j} className="text-[11px] px-2 py-0.5 rounded-full bg-warn/12 text-warn">{rlabel(m)}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="checkCircle" title="Couverture complète">Tous les modèles phares ont leurs réparations principales.</Empty>
          )}
        </Card>

        <Card>
          <CardHead
            title="Points à vérifier"
            icon="link"
            sub="Prix au-dessus d'Apple ou liens cassés"
            action={<Badge tone={c.over_ceiling.length + c.broken_items.length ? 'warn' : 'ok'}>{c.over_ceiling.length + c.broken_items.length}</Badge>}
          />
          <div className="p-2 max-h-[320px] overflow-auto no-scrollbar">
            {c.over_ceiling.length === 0 && c.broken_items.length === 0 ? (
              <Empty icon="checkCircle" title="Tout est cohérent">Aucun dépassement de prix ni lien cassé.</Empty>
            ) : (
              <>
                {c.over_ceiling.map((o, i) => (
                  <div key={'o' + i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-fg/[0.03]">
                    <span className="grid place-items-center h-8 w-8 rounded-lg bg-warn/12 text-warn shrink-0"><Icon name="trendUp" size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium truncate">{rlabel(o.repairId)} · {o.model}</div>
                      <div className="text-[11px] text-fg3">au-dessus du prix Apple</div>
                    </div>
                    <div className="text-right text-[12px] tnum shrink-0">
                      <span className="text-warn font-semibold">{o.final} €</span>
                      <span className="text-fg3"> / {o.ceiling} €</span>
                    </div>
                  </div>
                ))}
                {c.broken_items.map((b, i) => (
                  <div key={'b' + i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-fg/[0.03]">
                    <span className="grid place-items-center h-8 w-8 rounded-lg bg-danger/12 text-danger shrink-0"><Icon name="alert" size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium truncate">{rlabel(b.repairId)} · {b.model}</div>
                      <div className="text-[11px] text-fg3">sans prix récupéré</div>
                    </div>
                    {b.url && (
                      <a href={b.url} target="_blank" rel="noreferrer" className="text-fg3 hover:text-fg shrink-0" title="Ouvrir chez Utopya">
                        <Icon name="external" size={14} />
                      </a>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3.5">
        <Card pad>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-fg2"><Icon name="checkCircle" size={16} /></span>
            <span className="text-[13px] font-semibold">Disponibilité globale</span>
            <span className="ml-auto text-[13px] font-semibold tnum text-ok">{Math.round(inStockPct)} %</span>
          </div>
          <Meter value={inStockPct} tone="ok" />
        </Card>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-[12.5px] text-fg2">{label}</span>
      <span className="ml-auto text-[12.5px] font-semibold tnum">{value}</span>
    </div>
  );
}
