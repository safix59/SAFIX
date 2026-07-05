// ─────────────────────────────────────────────────────────────────────────
// Auth admin — jeton signé (HMAC-SHA256) stocké dans un cookie httpOnly.
// Le navigateur ne peut PAS lire le cookie (httpOnly) → immunisé au vol via XSS.
// La clé Supabase n'est JAMAIS exposée : seules les routes /api/admin-* la lisent,
// côté serveur, après vérification du jeton.
// ─────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';

const SECRET  = process.env.ADMIN_SESSION_SECRET || '';
const COOKIE  = 'sfx_admin';
const TTL_SEC = 8 * 60 * 60; // session 8 h

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hmac(data) {
  return b64url(crypto.createHmac('sha256', SECRET).update(data).digest());
}

export function issueToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TTL_SEC * 1000 }));
  return payload + '.' + hmac(payload);
}

export function verifyToken(token) {
  if (!token || !SECRET) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = hmac(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' && Date.now() < exp;
  } catch { return false; }
}

export function cookieHeader(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_SEC}`;
}
export function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
export function getToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
}
export function requireAuth(req) {
  return verifyToken(getToken(req));
}
