import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';
import { useCountUp } from './lib/hooks';

type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'violet' | 'teal' | 'neutral';
const TONE_FG: Record<Tone, string> = {
  accent: 'text-accentFg', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger',
  violet: 'text-violet', teal: 'text-teal', neutral: 'text-fg',
};

// ─── Compteur animé ───
export function CountUp({
  value,
  format,
  className = '',
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const v = useCountUp(value);
  return <span className={`tnum ${className}`}>{format(v)}</span>;
}

// ─── Carte ───
export function Card({
  children,
  className = '',
  hover = false,
  pad = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  pad?: boolean;
}) {
  return (
    <div
      className={`bg-panel border border-line rounded-card ${pad ? 'p-5' : ''} ${
        hover ? 'transition-all duration-200 hover:border-line2 hover:shadow-soft' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  icon,
  sub,
  action,
}: {
  title: ReactNode;
  icon?: IconName;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
      {icon && (
        <span className="text-fg2">
          <Icon name={icon} size={17} />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[14px] font-semibold tracking-tight truncate">{title}</div>
        {sub && <div className="text-[12px] text-fg3 truncate">{sub}</div>}
      </div>
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}

// ─── Titre de section ───
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center mt-9 first:mt-0 mb-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-fg3">
        {children}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ─── KPI ───
export function Kpi({
  label,
  value,
  icon,
  tone = 'neutral',
  delta,
  sub,
  spark,
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  tone?: Tone;
  delta?: number | null;
  sub?: string;
  spark?: ReactNode;
}) {
  return (
    <div className="group relative bg-panel border border-line rounded-card p-5 overflow-hidden transition-all duration-200 hover:border-line2 hover:shadow-soft">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className={`grid place-items-center h-7 w-7 rounded-lg bg-panel2 ${TONE_FG[tone]}`}>
            <Icon name={icon} size={15} />
          </span>
        )}
        <span className="text-[12.5px] text-fg2 font-medium">{label}</span>
        {delta != null && <TrendPill value={delta} className="ml-auto" />}
      </div>
      <div className={`mt-3 text-[28px] leading-none font-semibold tracking-tight tnum ${TONE_FG[tone]}`}>
        {value}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        {sub && <div className="text-[11.5px] text-fg3">{sub}</div>}
        {spark && <div className="ml-auto opacity-90">{spark}</div>}
      </div>
    </div>
  );
}

// ─── Pastilles ───
export function TrendPill({ value, className = '' }: { value: number; className?: string }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11.5px] font-semibold tnum px-1.5 py-0.5 rounded-full ${
        up ? 'text-ok bg-ok/12' : 'text-danger bg-danger/12'
      } ${className}`}
    >
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} strokeWidth={2.4} />
      {Math.abs(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  soft = true,
}: {
  children: ReactNode;
  tone?: Tone;
  soft?: boolean;
}) {
  const map: Record<Tone, string> = {
    accent: 'text-accentFg bg-accent/12', ok: 'text-ok bg-ok/12', warn: 'text-warn bg-warn/12',
    danger: 'text-danger bg-danger/12', violet: 'text-violet bg-violet/12',
    teal: 'text-teal bg-teal/12', neutral: 'text-fg2 bg-fg/[0.07]',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
        soft ? map[tone] : ''
      }`}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: Tone; icon: IconName }> = {
    paid: { label: 'Payé', tone: 'accent', icon: 'checkCircle' },
    ordered: { label: 'Commandé', tone: 'ok', icon: 'package' },
    error: { label: 'Erreur', tone: 'danger', icon: 'alert' },
    refunded: { label: 'Remboursé', tone: 'neutral', icon: 'refresh' },
  };
  const s = map[status] || { label: status || '—', tone: 'neutral' as Tone, icon: 'dot' as IconName };
  return (
    <Badge tone={s.tone}>
      <Icon name={s.icon} size={11} strokeWidth={2} />
      {s.label}
    </Badge>
  );
}

export function Dot({ tone, ping = false }: { tone: Tone; ping?: boolean }) {
  const bg: Record<Tone, string> = {
    accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger',
    violet: 'bg-violet', teal: 'bg-teal', neutral: 'bg-fg3',
  };
  return (
    <span className="relative inline-flex h-2 w-2">
      {ping && <span className={`absolute inset-0 rounded-full ${bg[tone]} animate-ring-ping`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${bg[tone]}`} />
    </span>
  );
}

