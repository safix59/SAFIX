import { useRef, useState, type ReactNode } from 'react';

// ════════════════════════════════════════════════════════════════════
// Graphiques SVG faits main — zéro dépendance, légers, animés, thémables.
// Les couleurs viennent des tokens (currentColor / var CSS).
// ════════════════════════════════════════════════════════════════════

// Lissage monotone (courbe douce sans oscillation).
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i === 0 ? 0 : i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const t = 0.16;
    const c1x = x1 + (x2 - x0) * t;
    const c1y = y1 + (y2 - y0) * t;
    const c2x = x2 - (x3 - x1) * t;
    const c2y = y2 - (y3 - y1) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  }
  return d;
}

// ─── Sparkline (mini courbe pour KPI) ───
export function Sparkline({
  data,
  width = 96,
  height = 30,
  color = 'var(--accent)',
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pad = 3;
  const pts: [number, number][] = data.map((v, i) => [
    pad + (i / (data.length - 1 || 1)) * (width - pad * 2),
    pad + (1 - (v - min) / range) * (height - pad * 2),
  ]);
  const line = smoothPath(pts);
  const id = 'sg' + Math.round(pts[0][1] * 100 + width);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.1} fill={color} />
    </svg>
  );
}

// ─── Graphique en aire (interactif) ───
export function AreaChart({
  data,
  height = 220,
  color = 'var(--accent)',
  format = (n) => String(Math.round(n)),
  labelFor = (i) => String(i),
}: {
  data: number[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  labelFor?: (i: number) => string;
}) {
  const W = 760;
  const H = height;
  const padX = 8;
  const padTop = 16;
  const padBottom = 22;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const x = (i: number) => padX + (i / (data.length - 1 || 1)) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - min) / range) * (H - padTop - padBottom);
  const pts: [number, number][] = data.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = `${line} L${x(data.length - 1)},${H - padBottom} L${x(0)},${H - padBottom} Z`;

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
  };
  const gridY = [0.25, 0.5, 0.75].map((f) => padTop + f * (H - padTop - padBottom));

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridY.map((gy, i) => (
          <line key={i} x1={0} x2={W} y1={gy} y2={gy} stroke="var(--line)" strokeWidth={1} />
        ))}
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={padTop - 6} y2={H - padBottom} stroke="var(--line2)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(data[hover])} r={5} fill="var(--panel)" stroke={color} strokeWidth={2.4} />
          </>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full z-10"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover]) / H) * 100}%` }}
        >
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-panel border border-line2 shadow-pop text-center whitespace-nowrap">
            <div className="text-[11px] text-fg3">{labelFor(hover)}</div>
            <div className="text-[13px] font-semibold tnum">{format(data[hover])}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Liste de barres classées ───
export function BarList({
  items,
  tone = 'var(--accent)',
  format = (n) => n.toLocaleString('fr-FR'),
}: {
  items: { k: ReactNode; v: number; hint?: string }[];
  tone?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.v));
  const total = items.reduce((s, i) => s + i.v, 0) || 1;
  return (
    <div className="flex flex-col">
      {items.map((it, i) => (
        <div key={i} className="group relative flex items-center gap-3 h-10 px-3 rounded-lg hover:bg-fg/[0.03] transition-colors">
          <div
            className="absolute left-0 top-0 bottom-0 rounded-lg opacity-[0.14] group-hover:opacity-25 transition-opacity"
            style={{ width: `${(it.v / max) * 100}%`, background: tone }}
          />
          <div className="relative flex items-center gap-2 min-w-0 flex-1 text-[13px] text-fg2">
            {it.k}
          </div>
          <div className="relative text-[11px] text-fg3 tnum">{Math.round((it.v / total) * 100)} %</div>
          <div className="relative w-12 text-right text-[13px] font-semibold tnum">{format(it.v)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Histogramme (colonnes) — par heure / par jour ───
export function ColumnChart({
  data,
  height = 130,
  color = 'var(--accent)',
  labelFor,
  format = (n) => String(n),
  highlight,
}: {
  data: number[];
  height?: number;
  color?: string;
  labelFor?: (i: number) => string;
  format?: (n: number) => string;
  highlight?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data);
  return (
    <div className="relative">
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((v, i) => {
          const h = Math.max(2, (v / max) * (height - 4));
          const on = hover === i || highlight === i;
          return (
            <div
              key={i}
              className="flex-1 flex items-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full rounded-t-[3px] transition-all duration-200"
                style={{
                  height: h,
                  background: on ? color : 'var(--line2)',
                  opacity: on ? 1 : 0.85,
                }}
              />
            </div>
          );
        })}
      </div>
      {hover != null && (
        <div className="absolute -top-1 left-0 right-0 pointer-events-none flex justify-center">
          <div className="px-2 py-1 rounded-md bg-panel border border-line2 shadow-pop text-[11px] whitespace-nowrap">
            {labelFor && <span className="text-fg3 mr-1.5">{labelFor(hover)}</span>}
            <span className="font-semibold tnum">{format(data[hover])}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Donut ───
export function Donut({
  data,
  size = 148,
  thickness = 16,
  center,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (d.value / total) * c;
          const seg = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray .6s var(--ease)' }}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}
