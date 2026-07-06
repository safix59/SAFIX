import type { ReactNode } from 'react';

// Jeu d'icônes ligne fine (stroke = currentColor, grille 24). Cohérent, épuré,
// aligné sur le trait Apple/Linear. Une seule source de vérité pour tout l'admin.
const P: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7.5" height="9" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.6" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.6" /></>,
  orders: <><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  finance: <><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 15l3.5-4 3 2.5L21 7" /><path d="M17 7h4v4" /></>,
  visitors: <><circle cx="12" cy="12" r="2.4" /><path d="M12 5.5a6.5 6.5 0 0 1 0 13" opacity=".9" /><path d="M12 2.2a9.8 9.8 0 0 1 0 19.6" opacity=".5" /><path d="M12 5.5a6.5 6.5 0 0 0 0 13" opacity="0" /></>,
  catalog: <><path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 2z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  history: <><path d="M3.1 12a9 9 0 1 0 3-6.9" /><path d="M3 4v4h4" /><path d="M12 8v4.4l3 1.8" /></>,
  system: <><path d="M2.5 12h4l2-6 4 15 2.5-9H21.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  command: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z" /></>,
  bell: <><path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" /><path d="M13.8 20.5a2 2 0 0 1-3.6 0" /></>,
  sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M19.4 4.6l-1.6 1.6M6.2 17.8l-1.6 1.6" /></>,
  moon: <><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z" /></>,
  refresh: <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" /><path d="M20.5 3.5v5h-5" /></>,
  logout: <><path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" /><path d="M16 16.5 20.5 12 16 7.5" /><path d="M20.5 12H9.5" /></>,
  menu: <><path d="M3.5 7h17M3.5 12h17M3.5 17h17" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  chevronR: <><path d="M9 5l7 7-7 7" /></>,
  chevronD: <><path d="M5 9l7 7 7-7" /></>,
  chevronUpDown: <><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></>,
  arrowUp: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  arrowDown: <><path d="M12 5v14M6 13l6 6 6-6" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  download: <><path d="M12 3v12" /><path d="M7 10.5 12 15.5l5-5" /><path d="M4 20h16" /></>,
  trash: <><path d="M3.5 6h17" /><path d="M8.5 6V4h7v2" /><path d="M6.5 6l1 14h9l1-14" /><path d="M10.5 10.5v6M13.5 10.5v6" /></>,
  check: <><path d="M4.5 12.5 9.5 17.5 20 6.5" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="M8.2 12.2 11 15l5-5.6" /></>,
  alert: <><path d="M12 3.2 22 20H2L12 3.2z" /><path d="M12 9.5v4.5" /><path d="M12 17.4h.01" /></>,
  xCircle: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" /></>,
  filter: <><path d="M3.5 5h17l-6.5 8v6l-4 2v-8L3.5 5z" /></>,
  calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.4" /><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.6 2.5 4 5.7 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.7-4-9s1.4-6.5 4-9z" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.6" /><path d="M10.5 18.5h3" /></>,
  monitor: <><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></>,
  tablet: <><rect x="4.5" y="2.5" width="15" height="19" rx="2.4" /><path d="M11 18.5h2" /></>,
  cpu: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" /></>,
  shield: <><path d="M12 2.5 20 6v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6l8-3.5z" /><path d="M9 12l2 2 4-4.5" /></>,
  database: <><ellipse cx="12" cy="5.5" rx="7.5" ry="3" /><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13" /><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" /></>,
  sparkles: <><path d="M12 3l1.8 4.9L18.7 9.7 13.8 11.5 12 16.4 10.2 11.5 5.3 9.7 10.2 7.9 12 3z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  crosshair: <><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  expand: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2.2" /><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  user: <><circle cx="12" cy="8.5" r="3.6" /><path d="M4.5 20c0-4 3.4-6.4 7.5-6.4s7.5 2.4 7.5 6.4" /></>,
  euro: <><path d="M16.5 6.2A6 6 0 1 0 16.5 17.8" /><path d="M4.5 10h8M4.5 14h8" /></>,
  trendUp: <><path d="M3 17l6-6 4 4 8-9" /><path d="M15 6h6v6" /></>,
  trendDown: <><path d="M3 7l6 6 4-4 8 9" /><path d="M15 18h6v-6" /></>,
  package: <><path d="M12 2.5 21 7v10l-9 4.5L3 17V7l9-4.5z" /><path d="M3 7l9 4.5L21 7M12 21.5V11.5" /></>,
  link: <><path d="M9.5 14.5 14.5 9.5" /><path d="M7 12 4.7 14.3a3.7 3.7 0 0 0 5.2 5.2L12 17.4" /><path d="M17 12l2.3-2.3a3.7 3.7 0 0 0-5.2-5.2L12 6.6" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.5 12a7.5 7.5 0 0 0-.1-1.2l2.1-1.6-2-3.4-2.5 1a7 7 0 0 0-2-1.2L16.6 2h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.5-1-2 3.4 2.1 1.6a7.5 7.5 0 0 0 0 2.4L3.7 15.8l2 3.4 2.5-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.5 1 2-3.4-2.1-1.6a7.5 7.5 0 0 0 .1-1.2z" /></>,
  wifi: <><path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 12a10 10 0 0 1 13 0M8.5 15.5a5 5 0 0 1 7 0" /><path d="M12 19h.01" /></>,
  bolt: <><path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8z" /></>,
  layers: <><path d="M12 3 21 7.5 12 12 3 7.5 12 3z" /><path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" /></>,
  dot: <><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  route: <><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h5.5" /></>,
  qr: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><path d="M13.5 13.5h3v3M20.5 13.5v7M13.5 20.5h3" /></>,
  chat: <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></>,
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>,
};

export type IconName = keyof typeof P;

export function Icon({
  name,
  size = 18,
  className = '',
  strokeWidth = 1.7,
}: {
  name: IconName | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {P[name] ?? null}
    </svg>
  );
}