// ─── Boutons ───
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  icon?: IconName;
  size?: 'sm' | 'md';
};
export function Button({
  variant = 'outline',
  icon,
  size = 'md',
  className = '',
  children,
  ...rest
}: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-ctl transition-all duration-150 focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50 disabled:pointer-events-none';
  const sizes = size === 'sm' ? 'text-[12.5px] px-2.5 h-8' : 'text-[13.5px] px-3.5 h-10';
  const variants = {
    primary: 'bg-accent text-white hover:brightness-110 active:brightness-95 shadow-soft',
    ghost: 'text-fg2 hover:text-fg hover:bg-fg/[0.06]',
    outline: 'bg-panel border border-line text-fg2 hover:text-fg hover:border-line2',
    danger: 'bg-danger/10 text-danger hover:bg-danger/16 border border-danger/25',
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      className={`grid place-items-center h-10 w-10 rounded-ctl border transition-all duration-150 focus-visible:outline-none focus-visible:shadow-focus ${
        active
          ? 'bg-accent/12 border-accent/30 text-accentFg'
          : 'bg-panel border-line text-fg2 hover:text-fg hover:border-line2'
      } ${className}`}
      {...rest}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

// ─── Segmented control ───
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-ctl bg-panel2 border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`text-[12.5px] font-medium px-3 h-8 rounded-[8px] transition-all duration-150 ${
            value === o.value
              ? 'bg-panel text-fg shadow-soft'
              : 'text-fg3 hover:text-fg2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Champ de recherche ───
export function SearchInput({
  value,
  onChange,
  placeholder = 'Rechercher…',
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative flex-1 min-w-[180px]">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg3">
        <Icon name="search" size={15} />
      </span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 bg-panel border border-line rounded-ctl pl-9 pr-8 text-[13.5px] text-fg placeholder:text-fg3 outline-none focus:border-line2 focus:shadow-focus transition-all"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg3 hover:text-fg"
          aria-label="Effacer"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Skeleton ───
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-card ${className}`} />;
}

// ─── État vide ───
export function Empty({
  icon = 'sparkles',
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="text-center py-14 px-6">
      <div className="mx-auto grid place-items-center h-12 w-12 rounded-2xl bg-panel2 text-fg3 mb-3">
        <Icon name={icon} size={22} />
      </div>
      <div className="text-[14px] font-semibold">{title}</div>
      {children && <div className="mt-1 text-[12.5px] text-fg3 max-w-sm mx-auto">{children}</div>}
    </div>
  );
}

// ─── Bannière d'alerte ───
export function AlertBanner({
  level,
  children,
}: {
  level: 'error' | 'warn' | 'ok' | 'info';
  children: ReactNode;
}) {
  const cfg = {
    error: { c: 'bg-danger/[0.07] border-danger/25 text-danger', icon: 'alert' as IconName },
    warn: { c: 'bg-warn/[0.07] border-warn/25 text-warn', icon: 'alert' as IconName },
    ok: { c: 'bg-ok/[0.07] border-ok/25 text-ok', icon: 'checkCircle' as IconName },
    info: { c: 'bg-accent/[0.07] border-accent/25 text-accentFg', icon: 'info' as IconName },
  }[level];
  return (
    <div className={`flex items-start gap-3 rounded-ctl border px-4 py-3 text-[13px] ${cfg.c}`}>
      <span className="mt-px shrink-0">
        <Icon name={cfg.icon} size={16} />
      </span>
      <span className="text-fg2 leading-relaxed">{children}</span>
    </div>
  );
}

// ─── Barre de progression fine ───
export function Meter({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  const bg: Record<Tone, string> = {
    accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger',
    violet: 'bg-violet', teal: 'bg-teal', neutral: 'bg-fg3',
  };
  return (
    <div className="h-1.5 rounded-full bg-fg/[0.07] overflow-hidden">
      <div
        className={`h-full rounded-full ${bg[tone]} transition-[width] duration-700 ease-out`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Notifications (toasts)
// ════════════════════════════════════════════════════════════════════
type Toast = { id: number; title: string; msg?: string; tone: Tone };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2.5 w-[340px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => setToasts((p) => p.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const icon: IconName =
    toast.tone === 'ok' ? 'checkCircle' : toast.tone === 'danger' ? 'xCircle' : toast.tone === 'warn' ? 'alert' : 'info';
  const col = TONE_FG[toast.tone];
  return (
    <div className="glass border border-line rounded-card shadow-pop p-3.5 flex items-start gap-3 animate-slide-up">
      <span className={`mt-px shrink-0 ${col}`}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{toast.title}</div>
        {toast.msg && <div className="text-[12px] text-fg3 mt-0.5">{toast.msg}</div>}
      </div>
      <button onClick={onClose} className="text-fg3 hover:text-fg shrink-0" aria-label="Fermer">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

// ─── Modale (backdrop + panneau) ───
export function Modal({
  open,
  onClose,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', on);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 sm:pt-[12vh]">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={`relative w-full max-w-lg bg-panel border border-line2 rounded-card shadow-pop animate-scale-in ${className}`}>
        {children}
      </div>
    </div>
  );
}
