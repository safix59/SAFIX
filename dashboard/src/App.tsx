// Phase 0 — coquille de vérification du toolchain (React + TS + Tailwind).
// Sera remplacée par le vrai shell (sidebar/topbar/auth) à l'étape suivante.
export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-white">
      <div className="text-center">
        <div className="text-4xl font-extrabold tracking-tight">
          <span className="text-accent">SA</span>FIX
        </div>
        <div className="mt-2 text-sm text-white/50 uppercase tracking-widest">
          Administration · v2 (React + TypeScript)
        </div>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-white/70">
          <span className="h-2 w-2 rounded-full bg-ok" />
          Fondations en place
        </div>
      </div>
    </div>
  );
}
