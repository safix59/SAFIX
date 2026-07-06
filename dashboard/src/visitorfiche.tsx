import { useEffect, type ReactNode } from 'react';
import type { VisitorSession } from './lib/api';
import { flag, countryName, deviceMeta, sourceMeta, modelName, fDT, fTime, ago } from './lib/format';
import { Icon, type IconName } from './icons';
import { Badge, Dot } from './components';

function fmtDur(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function VisitorFiche({ session, onClose }: { session: VisitorSession | null; onClose: () => void }) {
  useEffect(() => {
    if (!session) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [session, onClose]);

  if (!session) return null;
  const s = session;
  const dm = deviceMeta(s.device);
  const sm = sourceMeta(s.source);
  const place = s.city || s.region || countryName(s.country);

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-panel border-l border-line2 shadow-pop flex flex-col animate-slide-in-right">
        {/* En-tête */}
        <div className="relative px-5 pt-5 pb-4 border-b border-line">
          <button onClick={onClose} className="absolute top-4 right-4 grid place-items-center h-8 w-8 rounded-lg text-fg3 hover:text-fg hover:bg-fg/[0.06]" aria-label="Fermer">
            <Icon name="close" size={17} />
          </button>
          <div className="flex items-center gap-3">
            <span className="grid place-items-center h-11 w-11 rounded-2xl bg-panel2 text-fg2 shrink-0">
              <Icon name={dm.icon} size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold tracking-tight flex items-center gap-2">
                {place} <span className="text-[17px] leading-none">{flag(s.country)}</span>
              </div>
              <div className="text-[12px] text-fg3 flex items-center gap-1.5">
                {s.live ? (
                  <><Dot tone="ok" ping /> En ligne · {fmtDur(s.duration_s)}</>
                ) : (
                  <>Dernière activité {ago(s.last_ts)}</>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={s.live ? 'ok' : 'neutral'}>{s.live ? 'Session active' : 'Session terminée'}</Badge>
            <Badge tone="neutral"><Icon name={sm.icon} size={11} /> {sm.label}</Badge>
            <Badge tone="neutral"><Icon name="eye" size={11} /> {s.page_count} pages</Badge>
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar px-5 py-4">
          <Section title="Localisation" icon="pin">
            <Row label="Pays" value={<span className="flex items-center gap-1.5">{flag(s.country)} {countryName(s.country)}</span>} />
            <Row label="Région" value={s.region || '—'} />
            <Row label="Ville" value={s.city || '—'} />
            <Row label="Coordonnées" value={s.lat != null && s.lng != null ? `${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}` : '—'} mono />
            <Row
              label="Adresse IP"
              value={<span className="flex items-center gap-1.5 text-fg3"><Icon name="shield" size={13} /> Masquée · non stockée</span>}
            />
          </Section>

          <Section title="Appareil & logiciel" icon="cpu">
            <Row label="Appareil" value={dm.label} />
            {s.device_model && <Row label="Modèle" value={modelName(s.device_model)} />}
            <Row label="Système" value={s.os || '—'} />
            <Row label="Navigateur" value={s.browser || '—'} />
            <Row label="Langue" value={s.lang || '—'} mono />
          </Section>

          <Section title="Session" icon="clock">
            <Row label="Début" value={fDT(s.first_ts)} />
            <Row label="Dernière activité" value={fDT(s.last_ts)} />
            <Row label="Durée" value={fmtDur(s.duration_s)} />
            <Row label="Pages vues" value={String(s.page_count)} />
            <Row label="Événements" value={String(s.hits)} />
            <Row label="Identifiant" value={s.id} mono />
          </Section>

          <Section title="Parcours sur le site" icon="route">
            {s.journey.length ? (
              <ol className="relative ml-1 mt-1">
                {s.journey.map((step, i) => {
                  const prev = i > 0 ? s.journey[i - 1] : null;
                  const gap = prev ? Math.round((new Date(step.ts).getTime() - new Date(prev.ts).getTime()) / 1000) : 0;
                  const last = i === s.journey.length - 1;
                  return (
                    <li key={i} className="relative pl-6 pb-4 last:pb-0">
                      {!last && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-line" />}
                      <span className={`absolute left-0 top-1 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-accent' : last && s.live ? 'bg-ok' : 'bg-fg3'}`} />
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-mono truncate">{step.path}</span>
                        {i === 0 && <Badge tone="accent">entrée</Badge>}
                        {last && s.live && <Badge tone="ok">ici</Badge>}
                      </div>
                      <div className="text-[11px] text-fg3">
                        {fTime(step.ts)}
                        {prev && gap > 0 && <span className="ml-2">+{gap < 60 ? `${gap} s` : `${Math.round(gap / 60)} min`}</span>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="text-[12.5px] text-fg3 py-2">Aucune page enregistrée.</div>
            )}
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg3 mb-2">
        <Icon name={icon} size={13} /> {title}
      </div>
      <div className="rounded-ctl border border-line overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-line last:border-0">
      <span className="text-[12.5px] text-fg3 shrink-0">{label}</span>
      <span className={`ml-auto text-[13px] font-medium text-right truncate ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</span>
    </div>
  );
}
