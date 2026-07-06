// Helpers de formatage — français, cohérents dans toute la console.

export const euro = (cents: number | null | undefined): string =>
  (Number(cents || 0) / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';

// Version compacte pour les gros KPI : 12 480 € → « 12,5 k € ».
export const euroShort = (cents: number | null | undefined): string => {
  const v = Number(cents || 0) / 100;
  if (Math.abs(v) >= 1000)
    return (
      v.toLocaleString('fr-FR', { maximumFractionDigits: 1, notation: 'compact' }) + ' €'
    );
  return euro(cents);
};

export const num = (n: number | null | undefined): string =>
  Number(n || 0).toLocaleString('fr-FR');

export const numShort = (n: number | null | undefined): string => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000)
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 1, notation: 'compact' });
  return num(v);
};

export const pct = (n: number): string =>
  (n > 0 ? '+' : '') + n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';

export const fDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return String(s);
  }
};

export const fDateFull = (s: string | null | undefined): string => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return String(s);
  }
};

export const fDT = (s: string | null | undefined): string => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(s);
  }
};

export const fTime = (s: string | null | undefined): string => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(s);
  }
};

// « il y a 2 min », « à l'instant »…
export const ago = (s: string | null | undefined): string => {
  if (!s) return '';
  const d = Date.now() - new Date(s).getTime();
  if (!Number.isFinite(d)) return '';
  const sec = Math.round(d / 1000);
  if (sec < 10) return "à l'instant";
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return `il y a ${j} j`;
};

export const SLOTS: Record<string, string> = {
  morning: 'Matin · 9 h – 12 h',
  afternoon: 'Après-midi · 14 h – 18 h',
  evening: 'Soir · 18 h – 20 h',
};

type DeviceMeta = { label: string; icon: string };
export const DEVICE_META: Record<string, DeviceMeta> = {
  iPhone: { label: 'iPhone', icon: 'phone' },
  iPad: { label: 'iPad', icon: 'tablet' },
  iPod: { label: 'iPod', icon: 'phone' },
  Mac: { label: 'Mac', icon: 'monitor' },
  Android: { label: 'Android', icon: 'phone' },
  'Tablette Android': { label: 'Tablette Android', icon: 'tablet' },
  Windows: { label: 'Windows', icon: 'monitor' },
  'Windows Phone': { label: 'Windows Phone', icon: 'phone' },
  Chromebook: { label: 'Chromebook', icon: 'monitor' },
  Linux: { label: 'Linux', icon: 'monitor' },
  mobile: { label: 'Mobile', icon: 'phone' },
  tablet: { label: 'Tablette', icon: 'tablet' },
  desktop: { label: 'Ordinateur', icon: 'monitor' },
  Autre: { label: 'Autre', icon: 'globe' },
};
export const deviceMeta = (d: string | null | undefined): DeviceMeta =>
  (d && DEVICE_META[d]) || { label: d || 'Inconnu', icon: 'globe' };

export const SOURCE_META: Record<string, { label: string; icon: string }> = {
  qr: { label: 'Scan QR code', icon: 'qr' },
  search: { label: 'Moteur de recherche', icon: 'search' },
  social: { label: 'Réseaux sociaux', icon: 'sparkles' },
  direct: { label: 'Accès direct', icon: 'bolt' },
  referral: { label: 'Site référent', icon: 'link' },
  interne: { label: 'Navigation interne', icon: 'route' },
};
export const sourceMeta = (s: string | null | undefined) =>
  (s && SOURCE_META[s]) || { label: s || 'Direct', icon: 'bolt' };

const ANDROID_MODELS: Record<string, string> = {
  'SM-S911B': 'Galaxy S23',
  'SM-S918B': 'Galaxy S23 Ultra',
  'SM-S921B': 'Galaxy S24',
  'SM-S928B': 'Galaxy S24 Ultra',
  'SM-S931B': 'Galaxy S25',
  'SM-S938B': 'Galaxy S25 Ultra',
  'SM-A546B': 'Galaxy A54',
  'SM-A356B': 'Galaxy A35',
  'SM-G991B': 'Galaxy S21',
};
export const modelName = (code: string | null | undefined): string =>
  code ? ANDROID_MODELS[code] || code : '';

export const deviceFull = (
  device: string | null | undefined,
  model: string | null | undefined,
): string => {
  const base = deviceMeta(device).label;
  return model ? `${base} · ${modelName(model)}` : base;
};

// Drapeau emoji depuis un code pays ISO-2 (FR → 🇫🇷).
export const flag = (cc: string | null | undefined): string => {
  if (!cc || cc.length !== 2) return '🌐';
  const base = 0x1f1e6;
  const A = 'A'.charCodeAt(0);
  return String.fromCodePoint(
    base + cc.toUpperCase().charCodeAt(0) - A,
    base + cc.toUpperCase().charCodeAt(1) - A,
  );
};

const COUNTRY_NAMES: Record<string, string> = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', LU: 'Luxembourg', DE: 'Allemagne',
  ES: 'Espagne', IT: 'Italie', GB: 'Royaume-Uni', US: 'États-Unis', NL: 'Pays-Bas',
  PT: 'Portugal', MA: 'Maroc', DZ: 'Algérie', TN: 'Tunisie', CA: 'Canada',
};
export const countryName = (cc: string | null | undefined): string =>
  (cc && COUNTRY_NAMES[cc]) || cc || 'Inconnu';

// Délai relatif « il y a X » à partir d'un âge en heures.
export const ageLabel = (h: number | null | undefined): string => {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} j`;
};
