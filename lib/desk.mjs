// desk.mjs: a view-only copy of the Prentis Team Desk behind one shared password, at /desk.
// The desk itself lives on claude.ai, where the team edits it. After every run, the desk sync routine pushes the
// page source and a snapshot of the desk database here (PUT /desk/snapshot with a bearer token). Visitors type the
// password once and get a signed cookie for 30 days. The page runs unchanged: a small shim stands in for the
// claude.ai runtime, serves the snapshot read-only and polls for the next one.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const COLLECTIONS = ['cards', 'decisions', 'signals', 'routines', 'tools'];
const COOKIE = 'mdesk';
const SESSION_S = 30 * 24 * 3600;
const MAX_PUSH = 4 * 1024 * 1024;
const MAX_LOGIN = 2 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

// The same document skeleton claude.ai wraps the page in, so the page renders exactly as it does there.
const SKELETON_STYLE = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';

const HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

const sha = (s) => createHash('sha256').update(s).digest();
const same = (a, b) => timingSafeEqual(sha(String(a)), sha(String(b)));
const b64url = (buf) => buf.toString('base64url');
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Runs before the page's own script. It answers window.claude.use("db") and ("user") the way the claude.ai runtime
// does for someone who can view the desk but not edit it.
const SHIM = `(() => {
  const POLL_MS = 60000;
  let snap = JSON.parse(document.getElementById("desk-snapshot").textContent);
  const cols = new Map(), docs = new Map();
  const listeners = (m, k) => { if (!m.has(k)) m.set(k, new Set()); return m.get(k); };
  const colSnap = (key) => { const all = (snap.collections && snap.collections[key]) || {}; const list = Object.keys(all).map((id) => ({ id, exists: true, data: () => ({ ...all[id] }) })); return { docs: list, size: list.length, empty: !list.length }; };
  const docSnap = (p) => { const d = snap.docs && snap.docs[p]; return { id: p.split("/").pop(), exists: !!d, data: () => (d ? { ...d } : undefined) }; };
  const call = (cb, v) => { try { cb(v); } catch (e) { console.error(e); } };
  const deliver = () => { cols.forEach((set, k) => set.forEach((cb) => call(cb, colSnap(k)))); docs.forEach((set, p) => set.forEach((cb) => call(cb, docSnap(p)))); };
  const viewOnly = () => Promise.reject(Object.assign(new Error("This copy of the desk is view only."), { code: "permission_denied" }));
  const db = {
    collection: (key) => ({
      onSnapshot(cb) { const set = listeners(cols, key); set.add(cb); setTimeout(() => call(cb, colSnap(key))); return () => set.delete(cb); },
      get: async () => colSnap(key),
      doc: (id) => db.doc(key + "/" + id),
      add: viewOnly,
    }),
    doc: (p) => ({
      onSnapshot(cb) { const set = listeners(docs, p); set.add(cb); setTimeout(() => call(cb, docSnap(p))); return () => set.delete(cb); },
      get: async () => docSnap(p),
      set: viewOnly, update: viewOnly, delete: viewOnly,
    }),
  };
  const user = {
    id: async () => "",
    can: async () => false,
    profiles: async (ids) => { const out = {}; (ids || []).forEach((id) => { const n = snap.names && snap.names[id]; if (n) out[id] = { name: n }; }); return out; },
  };
  window.claude = { use: async (name) => (name === "db" ? db : name === "user" ? user : null) };
  async function poll() {
    if (document.hidden) return;
    try {
      const r = await fetch("/desk/data.json", { cache: "no-store", credentials: "same-origin" });
      if (r.status === 401) { location.href = "/desk"; return; }
      if (!r.ok) return;
      const next = await r.json();
      if (next && next.pushedAt !== snap.pushedAt) { snap = next; deliver(); }
    } catch (e) {}
  }
  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();`;

