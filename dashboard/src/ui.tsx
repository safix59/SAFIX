import type { ReactNode } from 'react';

// ─── Icônes (SVG line-art, stroke = currentColor) ───
const P: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  orders: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  finance: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  visitors: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 4.5a3 3 0 0 1 0 6" /><path d="M21 20c0-2.4-1.4-4.2-3.5-5" /></>,
  catalog: <><path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 2z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></>,
  system: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.4-2.5H10.6l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.1 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h3.8l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v5h-5" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
};

export function Icon({ name, size = 18, className = '' }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {P[name] ?? null}
    </svg>
  );
}

// ─── Primitives ───
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-panel border border-line rounded-card ${className}`}>{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg3 mt-8 first:mt-1 mb-3">{children}</div>;
}

export function Kpi({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'accent' | 'ok' | 'warn'; sub?: string }) {
  const toneCls = tone === 'accent' ? 'text-accent2' : tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div className="bg-panel border border-line rounded-card p-5 transition-colors hover:border-line2">
      <div className="text-xs text-fg3 font-medium">{label}</div>
      <div className={`mt-2 text-[27px] font-bold tracking-tight tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-fg3">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'other' }: { children: ReactNode; tone?: 'paid' | 'ordered' | 'error' | 'other' }) {
  const c = {
    paid: 'bg-ok/15 text-ok', ordered: 'bg-accent/15 text-accent2',
    error: 'bg-danger/15 text-danger', other: 'bg-fg/10 text-fg3',
  }[tone];
  return <span className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${c}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, 'paid' | 'ordered' | 'error' | 'other']> = {
    paid: ['Payé', 'paid'], ordered: ['Commandé', 'ordered'], error: ['Erreur', 'error'],
  };
  const [txt, tone] = map[status] || [status || '—', 'other'];
  return <Badge tone={tone}>{txt}</Badge>;
}

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'danger' }) {
  const c = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' }[tone];
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

export function AlertRow({ level, children }: { level: 'error' | 'warn' | 'ok'; children: ReactNode }) {
  const cls = level === 'error' ? 'bg-danger/[0.08] border-danger/40 text-danger'
    : level === 'warn' ? 'bg-warn/[0.07] border-warn/35 text-warn'
    : 'bg-fg/[0.04] border-line text-fg2';
  const ic = level === 'error' ? '⛔' : level === 'warn' ? '⚠️' : '✓';
  return <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm mb-2 ${cls}`}><span>{ic}</span><span className="text-fg2">{children}</span></div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-card ${className}`} />;
}

export function EmptyState({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <Card>
      <div className="text-center text-fg3 py-11 px-5">
        <div className="text-3xl opacity-50 mb-2">{icon}</div>
        <div className="text-sm">{children}</div>
      </div>
    </Card>
  );
}

export function Bars({ items }: { items: { k: string; v: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return (
    <div>
      {items.map((i, idx) => (
        <div key={idx} className="flex items-center gap-3.5 my-3">
          <div className="w-[150px] text-[13.5px] text-fg2 truncate">{i.k}</div>
          <div className="flex-1 h-1.5 rounded-full bg-fg/[0.06] overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((i.v / max) * 100)}%`, minWidth: 3 }} />
          </div>
          <div className="w-11 text-right tabular-nums text-[13px]">{i.v}</div>
        </div>
      ))}
    </div>
  );
}
