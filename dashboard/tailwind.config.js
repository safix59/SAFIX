/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Tokens sémantiques pilotés par variables CSS (thème clair + sombre)
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        panel: 'var(--panel)',
        panel2: 'var(--panel2)',
        line: 'var(--line)',
        line2: 'var(--line2)',
        fg: 'var(--fg)',
        fg2: 'var(--fg2)',
        fg3: 'var(--fg3)',
        // Accents (identiques dans les 2 thèmes, alignés sur le site client)
        accent: '#0A84FF',
        accent2: '#5AC8FA',
        ok: '#30D158',
        warn: '#FF9F0A',
        danger: '#FF453A',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { card: '18px' },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } },
      },
      animation: {
        'fade-in': 'fade-in .35s cubic-bezier(.22,1,.36,1)',
        shimmer: 'shimmer 1.6s infinite',
        pulse2: 'pulse2 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
