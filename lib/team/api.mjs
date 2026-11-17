// api.mjs: the sales team platform at /equipo. Reps sign in with a PIN, log each contact and see their own numbers;
// managers see everyone, confirm meetings and contracts, and create reps. Only paths under /equipo are answered here.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, KINDS, channelOf, crmRow, flagsOf, localDay, weekStart, addDays, goalWindow } from './rules.mjs';
import { openTeamStore, searchLeads } from './store.mjs';
import { hashPin, checkPin, validPin, newSetupToken, hashToken, sessions, lockout, SETUP_HOURS } from './auth.mjs';
import { dayStats, ledger, earnedPoints, goalOf, streak } from './score.mjs';
import { repView, teamView } from './view.mjs';

const BASE = '/equipo', API = `${BASE}/api`, COOKIE = 'mteam';
const MAX_BODY = 16 * 1024, MAX_LEADS = 4 * 1024 * 1024, WINDOW_MS = 10 * 60 * 1000;
const HANDLE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const LOG_ID = /^[A-Za-z0-9-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TAGS = new Set(['meeting', 'waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call']);
// Every route the API answers. Anything else is a 404 before a session is even looked at.
const OPEN_ROUTES = /^(login|setup|logout)$/;
const TOKEN_ROUTES = /^(bootstrap|export|leads|leadmap)$/;
const REP_ROUTES = /^(me|leads|log|close|goal|kudos|play|held|lang)$/;
const MANAGER_ROUTES = /^(team|confirm|void|reps|reps\/[^/]+|reps\/[^/]+\/link|dayoff|site|site\/[^/]+|badge)$/;
const LONG_CACHE = 'public, max-age=31536000, immutable';   // fonts carry their version in the file name
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const HEADERS = {
  'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
  'content-security-policy': ["default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data:", "connect-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; '),
};
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sameToken = (a, b) => { const x = createHash('sha256').update(String(a)).digest(), y = createHash('sha256').update(String(b)).digest(); return timingSafeEqual(x, y); };
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

function loadStatic(dir) {
  const files = new Map();
  const walk = (folder, prefix) => {
    for (const name of readdirSync(folder)) {
      const full = path.join(folder, name), rel = `${prefix}${name}`;
      if (statSync(full).isDirectory()) { walk(full, `${rel}/`); continue; }
      const type = TYPES[path.extname(name).toLowerCase()];
      if (!type) continue;
      const body = readFileSync(full);
      const compress = !/^(font\/woff2|image\/png)/.test(type);
      files.set(rel, { body, br: compress ? brotliCompressSync(body) : null, type, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"` });
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return files;
}

export function createTeam({ dir, secret, pushToken, now = () => new Date(), staticDir = fileURLToPath(new URL('../../team', import.meta.url)), origins = [], publicBase = '', dev = false }) {
  if (!secret || !dir) return null;
  const nowIso = () => now().toISOString(), nowMs = () => now().getTime();
  const store = openTeamStore(dir, { now: nowIso });
  const { state } = store;
  const sess = sessions(secret, nowMs), lock = lockout(nowMs);
  const hits = new Map();
  let assets = loadStatic(staticDir);
  // A folder filled by tools/team-seed.mjs carries this marker, and every view says the data is a sample.
  const sample = existsSync(path.join(store.dir, 'SAMPLE'));

  const ctx = () => ({ now: nowIso(), leads: store.leads() });
  const limited = (ip, max = 30) => { const t = nowMs(), recent = (hits.get(ip) || []).filter((x) => t - x < WINDOW_MS); recent.push(t); hits.set(ip, recent); return recent.length > max; };
  const id = (prefix) => `${prefix}_${randomBytes(5).toString('hex')}`;

  function setupLink(req, repId) {
    const { token, tokenHash } = newSetupToken();
    store.append({ type: 'rep.setup', id: repId, tokenHash, exp: new Date(nowMs() + SETUP_HOURS * 3600 * 1000).toISOString() });
    const origin = String(req.headers.origin || '');
    const base = publicBase || (origins.includes(origin) ? origin : `${String(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers.host}`);
    return `${base}${BASE}/alta?t=${token}`;
  }
  const repBySetup = (token) => {
    const want = hashToken(token);
    for (const rep of state.reps.values()) if (rep.setup && rep.setup.tokenHash === want) return Date.parse(rep.setup.exp) > nowMs() ? rep : null;
    return null;
  };
  const leadOut = (l) => ({ id: l.id, name: l.company, zone: l.zone || '', known: !!(l.lastContact || state.leadFirstDay.get(l.id)) });

  /** The agreed end-of-day report. Always Spanish: it is what posts in Slack. */
  function reportText(rep, day, tomorrow, blocker) {
    const st = dayStats(state, rep.id, day, ctx());
    const logs = (state.byRep.get(rep.id) || []).map((x) => state.logs.get(x)).filter((l) => l.day === day && !state.voids.has(l.id));
    const ws = weekStart(day);
    const weekMeetings = (state.byRep.get(rep.id) || []).map((x) => state.logs.get(x)).filter((l) => l.kind === 'meeting' && l.day >= ws && l.day <= addDays(ws, 6) && !state.voids.has(l.id)).length;
    return [`Reporte de hoy · ${rep.name}`,
      `Visitas: ${st.visits} · Conversaciones con dueño o encargado: ${st.conversations} · Reuniones agendadas: ${st.meetings} · Contratos enviados: ${logs.filter((l) => l.kind === 'contract').length}`,
      `Semana: ${weekMeetings} de ${RULES.goals.meetings} reuniones`, `Mañana: ${tomorrow || '…'}`, `Bloqueo: ${blocker || 'ninguno'}`].join('\n');
  }

  function exportSince(since) {
    const from = Date.parse(since) || 0, order = ['Contacted', 'Intro call booked', 'Intro call done', 'Contract sent', 'Contract signed'];
    const logs = [], stage = new Map();
    const raise = (lead, s) => { if (String(lead).startsWith('APP-')) return; if (order.indexOf(s) > order.indexOf(stage.get(lead) ?? '')) stage.set(lead, s); };
    for (const log of state.logs.values()) {
      const rep = state.reps.get(log.rep), conf = state.confirms.get(log.id) || {};
      const touched = [log.t, conf.meeting_held, conf.contract_sent, conf.contract_signed].some((t) => t && Date.parse(t) >= from);
      if (!touched || state.voids.has(log.id)) continue;
      if (Date.parse(log.t) >= from) logs.push({ id: log.id, t: log.t, day: log.day, owner: rep?.name || '', handle: rep?.handle || '', lead: log.lead, kind: log.kind, crm: crmRow(log), tag: log.tag || null, note: log.note || '', contact: log.contact || '', when: log.when || null });
      raise(log.lead.id, 'Contacted');
      if (log.kind === 'meeting') raise(log.lead.id, conf.meeting_held ? 'Intro call done' : 'Intro call booked');
      if (log.kind === 'contract' && conf.contract_sent) raise(log.lead.id, conf.contract_signed ? 'Contract signed' : 'Contract sent');
    }
    return { since: new Date(from).toISOString(), until: nowIso(), logs, stages: [...stage].map(([lead, s]) => ({ lead, stage: s })),
      newLeads: [...store.leads().values()].filter((l) => l.app).map((l) => ({ id: l.id, company: l.company, zone: l.zone, city: l.city, createdAt: l.createdAt })),
      doNotCall: [...state.logs.values()].filter((l) => l.tag === 'do_not_call' && Date.parse(l.t) >= from).map((l) => l.lead.id) };
  }

  // ---- request handling ----
  return async function handle(req, res, pathname) {
    if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return false;
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { ...HEADERS, 'cache-control': 'no-store', 'content-type': type, ...extra }).end(body); return true; };
    const json = (status, body, extra) => send(status, 'application/json', JSON.stringify(body), extra);
    const fail = (status, error, more = {}, extra = undefined) => json(status, { ok: false, error, ...more }, extra);
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();

    // ---- the client ----
    if (!pathname.startsWith(`${API}/`) && pathname !== API) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method');
      if (dev) assets = loadStatic(staticDir);
      const rel = pathname === BASE || pathname === `${BASE}/` || pathname === `${BASE}/alta` ? 'index.html' : pathname.slice(BASE.length + 1);
      const file = /^[a-z0-9][a-z0-9._/-]*$/i.test(rel) && !rel.includes('..') ? assets.get(rel) : null;
      if (!file) return fail(404, 'not_found');
      const isPage = rel === 'index.html';
      const head = { etag: file.etag, 'cache-control': isPage ? 'no-store' : file.type === 'font/woff2' ? LONG_CACHE : 'no-cache', vary: 'Accept-Encoding' };
      if (!isPage && req.headers['if-none-match'] === file.etag) return send(304, file.type, undefined, head);
      const br = file.br && /\bbr\b/.test(String(req.headers['accept-encoding'] || ''));
      return send(200, file.type, req.method === 'HEAD' ? undefined : br ? file.br : file.body, br ? { ...head, 'content-encoding': 'br' } : head);
    }

    // ---- the API ----
    const route = pathname.slice(API.length + 1);
    if (!OPEN_ROUTES.test(route) && !TOKEN_ROUTES.test(route) && !REP_ROUTES.test(route) && !MANAGER_ROUTES.test(route)) return fail(404, 'not_found');
    const q = new URL(req.url, 'http://x').searchParams;
    const post = req.method === 'POST' || req.method === 'PUT';
    if (post) {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin) && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()) return fail(403, 'origin');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return fail(415, 'content_type');
    }
    let body = null;
    if (post) {
      // Collected as bytes and decoded once: decoding chunk by chunk breaks an accent that falls on a chunk boundary.
      const chunks = []; let size = 0; const max = route === 'leads' ? MAX_LEADS : MAX_BODY;
      for await (const chunk of req) { size += chunk.length; if (size > max) return fail(413, 'too_large', undefined, { connection: 'close' }); chunks.push(chunk); }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return fail(400, 'body'); }
      if (body === null || typeof body !== 'object') return fail(400, 'body');
    }
    // A local preview runs over plain http, where a Secure cookie would never come back.
    const cookieOut = (value, age) => ({ 'set-cookie': `${COOKIE}=${value}; Path=${BASE}; Max-Age=${age}; HttpOnly;${dev ? '' : ' Secure;'} SameSite=Lax` });
    const signIn = (rep) => cookieOut(sess.issue(rep.id, rep.pinVersion), sess.maxAge);

    // -- no session needed --
    if (route === 'login' && req.method === 'POST') {
      const handle = text(body.handle, 60).toLowerCase();
      if (limited(ip) || lock.blocked(handle)) return fail(429, 'locked');
      const rep = state.reps.get(state.handles.get(handle));
      const usable = rep && rep.active && rep.pin;
      // An unknown handle costs the same work as a wrong PIN, so the answer's timing says nothing about who exists.
      const right = usable ? checkPin(String(body.pin ?? ''), rep.pin.salt, rep.pin.hash) : (hashPin(String(body.pin ?? ''), 'no-such-rep'), false);
      if (!right) { lock.fail(handle); return fail(401, 'bad_login'); }
      lock.clear(handle);
      return json(200, { ok: true, role: rep.role, lang: rep.lang }, signIn(rep));
    }
    if (route === 'setup' && req.method === 'GET') {
      const rep = repBySetup(q.get('t') || '');
      return rep ? json(200, { ok: true, first: firstName(rep.name), handle: rep.handle, lang: rep.lang }) : fail(410, 'link_expired');
    }
    if (route === 'setup' && req.method === 'POST') {
      if (limited(ip)) return fail(429, 'locked');
      const rep = repBySetup(String(body.token || ''));
      if (!rep) return fail(410, 'link_expired');
      if (!validPin(body.pin)) return fail(400, 'weak_pin');
      store.append({ type: 'rep.pin', id: rep.id, ...hashPin(body.pin) });
      lock.clear(rep.handle);
      return json(200, { ok: true, role: rep.role, lang: rep.lang, handle: rep.handle }, signIn(rep));
    }
    if (route === 'logout' && req.method === 'POST') return json(200, { ok: true }, cookieOut('', 0));

    // -- the nightly routine and the first manager: bearer token --
    const bearer = String(req.headers.authorization || '');
    const hasBearer = !!pushToken && bearer.startsWith('Bearer ') && sameToken(bearer.slice(7), pushToken);
    if (['bootstrap', 'export', 'leads', 'leadmap'].includes(route) && !(route === 'leads' && req.method === 'GET')) {
      if (!hasBearer) return fail(401, 'token');
      if (route === 'bootstrap' && req.method === 'POST') {
        const handle = text(body.handle, 60).toLowerCase(), name = text(body.name, 80);
        if (!HANDLE.test(handle) || name.length < 2) return fail(400, 'fields');
        // The same call is the way back in for an admin who lost the PIN. It never touches a rep or a manager.
        const existing = state.reps.get(state.handles.get(handle));
        if (existing) return existing.role === 'admin' ? json(200, { ok: true, id: existing.id, setupUrl: setupLink(req, existing.id) }) : fail(409, 'handle_taken');
        const repId = id('r');
        store.append({ type: 'rep.created', id: repId, handle, name, role: 'admin', country: text(body.country, 2).toUpperCase() || 'PA', city: text(body.city, 60), tz: text(body.tz, 40) || 'America/Panama', workdays: [1, 2, 3, 4, 5], lang: body.lang === 'en' ? 'en' : 'es' });
        return json(200, { ok: true, id: repId, setupUrl: setupLink(req, repId) });
      }
      if (route === 'export' && req.method === 'GET') return json(200, { ok: true, ...exportSince(q.get('since') || '') });
      if (route === 'leads' && req.method === 'PUT') { if (!Array.isArray(body)) return fail(400, 'body'); return json(200, { ok: true, count: store.setLeads(body) }); }
      if (route === 'leadmap' && req.method === 'POST') {
        const pairs = Array.isArray(body.pairs) ? body.pairs : [];
        return json(200, { ok: true, mapped: pairs.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && p[1] && store.mapLead(p[0], p[1])).length });
      }
      return fail(404, 'not_found');
    }

    // -- everything else needs a session --
    const raw = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    const who = sess.read(raw ? raw.slice(COOKIE.length + 1) : '');
    const viewer = who ? state.reps.get(who.repId) : null;
    if (!viewer || !viewer.active || !viewer.pin || viewer.pinVersion !== who.pinVersion) return fail(401, 'session');
    const boss = viewer.role === 'manager' || viewer.role === 'admin';
    const today = localDay(nowIso(), viewer.tz);
    const mine = (asId = null) => { const subject = asId ? state.reps.get(asId) : viewer; return { ok: true, ...repView(state, subject.id, ctx()), viewer: { id: viewer.id, role: viewer.role, as: asId, lang: viewer.lang, first: firstName(viewer.name) }, sample }; };
    const answer = (more = {}) => json(200, { ...more, ok: true, me: mine() });

    if (route === 'me' && req.method === 'GET') {
      const as = boss ? q.get('as') : null;
      if (as && !state.reps.has(as)) return fail(404, 'rep');
      return json(200, mine(as || null));
    }
    if (route === 'leads' && req.method === 'GET') return json(200, { ok: true, leads: searchLeads(store.leads(), q.get('q') || '', viewer.city).map(leadOut) });

    if (route === 'log' && req.method === 'POST') {
      if (!LOG_ID.test(String(body.id || ''))) return fail(400, 'id');
      if (!Object.hasOwn(KINDS, body.kind)) return fail(400, 'kind');
      if (state.logs.has(body.id)) return answer({ repeat: true, gained: 0, pending: 0, tookLead: false, streakUp: false, logId: body.id });
      if (state.closes.has(`${viewer.id}|${today}`)) return fail(409, 'day_closed');
      // The business: one the rep can pick (the CRM list, or one they already logged), or a new one with a name.
      let lead = null;
      const given = body.lead && typeof body.lead === 'object' ? body.lead : {};
      if (given.id) {
        const known = store.leads().get(String(given.id));
        const earlier = !known && (state.byRep.get(viewer.id) || []).map((x) => state.logs.get(x)).find((l) => l.lead.id === given.id);
        if (known && known.doNotCall) return fail(409, 'do_not_call');
        if (known) lead = { id: known.id, name: known.company, zone: known.zone || '' }; else if (earlier) lead = earlier.lead;
      } else if (text(given.name, 120).length >= 2) {
        const made = store.addLead({ company: text(given.name, 120), zone: text(given.zone, 80), city: viewer.city, by: viewer.id });
        lead = { id: made.id, name: made.company, zone: made.zone };
      }
      if (!lead) return fail(400, 'lead');
      const dup = (state.byRep.get(viewer.id) || []).map((x) => state.logs.get(x)).find((l) => l.day === today && l.lead.id === lead.id && l.kind === body.kind && !state.voids.has(l.id));
      if (dup) return answer({ repeat: true, gained: 0, pending: 0, tookLead: false, streakUp: false, logId: dup.id });
      const todays = () => ledger(state, viewer.id, { ...ctx(), from: today, to: today });
      const before = { pts: earnedPoints(todays()), streak: streak(state, viewer.id, today, ctx()).current, place: repView(state, viewer.id, ctx()).table.week.me?.place ?? null };
      const clientAt = Date.parse(body.clientAt);
      const event = { type: 'log', id: body.id, rep: viewer.id, lead, kind: body.kind, clientAt: Number.isNaN(clientAt) ? null : new Date(clientAt).toISOString() };
      const ch = channelOf(body.kind, body.channel); if (ch) event.channel = ch;
      if (body.voicemail === true) event.voicemail = true;
      if (TAGS.has(body.tag)) event.tag = body.tag;
      if (text(body.note, 500)) event.note = text(body.note, 500);
      if (text(body.contact, 120)) event.contact = text(body.contact, 120);
      if (text(body.when, 40)) event.when = text(body.when, 40);
      if (event.clientAt && Math.abs(clientAt - nowMs()) > RULES.lateMinutes * 60 * 1000) event.late = true;
      store.append(event);
      const view = mine();
      const after = todays();
      const gained = earnedPoints(after) - before.pts;
      const pending = after.filter((e) => e.logId === event.id && e.status === 'pending').reduce((a, e) => a + e.pts, 0);
      const place = view.table.week.me?.place ?? null;
      return json(200, { ok: true, repeat: false, logId: event.id, gained, pending, streakUp: view.streak ? view.streak.current > before.streak : false,
        // Taking the lead needs someone to take it from, and points that are already earned.
        tookLead: gained > 0 && place === 1 && before.place !== 1 && view.table.week.ranked >= 2, counts: flagsOf(event), me: view });
    }

    if (route === 'close' && req.method === 'POST') {
      const tomorrow = text(body.tomorrow, 280), blocker = text(body.blocker, 280);
      const closed = state.closes.get(`${viewer.id}|${today}`);
      // A preview never changes anything. Once the day is closed it answers the report as it was closed, so it can be copied again.
      if (body.preview === true) return json(200, { ok: true, closed: !!closed, report: closed ? reportText(viewer, today, closed.tomorrow, closed.blocker) : reportText(viewer, today, tomorrow, blocker) });
      if (closed) return fail(409, 'day_closed');
      if (tomorrow.length < 3) return fail(400, 'tomorrow');
      store.append({ type: 'day.close', rep: viewer.id, day: today, tomorrow, blocker });
      return answer({ report: reportText(viewer, today, tomorrow, blocker) });
    }

    if (route === 'goal' && req.method === 'POST') {
      const win = goalWindow(today);
      if (!win) return fail(409, 'goal_locked');
      const target = win.week;
      if (!goalOf(state, viewer.id, target, ctx()).options.includes(body.k)) return fail(400, 'goal');
      store.append({ type: 'goal.pick', rep: viewer.id, week: target, k: body.k });
      return answer({ week: target });
    }
    if (route === 'kudos' && req.method === 'POST') {
      const item = state.feed.find((f) => f.id === body.target);
      if (!item || item.rep === viewer.id) return fail(400, 'target');
      store.append({ type: 'kudos', by: viewer.id, target: item.id, on: body.on !== false });
      return answer();
    }
    if ((route === 'play' || route === 'held') && req.method === 'POST') {
      const log = state.logs.get(String(body.logId || ''));
      if (!log) return fail(404, 'log');
      if (log.rep !== viewer.id) return fail(403, 'not_yours');
      if (route === 'held') { if (log.kind !== 'meeting') return fail(400, 'kind'); store.append({ type: 'log.held', logId: log.id }); return answer(); }
      if (!text(body.text, 280)) return fail(400, 'text');
      store.append({ type: 'play', logId: log.id, text: text(body.text, 280) });
      return answer();
    }
    if (route === 'lang' && req.method === 'POST') {
      if (body.lang !== 'es' && body.lang !== 'en') return fail(400, 'lang');
      store.append({ type: 'rep.updated', id: viewer.id, patch: { lang: body.lang } });
      return answer();
    }

    // -- managers --
    if (!MANAGER_ROUTES.test(route)) return fail(405, 'method');
    if (!boss) return fail(403, 'manager_only');
    const team = () => json(200, { ok: true, ...teamView(state, ctx()), leadCount: store.leads().size });

    if (route === 'team' && req.method === 'GET') return team();
    if (route === 'confirm' && req.method === 'POST') {
      const log = state.logs.get(String(body.logId || '')), what = body.what, conf = state.confirms.get(body.logId) || {};
      if (!log || state.voids.has(log.id)) return fail(404, 'log');
      if (!(what === 'meeting_held' && log.kind === 'meeting') && !(['contract_sent', 'contract_signed'].includes(what) && log.kind === 'contract')) return fail(400, 'what');
      if (what === 'contract_signed' && !conf.contract_sent) return fail(409, 'order');
      store.append({ type: 'confirm', logId: log.id, what, by: viewer.id });
      return team();
    }
    if (route === 'void' && req.method === 'POST') {
      const log = state.logs.get(String(body.logId || ''));
      if (!log) return fail(404, 'log');
      store.append({ type: 'log.void', logId: log.id, by: viewer.id, reason: text(body.reason, 200) });
      return team();
    }
    if (route === 'reps' && req.method === 'POST') {
      const handle = text(body.handle, 60).toLowerCase(), name = text(body.name, 80);
      if (!HANDLE.test(handle) || name.length < 2) return fail(400, 'fields');
      if (state.handles.has(handle)) return fail(409, 'handle_taken');
      const workdays = Array.isArray(body.workdays) ? [...new Set(body.workdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
      const repId = id('r');
      store.append({ type: 'rep.created', id: repId, handle, name, role: viewer.role === 'admin' && ['manager', 'admin'].includes(body.role) ? body.role : 'rep',
        country: text(body.country, 2).toUpperCase() || 'PA', city: text(body.city, 60), tz: text(body.tz, 40) || 'America/Panama', workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
        startDate: DAY.test(body.startDate) ? body.startDate : today, lang: body.lang === 'en' ? 'en' : 'es' });
      return json(200, { ok: true, id: repId, setupUrl: setupLink(req, repId) });
    }
    const repRoute = route.match(/^reps\/([^/]+)(\/link)?$/);
    if (repRoute && req.method === 'POST') {
      const rep = state.reps.get(repRoute[1]);
      if (!rep) return fail(404, 'rep');
      if (rep.role !== 'rep' && viewer.role !== 'admin') return fail(403, 'admin_only');
      if (repRoute[2]) return json(200, { ok: true, id: rep.id, setupUrl: setupLink(req, rep.id) });
      const p = body.patch && typeof body.patch === 'object' ? body.patch : {}, patch = {};
      if (typeof p.name === 'string' && text(p.name, 80).length >= 2) patch.name = text(p.name, 80);
      if (typeof p.city === 'string') patch.city = text(p.city, 60);
      if (typeof p.country === 'string') patch.country = text(p.country, 2).toUpperCase();
      if (Array.isArray(p.workdays)) { const w = [...new Set(p.workdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(); if (w.length) patch.workdays = w; }
      if (typeof p.active === 'boolean' && rep.id !== viewer.id) patch.active = p.active;
      if (DAY.test(p.startDate)) patch.startDate = p.startDate;
      if (viewer.role === 'admin' && ['rep', 'manager', 'admin'].includes(p.role) && rep.id !== viewer.id) patch.role = p.role;
      if (!Object.keys(patch).length) return fail(400, 'patch');
      store.append({ type: 'rep.updated', id: rep.id, patch });
      return team();
    }
    if (route === 'dayoff' && req.method === 'POST') {
      const scope = text(body.scope, 40);
      if (!DAY.test(body.date) || !(scope === 'all' || /^[A-Z]{2}$/.test(scope) || state.reps.has(scope))) return fail(400, 'fields');
      store.append({ type: body.undo === true ? 'dayoff.undo' : 'dayoff', scope, date: body.date });
      return team();
    }
    if (route === 'site' && req.method === 'POST') {
      const rep = state.reps.get(String(body.rep || '')), lead = body.lead && typeof body.lead === 'object' ? body.lead : {};
      if (!rep || text(lead.name, 120).length < 2) return fail(400, 'fields');
      store.append({ type: 'site', id: id('s'), rep: rep.id, lead: { id: text(lead.id, 40) || null, name: text(lead.name, 120) }, by: viewer.id });
      return team();
    }
    const siteRoute = route.match(/^site\/([^/]+)$/);
    if (siteRoute && req.method === 'POST') {
      const site = state.sites.get(siteRoute[1]);
      if (!site) return fail(404, 'site');
      if (!['installed', 'first_hour'].includes(body.what)) return fail(400, 'what');
      store.append({ type: 'site.step', siteId: site.id, what: body.what, by: viewer.id });
      return team();
    }
    if (route === 'badge' && req.method === 'POST') {
      const rep = state.reps.get(String(body.rep || ''));
      if (!rep || !text(body.text, 140)) return fail(400, 'fields');
      store.append({ type: 'badge.give', id: id('b'), rep: rep.id, text: text(body.text, 140), by: viewer.id });
      return team();
    }
    return fail(405, 'method');
  };
}
