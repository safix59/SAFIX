import { useMemo, useState } from 'react';
import { FRANCE } from './lib/france';

type GeoPt = { lat: number; lng: number; city: string | null };

// Carte France — silhouette réelle + points visiteurs regroupés par proximité.
// Les points hors métropole sont épinglés au bord (indicateur « ailleurs »).
export function FranceMap({ points }: { points: GeoPt[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const clusters = useMemo(() => {
    const map = new Map<string, { x: number; y: number; n: number; city: string | null; off: boolean }>();
    for (const p of points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      let [x, y] = FRANCE.project(p.lng, p.lat);
      const off = x < 0 || x > FRANCE.W || y < 0 || y > FRANCE.H;
      x = Math.max(6, Math.min(FRANCE.W - 6, x));
      y = Math.max(6, Math.min(FRANCE.H - 6, y));
      const key = `${Math.round(x / 9)}_${Math.round(y / 9)}`;
      const cur = map.get(key);
      if (cur) {
        cur.n++;
      } else {
        map.set(key, { x, y, n: 1, city: p.city, off });
      }
    }
    return [...map.values()].sort((a, b) => a.n - b.n);
  }, [points]);

  const maxN = Math.max(1, ...clusters.map((c) => c.n));

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${FRANCE.W} ${FRANCE.H}`} width="100%" className="overflow-visible">
        <defs>
          <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          d={FRANCE.path}
          fill="var(--panel2)"
          stroke="var(--line2)"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        {clusters.map((c, i) => {
          const r = 3 + (c.n / maxN) * 6;
          const on = hover === i;
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              <circle cx={c.x} cy={c.y} r={r * 2.4} fill="url(#dotGlow)" opacity={on ? 0.9 : 0.6} />
              {i === clusters.length - 1 && (
                <circle cx={c.x} cy={c.y} r={r} fill="none" stroke="var(--accent)" strokeWidth={1.5} className="animate-ring-ping" style={{ transformOrigin: `${c.x}px ${c.y}px` }} />
              )}
              <circle cx={c.x} cy={c.y} r={r} fill="var(--accent)" stroke="var(--bg)" strokeWidth={1.4} />
            </g>
          );
        })}
      </svg>
      {hover != null && clusters[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full z-10"
          style={{
            left: `${(clusters[hover].x / FRANCE.W) * 100}%`,
            top: `${(clusters[hover].y / FRANCE.H) * 100}%`,
          }}
        >
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-panel border border-line2 shadow-pop text-center whitespace-nowrap">
            <div className="text-[12px] font-semibold">{clusters[hover].city || 'Localisation'}</div>
            <div className="text-[11px] text-fg3 tnum">
              {clusters[hover].n} visiteur{clusters[hover].n > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
