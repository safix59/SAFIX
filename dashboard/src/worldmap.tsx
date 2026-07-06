import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VisitorSession } from './lib/api';
import { WORLD_W, WORLD_H, projectWorld, COUNTRIES, CENTROID } from './lib/world';
import { flag, countryName, deviceMeta, ago } from './lib/format';
import { Icon } from './icons';

const MIN_K = 1;
const MAX_K = 46;
const CLUSTER_TH = 30; // seuil de regroupement (unités viewBox = constantes à l'écran)

type XY = [number, number];
type Transform = { k: number; tx: number; ty: number };

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 16777619)) >>> 0;
  return h;
}

// Position de base (repère viewBox) d'une session : coordonnées précises si
// dispo, sinon centroïde du pays + léger décalage déterministe (fan-out au zoom).
function baseOf(s: VisitorSession): XY | null {
  if (s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    return projectWorld(s.lng, s.lat);
  if (s.country && CENTROID[s.country]) {
    const [x, y] = CENTROID[s.country];
    const h = hash(s.id);
    const jx = ((h & 0xff) / 255 - 0.5) * 6;
    const jy = (((h >> 8) & 0xff) / 255 - 0.5) * 6;
    return [x + jx, y + jy];
  }
  return null;
}

const levelOf = (k: number): string =>
  k < 1.8 ? 'Monde' : k < 4 ? 'Continent' : k < 9 ? 'Pays' : k < 20 ? 'Région' : 'Ville';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Cluster { x: number; y: number; items: number[]; live: boolean }

export function WorldMap({
  sessions,
  onSelect,
  selectedId,
}: {
  sessions: VisitorSession[];
  onSelect: (s: VisitorSession) => void;
  selectedId?: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [t, setT] = useState<Transform>({ k: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<Cluster | null>(null);
  const pointers = useRef<Map<number, XY>>(new Map());
  const drag = useRef<{ tx: number; ty: number; x: number; y: number } | null>(null);
  const pinch = useRef<{ dist: number; k: number } | null>(null);
  const raf = useRef(0);

  const bases = useMemo(() => sessions.map(baseOf), [sessions]);

  const clampT = useCallback((k: number, tx: number, ty: number): Transform => {
    return {
      k,
      tx: clamp(tx, WORLD_W * (1 - k), 0),
      ty: clamp(ty, WORLD_H * (1 - k), 0),
    };
  }, []);

  const vbPerPx = useCallback(() => {
    const r = svgRef.current?.getBoundingClientRect();
    return r && r.width ? WORLD_W / r.width : 1;
  }, []);

  const mouseVb = useCallback((clientX: number, clientY: number): XY => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * WORLD_W, ((clientY - r.top) / r.height) * WORLD_H];
  }, []);

  const animateTo = useCallback(
    (target: Transform, dur = 540) => {
      cancelAnimationFrame(raf.current);
      const start = performance.now();
      const from = { ...t };
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        const e = easeInOut(p);
        setT(
          clampT(
            from.k + (target.k - from.k) * e,
            from.tx + (target.tx - from.tx) * e,
            from.ty + (target.ty - from.ty) * e,
          ),
        );
        if (p < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [t, clampT],
  );
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const zoomAt = useCallback(
    (focal: XY, factor: number) => {
      setT((prev) => {
        const k2 = clamp(prev.k * factor, MIN_K, MAX_K);
        const bx = (focal[0] - prev.tx) / prev.k;
        const by = (focal[1] - prev.ty) / prev.k;
        return clampT(k2, focal[0] - bx * k2, focal[1] - by * k2);
      });
    },
    [clampT],
  );

  const fitLngLat = useCallback(
    (lngMin: number, latMin: number, lngMax: number, latMax: number) => {
      const a = projectWorld(lngMin, latMax);
      const b = projectWorld(lngMax, latMin);
      const x0 = Math.min(a[0], b[0]);
      const x1 = Math.max(a[0], b[0]);
      const y0 = Math.min(a[1], b[1]);
      const y1 = Math.max(a[1], b[1]);
      const k = clamp(Math.min(WORLD_W / (x1 - x0), WORLD_H / (y1 - y0)) * 0.92, MIN_K, MAX_K);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      animateTo(clampT(k, WORLD_W / 2 - cx * k, WORLD_H / 2 - cy * k));
    },
    [animateTo, clampT],
  );

  const clusters = useMemo<Cluster[]>(() => {
    const cell = CLUSTER_TH;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
      const base = bases[i];
      if (!base) continue;
      const sx = base[0] * t.k + t.tx;
      const sy = base[1] * t.k + t.ty;
      if (sx < -40 || sx > WORLD_W + 40 || sy < -40 || sy > WORLD_H + 40) continue;
      const key = `${Math.floor(sx / cell)}_${Math.floor(sy / cell)}`;
      const arr = buckets.get(key);
      if (arr) arr.push(i);
      else buckets.set(key, [i]);
    }
    const out: Cluster[] = [];
    for (const items of buckets.values()) {
      let sx = 0;
      let sy = 0;
      let live = false;
      for (const i of items) {
        const base = bases[i]!;
        sx += base[0] * t.k + t.tx;
        sy += base[1] * t.k + t.ty;
        if (sessions[i].live) live = true;
      }
      out.push({ x: sx / items.length, y: sy / items.length, items, live });
    }
    return out.sort((a, b) => b.items.length - a.items.length);
  }, [sessions, bases, t]);

  // ─── Gestes ───
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0016);
    zoomAt(mouseVb(e.clientX, e.clientY), f);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 1) drag.current = { tx: t.tx, ty: t.ty, x: e.clientX, y: e.clientY };
    else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), k: t.k };
      drag.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
      const midVb = mouseVb((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
      const targetK = clamp(pinch.current.k * (dist / pinch.current.dist), MIN_K, MAX_K);
      setT((prev) => {
        const bx = (midVb[0] - prev.tx) / prev.k;
        const by = (midVb[1] - prev.ty) / prev.k;
        return clampT(targetK, midVb[0] - bx * targetK, midVb[1] - by * targetK);
      });
    } else if (drag.current) {
      const s = vbPerPx();
      const nx = drag.current.tx + (e.clientX - drag.current.x) * s;
      const ny = drag.current.ty + (e.clientY - drag.current.y) * s;
      setT((prev) => clampT(prev.k, nx, ny));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };
  const onDoubleClick = (e: React.MouseEvent) => zoomAt(mouseVb(e.clientX, e.clientY), 2.2);

  const onClusterClick = (c: Cluster) => {
    if (c.items.length === 1) {
      onSelect(sessions[c.items[0]]);
    } else {
      const bx = (c.x - t.tx) / t.k;
      const by = (c.y - t.ty) / t.k;
      const k2 = clamp(t.k * 2.6, MIN_K, MAX_K);
      animateTo(clampT(k2, WORLD_W / 2 - bx * k2, WORLD_H / 2 - by * k2));
    }
  };

  // Couche pays mémoïsée : les 176 tracés ne sont créés qu'une fois (seul le
  // transform du <g> change au pan/zoom → rendu fluide).
  const countryLayer = useMemo(
    () =>
      COUNTRIES.map((c, i) => (
        <path key={i} d={c.d} fill="var(--panel3)" stroke="var(--line2)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      )),
    [],
  );

  const dragging = drag.current || pinch.current;

  return (
    <div className="relative select-none">
      <div style={{ aspectRatio: `${WORLD_W} / ${WORLD_H}` }} className="w-full overflow-hidden rounded-xl bg-panel2 border border-line">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
          width="100%"
          height="100%"
          style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', display: 'block' }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <g transform={`translate(${t.tx} ${t.ty}) scale(${t.k})`}>{countryLayer}</g>
          <g>
            {clusters.map((c, i) => {
              const single = c.items.length === 1;
              const sel = single && selectedId === sessions[c.items[0]].id;
              const r = single ? 4.4 : clamp(7 + Math.sqrt(c.items.length) * 2.6, 8, 22);
              const col = single ? (c.live ? 'var(--ok)' : 'var(--accent)') : 'var(--accent)';
              return (
                <g
                  key={i}
                  transform={`translate(${c.x} ${c.y})`}
                  onClick={() => onClusterClick(c)}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {c.live && (
                    <circle
                      r={r}
                      fill="none"
                      stroke="var(--ok)"
                      strokeWidth={1.4}
                      opacity={0.9}
                      className="animate-ring-ping"
                      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    />
                  )}
                  {single ? (
                    <>
                      {sel && <circle r={r + 4} fill="none" stroke={col} strokeWidth={1.6} opacity={0.6} />}
                      <circle r={r} fill={col} stroke="var(--bg)" strokeWidth={1.4} />
                    </>
                  ) : (
                    <>
                      <circle r={r} fill={col} fillOpacity={0.9} stroke="var(--bg)" strokeWidth={1.4} />
                      <text textAnchor="middle" dy="3.5" fontSize={r > 14 ? 11 : 9} fontWeight={700} fill="#fff">
                        {c.items.length}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: `${(hover.x / WORLD_W) * 100}%`, top: `${(hover.y / WORLD_H) * 100}%` }}
        >
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-panel border border-line2 shadow-pop text-center whitespace-nowrap">
            {hover.items.length === 1 ? (
              <>
                <div className="text-[12px] font-semibold">
                  {sessions[hover.items[0]].city || countryName(sessions[hover.items[0]].country)} {flag(sessions[hover.items[0]].country)}
                </div>
                <div className="text-[10.5px] text-fg3">
                  {deviceMeta(sessions[hover.items[0]].device).label} · {hover.live ? 'en ligne' : ago(sessions[hover.items[0]].last_ts)}
                </div>
              </>
            ) : (
              <div className="text-[12px] font-semibold tnum">
                {hover.items.length} visiteurs{hover.live ? ' · dont en ligne' : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contrôles zoom */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <MapBtn icon="plus" label="Zoomer" onClick={() => zoomAt([WORLD_W / 2, WORLD_H / 2], 1.6)} />
        <MapBtn icon="minus" label="Dézoomer" onClick={() => zoomAt([WORLD_W / 2, WORLD_H / 2], 1 / 1.6)} />
        <MapBtn icon="globe" label="Vue monde" onClick={() => animateTo({ k: 1, tx: 0, ty: 0 })} />
      </div>

      {/* Niveau + présets */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 h-7 rounded-full bg-panel/90 border border-line backdrop-blur text-fg2">
          <Icon name="crosshair" size={12} /> {levelOf(t.k)}
        </span>
      </div>
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
        {([
          ['Monde', () => animateTo({ k: 1, tx: 0, ty: 0 })],
          ['Europe', () => fitLngLat(-11, 34, 40, 61)],
          ['France', () => fitLngLat(-5.5, 41, 9.8, 51.5)],
          ['Afrique', () => fitLngLat(-18, -35, 52, 37)],
          ['Amériques', () => fitLngLat(-140, -55, -34, 60)],
          ['Asie', () => fitLngLat(40, 5, 150, 60)],
        ] as [string, () => void][]).map(([label, fn]) => (
          <button
            key={label}
            onClick={fn}
            className="text-[11px] font-medium px-2.5 h-7 rounded-full bg-panel/90 border border-line backdrop-blur text-fg2 hover:text-fg hover:border-line2 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MapBtn({ icon, label, onClick }: { icon: 'plus' | 'minus' | 'globe'; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid place-items-center h-8 w-8 rounded-lg bg-panel/90 border border-line backdrop-blur text-fg2 hover:text-fg hover:border-line2 transition-colors"
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
