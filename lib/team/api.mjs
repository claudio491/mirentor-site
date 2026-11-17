// api.mjs: the sales team platform at /equipo. Reps sign in with a PIN, log each contact and see their own numbers;
// managers see everyone, confirm meetings and contracts, and create reps. Only paths under /equipo are answered here.
// Nothing a request carries is trusted to be the type it should be: text is read with text() and str(), never String().
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, KINDS, channelOf, crmRow, flagsOf, localDay, weekStart, addDays, goalWindow, validTz } from './rules.mjs';
import { openTeamStore, searchLeads, pickable, findLead } from './store.mjs';
import { hashPin, checkPin, validPin, newSetupToken, hashToken, sessions, lockout, SETUP_HOURS } from './auth.mjs';
import { dayStats, ledger, earnedPoints, goalOf, streak, logsByDay } from './score.mjs';
import { repView, teamView } from './view.mjs';

const BASE = '/equipo', API = `${BASE}/api`, COOKIE = 'mteam';
const MAX_BODY = 16 * 1024, MAX_LEADS = 4 * 1024 * 1024, WINDOW_MS = 10 * 60 * 1000;
const HANDLE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const LOG_ID = /^[A-Za-z0-9-]{8,64}$/;
const SITE_ID = /^s_[A-Za-z0-9-]{8,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TAGS = new Set(['meeting', 'waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call']);
// Every route the API answers. Anything else is a 404 before a session is even looked at.
const OPEN_ROUTES = /^(login|setup|logout)$/;
const TOKEN_ROUTES = /^(bootstrap|export|leads|leadmap)$/;
const REP_ROUTES = /^(me|leads|log|close|goal|kudos|play|held|lang)$/;
const MANAGER_ROUTES = /^(team|confirm|void|reopen|reps|reps\/[^/]+|reps\/[^/]+\/link|dayoff|site|site\/[^/]+|badge)$/;
const LONG_CACHE = 'public, max-age=31536000, immutable';   // fonts carry their version in the file name
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const HEADERS = {
  'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
  'content-security-policy': ["default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data:", "connect-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; '),
};
/** Text a person typed: only a string or a number is read, anything else is empty. Never throws. */
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
/** An id or a code: a string, or nothing. */
const str = (v) => (typeof v === 'string' ? v : '');
const isDay = (v) => typeof v === 'string' && DAY.test(v);
const isOn = (v) => ['1', 'true', 'yes', 'on'].includes(str(v).toLowerCase());
/** Working days are Monday to Friday: the hand has five fingers. */
const weekdays = (list) => (Array.isArray(list) ? [...new Set(list.filter((d) => Number.isInteger(d) && d >= 1 && d <= 5))].sort() : []);
const sameToken = (a, b) => { const x = createHash('sha256').update(str(a)).digest(), y = createHash('sha256').update(str(b)).digest(); return timingSafeEqual(x, y); };
const firstName = (name) => str(name).trim().split(/\s+/)[0] || '';

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

/** What the service's environment says about this module. It stays off until TEAM_ENABLED says so by name: sharing a
 * key with the desk must never be enough to publish /equipo on a deploy made for another reason. */
export function teamConfig(env) {
  if (!isOn(env.TEAM_ENABLED)) return null;
  const secret = env.TEAM_SECRET || (env.DESK_PASSWORD && env.DESK_PUSH_TOKEN ? `${env.DESK_PASSWORD}|${env.DESK_PUSH_TOKEN}` : '');
  if (!secret) return null;
  return { secret, pushToken: env.TEAM_PUSH_TOKEN || env.DESK_PUSH_TOKEN || '',
    origins: str(env.ALLOWED_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean), publicBase: str(env.TEAM_PUBLIC_BASE).replace(/\/+$/, ''),
    bootstrapOpen: isOn(env.TEAM_BOOTSTRAP) };
}

/** Start the module from the environment. If it cannot start (a damaged folder, say) the rest of the service still runs. */
export function startTeam(env, dir, log = console.error) {
  const config = teamConfig(env);
  if (!config) return null;
  try { return createTeam({ dir, ...config, log }); } catch (err) { log(`team: could not start, the service runs without /equipo: ${(err && err.message) || err}`); return null; }
}

export function createTeam({ dir, secret, pushToken, now = () => new Date(), staticDir = fileURLToPath(new URL('../../team', import.meta.url)), origins = [], publicBase = '',
  dev = false, previewOffsetMs = 0, bootstrapOpen = false, log = console.error }) {
  if (!secret || !dir) return null;
  const nowIso = () => now().toISOString(), nowMs = () => now().getTime();
  const store = openTeamStore(dir, { now: nowIso, log });
  const { state } = store;
  const sess = sessions(secret, nowMs), lock = lockout(nowMs);
  const hits = new Map();
  let assets = loadStatic(staticDir);
  // A folder filled by tools/team-seed.mjs carries this marker, and every view says the data is a sample.
  const sample = existsSync(path.join(store.dir, 'SAMPLE'));

  const ctx = () => ({ now: nowIso() });
  const limited = (ip, max = 30) => { const t = nowMs(), recent = (hits.get(ip) || []).filter((x) => t - x < WINDOW_MS); recent.push(t); hits.set(ip, recent); return recent.length > max; };
  const id = (prefix) => `${prefix}_${randomBytes(5).toString('hex')}`;
  const logsOf = (repId) => (state.byRep.get(repId) || []).map((x) => state.logs.get(x));

  function setupLink(req, repId) {
    const { token, tokenHash } = newSetupToken();
    store.append({ type: 'rep.setup', id: repId, tokenHash, exp: new Date(nowMs() + SETUP_HOURS * 3600 * 1000).toISOString() });
    const origin = str(req.headers.origin);
    const base = publicBase || (origins.includes(origin) ? origin : `${str(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers.host}`);
    return `${base}${BASE}/alta?t=${token}`;
  }
  const repBySetup = (token) => {
    const want = hashToken(token);
    for (const rep of state.reps.values()) if (rep.setup && rep.setup.tokenHash === want) return Date.parse(rep.setup.exp) > nowMs() ? rep : null;
    return null;
  };
  const leadOut = (l) => ({ id: l.id, name: l.company, zone: l.zone || '', known: !!(l.lastContact || state.leadFirstDay.get(l.id)) });

  /** The details a log may carry besides its result. Only what was sent, and only in the shape it should have. */
  function detailsOf(body, kind) {
    const d = {};
    if (typeof body.channel === 'string' && KINDS[kind].channels.includes(body.channel)) d.channel = body.channel;
    if (body.voicemail === true) d.voicemail = true;
    if (typeof body.tag === 'string' && TAGS.has(body.tag)) d.tag = body.tag;
    if (text(body.note, 500)) d.note = text(body.note, 500);
    if (text(body.contact, 120)) d.contact = text(body.contact, 120);
    if (isDay(body.when)) d.when = body.when;
    return d;
  }

  /** The agreed end-of-day report. Always Spanish: it is what posts in Slack. */
  function reportText(rep, day, tomorrow, blocker) {
    const st = dayStats(state, rep.id, day, ctx());
    const logs = logsOf(rep.id).filter((l) => l.day === day && !state.voids.has(l.id));
    const ws = weekStart(day);
    const weekMeetings = logsOf(rep.id).filter((l) => l.kind === 'meeting' && l.day >= ws && l.day <= addDays(ws, 6) && !state.voids.has(l.id)).length;
    return [`Reporte de hoy · ${rep.name}`,
      `Visitas: ${st.visits} · Conversaciones con dueño o encargado: ${st.conversations} · Reuniones agendadas: ${st.meetings} · Contratos enviados: ${logs.filter((l) => l.kind === 'contract').length}`,
      `Semana: ${weekMeetings} de ${RULES.goals.meetings} reuniones`, `Mañana: ${tomorrow || '…'}`, `Bloqueo: ${blocker || 'ninguno'}`].join('\n');
  }

  function exportSince(since) {
    const from = Date.parse(str(since)) || 0, order = ['Contacted', 'Intro call booked', 'Intro call done', 'Contract sent', 'Contract signed'];
    const logs = [], stage = new Map();
    const raise = (lead, s) => { if (lead.startsWith('APP-')) return; if (order.indexOf(s) > order.indexOf(stage.get(lead) ?? '')) stage.set(lead, s); };
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
  async function answerRequest(req, res, pathname) {
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { ...HEADERS, 'cache-control': 'no-store', 'content-type': type, ...extra }).end(body); return true; };
    const json = (status, body, extra) => send(status, 'application/json', JSON.stringify(body), extra);
    const fail = (status, error, more = {}, extra = undefined) => json(status, { ok: false, error, ...more }, extra);
    const ip = str(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();

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
      const br = file.br && /\bbr\b/.test(str(req.headers['accept-encoding']));
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
      if (!str(req.headers['content-type']).startsWith('application/json')) return fail(415, 'content_type');
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
      const handle = text(body.handle, 60).toLowerCase(), pin = str(body.pin);
      if (limited(ip) || lock.blocked(handle)) return fail(429, 'locked');
      const rep = state.reps.get(state.handles.get(handle));
      const usable = rep && rep.active && rep.pin;
      // An unknown handle costs the same work as a wrong PIN, so the answer's timing says nothing about who exists.
      const right = usable ? checkPin(pin, rep.pin.salt, rep.pin.hash) : (hashPin(pin, 'no-such-rep'), false);
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
      const rep = repBySetup(str(body.token));
      if (!rep) return fail(410, 'link_expired');
      if (!validPin(body.pin)) return fail(400, 'weak_pin');
      store.append({ type: 'rep.pin', id: rep.id, ...hashPin(body.pin) });
      lock.clear(rep.handle);
      return json(200, { ok: true, role: rep.role, lang: rep.lang, handle: rep.handle }, signIn(rep));
    }
    if (route === 'logout' && req.method === 'POST') return json(200, { ok: true }, cookieOut('', 0));

    // -- the nightly routine and the first manager: bearer token --
    const bearer = str(req.headers.authorization);
    const hasBearer = !!pushToken && bearer.startsWith('Bearer ') && sameToken(bearer.slice(7), pushToken);
    if (['bootstrap', 'export', 'leads', 'leadmap'].includes(route) && !(route === 'leads' && req.method === 'GET')) {
      if (!hasBearer) return fail(401, 'token');
      if (route === 'bootstrap' && req.method === 'POST') {
        const handle = text(body.handle, 60).toLowerCase(), name = text(body.name, 80), tz = text(body.tz, 40) || 'America/Panama';
        if (!HANDLE.test(handle) || name.length < 2 || !validTz(tz)) return fail(400, 'fields');
        // Once an admin can sign in, this door is shut: the token alone can no longer make an admin or retire one's PIN.
        // TEAM_BOOTSTRAP=1 opens it again, which is the way back in after a lost PIN.
        if (!bootstrapOpen && [...state.reps.values()].some((r) => r.role === 'admin' && r.active && r.pin)) return fail(409, 'bootstrap_closed');
        const existing = state.reps.get(state.handles.get(handle));
        if (existing) return existing.role === 'admin' ? json(200, { ok: true, id: existing.id, setupUrl: setupLink(req, existing.id) }) : fail(409, 'handle_taken');
        const repId = id('r');
        store.append({ type: 'rep.created', id: repId, handle, name, role: 'admin', country: text(body.country, 2).toUpperCase() || 'PA', city: text(body.city, 60), tz, workdays: [1, 2, 3, 4, 5], lang: body.lang === 'en' ? 'en' : 'es' });
        return json(200, { ok: true, id: repId, setupUrl: setupLink(req, repId) });
      }
      if (route === 'export' && req.method === 'GET') return json(200, { ok: true, ...exportSince(q.get('since') || '') });
      if (route === 'leads' && req.method === 'PUT') {
        if (!Array.isArray(body)) return fail(400, 'body');
        const list = body.filter((l) => l && typeof l === 'object' && (typeof l.id === 'string' || typeof l.id === 'number') && typeof l.company === 'string' && String(l.id) && l.company.trim());
        // A list that arrives empty, or at less than half its size, is far more likely a broken run than the truth.
        if (!list.length) return fail(400, 'empty');
        const have = store.crmCount();
        if (have >= 20 && list.length < have / 2 && q.get('force') !== '1') return fail(409, 'shrink', { have, got: list.length });
        return json(200, { ok: true, count: store.setLeads(list) });
      }
      if (route === 'leadmap' && req.method === 'POST') {
        const pairs = Array.isArray(body.pairs) ? body.pairs : [];
        return json(200, { ok: true, mapped: pairs.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && p[1] && store.mapLead(p[0], p[1])).length });
      }
      return fail(404, 'not_found');
    }

    // -- everything else needs a session --
    const raw = str(req.headers.cookie).split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
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
      const logId = str(body.id), kind = str(body.kind);
      if (!LOG_ID.test(logId)) return fail(400, 'id');
      if (!Object.hasOwn(KINDS, kind)) return fail(400, 'kind');
      const repeat = (more) => answer({ repeat: true, updated: false, gained: 0, pending: 0, tookLead: false, streakUp: false, ...more });
      if (state.logs.has(logId)) return repeat({ logId });   // the same id again is a retry, never an edit
      if (state.closes.has(`${viewer.id}|${today}`)) return fail(409, 'day_closed');
      // The business: one the rep can pick (the CRM list, or one they already logged), or a new one with a name.
      let lead = null;
      const given = body.lead && typeof body.lead === 'object' ? body.lead : {};
      const leadId = str(given.id), name = text(given.name, 120), zone = text(given.zone, 80);
      if (leadId) {
        const known = store.leads().get(leadId);
        const earlier = !known && logsOf(viewer.id).find((l) => l.lead.id === leadId);
        if (known && known.doNotCall) return fail(409, 'do_not_call');
        // The same rule as the search: a request that names an id cannot reach another city's business or one already signed.
        if (known) lead = pickable(known, viewer.city) ? { id: known.id, name: known.company, zone: known.zone || '' } : null; else if (earlier) lead = earlier.lead;
      } else if (name.length >= 2) {
        // A business typed as new a second time is the same business: same name and area in the rep's city.
        const same = findLead(store.leads(), name, zone, viewer.city);
        if (same && same.doNotCall) return fail(409, 'do_not_call');
        const made = same || store.addLead({ company: name, zone, city: viewer.city, by: viewer.id });
        lead = { id: made.id, name: made.company, zone: made.zone || '' };
      }
      if (!lead) return fail(400, 'lead');
      const details = detailsOf(body, kind);
      const dup = logsOf(viewer.id).find((l) => l.day === today && l.lead.id === lead.id && l.kind === kind && !state.voids.has(l.id));
      if (dup) {
        // The same result on the same business the same day earns nothing more, but what was typed the second time is kept.
        const changed = Object.fromEntries(Object.entries(details).filter(([k, v]) => dup[k] !== v));
        const updated = Object.keys(changed).length > 0;
        if (updated) store.append({ type: 'log.update', logId: dup.id, patch: changed, by: viewer.id });
        return repeat({ logId: dup.id, updated });
      }
      const todays = () => ledger(state, viewer.id, { ...ctx(), from: today, to: today });
      const before = { pts: earnedPoints(todays()), streak: streak(state, viewer.id, today, ctx()).current, place: repView(state, viewer.id, ctx()).table.week.me?.place ?? null };
      // In a preview the clock can run days away from the real one; the phone's time is moved by the same amount.
      const clientAt = typeof body.clientAt === 'string' ? Date.parse(body.clientAt) + previewOffsetMs : NaN;
      const event = { type: 'log', id: logId, rep: viewer.id, lead, kind, clientAt: Number.isNaN(clientAt) ? null : new Date(clientAt).toISOString(), ...details };
      const ch = channelOf(kind, details.channel); if (ch) event.channel = ch;
      // What the CRM knows about this business today is written on the log: whether it is a follow-up never changes afterwards.
      const cached = store.leads().get(lead.id);
      if (cached && isDay(cached.lastContact) && cached.lastContact < today) event.prior = cached.lastContact;
      if (event.clientAt && Math.abs(clientAt - nowMs()) > RULES.lateMinutes * 60 * 1000) event.late = true;
      store.append(event);
      const view = mine();
      const after = todays();
      const gained = earnedPoints(after) - before.pts;
      const pending = after.filter((e) => e.logId === event.id && e.status === 'pending').reduce((a, e) => a + e.pts, 0);
      const place = view.table.week.me?.place ?? null;
      return json(200, { ok: true, repeat: false, updated: false, logId: event.id, gained, pending, streakUp: view.streak ? view.streak.current > before.streak : false,
        // Taking the lead needs someone to take it from, and points that are already earned.
        tookLead: gained > 0 && place === 1 && before.place !== 1 && view.table.week.ranked >= 2, counts: flagsOf(event), me: view });
    }

    if (route === 'close' && req.method === 'POST') {
      const tomorrow = text(body.tomorrow, 280), blocker = text(body.blocker, 280);
      const closed = state.closes.get(`${viewer.id}|${today}`);
      // A preview never changes anything. Once the day is closed it answers the report as it was closed, so it can be copied again.
      // A day with nothing logged has nothing to report: this also stops a tap just after midnight from closing the wrong day.
      const empty = !closed && !(logsByDay(state, viewer.id).get(today) || []).length;
      if (body.preview === true) return json(200, { ok: true, closed: !!closed, empty, report: closed ? reportText(viewer, today, closed.tomorrow, closed.blocker) : reportText(viewer, today, tomorrow, blocker) });
      if (closed) return fail(409, 'day_closed');
      if (empty) return fail(409, 'nothing_to_close');
      if (tomorrow.length < 3) return fail(400, 'tomorrow');
      store.append({ type: 'day.close', rep: viewer.id, day: today, tomorrow, blocker });
      return answer({ report: reportText(viewer, today, tomorrow, blocker) });
    }

    if (route === 'goal' && req.method === 'POST') {
      const win = goalWindow(today);
      if (!win) return fail(409, 'goal_locked');
      if (!goalOf(state, viewer.id, win.week, ctx()).options.includes(body.k)) return fail(400, 'goal');
      store.append({ type: 'goal.pick', rep: viewer.id, week: win.week, k: body.k });
      return answer({ week: win.week });
    }
    if (route === 'kudos' && req.method === 'POST') {
      const item = state.feed.find((f) => f.id === body.target);
      if (!item || item.rep === viewer.id) return fail(400, 'target');
      store.append({ type: 'kudos', by: viewer.id, target: item.id, on: body.on !== false });
      return answer();
    }
    if ((route === 'play' || route === 'held') && req.method === 'POST') {
      const log = state.logs.get(str(body.logId));
      if (!log) return fail(404, 'log');
      if (log.rep !== viewer.id) return fail(403, 'not_yours');
      if (route === 'held') { if (log.kind !== 'meeting') return fail(400, 'kind'); store.append({ type: 'log.held', logId: log.id }); return answer(); }
      if (!text(body.text, 280)) return fail(400, 'text');
      store.append({ type: 'play', logId: log.id, text: text(body.text, 280) });
      return answer();
    }
    if (route === 'lang' && req.method === 'POST') {
      if (body.lang !== 'es' && body.lang !== 'en') return fail(400, 'lang');
      if (viewer.lang !== body.lang) store.append({ type: 'rep.updated', id: viewer.id, patch: { lang: body.lang } });
      return answer();
    }

    // -- managers --
    if (!MANAGER_ROUTES.test(route)) return fail(405, 'method');
    if (!boss) return fail(403, 'manager_only');
    const team = () => {
      const view = teamView(state, ctx()), leads = [...store.leads().values()];
      // The cities the lead list really uses, and how many businesses each rep can pick: a city typed another way finds none.
      const cities = [...new Set(leads.map((l) => l.city).filter((c) => typeof c === 'string' && c))].sort((a, b) => a.localeCompare(b, 'es'));
      for (const r of view.reps) r.leadsInCity = leads.filter((l) => pickable(l, r.city)).length;
      return json(200, { ok: true, ...view, leadCount: leads.length, cities });
    };

    if (route === 'team' && req.method === 'GET') return team();
    if (route === 'confirm' && req.method === 'POST') {
      const log = state.logs.get(str(body.logId)), what = str(body.what);
      if (!log || state.voids.has(log.id)) return fail(404, 'log');
      const conf = state.confirms.get(log.id) || {};
      if (!(what === 'meeting_held' && log.kind === 'meeting') && !(['contract_sent', 'contract_signed'].includes(what) && log.kind === 'contract')) return fail(400, 'what');
      if (body.undo === true) {
        // Taking back a confirmation made by mistake. A contract cannot lose "sent" while it still says "signed".
        if (!conf[what]) return fail(400, 'what');
        if (what === 'contract_sent' && conf.contract_signed) return fail(409, 'order');
        store.append({ type: 'confirm.undo', logId: log.id, what, by: viewer.id });
        return team();
      }
      if (what === 'contract_signed' && !conf.contract_sent) return fail(409, 'order');
      // The wait is over: the rep was already told this part earns nothing.
      const entry = ledger(state, log.rep, ctx()).find((e) => e.id === `${log.id}:${what}`);
      if (entry && entry.status === 'expired') return fail(409, 'expired');
      store.append({ type: 'confirm', logId: log.id, what, by: viewer.id });
      return team();
    }
    if (route === 'void' && req.method === 'POST') {
      const log = state.logs.get(str(body.logId));
      if (!log) return fail(404, 'log');
      store.append({ type: 'log.void', logId: log.id, by: viewer.id, reason: text(body.reason, 200) });
      return team();
    }
    if (route === 'reopen' && req.method === 'POST') {
      const rep = state.reps.get(str(body.rep));
      if (!rep) return fail(404, 'rep');
      if (!isDay(body.day) || !state.closes.has(`${rep.id}|${body.day}`)) return fail(409, 'not_closed');
      store.append({ type: 'day.reopen', rep: rep.id, day: body.day, by: viewer.id });
      return team();
    }
    if (route === 'reps' && req.method === 'POST') {
      const handle = text(body.handle, 60).toLowerCase(), name = text(body.name, 80), tz = text(body.tz, 40) || 'America/Panama';
      if (!HANDLE.test(handle) || name.length < 2 || !validTz(tz)) return fail(400, 'fields');
      if (state.handles.has(handle)) return fail(409, 'handle_taken');
      const workdays = weekdays(body.workdays);
      const repId = id('r');
      store.append({ type: 'rep.created', id: repId, handle, name, role: viewer.role === 'admin' && ['manager', 'admin'].includes(body.role) ? body.role : 'rep',
        country: text(body.country, 2).toUpperCase() || 'PA', city: text(body.city, 60), tz, workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
        startDate: isDay(body.startDate) ? body.startDate : today, lang: body.lang === 'en' ? 'en' : 'es' });
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
      if (weekdays(p.workdays).length) patch.workdays = weekdays(p.workdays);
      if (typeof p.active === 'boolean' && rep.id !== viewer.id) patch.active = p.active;
      if (isDay(p.startDate)) patch.startDate = p.startDate;
      if (viewer.role === 'admin' && ['rep', 'manager', 'admin'].includes(p.role) && rep.id !== viewer.id) patch.role = p.role;
      if (!Object.keys(patch).length) return fail(400, 'patch');
      store.append({ type: 'rep.updated', id: rep.id, patch });
      return team();
    }
    if (route === 'dayoff' && req.method === 'POST') {
      const scope = text(body.scope, 40);
      if (!isDay(body.date) || !(scope === 'all' || /^[A-Z]{2}$/.test(scope) || state.reps.has(scope))) return fail(400, 'fields');
      store.append({ type: body.undo === true ? 'dayoff.undo' : 'dayoff', scope, date: body.date });
      return team();
    }
    if (route === 'site' && req.method === 'POST') {
      const rep = state.reps.get(str(body.rep)), lead = body.lead && typeof body.lead === 'object' ? body.lead : {};
      if (!rep || text(lead.name, 120).length < 2) return fail(400, 'fields');
      // The id is made where the form is filled: the same id again is the same site, so a retry never doubles it.
      const siteId = SITE_ID.test(str(body.id)) ? body.id : id('s');
      if (!state.sites.has(siteId)) store.append({ type: 'site', id: siteId, rep: rep.id, lead: { id: text(lead.id, 40) || null, name: text(lead.name, 120) }, by: viewer.id });
      return team();
    }
    const siteRoute = route.match(/^site\/([^/]+)$/);
    if (siteRoute && req.method === 'POST') {
      const site = state.sites.get(siteRoute[1]), what = str(body.what);
      if (!site || site.void) return fail(404, 'site');
      if (what === 'void') { store.append({ type: 'site.void', siteId: site.id, by: viewer.id }); return team(); }
      if (!['installed', 'first_hour'].includes(what)) return fail(400, 'what');
      store.append({ type: 'site.step', siteId: site.id, what, by: viewer.id });
      return team();
    }
    if (route === 'badge' && req.method === 'POST') {
      const rep = state.reps.get(str(body.rep));
      if (!rep || !text(body.text, 140)) return fail(400, 'fields');
      store.append({ type: 'badge.give', id: id('b'), rep: rep.id, text: text(body.text, 140), by: viewer.id });
      return team();
    }
    return fail(405, 'method');
  }

  /** The handler the service mounts. Whatever goes wrong inside, the answer is a 500 and the process goes on. */
  return async function handle(req, res, pathname) {
    if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return false;
    try { return await answerRequest(req, res, pathname); } catch (err) {
      log(`team: ${req.method} ${pathname} failed: ${(err && err.stack) || err}`);
      if (!res.headersSent) res.writeHead(500, { ...HEADERS, 'cache-control': 'no-store', 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'server' }));
      else res.end();
      return true;
    }
  };
}
