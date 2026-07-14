import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { SupportEmail, EmailStatus } from '../lib/api';
import { ago, fDT } from '../lib/format';
import { Card, Badge, Button, Empty, Skeleton, Segmented, SearchInput, Modal, useToast } from '../components';
import { Icon } from '../icons';

type Filter = 'all' | 'non_lu' | 'traite';

const STATUS_META: Record<EmailStatus, { label: string; tone: 'danger' | 'neutral' | 'ok' }> = {
  non_lu: { label: 'Non lu', tone: 'danger' },
  lu: { label: 'Lu', tone: 'neutral' },
  traite: { label: 'Traité', tone: 'ok' },
};

const senderName = (e: SupportEmail) => e.from_name || e.from_email || 'Expéditeur inconnu';
const initialOf = (e: SupportEmail) => (senderName(e).trim()[0] || '?').toUpperCase();

export function Emails({ onChanged }: { onChanged?: () => void }) {
  const [emails, setEmails] = useState<SupportEmail[] | null>(null);
  const [ready, setReady] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<SupportEmail | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const autoRead = useRef<Set<number>>(new Set());

  async function load() {
    const res = await api.emails();
    if (res.status === 200 && res.data) {
      setEmails(res.data.emails);
      setReady(res.data.ready);
      setReason(res.data.reason);
    } else {
      setEmails([]);
      setReady(false);
    }
  }

  useEffect(() => { void load(); }, []);
  // Rafraîchissement doux tant que la page reste ouverte.
  useEffect(() => {
    const t = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(t);
  }, []);

  const unread = useMemo(() => (emails || []).filter((e) => e.status === 'non_lu').length, [emails]);

  const filtered = useMemo(() => {
    let list = emails || [];
    if (filter === 'non_lu') list = list.filter((e) => e.status === 'non_lu');
    else if (filter === 'traite') list = list.filter((e) => e.status === 'traite');
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (e) =>
          (e.subject || '').toLowerCase().includes(term) ||
          (e.from_email || '').toLowerCase().includes(term) ||
          (e.from_name || '').toLowerCase().includes(term) ||
          (e.preview || '').toLowerCase().includes(term),
      );
    }
    return list;
  }, [emails, filter, q]);

  const selected = useMemo(() => (emails || []).find((e) => e.id === selId) || null, [emails, selId]);

  // Ouvrir un e-mail non lu → le marque « lu » (une seule fois).
  async function open(e: SupportEmail) {
    setSelId(e.id);
    if (e.status === 'non_lu' && !autoRead.current.has(e.id)) {
      autoRead.current.add(e.id);
      setEmails((prev) => (prev || []).map((x) => (x.id === e.id ? { ...x, status: 'lu' } : x)));
      await api.emailStatus([e.id], 'lu');
      onChanged?.();
    }
  }

  async function setStatus(e: SupportEmail, status: EmailStatus) {
    setBusy(true);
    setEmails((prev) => (prev || []).map((x) => (x.id === e.id ? { ...x, status } : x)));
    const res = await api.emailStatus([e.id], status);
    setBusy(false);
    if (res.status !== 200) { toast({ title: 'Échec', msg: 'Statut non enregistré.', tone: 'danger' }); void load(); return; }
    toast({ title: STATUS_META[status].label, msg: 'Statut mis à jour.', tone: status === 'traite' ? 'ok' : 'neutral' });
    onChanged?.();
  }

  async function markAllRead() {
    const ids = (emails || []).filter((e) => e.status === 'non_lu').map((e) => e.id);
    if (!ids.length) return;
    setBusy(true);
    setEmails((prev) => (prev || []).map((x) => (x.status === 'non_lu' ? { ...x, status: 'lu' } : x)));
    await api.emailStatus(ids, 'lu');
    setBusy(false);
    onChanged?.();
    toast({ title: 'Tout marqué comme lu', msg: `${ids.length} e-mail${ids.length > 1 ? 's' : ''}.`, tone: 'neutral' });
  }

  async function del(e: SupportEmail) {
    setConfirmDel(null);
    setBusy(true);
    setEmails((prev) => (prev || []).filter((x) => x.id !== e.id));
    if (selId === e.id) setSelId(null);
    const res = await api.emailDel([e.id]);
    setBusy(false);
    if (res.status !== 200) { toast({ title: 'Échec', msg: 'Suppression impossible.', tone: 'danger' }); void load(); return; }
    onChanged?.();
    toast({ title: 'Supprimé', msg: 'E-mail retiré de la boîte.', tone: 'neutral' });
  }

  const mailto = (e: SupportEmail) => {
    const to = e.from_email || '';
    const subj = encodeURIComponent((e.subject || '').replace(/^\s*re\s*:\s*/i, '') ? `Re: ${(e.subject || '').replace(/^\s*re\s*:\s*/i, '')}` : 'Votre message');
    return `mailto:${to}?subject=${subj}`;
  };

  if (emails === null) {
    return (
      <div className="stagger">
        <div className="grid lg:grid-cols-[minmax(300px,380px)_1fr] gap-3.5">
          <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px]" />)}</div>
          <Skeleton className="h-[420px] hidden lg:block" />
        </div>
      </div>
    );
  }

  return (
    <div className="stagger">
      {/* Bandeau si la base est momentanément injoignable (rare) */}
      {!ready && (
        <Card className="mb-3.5 p-4 border-warn/30">
          <div className="flex items-start gap-3">
            <span className="text-warn mt-0.5"><Icon name="alert" size={18} /></span>
            <div className="text-[13px] text-fg2 leading-relaxed">
              <b>Boîte support momentanément indisponible.</b> La base de données est injoignable pour l'instant —
              nouvel essai automatique dans quelques secondes.{reason ? <span className="text-fg3"> ({reason})</span> : null}
            </div>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-[minmax(300px,380px)_1fr] gap-3.5">
        {/* ─── Liste ─── */}
        <Card className={`p-0 overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
          <div className="p-3.5 border-b border-line space-y-2.5">
            <div className="flex items-center gap-2">
              <Icon name="inbox" size={16} className="text-fg2" />
              <span className="text-[14px] font-semibold tracking-tight">Boîte support</span>
              {unread > 0 && <Badge tone="danger">{unread} non lu{unread > 1 ? 's' : ''}</Badge>}
              <button
                onClick={() => void load()}
                className="ml-auto grid place-items-center h-8 w-8 rounded-ctl text-fg3 hover:text-fg hover:bg-fg/[0.06] transition-colors"
                title="Rafraîchir"
              >
                <Icon name="refresh" size={15} />
              </button>
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher un e-mail…" />
            <div className="flex items-center gap-2">
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Tout' },
                  { value: 'non_lu', label: 'Non lus' },
                  { value: 'traite', label: 'Traités' },
                ]}
              />
              {unread > 0 && (
                <button onClick={() => void markAllRead()} disabled={busy} className="ml-auto text-[11.5px] font-medium text-accentFg hover:underline disabled:opacity-50">
                  Tout marquer lu
                </button>
              )}
            </div>
          </div>

          {filtered.length ? (
            <div className="max-h-[calc(100vh-260px)] overflow-auto no-scrollbar p-1.5">
              {filtered.map((e) => {
                const active = selId === e.id;
                const isUnread = e.status === 'non_lu';
                return (
                  <button
                    key={e.id}
                    onClick={() => void open(e)}
                    className={`w-full text-left flex gap-3 px-3 py-3 rounded-xl transition-colors ${active ? 'bg-accent/12' : 'hover:bg-fg/[0.03]'}`}
                  >
                    <span className={`relative grid place-items-center h-9 w-9 rounded-full shrink-0 text-[13px] font-bold ${isUnread ? 'bg-accent text-white' : 'bg-panel2 text-fg2'}`}>
                      {initialOf(e)}
                      {isUnread && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-danger border-2 border-panel" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] truncate ${isUnread ? 'font-bold text-fg' : 'font-medium text-fg2'}`}>{senderName(e)}</span>
                        <span className="ml-auto text-[10.5px] text-fg3 shrink-0">{ago(e.received_at)}</span>
                      </div>
                      <div className={`text-[12.5px] truncate ${isUnread ? 'font-semibold text-fg' : 'text-fg2'}`}>{e.subject}</div>
                      <div className="text-[11.5px] text-fg3 truncate">{e.preview || '—'}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty icon="mail" title="Aucun e-mail">
              {q || filter !== 'all' ? 'Aucun e-mail pour ce filtre.' : 'Les nouveaux e-mails reçus sur support@safix59.fr apparaîtront ici.'}
            </Empty>
          )}
        </Card>

        {/* ─── Détail ─── */}
        {selected ? (
          <Card className="p-0 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-line">
              <div className="flex items-start gap-3">
                <button onClick={() => setSelId(null)} className="lg:hidden grid place-items-center h-8 w-8 rounded-ctl text-fg3 hover:text-fg hover:bg-fg/[0.06] shrink-0" aria-label="Retour">
                  <Icon name="chevronR" size={16} className="rotate-180" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[16px] font-bold tracking-tight leading-snug">{selected.subject}</h2>
                    <Badge tone={STATUS_META[selected.status].tone}>{STATUS_META[selected.status].label}</Badge>
                  </div>
                  <div className="text-[12.5px] text-fg2 mt-1.5">
                    <span className="font-medium">{selected.from_name || 'Expéditeur'}</span>
                    {selected.from_email && <span className="text-fg3"> · {selected.from_email}</span>}
                  </div>
                  <div className="text-[11.5px] text-fg3 mt-0.5 flex items-center gap-1.5">
                    <Icon name="clock" size={12} /> {fDT(selected.received_at)}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-auto no-scrollbar">
              <div className="text-[13.5px] text-fg2 leading-relaxed whitespace-pre-wrap break-words">
                {selected.body || selected.preview || <span className="text-fg3 italic">Contenu vide.</span>}
              </div>
            </div>

            <div className="p-3.5 border-t border-line flex flex-wrap items-center gap-2">
              <a href={mailto(selected)}>
                <Button variant="primary" icon="send">Répondre par e-mail</Button>
              </a>
              {selected.status !== 'traite' ? (
                <Button variant="outline" icon="check" onClick={() => void setStatus(selected, 'traite')} disabled={busy}>Marquer traité</Button>
              ) : (
                <Button variant="outline" icon="mailOpen" onClick={() => void setStatus(selected, 'lu')} disabled={busy}>Rouvrir</Button>
              )}
              <Button variant="ghost" icon="mail" onClick={() => void setStatus(selected, 'non_lu')} disabled={busy || selected.status === 'non_lu'}>Marquer non lu</Button>
              <Button variant="danger" icon="trash" onClick={() => setConfirmDel(selected)} disabled={busy} className="ml-auto">Supprimer</Button>
            </div>
          </Card>
        ) : (
          <Card className="hidden lg:flex items-center justify-center min-h-[420px]">
            <div className="text-center px-8">
              <div className="grid place-items-center h-14 w-14 rounded-2xl bg-panel2 text-fg3 mx-auto mb-3"><Icon name="mailOpen" size={24} /></div>
              <div className="text-[14px] font-semibold text-fg2">Sélectionnez un e-mail</div>
              <div className="text-[12.5px] text-fg3 mt-1 max-w-[280px]">Choisissez un message à gauche pour lire son contenu et le traiter.</div>
            </div>
          </Card>
        )}
      </div>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} className="max-w-[400px]">
        <div className="p-5">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="grid place-items-center h-9 w-9 rounded-full bg-danger/12 text-danger"><Icon name="trash" size={17} /></span>
            <span className="text-[15px] font-bold">Supprimer cet e-mail ?</span>
          </div>
          <p className="text-[13px] text-fg3 leading-relaxed">
            « {confirmDel?.subject} » sera définitivement retiré de la boîte support. Cette action est irréversible.
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDel(null)} className="flex-1">Annuler</Button>
            <Button variant="danger" icon="trash" onClick={() => confirmDel && void del(confirmDel)} className="flex-1">Supprimer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
