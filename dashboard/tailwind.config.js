/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        panel: 'var(--panel)',
        panel2: 'var(--panel2)',
        panel3: 'var(--panel3)',
        line: 'var(--line)',
        line2: 'var(--line2)',
        fg: 'var(--fg)',
        fg2: 'var(--fg2)',
        fg3: 'var(--fg3)',
        accent: 'var(--accent)',
        accentFg: 'var(--accent-fg)',
        accentSoft: 'var(--accent-soft)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        violet: 'var(--violet)',
        pink: 'var(--pink)',
        teal: 'var(--teal)',
      },
      fontFamily: {
        sans: ['var(--font)'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
        ctl: 'var(--radius-ctl)',
      },
      boxShadow: {
        soft: 'var(--shadow)',
        pop: 'var(--shadow-lg)',
        focus: '0 0 0 3.5px var(--accent-soft)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97) translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        'draw': { from: { 'stroke-dashoffset': '1' }, to: { 'stroke-dashoffset': '0' } },
        'ring-ping': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '80%,100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s var(--ease) both',
        'scale-in': 'scale-in 0.28s var(--ease) both',
        'slide-up': 'slide-up 0.35s var(--ease) both',
        shimmer: 'shimmer 1.5s infinite',
        pulse2: 'pulse2 2s ease-in-out infinite',
        'ring-ping': 'ring-ping 2s ease-out infinite',
      },
    },
  },
  plugins: [],
};
