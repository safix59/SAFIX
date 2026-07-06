import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le dashboard est servi sur /admin-next/ (même origine que l'API → cookie
// d'auth sécurisé). L'admin actuel (/admin) reste intact pendant la refonte.
// Le build sort dans ../admin-next à la racine du projet (servi statiquement).
export default defineConfig({
  base: '/admin-next/',
  plugins: [react()],
  build: {
    outDir: '../admin-next',
    emptyOutDir: true,
    sourcemap: false,
  },
});