function loginPage({ error = '', status = '' } = {}) {
  const note = error ? `<p class="err" role="alert">${error}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Prentis Team Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,100..800&family=Mona+Sans:wdth,wght@75..125,200..900&display=swap">
<style>
:root{color-scheme:dark;--bg:#1b1d20;--panel:#232629;--line:#363a3f;--line-2:#464b51;--edge:#6b7178;--ink:#e9ebec;--ink-2:#c9cdd1;--ink-3:#a9b0b6;--signal:#ff6e1a;--signal-hover:#ff8040;--red:#ef7a6f;--mono:"Martian Mono",ui-monospace,"SF Mono",Menlo,monospace;--sans:"Mona Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
main{min-height:100svh;display:grid;place-items:center;padding:24px 16px}
form{width:100%;max-width:380px;display:grid;gap:18px;padding:28px 24px 24px;background:var(--panel);border:1px solid var(--line);border-radius:16px;position:relative}
form::before{content:"";position:absolute;left:24px;top:-1px;width:56px;height:2px;background:var(--signal)}
.lbl{font-family:var(--mono);font-stretch:87.5%;font-weight:500;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
h1{margin:6px 0 0;font-weight:600;font-size:30px;line-height:1.05;letter-spacing:-.02em}
p{margin:0;color:var(--ink-2)}
label{display:grid;gap:8px}
input{height:44px;padding:0 14px;border:1px solid var(--line-2);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
input:focus-visible{outline:2px solid var(--signal);outline-offset:2px;border-color:var(--edge)}
button{height:44px;border:0;border-radius:999px;background:var(--signal);color:#1b1d20;font:600 15px var(--sans);cursor:pointer}
button:hover{background:var(--signal-hover)}
.err{color:var(--red);font-size:14px}
</style></head><body><main>
<form method="post" action="/desk/login">
<div><span class="lbl">Mirentor</span><h1>Prentis Team Desk</h1></div>
<p>View-only copy for the team. It refreshes after every desk sync.</p>
<label><span class="lbl">Password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
${note}<button type="submit">Open the desk</button>
</form></main></body></html>`;
}

function emptyPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Prentis Team Desk</title>
<style>html,body{margin:0;background:#1b1d20;color:#e9ebec;font:15px/1.5 system-ui,sans-serif}main{min-height:100svh;display:grid;place-items:center;padding:24px 16px;text-align:center}</style></head>
<body><main><p>The desk copy has not been published yet. It appears after the next desk sync.</p></main></body></html>`;
}

// A snapshot is { pushedAt, collections: { cards: { T1: {...} }, ... }, docs: { "meta/desk": {...} }, names: { u_x: "Name" } }.
export function checkSnapshot(s) {
  const errors = [];
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(s)) return ['snapshot'];
  if (typeof s.pushedAt !== 'string' || Number.isNaN(Date.parse(s.pushedAt))) errors.push('pushedAt');
  if (!isObj(s.collections)) errors.push('collections');
  else {
    for (const k of Object.keys(s.collections)) if (!COLLECTIONS.includes(k)) errors.push(`collections.${k}`);
    for (const k of COLLECTIONS) {
      const c = s.collections[k];
      if (!isObj(c) || Object.keys(c).some((id) => !ID.test(id) || !isObj(c[id]))) errors.push(`collections.${k}`);
    }
    if (isObj(s.collections.cards) && !Object.keys(s.collections.cards).length) errors.push('collections.cards');
  }
  if (!isObj(s.docs) || !isObj(s.docs['meta/desk'])) errors.push('docs');
  if (s.names !== undefined && (!isObj(s.names) || Object.values(s.names).some((n) => typeof n !== 'string'))) errors.push('names');
  return errors;
}

export function createDesk({ dir, password, pushToken, limit = 10, now = () => Date.now() }) {
  if (!password || !pushToken) return null;
  const folder = path.join(dir, 'desk');
  mkdirSync(folder, { recursive: true });
  const files = { page: path.join(folder, 'page.html'), snap: path.join(folder, 'snapshot.json') };
  const key = sha(`mirentor-desk-session|${password}|${pushToken}`);
  const hits = new Map();

  const load = () => (existsSync(files.page) && existsSync(files.snap)
    ? { page: readFileSync(files.page, 'utf8'), snap: readFileSync(files.snap, 'utf8') } : null);
  let current = load();

  const atomic = (file, text) => { const tmp = `${file}.tmp`; writeFileSync(tmp, text); renameSync(tmp, file); };
  const sign = (exp) => b64url(createHmac('sha256', key).update(`desk:${exp}`).digest());
  const cookieFor = (exp) => `${COOKIE}=${exp}.${sign(exp)}; Path=/desk; Max-Age=${SESSION_S}; HttpOnly; Secure; SameSite=Lax`;

  function authed(req) {
    const raw = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    if (!raw) return false;
    const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
    if (!/^\d+$/.test(exp || '') || !sig) return false;
    if (Number(exp) * 1000 < now()) return false;
    return same(sig, sign(exp));
  }

  function limited(ip) {
    const t = now();
    const recent = (hits.get(ip) || []).filter((x) => t - x < WINDOW_MS);
    hits.set(ip, recent);
    return recent.length >= limit;
  }

  async function readBody(req, max) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > max) return null;
    }
    return raw;
  }

  function page() {
    if (!current) return emptyPage();
    const head = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><style>${SKELETON_STYLE}</style>`
      + `<script type="application/json" id="desk-snapshot">${jsonForScript(JSON.parse(current.snap))}</script><script>${SHIM}</script></head><body>\n`;
    return `${head}${current.page}\n</body></html>`;
  }

  // Returns true when the request was a /desk request and has been answered.
  return async function handle(req, res, pathname) {
    if (pathname !== '/desk' && !pathname.startsWith('/desk/')) return false;
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { ...HEADERS, 'content-type': type, ...extra }).end(body); };
    const html = (status, body, extra) => send(status, 'text/html; charset=utf-8', body, extra);
    const json = (status, body) => send(status, 'application/json', JSON.stringify(body));
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();

    if ((pathname === '/desk' || pathname === '/desk/') && req.method === 'GET') {
      return html(200, authed(req) ? page() : loginPage()), true;
    }
    if (pathname === '/desk/login' && req.method === 'POST') {
      if (limited(ip)) return html(429, loginPage({ error: 'Too many tries. Wait ten minutes and try again.' })), true;
      const raw = await readBody(req, MAX_LOGIN);
      const given = raw == null ? '' : new URLSearchParams(raw).get('password') || '';
      if (!given || !same(given, password)) {
        hits.get(ip).push(now());
        return html(401, loginPage({ error: 'That password did not work.' })), true;
      }
      const exp = Math.floor(now() / 1000) + SESSION_S;
      return html(303, '', { location: '/desk', 'set-cookie': cookieFor(exp) }), true;
    }
    if (pathname === '/desk/logout' && req.method === 'POST') {
      return html(303, '', { location: '/desk', 'set-cookie': `${COOKIE}=; Path=/desk; Max-Age=0; HttpOnly; Secure; SameSite=Lax` }), true;
    }
    if (pathname === '/desk/data.json' && req.method === 'GET') {
      if (!authed(req)) return json(401, { ok: false }), true;
      if (!current) return json(404, { ok: false }), true;
      return send(200, 'application/json', current.snap), true;
    }
    if (pathname === '/desk/snapshot' && req.method === 'PUT') {
      const auth = String(req.headers.authorization || '');
      if (!auth.startsWith('Bearer ') || !same(auth.slice(7), pushToken)) return json(401, { ok: false }), true;
      const raw = await readBody(req, MAX_PUSH);
      if (raw == null) return json(413, { ok: false }), true;
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { ok: false, errors: ['body'] }), true; }
      const errors = checkSnapshot(body && body.snapshot);
      if (typeof body?.page !== 'string' || !body.page.includes('window.claude.use')) errors.push('page');
      if (errors.length) return json(400, { ok: false, errors }), true;
      // Never step back: a snapshot from an older desk sync than the one already served is refused.
      const syncedAt = (s) => Date.parse((s && s.docs && s.docs['meta/desk'] && s.docs['meta/desk'].updatedAt) || '') || 0;
      const served = current ? syncedAt(JSON.parse(current.snap)) : 0;
      if (syncedAt(body.snapshot) < served) return json(409, { ok: false, errors: ['stale'], servedSyncAt: new Date(served).toISOString() }), true;
      const snap = JSON.stringify(body.snapshot);
      atomic(files.page, body.page);
      atomic(files.snap, snap);
      current = { page: body.page, snap };
      const counts = Object.fromEntries(COLLECTIONS.map((k) => [k, Object.keys(body.snapshot.collections[k]).length]));
      return json(200, { ok: true, pushedAt: body.snapshot.pushedAt, counts, sha256: createHash('sha256').update(snap).digest('hex') }), true;
    }
    return json(404, { ok: false }), true;
  };
}
