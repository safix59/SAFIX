// ─────────────────────────────────────────────────────────────────────────
// Fonction admin CONSOLIDÉE (1 seule fonction serverless → limite Vercel free).
// Actions via ?action= : login | logout | data | visits.
// Sécurité : login vérifié côté serveur, cookie httpOnly signé ; data/visits
// exigent le cookie ; clé Supabase jamais exposée au navigateur.
// ─────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { issueToken, cookieHeader, clearCookieHeader, requireAuth } from './_admin-auth.js';
import { BOT_FACTS, botAnswer, botCatalogContext, botSuggest, conversationState } from './_bot-nlu.js';

const ORIGIN = 'https://safix59.fr';
const FLAGSHIP = [
  'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro',
  'iPhone 16', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15',
  'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14', 'iPhone 13', 'iPhone 12', 'iPhone 11',
];

// ── Upload d'une photo de chat vers Supabase Storage (bucket public `chat`) ──
// Compression faite côté client (canvas JPEG ≤1280px) → ici on valide + stocke.
async function uploadChatImage(S, K, session, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || m[2].length > 2_000_000) return null; // ~1,5 Mo binaire max
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const bin = Buffer.from(m[2], 'base64');
  const path = `${session}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const H = { apikey: K, Authorization: `Bearer ${K}` };
  // Bucket idempotent (409 = existe déjà, OK)
  await fetch(`${S}/storage/v1/bucket`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'chat', name: 'chat', public: true }),
  }).catch(() => {});
  const up = await fetch(`${S}/storage/v1/object/chat/${path}`, {
    method: 'POST', headers: { ...H, 'Content-Type': `image/${m[1]}` }, body: bin,
  }).catch(() => null);
  if (!up || !up.ok) return null;
  return `${S}/storage/v1/object/public/chat/${path}`;
}

// ══ Assistant IA — CASCADE MULTI-FOURNISSEURS ancrée sur données vérifiées ══
// Une vraie intelligence, sans dépendre d'un seul service : on interroge le
// meilleur fournisseur DISPONIBLE (clé présente), et on descend la cascade en
// cas d'erreur/quota. Le moteur déterministe v5 reste le filet final (le site
// répond TOUJOURS, même sans aucune clé, même si toutes les API tombent).
//   1. Anthropic Claude   (ANTHROPIC_API_KEY — payant, qualité maximale)
//   2. Groq Llama-3.3-70B (GROQ_API_KEY     — GRATUIT, rapide, très bon FR)
//   3. Google Gemini      (GEMINI_API_KEY   — GRATUIT)
//   4. Mistral            (MISTRAL_API_KEY  — GRATUIT, français)
// Règle d'or inchangée : le LLM ne reçoit QUE des faits vérifiés (catalogue
// réel + infos du site) et a interdiction d'inventer — l'inconnu → humain.
const llmAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY
  || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY);

// fetch avec délai maximal (les fonctions Vercel ont 30 s au total : chaque
// fournisseur a droit à ~9 s, la cascade s'arrête au-delà de ~20 s cumulées).
async function llmFetch(url, init, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(to); }
}
// Sortie JSON robuste : certains modèles emballent le JSON dans ```json … ```.
function llmParse(text, schema) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (!schema) return s;
  const clean = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch {}
  // Dernier recours : extraire le premier objet/tableau JSON de la sortie.
  const m = clean.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

let _anthropic = null;
async function askClaude(system, messages, maxTokens = 400, schema = null) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    if (!_anthropic) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      _anthropic = new Anthropic({ timeout: 20000, maxRetries: 1 });
    }
    const req = {
      // ANTHROPIC_MODEL (env Vercel) permet de basculer sans code,
      // ex. claude-haiku-4-5 (≈ ⅕ du coût, très bon en support chat).
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: maxTokens,
      output_config: { effort: 'low' },   // chat support = sensible à la latence
      system,
      messages,
    };
    if (schema) req.output_config.format = { type: 'json_schema', schema };
    const resp = await _anthropic.messages.create(req);
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) return null;
    return schema ? llmParse(text, schema) : text;
  } catch { return null; }
}

// Fournisseurs à API « compatible OpenAI » (Groq, Mistral) — REST direct,
// zéro dépendance. json_object impose de mentionner « JSON » dans le prompt
// (nos prompts le font) ; llmParse re-vérifie de toute façon.
async function askOpenAICompat({ url, key, model }, system, messages, maxTokens, schema) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (schema) body.response_format = { type: 'json_object' };
  const r = await llmFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 9000);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return llmParse(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, schema);
}

// Google Gemini : rôles user/model en alternance stricte, premier tour = user
// → on fusionne les tours consécutifs et on ignore un éventuel tour assistant
// en tête (le message d'accueil du bot n'apporte rien au raisonnement).
async function askGemini(system, messages, maxTokens, schema) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (!contents.length && role === 'model') continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n' + m.content;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  if (!contents.length) return null;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4, ...(schema ? { responseMimeType: 'application/json' } : {}) },
  };
  const r = await llmFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    9000,
  );
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const text = j && j.candidates && j.candidates[0] && j.candidates[0].content
    && j.candidates[0].content.parts && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  return llmParse(text, schema);
}

// La cascade elle-même. `schema` (optionnel) → sortie structurée garantie :
// {reply, escalate} pour le bot, {suggestions[]} pour l'assistant admin.
async function askLLM(system, messages, maxTokens = 400, schema = null) {
  const t0 = Date.now();
  const budget = () => Date.now() - t0 < 20000; // garde 10 s pour le reste du handler
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await askClaude(system, messages, maxTokens, schema);
      if (r) return r;
    }
    if (budget() && process.env.GROQ_API_KEY) {
      const r = await askOpenAICompat({
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      }, system, messages, maxTokens, schema).catch(() => null);
      if (r) return r;
    }
    if (budget() && process.env.GEMINI_API_KEY) {
      const r = await askGemini(system, messages, maxTokens, schema).catch(() => null);
      if (r) return r;
    }
    if (budget() && process.env.MISTRAL_API_KEY) {
      const r = await askOpenAICompat({
        url: 'https://api.mistral.ai/v1/chat/completions',
        key: process.env.MISTRAL_API_KEY,
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
      }, system, messages, maxTokens, schema).catch(() => null);
      if (r) return r;
    }
  } catch { /* le filet déterministe prend la suite */ }
  return null;
}

// Cache prix (prices.json) — SEUL morceau réseau du bot : le moteur NLU
// (botAnswer / botCatalogContext, api/_bot-nlu.js) est pur et reçoit `prices`.
let _botPrices = { doc: null, ts: 0 };
async function botPrices() {
  if (_botPrices.doc && Date.now() - _botPrices.ts < 300000) return _botPrices.doc;
  const doc = await getJson('/scraper/prices.json');
  if (doc && doc.prices) _botPrices = { doc, ts: Date.now() };
  return _botPrices.doc;
}
async function getJson(path, ms = 8000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(ORIGIN + path, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(to); }
}

// Sépare un en-tête « From » (« "Jean Dupont" <jean@x.fr> ») en {name,email}.
function parseFrom(raw) {
  const s = String(raw || '').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: (m[1] || '').trim() || null, email: (m[2] || '').trim().toLowerCase() || null };
  if (/@/.test(s)) return { name: null, email: s.toLowerCase() };
  return { name: s || null, email: null };
}

// ── Boîte support : stockage dans la table `settings` (clé support_emails) ──
// Pas de table dédiée à créer : `settings` existe déjà (cartes, géo-zone,
// maintenance…) → zéro migration côté Supabase. Volume faible (quelques
// e-mails/semaine) : un document JSON {seq, list} suffit, liste plafonnée.
const EMAILS_KEY = 'support_emails';
const EMAILS_MAX = 120;        // e-mails conservés (les plus récents)
const EMAIL_BODY_MAX = 5000;   // longueur max du corps stocké
async function readEmailDoc(S, K) {
  const r = await fetch(`${S}/rest/v1/settings?select=value&key=eq.${EMAILS_KEY}`,
    { headers: { apikey: K, Authorization: `Bearer ${K}` } });
  if (r.status === 404) return null; // table settings absente (ne devrait pas arriver)
  if (!r.ok) throw new Error('http_' + r.status);
  const rows = await r.json().catch(() => []);
  const v = Array.isArray(rows) && rows[0] && rows[0].value;
  return (v && Array.isArray(v.list)) ? { seq: Number(v.seq) || 1, list: v.list } : { seq: 1, list: [] };
}
async function writeEmailDoc(S, K, doc) {
  const r = await fetch(`${S}/rest/v1/settings?on_conflict=key`, {
    method: 'POST',
    headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: EMAILS_KEY, value: doc, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = (req.query && req.query.action) || (req.body && req.body.action) || '';

  // ── LOGIN ──
  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const pw = (req.body && req.body.password) != null ? String(req.body.password) : '';
    const real = process.env.ADMIN_PASSWORD || '';
    // Config incomplète → erreur franche plutôt qu'un cookie qui ne validera
    // jamais (le login « réussirait » puis tout renverrait 401 : déroutant).
    if (!process.env.ADMIN_SESSION_SECRET) return res.status(500).json({ error: 'server_config' });
    // ── Verrouillage progressif anti force-brute (état dans la table settings,
    // clé login_guard = {fails, first, until}). 8 échecs / 10 min → blocage
    // 15 min. Un login réussi remet à zéro. DB indisponible → on n'enferme
    // jamais l'admin dehors (fail-open), le délai de 400 ms reste.
    const SUPA = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_SERVICE_ROLE;
    const gHead = SUPA && SKEY ? { apikey: SKEY, Authorization: `Bearer ${SKEY}` } : null;
    let guard = { fails: 0, first: 0, until: 0 };
    if (gHead) {
      try {
        const r = await fetch(`${SUPA}/rest/v1/settings?select=value&key=eq.login_guard`, { headers: gHead });
        const rows = r.ok ? await r.json() : [];
        if (Array.isArray(rows) && rows[0] && rows[0].value) guard = { fails: 0, first: 0, until: 0, ...rows[0].value };
      } catch {}
    }
    const now = Date.now();
    if (guard.until && now < guard.until) {
      await new Promise(r => setTimeout(r, 400));
      return res.status(429).json({ error: 'locked', retry_minutes: Math.ceil((guard.until - now) / 60000) });
    }
    let ok = false;
    if (real.length > 0) {
      const a = Buffer.from(pw), b = Buffer.from(real);
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    await new Promise(r => setTimeout(r, 400));
    if (gHead) {
      try {
        let next;
        if (ok) next = { fails: 0, first: 0, until: 0 };
        else {
          const windowOk = guard.first && now - guard.first < 600000;
          const fails = windowOk ? guard.fails + 1 : 1;
          next = { fails, first: windowOk ? guard.first : now, until: fails >= 8 ? now + 900000 : 0 };
        }
        await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
          method: 'POST',
          headers: { ...gHead, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ key: 'login_guard', value: next }),
        });
      } catch {}
    }
    if (!ok) return res.status(401).json({ error: 'bad_password' });
    res.setHeader('Set-Cookie', cookieHeader(issueToken()));
    return res.status(200).json({ ok: true });
  }

  // ── LOGOUT ──
  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearCookieHeader());
    return res.status(200).json({ ok: true });
  }

  // ── GÉO-ZONE (PUBLIC, lecture) : le site client lit la config de zone ──
  // d'intervention (centre + rayon). Aucune donnée sensible → pas d'auth.
  if (action === 'geo') {
    const def = { enabled: true, lat: 51.0344, lng: 2.3768, radiusKm: 30, city: 'Dunkerque' };
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    if (!S || !K) return res.status(200).json({ ok: true, geo: def });
    try {
      const r = await fetch(`${S}/rest/v1/settings?select=value&key=eq.geozone`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0] && rows[0].value)
          return res.status(200).json({ ok: true, geo: Object.assign(def, rows[0].value) });
      }
    } catch { /* table absente / réseau → défauts */ }
    return res.status(200).json({ ok: true, geo: def });
  }

  // ── CMS CARTES — config publique (lue par le site à chaque visite) ──
  if (action === 'cards') {
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    if (!S || !K) return res.status(200).json({ ok: true, cards: {} });
    try {
      const r = await fetch(`${S}/rest/v1/settings?select=value,updated_at&key=eq.cards_config`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } });
      if (r.ok) {
        const rows = await r.json();
        const v = Array.isArray(rows) && rows[0] ? rows[0] : null;
        return res.status(200).json({ ok: true, cards: (v && v.value && v.value.cards) || {}, updated_at: v && v.updated_at });
      }
    } catch { /* fail-open : site sans surcharges */ }
    return res.status(200).json({ ok: true, cards: {} });
  }

  // ── MESSAGERIE — envoi d'un message par le visiteur (PUBLIC) ──
  if (action === 'msg-send') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    const b = req.body || {};
    const session = String(b.session || '').slice(0, 60);
    let body = String(b.body || '').trim().slice(0, 2000);
    const name = b.name ? String(b.name).slice(0, 80) : null;
    if (!session || (!body && !b.image)) return res.status(400).json({ error: 'invalid' });
    if (!S || !K) return res.status(200).json({ ok: false });
    try {
      // Anti-spam : max 10 messages visiteur / minute et par session.
      // DB muette → on laisse passer (jamais de client légitime bloqué).
      try {
        const since = new Date(Date.now() - 60000).toISOString();
        const rc = await fetch(`${S}/rest/v1/messages?select=id&session=eq.${encodeURIComponent(session)}&sender=eq.user&created_at=gte.${encodeURIComponent(since)}`, {
          headers: { apikey: K, Authorization: `Bearer ${K}`, Prefer: 'count=exact', Range: '0-0' },
        });
        const total = Number((rc.headers.get('content-range') || '').split('/')[1] || 0);
        if (total >= 10) return res.status(429).json({ error: 'too_many' });
      } catch {}
      if (b.image) {
        const url = await uploadChatImage(S, K, session, b.image);
        if (!url && !body) return res.status(400).json({ error: 'image_invalid' });
        if (url) body = '::img::' + url + (body ? '\n' + body : '');
      }
      const r = await fetch(`${S}/rest/v1/messages`, {
        method: 'POST',
        headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ session, sender: 'user', body, name, read_admin: false, read_user: true }),
      });
      const j = await r.json().catch(() => null);
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok, message: Array.isArray(j) ? j[0] : null });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MESSAGERIE — conversation du visiteur (PUBLIC, par identifiant de session) ──
  if (action === 'msg-list') {
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    const session = String((req.query && req.query.session) || '').slice(0, 60);
    if (!session) return res.status(400).json({ error: 'no_session' });
    if (!S || !K) return res.status(200).json({ ready: false, messages: [] });
    try {
      const r = await fetch(`${S}/rest/v1/messages?select=id,sender,body,created_at,read_admin&session=eq.${encodeURIComponent(session)}&order=created_at.asc&limit=200`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } });
      if (r.status === 404) return res.status(200).json({ ready: false, messages: [] });
      const rows = await r.json().catch(() => []);
      // Marque les réponses admin comme lues côté visiteur (fire-and-forget).
      fetch(`${S}/rest/v1/messages?session=eq.${encodeURIComponent(session)}&sender=eq.admin&read_user=eq.false`,
        { method: 'PATCH', headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ read_user: true }) }).catch(() => {});
      return res.status(200).json({ ready: true, messages: Array.isArray(rows) ? rows : [] });
    } catch (e) { return res.status(200).json({ ready: false, messages: [] }); }
  }

  // ── ASSISTANT IA (PUBLIC) : réponse déterministe catalogue + FAQ ──
  // Ne répond QUE si aucun conseiller humain n'est engagé dans le fil.
  // N'invente jamais : prix/stocks lus dans prices.json, sinon → conseiller.
  if (action === 'bot') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    const b = req.body || {};
    const session = String(b.session || '').slice(0, 60);
    const message = String(b.message || '').trim().slice(0, 1000);
    if (!session || !message) return res.status(400).json({ error: 'invalid' });
    if (!S || !K) return res.status(200).json({ ok: false });
    try {
      // Un humain a-t-il pris la main ? (message admin sans ::bot::, ou demande ::human::)
      let rows = [];
      const th = await fetch(`${S}/rest/v1/messages?select=sender,body,created_at&session=eq.${encodeURIComponent(session)}&order=created_at.desc&limit=40`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } });
      if (th.ok) {
        rows = await th.json();
        if (!Array.isArray(rows)) rows = [];
        for (const m of rows) {
          if (m.body === '::human::') return res.status(200).json({ ok: true, human: true });
          if (m.sender === 'admin' && String(m.body || '').indexOf('::bot::') !== 0) return res.status(200).json({ ok: true, human: true });
        }
      }
      // Anti-spam assistant : max 8 sollicitations / minute par session.
      const cut = Date.now() - 60000;
      const recent = rows.filter((m) => m.sender === 'user' && m.created_at && new Date(m.created_at).getTime() > cut).length;
      if (recent >= 8) return res.status(429).json({ error: 'too_many' });
      // Prix (prices.json) chargés une fois, injectés dans le moteur pur.
      const pricesDoc = await botPrices();
      const prices = (pricesDoc && pricesDoc.prices) || null;
      // 1) Réponse déterministe (repli garanti + ancrage anti-hallucination)
      const det = botAnswer(message, rows, prices);
      // 2) Réponse IA ancrée (cascade multi-fournisseurs) : historique + catalogue réel
      let reply = null;
      if (llmAvailable()) {
        const hist = rows.slice(0, 16).reverse()
          .filter((m) => m.body !== '::human::')
          .map((m) => ({
            role: m.sender === 'admin' ? 'assistant' : 'user',
            content: String(m.body || '').replace(/^::bot::/, '').replace(/^::img::\S+\n?/, '[photo envoyée] '),
          }))
          .filter((m) => m.content.trim());
        const userTexts = [message, ...rows.filter((m) => m.sender === 'user').map((m) => String(m.body || ''))];
        const catalog = botCatalogContext(userTexts, prices);
        const system = BOT_FACTS
          + (catalog ? `\n\n${catalog}` : '\n\nAucune donnée catalogue disponible pour cette conversation (aucun modèle identifié). Ne cite AUCUN prix.')
          + `\n\nRÉPONSE DE RÉFÉRENCE du moteur catalogue (fiable et vérifiée) au dernier message : « ${det.reply} ».`
          + `\nSi cette référence ou les DONNÉES CATALOGUE contiennent un PRIX ou une DISPONIBILITÉ, tu DOIS reprendre ces montants EXACTS dans ta réponse (reformulés naturellement et chaleureusement) — n'esquive JAMAIS avec « consultez le site » ou « différentes options » quand tu connais le prix. Sois concret et précis.`
          + `\n\nRéponds en JSON : {"reply": ta réponse au client, "escalate": true si un conseiller humain doit être proposé (règle 7), sinon false}.`;
        const msgs = [...hist];
        if (!msgs.length || msgs[msgs.length - 1].role !== 'user' || msgs[msgs.length - 1].content.trim() !== message) {
          msgs.push({ role: 'user', content: message });
        }
        const out = await askLLM(system, msgs, 500, {
          type: 'object',
          properties: {
            reply: { type: 'string', description: 'La réponse à afficher au client (français, vouvoiement).' },
            escalate: { type: 'boolean', description: 'true si la conversation doit être orientée vers un conseiller humain.' },
          },
          required: ['reply', 'escalate'],
          additionalProperties: false,
        });
        if (out && typeof out.reply === 'string' && out.reply.trim()) reply = out.reply.trim();
        var llmEscalate = !!(out && out.escalate);
        // GARDE-FOU anti-perte d'info : le moteur catalogue a un PRIX concret
        // mais le LLM l'a esquivé (« consultez le site ») → on garde la réponse
        // déterministe, précise et vérifiée. Le concret prime sur le style.
        if (reply && /\d+\s*€/.test(det.reply) && !/\d+\s*€/.test(reply)) {
          reply = det.reply;
          llmEscalate = !!det.human;
        }
      }
      const finalReply = reply || det.reply;
      const human = reply ? llmEscalate : !!det.human;
      await fetch(`${S}/rest/v1/messages`, {
        method: 'POST',
        headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ session, sender: 'admin', body: '::bot::' + finalReply, read_admin: true, read_user: false }),
      });
      return res.status(200).json({ ok: true, reply: finalReply, human });
    } catch (e) { return res.status(200).json({ ok: false }); }
  }

  // ── PRÉSENCE ADMIN (PUBLIC) : le widget de chat sait si l'admin est en messagerie ──
  if (action === 'presence') {
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    if (!S || !K) return res.status(200).json({ online: false });
    try {
      const r = await fetch(`${S}/rest/v1/settings?select=updated_at&key=eq.admin_presence`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0] && rows[0].updated_at) {
          const age = Date.now() - new Date(rows[0].updated_at).getTime();
          return res.status(200).json({ online: age < 70000 }); // vu il y a moins de 70 s
        }
      }
    } catch { /* défaut hors ligne */ }
    return res.status(200).json({ online: false });
  }

  // ── E-MAILS SUPPORT — RÉCEPTION (PUBLIC, jeton partagé) ──
  // Un service de parsing d'e-mails (Cloudflare Email Worker, Pipedream, Zapier
  // « Email Parser »…) POST ici chaque message reçu sur support@safix59.fr.
  // Sécurité : jeton secret (en-tête « x-inbound-token » de préférence, sinon
  // ?token=), JAMAIS le cookie admin. Le corps est du JSON ; on tolère les noms
  // de champs les plus courants d'un service à l'autre.
  if (action === 'inbound-email') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const secret = process.env.INBOUND_EMAIL_TOKEN || '';
    if (!secret) return res.status(500).json({ error: 'server_config' }); // jeton non configuré
    const given = String((req.headers && req.headers['x-inbound-token']) || (req.query && req.query.token) || '');
    let ok = false;
    if (given.length > 0) { const a = Buffer.from(given), b = Buffer.from(secret); ok = a.length === b.length && crypto.timingSafeEqual(a, b); }
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
    const S = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE;
    if (!S || !K) return res.status(500).json({ error: 'supabase_absent' });
    const p = (req.body && typeof req.body === 'object') ? req.body : {};
    const hdr = (p.headers && typeof p.headers === 'object') ? p.headers : {};
    // Tolérant : cherche dans le corps puis dans les en-têtes ; certains
    // services envoient `from` en objet ({text, value:[{address,name}]}).
    const pick = (...keys) => {
      for (const k of keys) {
        let v = p[k] != null ? p[k] : (hdr[k] != null ? hdr[k] : hdr[k.toLowerCase()]);
        if (v == null) continue;
        if (typeof v === 'object') v = v.text || (Array.isArray(v.value) && v.value[0] && `${v.value[0].name || ''} <${v.value[0].address || ''}>`) || '';
        if (String(v).trim() !== '') return String(v);
      }
      return '';
    };
    const f = parseFrom(pick('from', 'sender', 'From', 'from_email', 'email'));
    const from_email = (pick('from_email') || f.email || '').toLowerCase() || null;
    const from_name = pick('from_name', 'fromName') || f.name;
    const subject = (pick('subject', 'Subject', 'sujet').slice(0, 500)) || '(sans objet)';
    const textRaw = pick('text', 'body', 'plain', 'body-plain', 'stripped-text', 'snippet', 'html');
    const text = textRaw.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    let received_at = new Date().toISOString();
    const dRaw = pick('date', 'Date', 'received_at', 'timestamp');
    if (dRaw) { const d = new Date(dRaw); if (!isNaN(d.getTime())) received_at = d.toISOString(); }
    const message_id = pick('message_id', 'Message-Id', 'messageId', 'message-id').slice(0, 300) || null;
    try {
      const doc = await readEmailDoc(S, K);
      if (!doc) return res.status(200).json({ ok: false, reason: 'table_absente' });
      // Anti-doublon : une même livraison (même Message-Id) n'est insérée qu'une fois.
      if (message_id && doc.list.some((e) => e.message_id === message_id))
        return res.status(200).json({ ok: true, duplicate: true });
      doc.list.unshift({
        id: doc.seq, received_at, from_email, from_name: from_name || null, subject,
        preview: text.slice(0, 280), body: text.slice(0, EMAIL_BODY_MAX) || null,
        status: 'non_lu', message_id,
      });
      doc.seq += 1;
      doc.list = doc.list.slice(0, EMAILS_MAX);
      const ok = await writeEmailDoc(S, K, doc);
      return res.status(ok ? 200 : 500).json({ ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── (tout le reste exige l'authentification) ──
  if (!requireAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  const SUPA = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;

  // ── SUPPRIMER UNE COMMANDE (nettoyage des tests, contrôle propriétaire) ──
  // ── PRÉSENCE ADMIN (battement) : marque l'admin « en ligne » depuis la messagerie ──
  if (action === 'admin-ping') {
    if (!SUPA || !KEY) return res.status(200).json({ ok: false });
    try {
      const r = await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'admin_presence', value: {}, updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: r.ok });
    } catch (e) { return res.status(200).json({ ok: false }); }
  }

  // ── MODE MAINTENANCE — lecture / bascule depuis le Dashboard ──
  if (action === 'maintenance-get') {
    if (!SUPA || !KEY) return res.status(200).json({ ok: true, on: false });
    try {
      const r = await fetch(`${SUPA}/rest/v1/settings?select=value,updated_at&key=eq.maintenance`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.ok) {
        const rows = await r.json();
        return res.status(200).json({ ok: true, on: !!(rows[0] && rows[0].value && rows[0].value.on), since: rows[0]?.updated_at || null });
      }
    } catch { /* défaut off */ }
    return res.status(200).json({ ok: true, on: false });
  }
  if (action === 'maintenance-set') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const on = !!(req.body && req.body.on);
    try {
      const r = await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'maintenance', value: { on }, updated_at: new Date().toISOString() }),
      });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok, on });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── E-MAILS SUPPORT — liste pour le Dashboard + compteur de non-lus ──
  if (action === 'emails') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false, emails: [], unread: 0 });
    try {
      const doc = await readEmailDoc(SUPA, KEY);
      if (!doc) return res.status(200).json({ ready: false, emails: [], unread: 0, reason: 'table_absente' });
      const emails = [...doc.list].sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
      return res.status(200).json({ ready: true, emails, unread: emails.filter((e) => e.status === 'non_lu').length });
    } catch (e) { return res.status(200).json({ ready: false, emails: [], unread: 0, reason: e.message }); }
  }

  // ── E-MAILS SUPPORT — changer le statut (non_lu | lu | traite) d'un ou plusieurs ──
  if (action === 'email-status') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const b = req.body || {};
    const status = ['non_lu', 'lu', 'traite'].includes(b.status) ? b.status : null;
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite)
      : (Number.isFinite(Number(b.id)) ? [Number(b.id)] : []);
    if (!status || !ids.length) return res.status(400).json({ error: 'invalid' });
    try {
      const doc = await readEmailDoc(SUPA, KEY);
      if (!doc) return res.status(500).json({ error: 'table_absente' });
      doc.list = doc.list.map((e) => (ids.includes(e.id) ? { ...e, status } : e));
      const ok = await writeEmailDoc(SUPA, KEY, doc);
      return res.status(ok ? 200 : 500).json({ ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── E-MAILS SUPPORT — suppression (nettoyage) ──
  if (action === 'email-del') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite)
      : (Number.isFinite(Number(b.id)) ? [Number(b.id)] : []);
    if (!ids.length) return res.status(400).json({ error: 'invalid' });
    try {
      const doc = await readEmailDoc(SUPA, KEY);
      if (!doc) return res.status(500).json({ error: 'table_absente' });
      doc.list = doc.list.filter((e) => !ids.includes(e.id));
      const ok = await writeEmailDoc(SUPA, KEY, doc);
      return res.status(ok ? 200 : 500).json({ ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MESSAGERIE ADMIN — liste des conversations (groupées par session) ──
  if (action === 'msg-threads') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false, threads: [], total_unread: 0 });
    try {
      const r = await fetch(`${SUPA}/rest/v1/messages?select=*&order=created_at.desc&limit=3000`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.status === 404) return res.status(200).json({ ready: false, threads: [], total_unread: 0 });
      const rows = await r.json().catch(() => []);
      const map = new Map();
      for (const m of (Array.isArray(rows) ? rows : [])) {
        let t = map.get(m.session);
        if (!t) { t = { session: m.session, name: null, last: m, count: 0, unread: 0 }; map.set(m.session, t); }
        t.count++;
        if (m.name && !t.name) t.name = m.name;
        if (new Date(m.created_at) > new Date(t.last.created_at)) t.last = m;
        if (m.sender === 'user' && !m.read_admin) t.unread++;
      }
      const threads = [...map.values()]
        .map((t) => ({ session: t.session, name: t.name, last_body: t.last.body, last_sender: t.last.sender, last_ts: t.last.created_at, unread: t.unread, count: t.count }))
        .sort((a, b) => new Date(b.last_ts) - new Date(a.last_ts));
      return res.status(200).json({ ready: true, threads, total_unread: threads.reduce((s, t) => s + t.unread, 0) });
    } catch (e) { return res.status(200).json({ ready: false, threads: [], total_unread: 0, reason: e.message }); }
  }

  // ── MESSAGERIE ADMIN — une conversation + marque les messages visiteur comme lus ──
  if (action === 'msg-thread') {
    const session = String((req.query && req.query.session) || '');
    if (!session) return res.status(400).json({ error: 'no_session' });
    if (!SUPA || !KEY) return res.status(200).json({ messages: [] });
    try {
      const r = await fetch(`${SUPA}/rest/v1/messages?select=id,sender,body,name,created_at&session=eq.${encodeURIComponent(session)}&order=created_at.asc&limit=500`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      const rows = await r.json().catch(() => []);
      fetch(`${SUPA}/rest/v1/messages?session=eq.${encodeURIComponent(session)}&sender=eq.user&read_admin=eq.false`,
        { method: 'PATCH', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ read_admin: true }) }).catch(() => {});
      return res.status(200).json({ messages: Array.isArray(rows) ? rows : [] });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MESSAGERIE ADMIN — répondre à un visiteur (texte et/ou photo) ──
  if (action === 'msg-reply') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const b = req.body || {};
    const session = String(b.session || '').slice(0, 60);
    let body = String(b.body || '').trim().slice(0, 2000);
    if (!session || (!body && !b.image)) return res.status(400).json({ error: 'invalid' });
    try {
      if (b.image) {
        const url = await uploadChatImage(SUPA, KEY, session, b.image);
        if (!url && !body) return res.status(400).json({ error: 'image_invalid' });
        if (url) body = '::img::' + url + (body ? '\n' + body : '');
      }
      const r = await fetch(`${SUPA}/rest/v1/messages`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ session, sender: 'admin', body, read_admin: true, read_user: false }),
      });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MESSAGERIE ADMIN — suggestions de réponses générées par l'IA (cascade) ──
  if (action === 'suggest') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(200).json({ ready: false, suggestions: [] });
    const session = String((req.body && req.body.session) || '').slice(0, 60);
    if (!session) return res.status(400).json({ error: 'no_session' });
    try {
      const r = await fetch(`${SUPA}/rest/v1/messages?select=sender,body,name&session=eq.${encodeURIComponent(session)}&order=created_at.desc&limit=20`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      let rows = r.ok ? await r.json() : [];
      if (!Array.isArray(rows)) rows = [];
      const name = (rows.find((m) => m.name) || {}).name || null;
      const pd = await botPrices();
      const prices = (pd && pd.prices) || null;
      // Base DÉTERMINISTE, toujours disponible : slot-aware, ne redemande
      // jamais une info déjà donnée. C'est ce qui s'affiche sans clé LLM, et
      // le filet si le LLM échoue.
      const det = botSuggest(rows, prices, name);

      // Si une IA est branchée : raisonnement plus fin, ancré sur le même état.
      if (llmAvailable()) {
        const transcript = rows.slice().reverse()
          .filter((m) => m.body !== '::human::')
          .map((m) => `${m.sender === 'admin' ? 'SAFIX' : 'Client'}: ${String(m.body || '').replace(/^::bot::/, '[assistant] ').replace(/^::img::\S+\n?/, '[photo] ')}`)
          .join('\n').slice(-3000);
        const userTexts = rows.filter((m) => m.sender === 'user').map((m) => String(m.body || ''));
        const catalog = botCatalogContext(userTexts, prices);
        const st = conversationState(rows, prices);
        const userCount = st.userCount;
        const isOpening = userCount <= 1 && !st.weReplied;
        const known = [
          st.model ? `modèle = ${st.model}` : null,
          st.repairLabel ? `panne/réparation = ${st.repairLabel}` : null,
          st.priceQuoted ? 'un prix a DÉJÀ été annoncé' : null,
          st.rdvMentioned ? 'le rendez-vous a DÉJÀ été évoqué' : null,
        ].filter(Boolean);
        const system = BOT_FACTS
          + (catalog ? `\n\n${catalog}` : '')
          + `\n\nTU RÉDIGES POUR L'ADMINISTRATEUR HUMAIN (le réparateur${name ? `, le client s'appelle ${name}` : ''}), comme un conseiller SAV expérimenté.
STADE : ${isOpening ? 'tout premier contact (une salutation brève est appropriée).' : `conversation DÉJÀ EN COURS (${userCount} messages client).`}
INFORMATIONS DÉJÀ FOURNIES PAR LE CLIENT : ${known.length ? known.join(' ; ') : 'aucune pour l\'instant'}.
${isOpening ? '' : `RÈGLES DE CONTEXTE STRICTES :
- INTERDICTION de saluer/te présenter (« Bonjour, comment puis-je vous aider ? » est PROSCRIT).
- INTERDICTION de redemander une information DÉJÀ FOURNIE (listée ci-dessus). Avant chaque phrase, demande-toi : « cette info a-t-elle déjà été donnée ? » Si oui, ne la redemande pas.
- Fais AVANCER l'échange : confirmer la prise en charge, expliquer la prochaine étape, proposer un rendez-vous, donner l'estimation, rassurer, orienter vers une action — et ne demander QUE ce qui manque réellement.`}
Propose EXACTEMENT 3 réponses possibles au dernier message du client, VRAIMENT DIFFÉRENTES et prêtes à envoyer :
(1) directe et efficace, (2) chaleureuse et accompagnante, (3) une action concrète (rendez-vous, commande) ou une question UNIQUEMENT sur une info manquante.
1-3 phrases chacune, français, vouvoiement, sans placeholder.
Réponds UNIQUEMENT en JSON : {"suggestions": ["…", "…", "…"]}`;
        const out = await askLLM(system, [{ role: 'user', content: `Conversation :\n${transcript}\n\nGénère les 3 suggestions.` }], 700, {
          type: 'object',
          properties: { suggestions: { type: 'array', items: { type: 'string' }, description: '3 réponses prêtes à envoyer au client.' } },
          required: ['suggestions'],
          additionalProperties: false,
        });
        const llm = (out && Array.isArray(out.suggestions) ? out.suggestions : []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 3);
        if (llm.length) return res.status(200).json({ ready: true, suggestions: llm, source: 'llm' });
      }
      return res.status(200).json({ ready: det.length > 0, suggestions: det, source: 'engine' });
    } catch { return res.status(200).json({ ready: false, suggestions: [] }); }
  }

  // ── RÉÉCRITURE IA d'un message admin (correction + reformulation) ──
  // Transforme le brouillon du réparateur en message propre, sans JAMAIS
  // inventer d'information (prix, délai…) absente du texte. Ton au choix.
  if (action === 'rewrite') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!llmAvailable()) return res.status(200).json({ ok: false, reason: 'no_llm' });
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'empty' });
    const tone = ['client', 'pro', 'interne'].includes(b.tone) ? b.tone : 'client';
    const clientFacing = tone !== 'interne';
    const toneDesc = tone === 'pro' ? 'sobre, professionnel et direct'
      : tone === 'interne' ? 'concis et factuel (note interne entre collègues, PAS destinée au client)'
      : 'chaleureux, rassurant et orienté service client';
    const system = `Tu es l'assistant d'écriture de SAFIX (réparation d'iPhone à Dunkerque). Tu reçois un message rédigé rapidement par le réparateur${clientFacing ? ' et destiné à un CLIENT' : ' (note interne)'}. Réécris-le pour qu'il soit clair, correct et naturel.
RÈGLES ABSOLUES :
- Corrige l'orthographe, la grammaire, la ponctuation ; améliore la formulation et la fluidité.
- GARDE le sens EXACT et TOUTES les informations du message. N'AJOUTE AUCUNE information : aucun prix, délai, adresse, garantie ou promesse qui n'est pas déjà dans le texte. Ne supprime aucune info.
- Reste CONCIS : ne rallonge pas inutilement.
- ${clientFacing ? 'Vouvoiement. ' : ''}Ton ${toneDesc}.
- Si le texte est déjà correct, ne le change qu'à la marge.
- Écris dans la MÊME langue que le message d'origine.
Réponds UNIQUEMENT avec le message réécrit — aucun préambule, aucune explication, aucun guillemet, aucune liste d'options.`;
    try {
      const out = await askLLM(system, [{ role: 'user', content: text }], 600);
      const improved = (typeof out === 'string' ? out : '').trim().replace(/^["'«»\s]+|["'«»\s]+$/g, '');
      if (!improved) return res.status(200).json({ ok: false, reason: 'no_output' });
      return res.status(200).json({ ok: true, text: improved });
    } catch (e) { return res.status(200).json({ ok: false, reason: 'error' }); }
  }

  // ── MESSAGERIE ADMIN — suppression (message(s) / conversation entière) ──
  if (action === 'msg-del') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 200);
    if (!ids.length) return res.status(400).json({ error: 'no_ids' });
    try {
      const r = await fetch(`${SUPA}/rest/v1/messages?id=in.(${ids.join(',')})`,
        { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok, count: ids.length });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (action === 'msg-del-thread') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const session = String((req.body && req.body.session) || '').slice(0, 60);
    if (!session) return res.status(400).json({ error: 'no_session' });
    try {
      const r = await fetch(`${SUPA}/rest/v1/messages?session=eq.${encodeURIComponent(session)}`,
        { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (action === 'order-del') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const id = (req.query && req.query.id) || (req.body && req.body.id);
    if (!id) return res.status(400).json({ error: 'id_manquant' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    try {
      const r = await fetch(`${SUPA}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── GÉO-ZONE (écriture, réservé admin) : enregistre centre + rayon ──
  if (action === 'geo-set') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const b = req.body || {};
    const value = {
      enabled: !!b.enabled,
      lat: Number.isFinite(+b.lat) ? +b.lat : 51.0344,
      lng: Number.isFinite(+b.lng) ? +b.lng : 2.3768,
      radiusKm: Math.max(1, Math.min(2000, +b.radiusKm || 30)),
      city: String(b.city || 'Dunkerque').slice(0, 60),
    };
    try {
      const r = await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'geozone', value, updated_at: new Date().toISOString() }),
      });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok, geo: value });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CMS CARTES — écriture (auth) : sauvegarde + instantané d'historique ──
  if (action === 'cards-set') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const b = req.body || {};
    const cards = (b.cards && typeof b.cards === 'object' && !Array.isArray(b.cards)) ? b.cards : null;
    if (!cards) return res.status(400).json({ error: 'invalid' });
    if (JSON.stringify(cards).length > 200000) return res.status(400).json({ error: 'too_large' });
    const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
    try {
      // 1) instantané de l'état actuel → historique (undo), 25 max
      const cur = await fetch(`${SUPA}/rest/v1/settings?select=value&key=eq.cards_config`, { headers: H });
      const curRows = cur.ok ? await cur.json() : [];
      const prev = (curRows[0] && curRows[0].value && curRows[0].value.cards) || {};
      const hi = await fetch(`${SUPA}/rest/v1/settings?select=value&key=eq.cards_history`, { headers: H });
      const hiRows = hi.ok ? await hi.json() : [];
      const snaps = ((hiRows[0] && hiRows[0].value && hiRows[0].value.snaps) || []);
      snaps.unshift({ ts: new Date().toISOString(), cards: prev, note: String(b.note || '').slice(0, 120) });
      await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'cards_history', value: { snaps: snaps.slice(0, 25) }, updated_at: new Date().toISOString() }),
      });
      // 2) sauvegarde de la nouvelle config
      const r = await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'cards_config', value: { cards }, updated_at: new Date().toISOString() }),
      });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CMS CARTES — historique des sauvegardes (auth) ──
  if (action === 'cards-history') {
    if (!SUPA || !KEY) return res.status(200).json({ ok: true, snaps: [] });
    try {
      const r = await fetch(`${SUPA}/rest/v1/settings?select=value&key=eq.cards_history`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      const rows = r.ok ? await r.json() : [];
      const snaps = ((rows[0] && rows[0].value && rows[0].value.snaps) || [])
        .map((s) => ({ ts: s.ts, note: s.note || '', count: Object.keys(s.cards || {}).length }));
      return res.status(200).json({ ok: true, snaps });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CMS CARTES — restauration d'un instantané (auth, undo) ──
  if (action === 'cards-restore') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!SUPA || !KEY) return res.status(500).json({ error: 'supabase_absent' });
    const ts = String((req.body || {}).ts || '');
    if (!ts) return res.status(400).json({ error: 'invalid' });
    const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
    try {
      const hi = await fetch(`${SUPA}/rest/v1/settings?select=value&key=eq.cards_history`, { headers: H });
      const hiRows = hi.ok ? await hi.json() : [];
      const snaps = ((hiRows[0] && hiRows[0].value && hiRows[0].value.snaps) || []);
      const snap = snaps.find((s) => s.ts === ts);
      if (!snap) return res.status(404).json({ error: 'not_found' });
      // l'état actuel devient lui-même un instantané (permet de re-annuler)
      const cur = await fetch(`${SUPA}/rest/v1/settings?select=value&key=eq.cards_config`, { headers: H });
      const curRows = cur.ok ? await cur.json() : [];
      const prev = (curRows[0] && curRows[0].value && curRows[0].value.cards) || {};
      snaps.unshift({ ts: new Date().toISOString(), cards: prev, note: 'avant restauration' });
      await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'cards_history', value: { snaps: snaps.slice(0, 25) }, updated_at: new Date().toISOString() }),
      });
      const r = await fetch(`${SUPA}/rest/v1/settings?on_conflict=key`, {
        method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'cards_config', value: { cards: snap.cards || {} }, updated_at: new Date().toISOString() }),
      });
      return res.status(r.ok ? 200 : 500).json({ ok: r.ok, cards: snap.cards || {} });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── LIVE (temps réel : qui est en ligne maintenant) ──
  if (action === 'live') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false });
    const since = new Date(Date.now() - 50 * 1000).toISOString(); // fenêtre 50 s
    try {
      const r = await fetch(`${SUPA}/rest/v1/visits?select=*&ts=gte.${since}&order=ts.desc&limit=800`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.status === 404 || !r.ok) return res.status(200).json({ ready: false });
      const rows = await r.json();
      const seen = new Map();
      for (const v of (Array.isArray(rows) ? rows : [])) {
        const key = v.session || v.ts;
        if (!seen.has(key)) seen.set(key, { path: v.path, country: v.country, city: v.city || v.region || null, device: v.device, device_model: v.device_model || null, ts: v.ts });
      }
      return res.status(200).json({ ready: true, online: seen.size, visitors: [...seen.values()].slice(0, 60) });
    } catch { return res.status(200).json({ ready: false }); }
  }

  // ── SESSIONS (supervision temps réel : une fiche par visiteur + parcours) ──
  if (action === 'sessions') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false, reason: 'supabase_absent' });
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // fenêtre 24 h
    let rows;
    try {
      const r = await fetch(`${SUPA}/rest/v1/visits?select=*&ts=gte.${since}&order=ts.asc&limit=20000`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.status === 404) return res.status(200).json({ ready: false, reason: 'table_absente' });
      if (!r.ok) return res.status(200).json({ ready: false, reason: 'http_' + r.status });
      rows = await r.json();
    } catch (e) { return res.status(200).json({ ready: false, reason: e.message }); }
    if (!Array.isArray(rows)) rows = [];
    const now = Date.now();
    const KEEP = ['country', 'region', 'city', 'device', 'device_model', 'source', 'browser', 'os', 'lang', 'ref_host'];
    const map = new Map();
    for (const v of rows) {
      const sid = v.session || ('_' + v.ts);
      let s = map.get(sid);
      if (!s) {
        s = { id: sid, first: v.ts, last: v.ts, hits: 0, pages: new Set(), journey: [], lat: null, lng: null };
        for (const k of KEEP) s[k] = null;
        map.set(sid, s);
      }
      s.hits++;
      if (v.ts < s.first) s.first = v.ts;
      if (v.ts > s.last) s.last = v.ts;
      for (const k of KEEP) if (v[k] != null && v[k] !== '') s[k] = v[k];
      if (Number.isFinite(v.lat)) s.lat = v.lat;
      if (Number.isFinite(v.lng)) s.lng = v.lng;
      if (v.kind !== 'ping') {
        const p = v.path || '/';
        s.pages.add(p);
        if (s.journey.length < 80) {
          const prev = s.journey[s.journey.length - 1];
          if (!prev || prev.path !== p) s.journey.push({ path: p, ts: v.ts });
        }
      }
    }
    const sessions = [...map.values()].map((s) => {
      const out = {
        id: s.id, lat: s.lat, lng: s.lng,
        first_ts: s.first, last_ts: s.last,
        duration_s: Math.max(0, Math.round((new Date(s.last).getTime() - new Date(s.first).getTime()) / 1000)),
        page_count: s.pages.size, hits: s.hits,
        live: now - new Date(s.last).getTime() < 60000,
        journey: s.journey,
      };
      for (const k of KEEP) out[k] = s[k];
      return out;
    });
    sessions.sort((a, b) => new Date(b.last_ts) - new Date(a.last_ts));
    return res.status(200).json({
      ready: true,
      now: new Date().toISOString(),
      online: sessions.filter((s) => s.live).length,
      total: sessions.length,
      sessions: sessions.slice(0, 600),
    });
  }

  // ── VISITS ──
  if (action === 'visits') {
    if (!SUPA || !KEY) return res.status(200).json({ ready: false, reason: 'supabase_absent' });
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    let rows;
    try {
      const r = await fetch(`${SUPA}/rest/v1/visits?select=*&ts=gte.${since}&order=ts.desc&limit=20000`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (r.status === 404) return res.status(200).json({ ready: false, reason: 'table_absente' });
      if (!r.ok) return res.status(200).json({ ready: false, reason: 'http_' + r.status });
      rows = await r.json();
    } catch (e) { return res.status(200).json({ ready: false, reason: e.message }); }
    if (!Array.isArray(rows)) rows = [];
    const today = new Date().toISOString().slice(0, 10);
    const byHour = Array(24).fill(0);
    const bySource = {}, byDevice = {}, byCountry = {}, byDay = {}, byPath = {}, byCity = {};

    // Une VISITE = une session unique (peu importe que la ligne soit 'view' ou 'ping').
    // rows est trié du plus récent au plus ancien : on garde 1 entrée par session.
    const sessions = new Map();
    for (const v of rows) {
      const sid = v.session || ('_' + v.ts); // sans session → chaque ligne = 1 visite
      if (!sessions.has(sid)) sessions.set(sid, v);
    }
    let todayCount = 0;
    for (const v of sessions.values()) {
      if (v.day === today) todayCount++;
      if (typeof v.hour === 'number' && v.hour >= 0 && v.hour < 24) byHour[v.hour]++;
      bySource[v.source || 'direct'] = (bySource[v.source || 'direct'] || 0) + 1;
      byDevice[v.device || 'desktop'] = (byDevice[v.device || 'desktop'] || 0) + 1;
      if (v.country) byCountry[v.country] = (byCountry[v.country] || 0) + 1;
      // Ville si dispo (plan Vercel Pro), sinon région (dispo en gratuit).
      const place = v.city || v.region;
      if (place) { const key = place + (v.country ? ' (' + v.country + ')' : ''); byCity[key] = (byCity[key] || 0) + 1; }
      if (v.day) byDay[v.day] = (byDay[v.day] || 0) + 1;
    }
    // Pages vues : on compte les vraies vues de page (pas les battements).
    for (const v of rows) { if (v.kind === 'ping') continue; const p = v.path || '/'; byPath[p] = (byPath[p] || 0) + 1; }
    // Points géo pour une éventuelle carte (dernières positions, dédupliquées par session).
    const geo = [];
    for (const v of sessions.values()) { if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) geo.push({ lat: v.lat, lng: v.lng, city: v.city || null }); }

    const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
    return res.status(200).json({
      ready: true, total_30d: sessions.size, today: todayCount, by_hour: byHour,
      by_source: topN(bySource, 8), by_device: topN(byDevice, 4), by_country: topN(byCountry, 10),
      by_city: topN(byCity, 12), by_path: topN(byPath, 10),
      geo: geo.slice(0, 300),
      by_day: Object.entries(byDay).sort().slice(-30).map(([k, v]) => ({ k, v })),
    });
  }

  // ── DATA (défaut) ──
  const alerts = [];
  const [ordersRaw, pricesDoc, links, hist] = await Promise.all([
    (async () => {
      if (!SUPA || !KEY) { alerts.push({ level: 'warn', msg: 'Supabase non configuré — commandes indisponibles.' }); return []; }
      try {
        const r = await fetch(`${SUPA}/rest/v1/orders?select=id,created_at,customer_email,total_cents,currency,status,utopya_order_id,line_items,metadata,error_message,stripe_payment_intent&order=created_at.desc&limit=500`,
          { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        if (!r.ok) { alerts.push({ level: 'error', msg: `Supabase HTTP ${r.status} — base injoignable.` }); return []; }
        const j = await r.json(); return Array.isArray(j) ? j : [];
      } catch (e) { alerts.push({ level: 'error', msg: 'Supabase injoignable : ' + e.message }); return []; }
    })(),
    getJson('/scraper/prices.json'), getJson('/scraper/links.json'), getJson('/scraper/price-history.json'),
  ]);

  const orders = ordersRaw || [];
  const prices = (pricesDoc && pricesDoc.prices) || {};
  const priceOf = (rid, model) => (prices?.[rid]?.[model] || prices?.[rid]?.default) || null;

  // Détail fiable des pièces d'une commande : d'abord metadata.cart (compact,
  // écrit pour le bot), sinon line_items s'ils portent le repair_id.
  const itemsOf = (o) => {
    const m = o.metadata || {};
    try { const c = JSON.parse(m.cart || 'null'); if (Array.isArray(c) && c.length) return c.map(x => ({ rid: x.r, mdl: x.m || 'default', q: x.q || 1 })); } catch {}
    const li = Array.isArray(o.line_items) ? o.line_items : [];
    if (li.some(x => x.repair_id || x.repairId)) return li.map(x => ({ rid: x.repair_id || x.repairId, mdl: x.model || 'default', q: x.qty || 1 }));
    return null;
  };

  const now = new Date(); const d30 = new Date(now.getTime() - 30 * 864e5);
  let revenue = 0, revenue30 = 0, count30 = 0, partsCost = 0, gain = 0, cost30 = 0, gain30 = 0, costUnknown = 0;
  const upcoming = [];
  for (const o of orders) {
    const tot = o.total_cents || 0; revenue += tot;
    const recent = o.created_at && new Date(o.created_at) >= d30;
    if (recent) { revenue30 += tot; count30++; }
    // Coût pièces Utopya (basePrice) — connu seulement si TOUS les articles sont reliés
    const its = itemsOf(o);
    let cost = 0, known = false;
    if (its) {
      known = true;
      for (const it of its) { const p = priceOf(it.rid, it.mdl); if (p && typeof p.basePrice === 'number') cost += Math.round(p.basePrice * 100) * it.q; else known = false; }
    }
    o._cost_cents = known ? cost : null;
    o._gain_cents = known ? (tot - cost) : null;
    if (known) { partsCost += cost; gain += (tot - cost); if (recent) { cost30 += cost; gain30 += (tot - cost); } }
    else costUnknown++;
    const m = o.metadata || {};
    if (m.apptDate) { const ad = new Date(m.apptDate); if (ad >= new Date(now.toDateString())) upcoming.push({ id: o.id, date: m.apptDate, slot: m.apptSlot || null, addr: m.addr || null, email: o.customer_email, model: m.model || null }); }
  }
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  let combos = 0, inStock = 0, oos = 0, broken = 0; const overCeiling = [], brokenItems = [];
  for (const [rid, models] of Object.entries(prices)) {
    for (const [mdl, e] of Object.entries(models)) {
      if (!e || typeof e !== 'object') continue; combos++;
      if (e.overCeiling) overCeiling.push({ repairId: rid, model: mdl, final: e.final, ceiling: e.ceiling });
      if (e.outOfStock) oos++;
      else if (e.final == null) { broken++; brokenItems.push({ repairId: rid, model: mdl, url: e.url || null }); }
      else inStock++;
    }
  }
  const coverage = [], modelGaps = [];
  if (Array.isArray(links)) {
    const byType = {}, byModel = {};
    for (const l of links) { if (!l.model || l.model === 'default') continue; (byType[l.repair_id] ||= new Set()).add(l.model); (byModel[l.model] ||= new Set()).add(l.repair_id); }
    const allTypes = Object.keys(byType);
    for (const t of allTypes.sort()) coverage.push({ repairId: t, models: byType[t].size });
    for (const model of FLAGSHIP) {
      const have = byModel[model];
      if (!have) { modelGaps.push({ model, missing: ['(modèle absent)'] }); continue; }
      const missing = allTypes.filter(t => !have.has(t)); if (missing.length) modelGaps.push({ model, missing });
    }
  }
  const genAt = pricesDoc?.generatedAt ? new Date(pricesDoc.generatedAt) : null;
  const ageH = genAt ? (now - genAt) / 36e5 : null;
  const stale = ageH != null && ageH > 24 * 5;
  if (!pricesDoc) alerts.push({ level: 'error', msg: 'Fichier de prix injoignable.' });
  else if (stale) alerts.push({ level: 'warn', msg: `Prix inchangés depuis ${Math.round(ageH / 24)} j — le rafraîchissement automatique est suspendu (accord Utopya). Mise à jour manuelle via Cartes.` });
  if (broken > 0) alerts.push({ level: 'warn', msg: `${broken} lien(s) sans prix — à vérifier chez Utopya.` });
  if (overCeiling.length) alerts.push({ level: 'warn', msg: `${overCeiling.length} produit(s) dépassent le prix Apple.` });
  const orderErrors = orders.filter(o => o.status === 'error' || o.error_message).map(o => ({ id: o.id, email: o.customer_email, created_at: o.created_at, error: o.error_message || 'statut error', total: o.total_cents }));
  if (orderErrors.length) alerts.push({ level: 'error', msg: `${orderErrors.length} commande(s) en erreur — action requise.` });
  const paidNotOrdered = orders.filter(o => o.status === 'paid' && !o.utopya_order_id).length;
  const changes = (hist && Array.isArray(hist.changes)) ? hist.changes : [];
  const c30 = { up: 0, down: 0, oos: 0, restock: 0 };
  for (const c of changes) if (new Date(c.t) >= d30 && c30[c.kind] != null) c30[c.kind]++;

  // ── Bilan des variations de prix (rapport Historique) — sur tous les
  // changements CHIFFRÉS (ancien & nouveau prix connus). ──
  const catOf = (rid) => {
    const r = String(rid || '');
    if (/^verre_trempe/.test(r)) return 'Protections';
    if (/^(diagnostic|deblocage|restauration|recuperation|reparation_express)/.test(r)) return 'Services';
    if (/^(cable|adaptateur|coque|chargeur|accessoire)/.test(r)) return 'Accessoires';
    return 'Réparations';
  };
  const numeric = changes.filter(c => typeof c.oldFinal === 'number' && typeof c.newFinal === 'number' && c.oldFinal > 0);
  let priceStats = null;
  if (numeric.length) {
    let maxUp = null, maxDown = null, sumDelta = 0, sumPct = 0;
    const products = new Set();
    const byCat = {};
    for (const c of numeric) {
      const d = c.newFinal - c.oldFinal;
      const pct = (d / c.oldFinal) * 100;
      sumDelta += d; sumPct += pct;
      products.add(`${c.repairId}|${c.model}`);
      const cat = catOf(c.repairId);
      byCat[cat] = (byCat[cat] || 0) + 1;
      if (d > 0 && (!maxUp || d > maxUp.delta)) maxUp = { delta: d, pct, repairId: c.repairId, model: c.model, from: c.oldFinal, to: c.newFinal, t: c.t };
      if (d < 0 && (!maxDown || d < maxDown.delta)) maxDown = { delta: d, pct, repairId: c.repairId, model: c.model, from: c.oldFinal, to: c.newFinal, t: c.t };
    }
    priceStats = {
      total_changes: numeric.length,
      products_affected: products.size,
      avg_delta_eur: Math.round((sumDelta / numeric.length) * 100) / 100,
      avg_pct: Math.round((sumPct / numeric.length) * 10) / 10,
      max_up: maxUp,
      max_down: maxDown,
      by_category: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, n]) => ({ cat, n })),
      oos_events: changes.filter(c => c.kind === 'oos').length,
      restock_events: changes.filter(c => c.kind === 'restock').length,
    };
  }

  return res.status(200).json({
    orders,
    stats: {
      total_orders: orders.length, orders_30d: count30,
      encaisse_cents: revenue, encaisse_30d_cents: revenue30,
      cout_pieces_cents: partsCost, benefice_cents: gain,
      cout_30d_cents: cost30, benefice_30d_cents: gain30,
      cost_unknown_orders: costUnknown,
      upcoming_appointments: upcoming.slice(0, 40),
    },
    catalog: { combos, in_stock: inStock, out_of_stock: oos, broken, prices_generated_at: pricesDoc?.generatedAt || null, prices_age_hours: ageH, over_ceiling: overCeiling, broken_items: brokenItems.slice(0, 60), coverage, model_gaps: modelGaps },
    price_changes: { updatedAt: hist?.updatedAt || null, total: changes.length, recent: changes.slice(0, 60), counts_30d: c30, stats: priceStats },
    health: { supabase_ok: !!(SUPA && KEY) && !alerts.some(a => a.level === 'error' && /Supabase/.test(a.msg)), prices_ok: !!pricesDoc && !stale, order_errors: orderErrors, paid_not_ordered: paidNotOrdered, alerts },
    serverTime: now.toISOString(),
  });
}
