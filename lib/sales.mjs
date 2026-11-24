// The pages live on the service disk (DATA_DIR/sales), never in the repo: the repo Render deploys from is public.
// tools/sales-push.mjs uploads them with PUT /ventas/_files/<path> and the desk push token.
// sales.mjs: the sales team portal (materials, routine, WhatsApp profile, PDFs) behind "Sign in with Google".
// Only verified Google accounts on the team domain (mirentor.com) get in; SALES_ALLOW can narrow that to a list.
// Google's popup hands the ID token to the page, which posts it to /auth on the same address it was opened from,
// so the same server works behind www.mirentor.com/ventas (a rewrite) and at its own onrender address; we check it with
// Google's tokeninfo endpoint, then set a signed cookie for 30 days. On its own host (SALES_HOST, for example
// sales.mirentor.com) the portal sits at the root; everywhere else under /ventas.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const COOKIE = 'msales';
const SESSION_S = 30 * 24 * 3600;
const MAX_AUTH = 8 * 1024;
const MAX_FILE = 12 * 1024 * 1024;
const PUSH_PATH = /^\/(?:[a-z0-9][a-z0-9._-]{0,80}\/){0,3}[a-z0-9][a-z0-9._-]{0,80}\.(html|css|js|svg|png|jpg|webp|pdf|ttf|woff2|json)$/i;
const WINDOW_MS = 10 * 60 * 1000;
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

const HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "frame-src https://accounts.google.com/gsi/",
    "connect-src 'self' https://accounts.google.com/gsi/",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://accounts.google.com",
  ].join('; '),
};

const sha = (s) => createHash('sha256').update(s).digest();
const same = (a, b) => timingSafeEqual(sha(String(a)), sha(String(b)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Asks Google whether the ID token is real. Tests pass their own verify.
export async function googleTokenInfo(credential) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) return null;
  return r.json();
}

/** The guests: exact addresses from outside the company domain that may come in (SALES_GUESTS, comma-separated). Naming
 * one address never opens the rest of its domain. */
export const guestSet = (value) => new Set(String(value || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)));

// Who the token says it is, or why not. Pure, so the rules are tested without Google.
export function checkClaims(c, { clientId, domain, allow, guests = new Set(), nowS }) {
  if (!c || typeof c !== 'object') return { ok: false, why: 'token' };
  if (c.aud !== clientId) return { ok: false, why: 'aud' };
  if (!ISSUERS.has(c.iss)) return { ok: false, why: 'iss' };
  if (!(Number(c.exp) > nowS)) return { ok: false, why: 'exp' };
  if (!(c.email_verified === true || c.email_verified === 'true')) return { ok: false, why: 'unverified' };
  const email = String(c.email || '').toLowerCase();
  // A guest is named by their exact, verified address, so neither the domain nor the narrower list applies to them.
  if (guests.has(email)) return { ok: true, email, name: String(c.given_name || c.name || '').slice(0, 60) };
  if (c.hd !== domain || !email.endsWith(`@${domain}`)) return { ok: false, why: 'domain', email };
  if (allow.size && !allow.has(email)) return { ok: false, why: 'list', email };
  return { ok: true, email, name: String(c.given_name || c.name || '').slice(0, 60) };
}

