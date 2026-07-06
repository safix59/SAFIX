import { useCallback, useEffect, useRef, useState } from 'react';

// Media query réactive (responsive sans dépendance).
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

// Raccourci clavier global (ex : ⌘K / Ctrl+K).
export function useHotkey(
  key: string,
  handler: (e: KeyboardEvent) => void,
  opts: { meta?: boolean; shift?: boolean } = {},
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const metaOk = opts.meta ? e.metaKey || e.ctrlKey : true;
      const shiftOk = opts.shift ? e.shiftKey : true;
      if (e.key.toLowerCase() === key.toLowerCase() && metaOk && shiftOk) {
        ref.current(e);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [key, opts.meta, opts.shift]);
}

// Compteur animé (les chiffres montent en douceur — signature « premium »).
export function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    const delta = target - origin;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(origin + delta * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return val;
}

// Horloge qui bat (heure « live », relatif temps réel).
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// État persistant (localStorage).
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* quota / mode privé — sans gravité */
      }
    },
    [key],
  );
  return [value, set] as const;
}
