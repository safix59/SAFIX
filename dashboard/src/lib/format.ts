export const euro = (cents: number | null | undefined): string =>
  (Number(cents || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export const fDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return String(s); }
};

export const fDT = (s: string | null | undefined): string => {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return String(s); }
};

export const SLOTS: Record<string, string> = {
  morning: 'Matin (9h–12h)',
  afternoon: 'Après-midi (14h–18h)',
  evening: 'Soir (18h–20h)',
};

export const DEVICE_LABEL: Record<string, string> = {
  iPhone: '📱 iPhone', iPad: '📲 iPad', iPod: '📱 iPod', Mac: '💻 Mac',
  Android: '🤖 Android', 'Tablette Android': '🤖 Tablette Android',
  Windows: '🖥️ Windows', 'Windows Phone': '📱 Windows Phone', Chromebook: '💻 Chromebook',
  Linux: '🐧 Linux', Autre: '❔ Autre', mobile: '📱 Mobile', tablet: '📲 Tablette', desktop: '🖥️ Ordinateur',
};

export const SOURCE_LABEL: Record<string, string> = {
  qr: 'Scan QR', search: 'Recherche', social: 'Réseaux sociaux', direct: 'Accès direct', referral: 'Autre site', interne: 'Navigation interne',
};

const ANDROID_MODELS: Record<string, string> = {
  'SM-S911B': 'Galaxy S23', 'SM-S918B': 'Galaxy S23 Ultra', 'SM-S921B': 'Galaxy S24',
  'SM-S928B': 'Galaxy S24 Ultra', 'SM-S931B': 'Galaxy S25', 'SM-S938B': 'Galaxy S25 Ultra',
  'SM-A546B': 'Galaxy A54', 'SM-A356B': 'Galaxy A35', 'SM-G991B': 'Galaxy S21',
};

export const modelName = (code: string | null | undefined): string => (code ? ANDROID_MODELS[code] || code : '');

export const deviceFull = (device: string | null | undefined, model: string | null | undefined): string => {
  const base = (device && DEVICE_LABEL[device]) || device || '';
  return model ? `${base} · ${modelName(model)}` : base;
};
