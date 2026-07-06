import type { DashboardData } from '../lib/api';
import { euro, fDT, fTime, num } from '../lib/format';
import { Card, CardHead, Empty, AlertBanner, Badge, Dot } from '../components';
import { Icon, type IconName } from '../icons';

type Level = 'ok' | 'warn' | 'danger';

export function System({ data, serverTime }: { data: DashboardData; serverTime: string | null }) {
  const h = data.health;
  const services: { name: string; icon: IconName; level: Level; detail: string }[] = [
    {
      name: 'Base de données',
      icon: 'database',
      level: h.supabase_ok ? 'ok' : 'danger',
      detail: h.supabase_ok ? 'Supabase connecté et opérationnel' : 'Supabase injoignable',
    },
    {
      name: 'Catalogue & prix',
      icon: 'catalog',
      level: h.prices_ok ? 'ok' : 'warn',
      detail: h.prices_ok ? 'Prix récents et cohérents' : 'Prix figés — à rafraîchir',
    },
    {
      name: 'Transmission des commandes',
      icon: 'package',
      level: h.paid_not_ordered > 0 ? 'warn' : 'ok',
      detail: h.paid_not_ordered > 0 ? `${h.paid_not_ordered} payée(s) non transmise(s)` : 'Toutes les commandes transmises',
    },
    {
      name: 'Traitement des paiements',
      icon: 'euro',
      level: h.order_errors.length > 0 ? 'warn' : 'ok',
      detail: h.order_errors.length > 0 ? `${h.order_errors.length} erreur(s) à traiter` : 'Aucune erreur de paiement',
    },
  ];

  const worst: Level = services.some((s) => s.level === 'danger')
    ? 'danger'
    : services.some((s) => s.level === 'warn')
    ? 'warn'
    : 'ok';
  const headline =
    worst === 'ok' ? 'Tous les systèmes sont opérationnels' : worst === 'warn' ? 'Fonctionnel — points à surveiller' : 'Incident en cours';

  return (
    <div className="stagger">
      <Card pad className="flex items-center gap-4">
        <span
          className={`grid place-items-center h-12 w-12 rounded-2xl ${
            worst === 'ok' ? 'bg-ok/12 text-ok' : worst === 'warn' ? 'bg-warn/12 text-warn' : 'bg-danger/12 text-danger'
          }`}
        >
          <Icon name={worst === 'ok' ? 'checkCircle' : 'alert'} size={24} />
        </span>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold tracking-tight">{headline}</div>
          <div className="text-[12.5px] text-fg3">
            Dernière vérification {serverTime ? fTime(serverTime) : '—'} · {num(data.orders.length)} commandes suivies
          </div>
        </div>
        <div className="ml-auto hidden sm:block">
          <Badge tone={worst === 'ok' ? 'ok' : worst === 'warn' ? 'warn' : 'danger'}>
            <Dot tone={worst === 'ok' ? 'ok' : worst === 'warn' ? 'warn' : 'danger'} ping={worst !== 'ok'} />
            {worst === 'ok' ? 'En ligne' : worst === 'warn' ? 'Vigilance' : 'Incident'}
          </Badge>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
        {services.map((s) => (
          <Card key={s.name} pad className="flex items-center gap-3.5">
            <span className="grid place-items-center h-10 w-10 rounded-xl bg-panel2 text-fg2 shrink-0">
              <Icon name={s.icon} size={18} />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold">{s.name}</div>
              <div className="text-[12px] text-fg3 truncate">{s.detail}</div>
            </div>
            <span className="ml-auto shrink-0">
              <Badge tone={s.level === 'ok' ? 'ok' : s.level === 'warn' ? 'warn' : 'danger'}>
                <Dot tone={s.level === 'ok' ? 'ok' : s.level === 'warn' ? 'warn' : 'danger'} />
                {s.level === 'ok' ? 'OK' : s.level === 'warn' ? 'Alerte' : 'HS'}
              </Badge>
            </span>
          </Card>
        ))}
      </div>

      {h.alerts.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-2.5">
          {h.alerts.map((a, i) => (
            <AlertBanner key={i} level={a.level === 'ok' ? 'ok' : a.level}>
              {a.msg}
            </AlertBanner>
          ))}
        </div>
      )}

      <Card className="mt-3.5">
        <CardHead
          title="Commandes en erreur"
          icon="alert"
          sub="Paiement encaissé mais commande non aboutie"
          action={<Badge tone={h.order_errors.length ? 'danger' : 'ok'}>{h.order_errors.length}</Badge>}
        />
        {h.order_errors.length ? (
          <div className="p-2">
            {h.order_errors.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-fg/[0.03] transition-colors">
                <span className="grid place-items-center h-9 w-9 rounded-xl bg-danger/12 text-danger shrink-0">
                  <Icon name="alert" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">#{e.id} · {e.email || 'e-mail inconnu'}</div>
                  <div className="text-[11.5px] text-fg3 truncate">{e.error}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-semibold tnum">{euro(e.total)}</div>
                  <div className="text-[11px] text-fg3">{fDT(e.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="checkCircle" title="Aucune erreur">Toutes les commandes se sont déroulées correctement.</Empty>
        )}
      </Card>
    </div>
  );
}
