import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le dashboard EST désormais l'admin officiel : servi sur /admin/ (même origine
// que l'API → cookie d'auth sécurisé). L'ancien admin.html vanilla est supprimé.
// Le build sort dans ../admin à la racine du projet (servi statiquement).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: '../admin',
    emptyOutDir: true,
    sourcemap: false,
  },
});
