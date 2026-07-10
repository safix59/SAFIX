import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { GeoConfig } from '../lib/api';
import { haversineKm } from '../lib/derive';
import { Card, CardHead, Button, Switch, Badge, Skeleton, AlertBanner, Modal, Dot, useToast } from '../components';
import { Icon } from '../icons';

const DEFAULT: GeoConfig = { enabled: true, lat: 51.0344, lng: 2.3768, radiusKm: 30, city: 'Dunkerque' };

const TEST_CITIES = [
  { name: 'Grande-Synthe', lat: 51.0128, lng: 2.302 },
  { name: 'Gravelines', lat: 50.987, lng: 2.128 },
  { name: 'Bergues', lat: 50.968, lng: 2.435 },
  { name: 'Calais', lat: 50.9513, lng: 1.8587 },
  { name: 'Lille', lat: 50.6292, lng: 3.0573 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522 },
];

export function Settings() {
  const [cfg, setCfg] = useState<GeoConfig | null>(null);
  const [saved, setSaved] = useState<GeoConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    api.geo().then((res) => {
      if (!alive) return;
      const g = res.data?.geo ?? DEFAULT;
      setCfg(g);
      setSaved(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = useMemo(() => cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved]);

  const preview = useMemo(() => {
    if (!cfg) return [];
    return TEST_CITIES.map((c) => {
      const d = haversineKm(cfg.lat, cfg.lng, c.lat, c.lng);
      return { ...c, d, inside: d <= cfg.radiusKm };
    });
  }, [cfg]);

  if (!cfg) {
    return (
      <div className="stagger grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <Skeleton className="h-[420px] lg:col-span-2" />
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  const set = <K extends keyof GeoConfig>(k: K, v: GeoConfig[K]) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    setSaving(true);
    const res = await api.geoSet(cfg);
    setSaving(false);
    if (res.status === 200 && res.data?.ok) {
      setSaved(cfg);
      toast({ title: 'Réglages enregistrés', msg: 'La zone d’intervention est à jour sur le site.', tone: 'ok' });
    } else {
      toast({ title: 'Échec de l’enregistrement', msg: 'La table « settings » existe-t-elle ? (SQL fourni)', tone: 'danger' });
    }
  };

  return (
    <div className="stagger">
      <MaintenanceCard />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        {/* Configuration */}
        <Card className="lg:col-span-2">
          <CardHead title="Zone d’intervention" icon="pin" sub="Vérification de localisation au moment de la commande" />
          <div className="p-5 flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-ctl bg-panel2 border border-line p-4">
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-accent/12 text-accentFg shrink-0">
                <Icon name="pin" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">Vérification de localisation</div>
                <div className="text-[12px] text-fg3">Propose au client de confirmer qu’il est dans la zone avant de payer.</div>
              </div>
              <Switch checked={cfg.enabled} onChange={(v) => set('enabled', v)} />
            </div>

            <div className={cfg.enabled ? '' : 'opacity-40 pointer-events-none'}>
              <Field label="Ville de référence" hint="Nom affiché dans les messages au client">
                <input
                  value={cfg.city}
                  onChange={(e) => set('city', e.target.value)}
                  className="ctl"
                  placeholder="Dunkerque"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <Field label="Latitude" hint="du point de réparation">
                  <input type="number" step="0.0001" value={cfg.lat} onChange={(e) => set('lat', +e.target.value)} className="ctl tnum" />
                </Field>
                <Field label="Longitude" hint="du point de réparation">
                  <input type="number" step="0.0001" value={cfg.lng} onChange={(e) => set('lng', +e.target.value)} className="ctl tnum" />
                </Field>
              </div>

              <Field label={`Rayon accepté · ${cfg.radiusKm} km`} hint="Au-delà, un message de confirmation s’affiche">
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={5}
                    max={200}
                    step={5}
                    value={cfg.radiusKm}
                    onChange={(e) => set('radiusKm', +e.target.value)}
                    className="flex-1 accent-[color:var(--accent)]"
                  />
                  <input
                    type="number"
                    min={1}
                    value={cfg.radiusKm}
                    onChange={(e) => set('radiusKm', Math.max(1, +e.target.value))}
                    className="ctl tnum w-[84px] text-center"
                  />
                </div>
              </Field>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button variant="primary" icon="check" onClick={save} disabled={saving || !dirty}>
                {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'À jour'}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setCfg(saved)}>
                  Annuler
                </Button>
              )}
              <span className="ml-auto text-[11.5px] text-fg3">
                {cfg.enabled ? <Badge tone="ok">Actif</Badge> : <Badge tone="neutral">Désactivé</Badge>}
              </span>
            </div>
          </div>
        </Card>

        {/* Aperçu live */}
        <Card>
          <CardHead title="Aperçu" icon="crosshair" sub={`Rayon ${cfg.radiusKm} km`} />
          <div className="p-2.5">
            {preview.map((c) => (
              <div key={c.name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-fg/[0.03] transition-colors">
                <span className={`grid place-items-center h-8 w-8 rounded-lg shrink-0 ${c.inside ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn'}`}>
                  <Icon name={c.inside ? 'checkCircle' : 'alert'} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{c.name}</div>
                  <div className="text-[11px] text-fg3 tnum">≈ {Math.round(c.d)} km</div>
                </div>
                <Badge tone={c.inside ? 'ok' : 'warn'}>{c.inside ? 'Dans la zone' : 'Confirmation'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-3.5">
        <AlertBanner level="info">
          Le contrôle n’est <strong>jamais bloquant</strong> : un client éloigné voit une demande de confirmation élégante, mais reste libre de poursuivre. Si la position est refusée, la commande continue normalement.
        </AlertBanner>
      </div>

      <style>{`.ctl{width:100%;height:40px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-ctl);padding:0 12px;color:var(--fg);font-size:13.5px;outline:none;transition:border-color .15s,box-shadow .15s}.ctl:focus{border-color:var(--line2);box-shadow:0 0 0 3.5px var(--accent-soft)}`}</style>
    </div>
  );
}

// ─── Mode maintenance : bascule instantanée du site public (< 30 s) ───
function MaintenanceCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState<null | boolean>(null); // valeur demandée
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    api.maintenanceGet().then((r) => { if (alive && r.data) setOn(!!r.data.on); });
    return () => { alive = false; };
  }, []);

  const apply = async (v: boolean) => {
    setBusy(true);
    const r = await api.maintenanceSet(v);
    setBusy(false);
    setConfirm(null);
    if (r.status === 200 && r.data?.ok) {
      setOn(v);
      toast({
        title: v ? 'Maintenance activée' : 'Site rouvert au public',
        msg: v ? 'Le public voit la page de maintenance (effet < 30 s).' : 'Le site est de nouveau accessible (effet < 30 s).',
        tone: v ? 'warn' : 'ok',
      });
    } else {
      toast({ title: 'Échec de la bascule', msg: 'Vérifiez la table settings, puis réessayez.', tone: 'danger' });
    }
  };

  return (
    <>
      <Card pad className="flex items-center gap-4">
        <span className={`grid place-items-center h-12 w-12 rounded-2xl shrink-0 ${on ? 'bg-warn/12 text-warn' : 'bg-ok/12 text-ok'}`}>
          <Icon name={on ? 'alert' : 'checkCircle'} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight flex items-center gap-2.5">
            Mode maintenance
            {on == null ? <Skeleton className="h-4 w-16 rounded" /> : (
              <Badge tone={on ? 'warn' : 'ok'}><Dot tone={on ? 'warn' : 'ok'} ping={!!on} />{on ? 'Site fermé au public' : 'Site en ligne'}</Badge>
            )}
          </div>
          <div className="text-[12.5px] text-fg3 mt-0.5">
            Ferme le site public derrière une page de maintenance premium. Le Dashboard et l'API restent accessibles. Effet en moins de 30 secondes, réversible à tout moment.
          </div>
        </div>
        {on != null && <Switch checked={on} onChange={(v) => setConfirm(v)} />}
      </Card>

      <Modal open={confirm != null} onClose={() => setConfirm(null)}>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <span className={`grid place-items-center h-10 w-10 rounded-xl ${confirm ? 'bg-warn/12 text-warn' : 'bg-ok/12 text-ok'}`}>
              <Icon name={confirm ? 'alert' : 'checkCircle'} size={18} />
            </span>
            <div>
              <div className="text-[15px] font-semibold">{confirm ? 'Fermer le site au public ?' : 'Rouvrir le site au public ?'}</div>
              <div className="text-[12.5px] text-fg3">
                {confirm ? 'Tous les visiteurs verront la page de maintenance.' : 'Le site redeviendra accessible à tous.'}
              </div>
            </div>
          </div>
          <div className="flex gap-2.5 mt-5">
            <Button className="flex-1" onClick={() => setConfirm(null)}>Annuler</Button>
            <Button variant={confirm ? 'danger' : 'primary'} className="flex-1" disabled={busy} onClick={() => void apply(!!confirm)}>
              {busy ? 'Application…' : confirm ? 'Activer la maintenance' : 'Rouvrir le site'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mt-4 first:mt-0">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[12.5px] font-medium text-fg2">{label}</span>
        {hint && <span className="text-[11px] text-fg3">· {hint}</span>}
      </div>
      {children}
    </label>
  );
}
