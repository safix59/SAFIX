/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Palette SAFIX (alignée sur le site client)
        ink: '#000000',
        panel: '#0d0d0f',
        panel2: '#141416',
        line: 'rgba(255,255,255,0.08)',
        line2: 'rgba(255,255,255,0.14)',
        accent: '#0A84FF',
        accent2: '#5AC8FA',
        ok: '#30D158',
        warn: '#FF9F0A',
        danger: '#FF453A',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl2: '18px' },
    },
  },
  plugins: [],
};