const loginPage = ({ clientId, authUri, error = '', devUri = '', hd = '' }) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Mirentor · Equipo de ventas</title>
<style>
:root{color-scheme:dark;--bg:#16181b;--panel:#202327;--line:#34383d;--ink:#eceeef;--ink-2:#b4bac0;--signal:#ff6e1a;--red:#ef7a6f}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.card{position:relative;width:min(400px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:36px 28px 30px}
.card::before{content:"";position:absolute;left:28px;top:-1px;width:56px;height:2px;background:var(--signal)}
.mark{font:600 13px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--signal)}
h1{font-size:32px;line-height:1.05;letter-spacing:-.02em;margin:10px 0 10px;font-weight:600}
p{color:var(--ink-2);margin:0 0 22px}.err{color:var(--red);margin:-6px 0 18px}
.dev{display:block;margin-top:18px;color:var(--ink-2);font-size:14px}
</style>
${clientId ? `<script>
function mirentorSignIn(r) {
  var b = location.pathname; while (b.length > 1 && b.charAt(b.length - 1) === '/') b = b.slice(0, -1); if (b === '/') b = '';
  fetch(b + '/auth', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-sales-login': '1' }, body: JSON.stringify({ credential: r.credential }) })
    .then(function (x) { return x.json().then(function (j) { return { ok: x.ok, j: j }; }); })
    .then(function (o) {
      if (o.ok) { location.href = b + '/'; return; }
      var e = document.getElementById('err'); e.textContent = o.j.error || 'No pudimos confirmar tu cuenta.'; e.hidden = false;
    })
    .catch(function () { var e = document.getElementById('err'); e.textContent = 'Sin conexión. Intenta de nuevo.'; e.hidden = false; });
}
</script>
<script src="https://accounts.google.com/gsi/client" async></script>` : ''}</head><body><main><div class="card">
<div class="mark">Mirentor · Panamá</div>
<h1>equipo de ventas.</h1>
<p>Entra con tu cuenta de Google @mirentor.com. / Sign in with your @mirentor.com Google account.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
${clientId ? `<div id="g_id_onload" data-client_id="${esc(clientId)}" data-callback="mirentorSignIn"${hd ? ` data-hd="${esc(hd)}"` : ''} data-auto_prompt="false"></div>
<div class="g_id_signin" data-type="standard" data-theme="filled_black" data-size="large" data-shape="pill" data-text="signin_with" data-locale="es"></div>
<p class="err" id="err" hidden></p>
` : ''}
${devUri ? `<a class="dev" href="${esc(devUri)}">Entrar en modo local (solo en esta Mac)</a>` : ''}
</div></main></body></html>`;

const ERRORS = {
  domain: 'Esa cuenta no es @mirentor.com. Entra con tu correo de Mirentor.',
  list: 'Tu cuenta todavía no tiene acceso. Escríbele a Claudio por Slack.',
  csrf: 'La sesión de Google expiró. Intenta de nuevo.',
  default: 'No pudimos confirmar tu cuenta. Intenta de nuevo.',
};

export function createSales({ clientId = '', secret = '', pushToken = '', host = '', domain = 'mirentor.com', allow = '', guests = '', root, devLogin = false, verify = googleTokenInfo, limit = 20, now = () => Date.now() }) {
  if (!secret || !root || (!clientId && !devLogin)) return null;
  host = String(host || '').toLowerCase();
  const allowSet = new Set(String(allow).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const guestList = guestSet(guests);
  const key = sha(`mirentor-sales-session|${secret}`);
  const hits = new Map();
  const realRoot = path.resolve(root);

  const sign = (body) => createHmac('sha256', key).update(`sales:${body}`).digest('base64url');
  const cookieFor = (email, base) => {
    const body = `${Buffer.from(email).toString('base64url')}.${Math.floor(now() / 1000) + SESSION_S}`;
    return `${COOKIE}=${body}.${sign(body)}; Path=${base}; Max-Age=${SESSION_S}; HttpOnly; Secure; SameSite=Lax`;
  };
  function who(req) {
    const raw = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [e, exp, sig] = raw.slice(COOKIE.length + 1).split('.');
    if (!e || !/^\d+$/.test(exp || '') || !sig) return null;
    if (Number(exp) * 1000 < now() || !same(sig, sign(`${e}.${exp}`))) return null;
    const email = Buffer.from(e, 'base64url').toString();
    // The sign-in's own rule (checkClaims), asked again on every request, so a list changed after someone signed in
    // takes effect on their next request: a guest is in while SALES_GUESTS names them (the narrower list never applies
    // to a guest); anyone else must be on the company domain and, when SALES_ALLOW is set, on it.
    if (guestList.has(email)) return email;
    if (!email.endsWith(`@${domain}`)) return null;
    if (allowSet.size && !allowSet.has(email)) return null;
    return email;
  }
  const cookieVal = (req, name) => {
    const raw = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
    return raw ? decodeURIComponent(raw.slice(name.length + 1)) : '';
  };
  function limited(ip) {
    const t = now();
    const recent = (hits.get(ip) || []).filter((x) => t - x < WINDOW_MS);
    recent.push(t);
    hits.set(ip, recent);
    return recent.length > limit;
  }
  function file(rel) {
    const p = path.resolve(realRoot, `.${rel}`);
    if (p !== realRoot && !p.startsWith(realRoot + path.sep)) return null;
    let target = p;
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!existsSync(target) && !path.extname(target)) target = `${target}.html`;
    if (!existsSync(target) || !statSync(target).isFile()) return null;
    return target;
  }

  async function handle(req, res, pathname) {
    const onHost = !!host && String(req.headers.host || '').split(':')[0].toLowerCase() === host;
    if (!onHost && pathname !== '/ventas' && !pathname.startsWith('/ventas/')) return false;
    const base = onHost ? '/' : '/ventas';
    const at = (p) => (onHost ? p : `/ventas${p}`);
    const rel = onHost ? pathname : pathname.slice('/ventas'.length) || '/';
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { ...HEADERS, 'content-type': type, ...extra }).end(body); };
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
    const authUri = `${proto}://${req.headers.host}${at('/auth')}`;
    const login = (status, error = '') => send(status, 'text/html; charset=utf-8', loginPage({ clientId, authUri, error, devUri: devLogin ? at('/dev-login') : '', hd: guestList.size ? '' : domain }));
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();

    if (rel === '/auth' && req.method === 'POST') {
      if (limited(ip)) return login(429, 'Demasiados intentos. Espera diez minutos.'), true;
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > MAX_AUTH) return login(413), true; }
      const isJson = String(req.headers['content-type'] || '').startsWith('application/json');
      let credential = '';
      if (isJson) {
        // A custom header makes the browser ask first (CORS preflight), which other sites never get past.
        if (req.headers['x-sales-login'] !== '1') return login(400, ERRORS.csrf), true;
        try { credential = String(JSON.parse(raw).credential || ''); } catch { credential = ''; }
      } else {
        const form = new URLSearchParams(raw);
        const csrf = form.get('g_csrf_token') || '';
        if (!csrf || !same(csrf, cookieVal(req, 'g_csrf_token'))) return login(400, ERRORS.csrf), true;
        credential = form.get('credential') || '';
      }
      let claims = null;
      try { claims = await verify(credential); } catch (err) { console.error(`sales verify: ${err.message}`); }
      const r = checkClaims(claims, { clientId, domain, allow: allowSet, guests: guestList, nowS: Math.floor(now() / 1000) });
      if (!r.ok) {
        console.log(`sales login refused (${r.why}) ${r.email || ''}`);
        if (isJson) return send(403, 'application/json', JSON.stringify({ ok: false, error: ERRORS[r.why] || ERRORS.default })), true;
        return login(403, ERRORS[r.why] || ERRORS.default), true;
      }
      console.log(`sales login ${r.email}`);
      if (isJson) return send(200, 'application/json', '{"ok":true}', { 'set-cookie': cookieFor(r.email, base) }), true;
      return send(303, 'text/html; charset=utf-8', '', { location: base, 'set-cookie': cookieFor(r.email, base) }), true;
    }
    if (rel === '/dev-login' && devLogin && req.method === 'GET') {
      return send(303, 'text/html; charset=utf-8', '', { location: base, 'set-cookie': cookieFor(`claudio@${domain}`, base).replace('; Secure', '') }), true;
    }
    if (rel === '/logout') {
      return send(303, 'text/html; charset=utf-8', '', { location: base, 'set-cookie': `${COOKIE}=; Path=${base}; Max-Age=0; HttpOnly; Secure; SameSite=Lax` }), true;
    }
    if (rel.startsWith('/_files/') && req.method === 'PUT') {
      const auth = String(req.headers.authorization || '');
      if (!pushToken || !auth.startsWith('Bearer ') || !same(auth.slice(7), pushToken)) return send(401, 'application/json', '{"ok":false}'), true;
      const target = rel.slice('/_files'.length);
      if (!PUSH_PATH.test(target) || target.includes('..')) return send(400, 'application/json', '{"ok":false}'), true;
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_FILE) return send(413, 'application/json', '{"ok":false}'), true; chunks.push(c); }
      const dest = path.join(realRoot, target);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(`${dest}.tmp`, Buffer.concat(chunks)); renameSync(`${dest}.tmp`, dest);
      console.log(`sales file ${target} ${size} bytes`);
      return send(200, 'application/json', JSON.stringify({ ok: true, path: target, size })), true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'application/json', '{"ok":false}'), true;

    const email = who(req);
    if (!email) {
      if (rel === '/' || rel === '') return login(200), true;
      return send(303, 'text/html; charset=utf-8', '', { location: base }), true;
    }
    if (rel === '/me.json') return send(200, 'application/json', JSON.stringify({ email })), true;
    if (!onHost && pathname === '/ventas') return send(301, 'text/html; charset=utf-8', '', { location: '/ventas/' }), true;
    const f = file(rel === '' ? '/' : rel);
    if (!f) return send(404, 'text/html; charset=utf-8', '<p>No encontrado.</p>'), true;
    send(200, TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', req.method === 'HEAD' ? undefined : readFileSync(f));
    return true;
  }
  // The team's board lives inside the portal (lib/team) and has no sign-in of its own: it asks here who a request is.
  handle.who = who;
  return handle;
}
