import { useMemo, useState } from 'react';
import type { DashboardData, Order } from '../lib/api';
import { api } from '../lib/api';
import { euro, num, fDT } from '../lib/format';
import { itemsText } from '../lib/derive';
import { Card, Button, SearchInput, Segmented, StatusPill, Empty, Kpi, CountUp, Modal, useToast } from '../components';
import { Icon } from '../icons';

type SortKey = 'date' | 'amount' | 'margin';
type Filter = 'all' | 'paid' | 'ordered' | 'error';

export function Orders({ data, onRefresh }: { data: DashboardData; onRefresh: () => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [toDelete, setToDelete] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = useMemo(() => {
    let r = data.orders;
    if (filter !== 'all') r = r.filter((o) => o.status === filter);
    const term = q.trim().toLowerCase();
    if (term)
      r = r.filter(
        (o) =>
          (o.customer_email || '').toLowerCase().includes(term) ||
          (o.metadata?.model || '').toLowerCase().includes(term) ||
          itemsText(o).toLowerCase().includes(term) ||
          String(o.id).includes(term),
      );
    const val = (o: Order) =>
      sort.key === 'date' ? new Date(o.created_at).getTime() : sort.key === 'amount' ? o.total_cents : o._gain_cents ?? -Infinity;
    return [...r].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [data.orders, filter, q, sort]);

  const totalRevenue = rows.reduce((s, o) => s + o.total_cents, 0);
  const totalMargin = rows.reduce((s, o) => s + (o._gain_cents || 0), 0);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));

  const exportCsv = () => {
    const head = ['id', 'date', 'email', 'modele', 'pieces', 'montant_eur', 'cout_eur', 'marge_eur', 'statut', 'utopya'];
    const lines = rows.map((o) =>
      [
        o.id,
        new Date(o.created_at).toISOString(),
        o.customer_email || '',
        o.metadata?.model || '',
        itemsText(o).replace(/;/g, ','),
        (o.total_cents / 100).toFixed(2),
        o._cost_cents != null ? (o._cost_cents / 100).toFixed(2) : '',
        o._gain_cents != null ? (o._gain_cents / 100).toFixed(2) : '',
        o.status,
        o.utopya_order_id || '',
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(';'),
    );
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commandes-safix-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Export terminé', msg: `${rows.length} commande(s) exportée(s) en CSV.`, tone: 'ok' });
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    const res = await api.deleteOrder(toDelete.id);
    setBusy(false);
    if (res.status === 200) {
      toast({ title: 'Commande supprimée', msg: `#${toDelete.id} a été retirée.`, tone: 'ok' });
      setToDelete(null);
      onRefresh();
    } else {
      toast({ title: 'Échec de la suppression', msg: 'Réessayez dans un instant.', tone: 'danger' });
    }
  };

  return (
    <div className="stagger">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi icon="orders" label="Résultats" value={<CountUp value={rows.length} format={num} />} sub={filter === 'all' ? 'toutes commandes' : 'après filtre'} />
        <Kpi icon="euro" label="Total encaissé" value={<CountUp value={totalRevenue} format={euro} />} tone="neutral" />
        <Kpi icon="trendUp" label="Marge cumulée" value={<CountUp value={totalMargin} format={euro} />} tone="ok" />
        <Kpi icon="alert" label="En erreur" value={<CountUp value={data.orders.filter((o) => o.status === 'error').length} format={num} />} tone={data.orders.some((o) => o.status === 'error') ? 'danger' : 'neutral'} />
      </div>

      <Card className="mt-3.5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 p-3.5 border-b border-line">
          <SearchInput value={q} onChange={setQ} placeholder="Modèle, e-mail, pièce, n°…" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Toutes' },
              { value: 'paid', label: 'Payées' },
              { value: 'ordered', label: 'Commandées' },
              { value: 'error', label: 'Erreurs' },
            ]}
          />
          <Button icon="download" onClick={exportCsv} className="ml-auto">
            Exporter
          </Button>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[130px_1fr_110px_110px_120px_44px] items-center gap-3 px-4 h-10 text-[11px] font-semibold uppercase tracking-wide text-fg3 border-b border-line">
                <SortHead label="Date" active={sort.key === 'date'} dir={sort.dir} onClick={() => toggleSort('date')} />
                <div>Client & réparation</div>
                <SortHead label="Montant" active={sort.key === 'amount'} dir={sort.dir} onClick={() => toggleSort('amount')} align="right" />
                <SortHead label="Marge" active={sort.key === 'margin'} dir={sort.dir} onClick={() => toggleSort('margin')} align="right" />
                <div>Statut</div>
                <div />
              </div>
              {rows.slice(0, 200).map((o) => (
                <div key={o.id} className="grid grid-cols-[130px_1fr_110px_110px_120px_44px] items-center gap-3 px-4 py-3 border-b border-line last:border-0 hover:bg-fg/[0.025] transition-colors">
                  <div>
                    <div className="text-[12.5px] font-medium tnum">{fDT(o.created_at)}</div>
                    <div className="text-[11px] text-fg3">#{o.id}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{o.metadata?.model || '—'} · <span className="text-fg2 font-normal">{itemsText(o)}</span></div>
                    <div className="text-[11.5px] text-fg3 truncate">{o.customer_email || 'e-mail inconnu'}</div>
                  </div>
                  <div className="text-right text-[13px] font-semibold tnum">{euro(o.total_cents)}</div>
                  <div className="text-right text-[13px] tnum">
                    {o._gain_cents == null ? (
                      <span className="text-fg3">—</span>
                    ) : (
                      <span className={o._gain_cents >= 0 ? 'text-ok' : 'text-danger'}>{euro(o._gain_cents)}</span>
                    )}
                  </div>
                  <div><StatusPill status={o.status} /></div>
                  <button
                    onClick={() => setToDelete(o)}
                    className="grid place-items-center h-8 w-8 rounded-lg text-fg3 hover:text-danger hover:bg-danger/10 transition-colors"
                    aria-label="Supprimer"
                    title="Supprimer"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty icon="search" title="Aucune commande trouvée">Ajustez la recherche ou le filtre pour voir des résultats.</Empty>
        )}
      </Card>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)}>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center h-10 w-10 rounded-xl bg-danger/12 text-danger">
              <Icon name="trash" size={18} />
            </span>
            <div>
              <div className="text-[15px] font-semibold">Supprimer cette commande ?</div>
              <div className="text-[12.5px] text-fg3">Action définitive et irréversible.</div>
            </div>
          </div>
          {toDelete && (
            <div className="mt-4 rounded-ctl bg-panel2 border border-line p-3.5 text-[13px]">
              <div className="flex justify-between"><span className="text-fg3">Commande</span><span className="font-medium tnum">#{toDelete.id}</span></div>
              <div className="flex justify-between mt-1"><span className="text-fg3">Appareil</span><span className="font-medium">{toDelete.metadata?.model || '—'}</span></div>
              <div className="flex justify-between mt-1"><span className="text-fg3">Montant</span><span className="font-medium tnum">{euro(toDelete.total_cents)}</span></div>
            </div>
          )}
          <div className="flex gap-2.5 mt-5">
            <Button className="flex-1" onClick={() => setToDelete(null)}>Annuler</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete} disabled={busy} icon="trash">
              {busy ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 hover:text-fg2 transition-colors ${align === 'right' ? 'justify-end' : ''} ${active ? 'text-fg2' : ''}`}
    >
      {label}
      <Icon name={active ? (dir === -1 ? 'arrowDown' : 'arrowUp') : 'chevronUpDown'} size={12} />
    </button>
  );
}
