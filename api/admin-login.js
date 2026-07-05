// Connexion admin : vérifie le mot de passe (comparaison à temps constant),
// pose un cookie de session signé. Petit délai anti-force-brute.
import crypto from 'crypto';
import { issueToken, cookieHeader } from './_admin-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const pw   = (req.body && req.body.password) != null ? String(req.body.password) : '';
  const real = process.env.ADMIN_PASSWORD || '';

  let ok = false;
  if (real.length > 0) {
    const a = Buffer.from(pw), b = Buffer.from(real);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  await new Promise(r => setTimeout(r, 400)); // ralentit les tentatives automatisées

  if (!ok) return res.status(401).json({ error: 'bad_password' });

  res.setHeader('Set-Cookie', cookieHeader(issueToken()));
  return res.status(200).json({ ok: true });
}
