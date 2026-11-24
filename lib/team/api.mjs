// api.mjs: the sales team's board. It has no sign-in of its own: it lives inside the sales portal, at /ventas/equipo, and
// knows each person by the Google account the portal already checked. Reps log each contact and see their own numbers;
// managers see everyone, confirm meetings and contracts, and add people by their work email. Only paths under its base
// are answered here.
// Nothing a request carries is trusted to be the type it should be: text is read with text() and str(), never String().
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, LADDER, SELF_STEPS, VIDEOS, KINDS, channelOf, crmRow, flagsOf, localDay, weekStart, addDays, goalWindow, validTz, isoWeekday, validMinutes, isCalendarDay } from './rules.mjs';
import { openTeamStore, searchLeads, pickable, findLead, norm } from './store.mjs';
import { realLeadId } from './state.mjs';
import { dayStats, ledger, earnedPoints, goalOf, streak, logsByDay } from './score.mjs';
import { repView, teamView, practiceRep, exampleReps, exampleStale } from './view.mjs';
import { leaderView } from './leader.mjs';
import { zonesFor } from './ladder.mjs';
import { MAX_PHOTO, photoKind, photoType, savePhoto, discardPhoto, keepOnlyPhoto, readPhoto, dropPhoto } from './photo.mjs';
import { MAX_CONSENT, CONSENT_FORMS, FIRST_CONSENT_DAY, saveConsent, discardConsent, keepOnlyConsent, readConsent, dropConsent } from './consent.mjs';
import { imeiFor, imeiKey, workerStatus, siteProgress, siteState, siteRecord } from './install.mjs';
import { routeOf } from './route.mjs';
import { DOC_ID, checkDoc, docGroups, moveOrders, nextOrder } from '../../team/docs-steps.js';
import { isMonday, MAX_RATE_CENTS } from './pay.mjs';
import { exampleTeam } from './example.mjs';
import { activityRows, removalRange } from './crm.mjs';
import { checkReport, prefillOf, reportDays, reportOf, reportRows, reportable, siteDay } from './report.mjs';
import { sheetText } from './sheet.mjs';

const MAX_BODY = 16 * 1024, MAX_LEADS = 4 * 1024 * 1024, MAX_PHOTO_BODY = 1024 * 1024, MAX_ACTIVITY = 1024 * 1024;
/** Past this many bytes a body that is over its limit is no longer read to its end: the connection is cut. */
const DRAIN_MAX = 32 * 1024 * 1024;
// An address a person can be added with. No plus sign: Google answers with the account's own address, so one with a
// tag after a plus could never open the board.
const EMAIL = /^[a-z0-9][a-z0-9._'-]{0,63}@[a-z0-9][a-z0-9.-]{0,180}\.[a-z]{2,}$/;
// Where the portal keeps its door. The board borrows it: the same sign-in page, the same session, the same sign-out.
// On its own host (SALES_HOST) the portal sits at the root, and so does its door.
const BOARD = '/ventas/equipo';
const PORTAL = { page: '/ventas', auth: '/ventas/auth', out: '/ventas/logout' }, PORTAL_AT_ROOT = { page: '/', auth: '/auth', out: '/logout' };
const LOG_ID = /^[A-Za-z0-9-]{8,64}$/;
const SITE_ID = /^s_[A-Za-z0-9-]{8,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TAGS = new Set(['meeting', 'waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call']);
/** How far from today the date a log carries (a meeting's, a contract's) may be, in days: a meeting held lately can still
 *  be logged, one booked months ahead too, and a typo like 2099 (which would never expire) cannot. */
const WHEN_BACK = 30, WHEN_AHEAD = 120;
// Every route the API answers. Anything else is a 404 before a session is even looked at.
const TOKEN_ROUTES = /^(bootstrap|export|leads|leadmap|hours|activity|sitereports)$/;
const REP_ROUTES = /^(me|leads|log|close|goal|kudos|play|held|lang|lead|zones|ladder|seen)$/;
// The install of a site: the rep who installs it and managers. Ids end up in file names and lookups, so only these shapes pass.
const INSTALL_ROUTE = /^install\/([A-Za-z0-9_-]{1,80})(?:\/(prep|coordinator|workers|close))?$/;
const WORKER_ROUTE = /^worker\/([A-Za-z0-9_-]{1,80})\/(consent|phone|phone\/return|clip|edit|remove)$/;
const RECORD_ROUTE = /^site\/([A-Za-z0-9_-]{1,80})\/record\.csv$/;
const CONSENT_ROUTE = /^consent\/([A-Za-z0-9_-]{1,80})$/;
const WORKER_ID = /^w_[A-Za-z0-9-]{8,60}$/;
// The daily report of a live site: read and written by its rep and by managers (report.mjs). A leader reads the export
// through the ops lead's sheet, not here: the leader allow-list below does not name this route.
const SITE_REPORT_ROUTE = /^site\/([A-Za-z0-9_-]{1,80})\/report$/;
// The documents: everyone on the team reads the list; a manager or an admin adds, edits, moves and removes.
const DOCS_ROUTE = /^docs(?:\/([A-Za-z0-9_-]{1,80})(?:\/(move|remove))?)?$/;
// The route of a business: the rep reads it and opens the site from it; the other three exist only for the practice rep.
const ROUTE_ROUTE = /^route(?:\/(site|confirm|phones|installed|hours))?$/;
// What only a player writes on their own account: a manager or an admin who is not acting is refused these.
const OWN_REP_WRITES = /^(log|close|goal|play|held)$/;
const MANAGER_ROUTES = /^(team|confirm|void|reopen|reps|reps\/[^/]+|dayoff|site|site\/[^/]+|badge|hours|pay|practice|practice\/remove|practice\/example|practice\/example\/remove)$/;
// The practice rep's name, as the server gives it. It has no address, so nobody can sign in as it.
const PRACTICE_NAME = 'Vendedor de práctica';
// A person's photo: anyone on the team may see it, only the service token may set it or take it down.
const PHOTO_ROUTE = /^photo\/([A-Za-z0-9_-]{1,80})$/;
// The sketches of what comes next: files like any other, but read only by a manager, an admin or a leader. Every other
// file the board serves needs no session, so these are checked by name before they are looked up.
const LEADERSHIP_FILES = new Set(['next.html', 'next.css', 'next.js']);
const LEADERSHIP_ROLES = ['manager', 'admin', 'leader'];
const LONG_CACHE = 'public, max-age=31536000, immutable';   // fonts carry their version in the file name
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const HEADERS = {
  'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
  'content-security-policy': ["default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data:", "connect-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; '),
};
/** Text a person typed: only a string or a number is read, anything else is empty. Never throws. */
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
/** One CSV value, quoted. A worker's name is typed by hand and the file opens in Sheets, so it is defused like every export (sheet.mjs). */
const csv = (v) => `"${sheetText(v === null || v === undefined ? '' : String(v)).replace(/"/g, '""')}"`;
/** A business as an export names it: its id as it is, its name and area defused for the sheet. */
const leadCell = (lead) => ({ ...lead, name: sheetText(lead.name), ...(lead.zone !== undefined ? { zone: sheetText(lead.zone) } : {}) });
/** An id or a code: a string, or nothing. */
const str = (v) => (typeof v === 'string' ? v : '');
const isDay = (v) => typeof v === 'string' && DAY.test(v);
const isOn = (v) => ['1', 'true', 'yes', 'on'].includes(str(v).toLowerCase());
/** Working days are Monday to Friday: the hand has five fingers. */
const weekdays = (list) => (Array.isArray(list) ? [...new Set(list.filter((d) => Number.isInteger(d) && d >= 1 && d <= 5))].sort() : []);
/** The weeks of an hours push, checked whole before anything is written: each a Monday, each count whole minutes from 0 to 100000. */
const hoursIn = (body) => {
  const weeks = Array.isArray(body.weeks) ? body.weeks : [];
  if (!weeks.length || weeks.length > 104) return { error: 'fields' };
  for (const w of weeks) {
    if (!w || typeof w !== 'object') return { error: 'fields' };
    if (!isDay(w.week) || Number.isNaN(Date.parse(w.week)) || new Date(Date.parse(w.week)).toISOString().slice(0, 10) !== w.week || isoWeekday(w.week) !== 1) return { error: 'week' };
    if (!validMinutes(w.delivered) || !validMinutes(w.accepted)) return { error: 'minutes' };
    if (w.accepted > w.delivered) return { error: 'fields' };
  }
  return { weeks: weeks.map((w) => ({ week: w.week, delivered: w.delivered, accepted: w.accepted })) };
};
const sameToken = (a, b) => { const x = createHash('sha256').update(str(a)).digest(), y = createHash('sha256').update(str(b)).digest(); return timingSafeEqual(x, y); };
const firstName = (name) => str(name).trim().split(/\s+/)[0] || '';
/** A work address as it is kept: trimmed and in lowercase, or nothing when it is not one. */
const emailOf = (v) => { const e = str(v).trim().toLowerCase(); return e.length <= 200 && EMAIL.test(e) ? e : ''; };
/** What may be said about a site when it is opened, by a manager or by its rep. Each fact is optional, and one that is
 *  sent must be well formed. Only a manager says a site is practice or legacy (`kinds`). */
function siteFacts(body, { kinds = false } = {}) {
  const extra = {};
  if (body.city !== undefined) { if (typeof body.city !== 'string') return { error: 'fields' }; extra.city = text(body.city, 60); }
  if (body.eligible !== undefined) { if (!Number.isInteger(body.eligible) || body.eligible < 0 || body.eligible > 5000) return { error: 'fields' }; extra.eligible = body.eligible; }
  if (body.coordinator !== undefined) {
    const c = body.coordinator && typeof body.coordinator === 'object' ? body.coordinator : {}, name = text(c.name, 80), phone = text(c.phone, 30);
    if (name.length < 2 || phone.length < 5) return { error: 'fields' };
    extra.coordinator = { name, phone };
  }
  if (kinds) {
    for (const k of ['practice', 'legacy']) if (body[k] !== undefined) { if (typeof body[k] !== 'boolean') return { error: 'fields' }; if (body[k]) extra[k] = true; }
    if (extra.practice && extra.legacy) return { error: 'fields' };
  }
  return { extra };
}

/** What a consent upload may say besides its photo (?signedOn=YYYY-MM-DD&form=v1), on a legacy site only: a past consent
 *  keeps the day it was signed (a real day, from FIRST_CONSENT_DAY to the site's today) and the form it was signed on.
 *  On a site installed through the app the consent is signed on install day, so neither is taken there. Nothing said,
 *  nothing changes: the upload's own day and form v1. */
function consentFacts(q, site, today) {
  const signedOn = q.get('signedOn'), form = q.get('form');
  if (signedOn === null && form === null) return {};
  if (!site.legacy) return { error: 'fields' };
  const out = {};
  if (signedOn !== null) { if (!isCalendarDay(signedOn) || signedOn < FIRST_CONSENT_DAY || signedOn > today) return { error: 'fields' }; out.signedOn = signedOn; }
  if (form !== null) { if (!CONSENT_FORMS.includes(form)) return { error: 'fields' }; out.form = form; }
  return out;
}

/** A request's body, up to `max` bytes: { bytes }, or { tooBig } when it is over the limit, or { gone } when the client
 *  left. A body over the limit is still read to its end (and thrown away) before the 413 goes out: leaving the loop
 *  early cuts the connection, the client then sees a network error instead of the 413, and the phone takes a network
 *  error for "no signal" and keeps the request waiting forever. One that says up front it is over the limit is not read
 *  here at all: the server reads the rest away once the answer is sent. Past DRAIN_MAX the connection is cut (`cut`). */
async function readBody(req, max) {
  const declared = Number(req.headers['content-length']);
  if (declared > max) return { tooBig: true, cut: declared > DRAIN_MAX };
  const chunks = []; let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= max) chunks.push(chunk); else chunks.length = 0;
      if (size > DRAIN_MAX) return { tooBig: true, cut: true };
    }
  } catch { return { gone: true }; }
  return size > max ? { tooBig: true } : { bytes: Buffer.concat(chunks) };
}

/** The board's files, read once. `pack` keeps a brotli copy of each text file; a preview reads them again on every
 *  request, so it skips that work and serves them as they are. */
function loadStatic(dir, pack = true) {
  const files = new Map();
  const walk = (folder, prefix) => {
    for (const name of readdirSync(folder)) {
      const full = path.join(folder, name), rel = `${prefix}${name}`;
      if (statSync(full).isDirectory()) { walk(full, `${rel}/`); continue; }
      const type = TYPES[path.extname(name).toLowerCase()];
      if (!type) continue;
      const body = readFileSync(full);
      const compress = pack && !/^(font\/woff2|image\/png|image\/webp)/.test(type);
      files.set(rel, { body, br: compress ? brotliCompressSync(body) : null, type, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"` });
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return files;
}

/** What the service's environment says about this module. It stays off until TEAM_ENABLED says so by name: a deploy
 * made for another reason must never be enough to publish the board. It keeps no secret of its own. */
export function teamConfig(env) {
  if (!isOn(env.TEAM_ENABLED)) return null;
  return { pushToken: env.TEAM_PUSH_TOKEN || env.DESK_PUSH_TOKEN || '',
    origins: str(env.ALLOWED_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean), bootstrapOpen: isOn(env.TEAM_BOOTSTRAP), guests: str(env.SALES_GUESTS).split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) };
}

/** Start the module from the environment, inside the sales portal: `sales` is the portal's handler (lib/sales.mjs).
 * Without the portal nobody could sign in, so the board stays off. If it cannot start (a damaged folder, say) the rest
 * of the service still runs. */
export function startTeam(env, dir, { sales = null, log = console.error } = {}) {
  const config = teamConfig(env);
  if (!config) return null;
  if (typeof sales !== 'function' || typeof sales.who !== 'function') { log('team: TEAM_ENABLED is set but the sales portal is off, and the portal is the only way in: the service runs without the board'); return null; }
  const identify = (req) => { const email = sales.who(req); return email ? { email } : null; };
  const portalHost = str(env.SALES_HOST).toLowerCase();
  const atRoot = (req) => !!portalHost && str(req.headers.host).split(':')[0].toLowerCase() === portalHost;
  const door = (req, res, what) => sales(req, res, (atRoot(req) ? PORTAL_AT_ROOT : PORTAL)[what]);
  try { return createTeam({ dir, ...config, base: BOARD, identify, door, log }); } catch (err) { log(`team: could not start, the service runs without the board: ${(err && err.message) || err}`); return null; }
}

/** `identify(req)` says who a request is: { email } for an account someone else already checked, or nothing. With
 * `dev` (a preview on one machine, never a service) it may name the person directly with { id }.
 * `door(req, res, what)` answers what the board has no screen for: 'page' (someone without a session opened the
 * board), 'auth' (the sign-in page posting back) and 'out'. */
export function createTeam({ dir, base = '/equipo', identify, door = null, domain = 'mirentor.com', pushToken, now = () => new Date(), staticDir = fileURLToPath(new URL('../../team', import.meta.url)), origins = [], guests = [],
  dev = false, previewOffsetMs = 0, bootstrapOpen = false, log = console.error }) {
  if (!dir || typeof identify !== 'function') return null;
  const API = `${base}/api`;
  const nowIso = () => now().toISOString(), nowMs = () => now().getTime();
  const store = openTeamStore(dir, { now: nowIso, log });
  const { state } = store;
  let assets = loadStatic(staticDir);
  // A folder filled by tools/team-seed.mjs carries this marker, and every view says the data is a sample.
  const sample = existsSync(path.join(store.dir, 'SAMPLE'));

  const ctx = () => ({ now: nowIso() });
  const id = (prefix) => `${prefix}_${randomBytes(5).toString('hex')}`;
  const logsOf = (repId) => (state.byRep.get(repId) || []).map((x) => state.logs.get(x));

  /** Who the request is, as whoever mounted the board says. An address is taken as it comes: whether it is one of
   *  ours is the lookup's job, so an account with an unusual address is told it is not on the team, not sent round in
   *  circles. Anything but a clear answer is nobody. */
  const whoIs = (req) => {
    let who = null;
    try { who = identify(req); } catch (err) { log(`team: could not tell who a request is: ${(err && err.message) || err}`); }
    if (!who || typeof who !== 'object') return null;
    const email = str(who.email).trim().toLowerCase().slice(0, 200);
    if (email) return { email };
    return dev && typeof who.id === 'string' && who.id ? { id: who.id } : null;
  };
  /** The same answer, but a redirect in it points at the board's own address. */
  const backHere = (res) => new Proxy(res, { get(target, key) {
    if (key === 'writeHead') return (status, headers = {}) => target.writeHead(status, headers.location ? { ...headers, location: `${base}/` } : headers);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  /** The short name exports and tools know a person by. It is made from their address, so nobody types or remembers it. */
  const handleFor = (email) => uniqueHandle(email.split('@')[0].replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 36));
  /** The same short name for a person added with no address yet: made from their name, accents dropped. */
  const handleFromName = (name) => uniqueHandle(name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, ''));
  const uniqueHandle = (raw) => {
    const stem = raw.length < 2 ? `rep-${raw || 'x'}` : raw;
    let handle = stem;
    for (let n = 2; state.handles.has(handle); n += 1) handle = `${stem}-${n}`;
    return handle;
  };
  /** An address a person may be added with: a real one, on the company domain, that nobody else has. */
  const newEmail = (value, except = null) => {
    const email = emailOf(value);
    if (!email) return { error: [400, 'fields'] };
    // A guest (SALES_GUESTS) is the one outside address the portal lets in, so the board may list them too.
    if (!email.endsWith(`@${domain}`) && !guests.includes(email)) return { error: [400, 'email_domain', { domain }] };
    const owner = state.emails.get(email);
    if (owner && owner !== except) return { error: [409, 'email_taken'] };
    return { email };
  };
  /** Each week is written once: the same numbers from the same source again change nothing and add nothing to the log. */
  const saveHours = (weeks, source, by) => {
    for (const w of weeks) {
      const have = state.hours.get(w.week);
      if (!have || have.delivered !== w.delivered || have.accepted !== w.accepted || have.source !== source) store.append({ type: 'hours.week', ...w, source, ...(by ? { by } : {}) });
    }
  };
  const leadOut = (l) => ({ id: l.id, name: l.company, zone: l.zone || '', known: !!(l.lastContact || state.leadFirstDay.get(l.id)) });

  /** The details a log may carry besides its result. Only what was sent, and only in the shape it should have: anything
   *  else is dropped and the log stands. A date (a meeting's, a contract's) is kept only as a real day near `today`. */
  function detailsOf(body, kind, today) {
    const d = {};
    if (typeof body.channel === 'string' && KINDS[kind].channels.includes(body.channel)) d.channel = body.channel;
    if (body.voicemail === true) d.voicemail = true;
    if (typeof body.tag === 'string' && TAGS.has(body.tag)) d.tag = body.tag;
    if (text(body.note, 500)) d.note = text(body.note, 500);
    if (text(body.contact, 120)) d.contact = text(body.contact, 120);
    if (isCalendarDay(body.when) && body.when >= addDays(today, -WHEN_BACK) && body.when <= addDays(today, WHEN_AHEAD)) d.when = body.when;
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
    // A business added in the app goes out under its temporary id: the bridge creates it in the CRM from newLeads and
    // reads its stage through the id it just made, in the same run. Once mapped, its logs go out again under that id.
    const raise = (lead, s) => { if (order.indexOf(s) > order.indexOf(stage.get(lead) ?? '')) stage.set(lead, s); };
    for (const log of state.logs.values()) {
      const rep = state.reps.get(log.rep), conf = state.confirms.get(log.id) || {};
      if (rep?.practice) continue;   // the CRM never receives a practice log
      if (log.crm) continue;   // nor a row it sent itself: it would hold it twice
      // when the log last changed: details added later (a repeat the same day) send it again, once, as it now stands
      const at = log.changedAt || log.t;
      const touched = [at, conf.meeting_held, conf.contract_sent, conf.contract_signed].some((t) => t && Date.parse(t) >= from);
      if (!touched || state.voids.has(log.id)) continue;
      // What people typed (the business, the owner's name, the note, the contact) is defused: the bridge writes it into a sheet.
      if (Date.parse(at) >= from) logs.push({ id: log.id, t: log.t, day: log.day, owner: sheetText(rep?.name || ''), handle: rep?.handle || '', lead: leadCell(log.lead), kind: log.kind, crm: crmRow(log), tag: log.tag || null,
        note: sheetText(log.note || ''), contact: sheetText(log.contact || ''), when: log.when || null });
      raise(log.lead.id, 'Contacted');
      if (log.kind === 'meeting') raise(log.lead.id, conf.meeting_held ? 'Intro call done' : 'Intro call booked');
      if (log.kind === 'contract' && conf.contract_sent) raise(log.lead.id, conf.contract_signed ? 'Contract signed' : 'Contract sent');
    }
    return { since: new Date(from).toISOString(), until: nowIso(), logs, stages: [...stage].map(([lead, s]) => ({ lead, stage: s })),
      newLeads: [...store.leads().values()].filter((l) => l.app && !l.practice).map((l) => ({ id: l.id, company: sheetText(l.company), zone: sheetText(l.zone), city: sheetText(l.city), createdAt: l.createdAt })),
      // a voided log says nothing: a "do not call" logged on the wrong business must not mark it
      doNotCall: [...state.logs.values()].filter((l) => !l.crm && l.tag === 'do_not_call' && !state.voids.has(l.id) && Date.parse(l.changedAt || l.t) >= from && !state.reps.get(l.rep)?.practice).map((l) => l.lead.id) };
  }

  // ---- request handling ----
  async function answerRequest(req, res, pathname) {
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { ...HEADERS, 'cache-control': 'no-store', 'content-type': type, ...extra }).end(body); return true; };
    const json = (status, body, extra) => send(status, 'application/json', JSON.stringify(body), extra);
    const fail = (status, error, more = {}, extra = undefined) => json(status, { ok: false, error, ...more }, extra);

    // ---- the client ----
    if (!pathname.startsWith(`${API}/`) && pathname !== API) {
      const at = pathname.slice(base.length + 1);
      // Signing in and out belong to the door: the sign-in page posts back to the address it was opened on. Signing
      // out comes back to the board's address, not to wherever the door would send: the next sign-in lands on the board.
      if (at === 'auth') return (door && (await door(req, res, 'auth'))) || fail(404, 'not_found');
      if (at === 'salir') return (door && (await door(req, backHere(res), 'out'))) || fail(404, 'not_found');
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method');
      // Every address inside the page is relative to this one, so it must end in a slash.
      if (pathname === base) return send(301, 'text/plain; charset=utf-8', '', { location: `${base}/${new URL(req.url, 'http://x').search}` });
      if (at === '' && !whoIs(req)) return (door && (await door(req, res, 'page'))) || send(401, 'text/plain; charset=utf-8', 'Sign in through the sales portal first.');
      if (dev) assets = loadStatic(staticDir, false);
      const rel = at === '' ? 'index.html' : at;
      const gated = LEADERSHIP_FILES.has(rel);
      if (gated) {
        const who = whoIs(req);
        if (!who) return fail(401, 'session');
        const person = state.reps.get(who.id || state.emails.get(who.email));
        if (!person || !person.active || !LEADERSHIP_ROLES.includes(person.role)) return fail(403, 'manager_only');
      }
      const file = /^[a-z0-9][a-z0-9._/-]*$/i.test(rel) && !rel.includes('..') ? assets.get(rel) : null;
      if (!file) return fail(404, 'not_found');
      const isPage = rel === 'index.html' || gated;   // never kept by a cache: who may read it is asked every time
      const head = { etag: file.etag, 'cache-control': isPage ? 'no-store' : file.type === 'font/woff2' ? LONG_CACHE : 'no-cache', vary: 'Accept-Encoding' };
      if (!isPage && req.headers['if-none-match'] === file.etag) return send(304, file.type, undefined, head);
      const br = file.br && /\bbr\b/.test(str(req.headers['accept-encoding']));
      return send(200, file.type, req.method === 'HEAD' ? undefined : br ? file.br : file.body, br ? { ...head, 'content-encoding': 'br' } : head);
    }

    // ---- the API ----
    const route = pathname.slice(API.length + 1);
    const photoRoute = route.match(PHOTO_ROUTE);
    const installRoute = route.match(INSTALL_ROUTE), workerRoute = route.match(WORKER_ROUTE), consentRoute = route.match(CONSENT_ROUTE);
    const recordRoute = route.match(RECORD_ROUTE), docsRoute = route.match(DOCS_ROUTE), routeRoute = route.match(ROUTE_ROUTE), siteReportRoute = route.match(SITE_REPORT_ROUTE);
    const consentUpload = !!workerRoute && workerRoute[2] === 'consent';   // the one write whose body is the image itself
    if (!installRoute && !workerRoute && !consentRoute && !recordRoute && !photoRoute && !docsRoute && !routeRoute && !siteReportRoute && !TOKEN_ROUTES.test(route) && !REP_ROUTES.test(route) && !MANAGER_ROUTES.test(route)) return fail(404, 'not_found');
    const q = new URL(req.url, 'http://x').searchParams;
    const post = req.method === 'POST' || req.method === 'PUT';
    if (post || req.method === 'DELETE') {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin) && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()) return fail(403, 'origin');
      if (post && !consentUpload && !str(req.headers['content-type']).startsWith('application/json')) return fail(415, 'content_type');
    }
    // -- who may send a body: the service token (the nightly routine, the first manager, the photos) or a session. Both
    // are checked before a byte of the body is read, so nobody without one can make the service read or parse megabytes.
    const bearer = str(req.headers.authorization);
    const hasBearer = !!pushToken && bearer.startsWith('Bearer ') && sameToken(bearer.slice(7), pushToken);
    const tokenRoute = (!!photoRoute && req.method !== 'GET')
      || (['bootstrap', 'export', 'leads', 'leadmap', 'hours', 'activity', 'sitereports'].includes(route) && !(route === 'leads' && req.method === 'GET') && !(route === 'hours' && req.method !== 'PUT'));
    if (tokenRoute && !hasBearer) return fail(401, 'token');
    const who = tokenRoute ? null : whoIs(req);
    if (!tokenRoute && !who) return fail(401, 'session');
    let body = null, raw = null;
    if (post) {
      // A consent is the image's own bytes (what they are comes from the bytes, not from a header). Everything else is
      // JSON, collected as bytes and decoded once: decoding chunk by chunk breaks an accent that falls on a chunk boundary.
      const max = consentUpload || photoRoute ? MAX_PHOTO_BODY : route === 'leads' ? MAX_LEADS : route === 'activity' ? MAX_ACTIVITY : MAX_BODY;
      const got = await readBody(req, max);
      if (got.gone) { res.destroy(); return true; }   // the client left mid-body: there is nobody to answer
      if (got.tooBig) return fail(413, consentUpload ? 'too_big' : 'too_large', undefined, got.cut ? { connection: 'close' } : undefined);
      if (consentUpload) { raw = got.bytes; body = {}; } else {
        try { body = JSON.parse(got.bytes.toString('utf8') || 'null'); } catch { return fail(400, 'body'); }
        if (body === null || typeof body !== 'object') return fail(400, 'body');
      }
    }

    // -- the nightly routine and the first manager: the service token, checked above --
    if (photoRoute && tokenRoute) {
      const person = state.reps.get(photoRoute[1]);
      if (!person) return fail(404, 'rep');
      // The event first, then the file: a log that cannot be written leaves the photo as it was.
      if (req.method === 'DELETE') { const old = person.photo; if (old) store.append({ type: 'rep.photo.removed', id: person.id }); dropPhoto(dir, person.id, old); return json(200, { ok: true, photo: null }); }
      if (req.method !== 'PUT') return fail(405, 'method');
      // The picture travels as base64 inside JSON, like every other write. What it is comes from its bytes, and must match what was said.
      const data = str(body.data), bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(data) ? Buffer.from(data, 'base64') : Buffer.alloc(0);
      const kind = photoKind(bytes);
      if (!kind || kind.type !== str(body.type)) return fail(400, 'photo');
      if (bytes.length > MAX_PHOTO) return fail(413, 'too_large');
      const old = person.photo, kept = savePhoto(dir, person.id, bytes);
      if (!kept) return fail(400, 'photo');
      // the new version is on disk under its own name; the old one goes only once the event naming the new one is written
      try { store.append({ type: 'rep.photo', id: person.id, ext: kept.ext, v: kept.v }); } catch (err) { discardPhoto(dir, person.id, kept); throw err; }
      keepOnlyPhoto(dir, person.id, kept, old);
      return json(200, { ok: true, photo: kept.v });
    }
    if (tokenRoute) {
      if (route === 'hours') {
        const got = hoursIn(body), source = text(body.source, 40);
        if (got.error) return fail(400, got.error);
        if (!source) return fail(400, 'fields');
        saveHours(got.weeks, source);
        return json(200, { ok: true, weeks: got.weeks.length });
      }
      // The CRM's Activities rows for reps who log there (crm.mjs decides each row). Nothing goes to the lead list.
      if (route === 'activity' && req.method === 'PUT') {
        const got = activityRows(state, body, { now: nowIso(), leads: store.leads() });
        if (got.error) return fail(400, got.error);
        for (const e of got.events) store.append(e);
        return json(200, { ok: true, added: got.added, repeated: got.repeated, refused: got.refused, reasons: got.reasons });
      }
      // Undoing an import: the CRM rows of those days leave, as one event. Nothing there, nothing written.
      if (route === 'activity' && req.method === 'DELETE') {
        const range = removalRange({ source: q.get('source'), from: q.get('from'), to: q.get('to') });
        if (!range) return fail(400, 'fields');
        const removed = [...state.logs.values()].filter((l) => l.crm && l.day >= range.from && l.day <= range.to).length;
        if (removed) store.append({ type: 'crm.log.removed', source: 'crm', ...range });
        return json(200, { ok: true, removed });
      }
      if (route === 'bootstrap' && req.method === 'POST') {
        const name = text(body.name, 80), tz = text(body.tz, 40) || 'America/Panama';
        if (name.length < 2 || !validTz(tz)) return fail(400, 'fields');
        // Once the team has an admin, this door is shut: the token alone can no longer make another. TEAM_BOOTSTRAP=1
        // opens it again, which is the way back in when the only admin has left or was made with the wrong address.
        if (!bootstrapOpen && [...state.reps.values()].some((r) => r.role === 'admin' && r.active)) return fail(409, 'bootstrap_closed');
        const existing = state.reps.get(state.emails.get(emailOf(body.email)));
        if (existing) return existing.role === 'admin' && existing.active ? json(200, { ok: true, id: existing.id, email: existing.email }) : fail(409, 'email_taken');
        const made = newEmail(body.email);
        if (made.error) return fail(...made.error);
        const repId = id('r');
        store.append({ type: 'rep.created', id: repId, handle: handleFor(made.email), email: made.email, name, role: 'admin', country: text(body.country, 2).toUpperCase() || 'PA', city: text(body.city, 60), tz, workdays: [1, 2, 3, 4, 5], lang: body.lang === 'en' ? 'en' : 'es' });
        return json(200, { ok: true, id: repId, email: made.email });
      }
      if (route === 'export' && req.method === 'GET') return json(200, { ok: true, ...exportSince(q.get('since') || '') });
      // The ops lead's sheet: the newest daily report of each real site and day written since `since` (report.mjs).
      if (route === 'sitereports' && req.method === 'GET') return json(200, { ok: true, ...reportRows(state, q.get('since') || '', nowIso()) });
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

    // -- everything else needs a session (checked above), and a place on the team --
    const viewer = state.reps.get(who.id || state.emails.get(who.email));
    // Signed in, but not one of ours (or no longer): they are told which account they used, and nothing else.
    if (!viewer || !viewer.active || viewer.practice) return fail(403, 'not_on_team', { email: who.email || '' });
    // A leader reads and changes nothing. This is the one place every signed-in request passes, and it is an allow-list:
    // a route added later is closed to leaders until someone lists it here. Static files are served before this point; the leadership files check their reader there.
    if (viewer.role === 'leader') {
      const get = req.method === 'GET';
      const allowed = (get && (route === 'me' || route === 'lead' || route === 'docs' || !!photoRoute || !!consentRoute || !!recordRoute)) || (req.method === 'POST' && route === 'lang');
      if (!allowed) return fail(403, 'read_only');
    }
    const boss = viewer.role === 'manager' || viewer.role === 'admin';
    // Whose screens a request is about. `?as=` carries it, on a read and on a write alike, and this is the one place it is
    // judged. A manager or an admin reads as any rep. A write as another person is taken only from a manager or an admin
    // and only for the practice rep: on behalf of a real person it is refused here, before anything is appended. A rep's
    // `as` on a read is ignored, as it always was; on a write, and from a leader, it is refused.
    const asked = q.get('as'), writes = req.method !== 'GET' && req.method !== 'HEAD';
    let subject = viewer;
    if (asked) {
      const target = state.reps.get(asked);
      if (writes && !(boss && target && target.practice)) return fail(403, 'read_only');
      if (boss) { if (!target) return fail(404, 'rep'); subject = target; }
    }
    const acting = subject !== viewer;
    // Acting touches only the practice rep's own things: a manager's own controls (people, sites, confirmations, hours,
    // the practice rep itself) are never run while acting, read or write. They are the manager's own screens.
    if (acting && MANAGER_ROUTES.test(route)) return fail(403, 'read_only');
    // A manager or an admin plays no part in the table: on their own account they log nothing, close no day, pick no
    // goal and mark no meeting. Only the practice rep's screens, while acting, write those. (Their own ladder preview
    // still saves its zones, videos and ticks, as it always did.)
    if (boss && !acting && writes && OWN_REP_WRITES.test(route)) return fail(403, 'not_a_player');
    // What an event written while acting carries besides its subject: the real person who wrote it.
    const actor = acting ? { by: viewer.id } : {};
    if (photoRoute) {   // the address carries the photo's version, so a phone may keep the file for a week
      const person = state.reps.get(photoRoute[1]);
      const bytes = person && person.photo ? readPhoto(dir, person.id, person.photo.ext, person.photo.v) : null;
      return bytes ? send(200, photoType(person.photo.ext), bytes, { 'cache-control': 'private, max-age=604800' }) : fail(404, 'photo');
    }
    /** The example team leaves whole: each practice site first with an event every build understands, then each of its
     *  businesses mapped to itself (the wave 2 build drops a business that way; it does not know the team), then the team
     *  with its example rate; the consent placeholders and the businesses in the cache go too. */
    const removeExample = (reps) => {
      const ids = new Set(reps.map((r) => r.id)), sites = [...state.sites.values()].filter((x) => ids.has(x.rep)), workers = sites.flatMap((x) => x.workers);
      const leads = [...state.appLeads.values()].filter((l) => l.practice && ids.has(l.by)).map((l) => l.id);
      const files = workers.map((wid) => [wid, state.workers.get(wid)?.consent || null]);   // which file is each one's, read before they leave
      for (const x of sites) store.append({ type: 'site.removed', siteId: x.id, by: viewer.id });
      for (const leadId of leads) store.append({ type: 'lead.map', temp: leadId, real: leadId, by: viewer.id });
      store.append({ type: 'practice.team.removed', ids: [...ids], by: viewer.id });
      for (const [wid, consent] of files) dropConsent(dir, wid, consent);
      for (const id of ids) store.dropPracticeLeads(id);
    };
    // Who may touch a site's install: managers and admins, and the rep named on the site. Nobody else.
    const canInstall = (v, site) => !!site && (v.role === 'manager' || v.role === 'admin' || site.rep === v.id);
    const today = localDay(nowIso(), subject.tz);
    /** Why accepted minutes cannot be recorded for this site and week, or null: the site is installed through the app,
     *  the week is a Monday from the week the site was opened to this one, the minutes are whole. A practice site is
     *  checked by the caller. */
    const hoursRefused = (site, body) => {
      if (site.legacy) return [409, 'legacy'];
      if (!site.steps.installed) return [409, 'not_installed'];
      if (!isMonday(body.week) || body.week > weekStart(today) || body.week < weekStart(siteDay(state, site, site.t))) return [400, 'week'];
      if (!validMinutes(body.accepted)) return [400, 'minutes'];
      return null;
    };
    const saveSiteHours = (site, body) => { if (state.siteHours.get(site.id)?.get(body.week)?.accepted !== body.accepted) store.append({ type: 'site.hours', siteId: site.id, week: body.week, accepted: body.accepted, by: viewer.id }); };
    const mine = () => ({ ok: true, ...repView(state, subject.id, { ...ctx(), lang: viewer.lang }), viewer: { id: viewer.id, role: viewer.role, as: acting ? subject.id : null, lang: viewer.lang, first: firstName(viewer.name), email: viewer.email }, sample });
    const answer = (more = {}) => json(200, { ...more, ok: true, me: mine() });

    const leaderMe = () => ({ ok: true, viewer: { id: viewer.id, role: 'leader', lang: viewer.lang, first: firstName(viewer.name), email: viewer.email } });
    if (route === 'me' && req.method === 'GET') {
      if (viewer.role === 'leader') return json(200, leaderMe());
      return json(200, mine());
    }
    if (route === 'lead' && req.method === 'GET') {
      if (!boss && viewer.role !== 'leader') return fail(403, 'manager_only');
      return json(200, { ok: true, ...leaderView(state, ctx()) });
    }
    if (route === 'leads' && req.method === 'GET') return json(200, { ok: true, leads: searchLeads(store.leads(), q.get('q') || '', subject.city, 20, state.zones.get(subject.id), { practice: !!subject.practice }).map(leadOut) });

    if (route === 'log' && req.method === 'POST') {
      const logId = str(body.id), kind = str(body.kind);
      if (!LOG_ID.test(logId)) return fail(400, 'id');
      if (!Object.hasOwn(KINDS, kind)) return fail(400, 'kind');
      const repeat = (more) => answer({ repeat: true, updated: false, gained: 0, pending: 0, tookLead: false, streakUp: false, ...more });
      if (state.logs.has(logId)) return repeat({ logId });   // the same id again is a retry, never an edit
      // A closed day takes no more logs. The practice rep's does: a demonstration goes on after the day is closed.
      if (!subject.practice && state.closes.has(`${subject.id}|${today}`)) return fail(409, 'day_closed');
      // The business: one the rep can pick (the CRM list, or one they already logged), or a new one with a name.
      let lead = null;
      const given = body.lead && typeof body.lead === 'object' ? body.lead : {};
      // An id the phone took before the CRM mapped that business (a log that waited in its queue) is read as the CRM's id.
      const leadId = realLeadId(state, str(given.id)), name = text(given.name, 120), zone = text(given.zone, 80);
      if (leadId) {
        const known = store.leads().get(leadId);
        const earlier = !known && logsOf(subject.id).find((l) => l.lead.id === leadId);
        if (known && known.doNotCall) return fail(409, 'do_not_call');
        // The same rule as the search: a request that names an id cannot reach another city's business or one already signed.
        if (known) lead = pickable(known, subject.city, { practice: !!subject.practice }) ? { id: known.id, name: known.company, zone: known.zone || '' } : null; else if (earlier) lead = earlier.lead;
      } else if (name.length >= 2) {
        // A business typed as new a second time is the same business: same name and area in the rep's city.
        const same = findLead(store.leads(), name, zone, subject.city, { practice: !!subject.practice });
        if (same && same.doNotCall) return fail(409, 'do_not_call');
        const made = same || store.addLead({ company: name, zone, city: subject.city, by: subject.id, practice: !!subject.practice, actor: actor.by });
        lead = { id: made.id, name: made.company, zone: made.zone || '' };
      }
      if (!lead) return fail(400, 'lead');
      const details = detailsOf(body, kind, today);
      const dup = logsOf(subject.id).find((l) => l.day === today && l.lead.id === lead.id && l.kind === kind && !state.voids.has(l.id));
      if (dup) {
        // The same result on the same business the same day earns nothing more, but what was typed the second time is kept.
        const changed = Object.fromEntries(Object.entries(details).filter(([k, v]) => dup[k] !== v));
        const updated = Object.keys(changed).length > 0;
        if (updated) store.append({ type: 'log.update', logId: dup.id, patch: changed, by: viewer.id });
        return repeat({ logId: dup.id, updated });
      }
      const todays = () => ledger(state, subject.id, { ...ctx(), from: today, to: today });
      const before = { pts: earnedPoints(todays()), streak: streak(state, subject.id, today, ctx()).current, place: repView(state, subject.id, ctx()).table.week.me?.place ?? null };
      // In a preview the clock can run days away from the real one; the phone's time is moved by the same amount.
      const clientAt = typeof body.clientAt === 'string' ? Date.parse(body.clientAt) + previewOffsetMs : NaN;
      const event = { type: 'log', id: logId, rep: subject.id, ...actor, lead, kind, clientAt: Number.isNaN(clientAt) ? null : new Date(clientAt).toISOString(), ...details };
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
      const closed = state.closes.get(`${subject.id}|${today}`);
      // A preview never changes anything. Once the day is closed it answers the report as it was closed, so it can be copied again.
      // A day with nothing logged has nothing to report: this also stops a tap just after midnight from closing the wrong day.
      const empty = !closed && !(logsByDay(state, subject.id).get(today) || []).length;
      if (body.preview === true) return json(200, { ok: true, closed: !!closed, empty, report: closed ? reportText(subject, today, closed.tomorrow, closed.blocker) : reportText(subject, today, tomorrow, blocker) });
      if (closed) return fail(409, 'day_closed');
      if (empty) return fail(409, 'nothing_to_close');
      if (tomorrow.length < 3) return fail(400, 'tomorrow');
      store.append({ type: 'day.close', rep: subject.id, ...actor, day: today, tomorrow, blocker });
      return answer({ report: reportText(subject, today, tomorrow, blocker) });
    }

    if (route === 'goal' && req.method === 'POST') {
      const win = goalWindow(today);
      if (!win) return fail(409, 'goal_locked');
      if (!goalOf(state, subject.id, win.week, ctx()).options.includes(body.k)) return fail(400, 'goal');
      store.append({ type: 'goal.pick', rep: subject.id, ...actor, week: win.week, k: body.k });
      return answer({ week: win.week });
    }
    if (route === 'kudos' && req.method === 'POST') {
      if (subject.practice) return fail(403, 'read_only');   // a clap from the practice rep would show on a real person's line
      const item = state.feed.find((f) => f.id === body.target);
      // a line of the practice world is no target for a real person, even with its id guessed
      if (!item || item.rep === viewer.id || state.reps.get(item.rep)?.practice) return fail(400, 'target');
      store.append({ type: 'kudos', by: viewer.id, target: item.id, on: body.on !== false });
      return answer();
    }
    if ((route === 'play' || route === 'held') && req.method === 'POST') {
      const log = state.logs.get(str(body.logId));
      if (!log) return fail(404, 'log');
      if (log.rep !== subject.id) return fail(403, 'not_yours');
      if (route === 'held') { if (log.kind !== 'meeting') return fail(400, 'kind'); store.append({ type: 'log.held', logId: log.id, ...actor }); return answer(); }
      if (!text(body.text, 280)) return fail(400, 'text');
      store.append({ type: 'play', logId: log.id, text: text(body.text, 280), ...actor });
      return answer();
    }
    // -- the first days: the two areas a rep works, the steps they tick, the videos they opened --
    if (route === 'zones' && req.method === 'GET') return json(200, { ok: true, zones: zonesFor(store.leads(), subject.city), picked: state.zones.get(subject.id) || [] });
    if (route === 'zones' && req.method === 'POST') {
      const offered = new Map(zonesFor(store.leads(), subject.city).map((z) => [norm(z), z]));
      const picks = Array.isArray(body.zones) ? body.zones.map((z) => (typeof z === 'string' ? offered.get(norm(z)) : undefined)) : [];
      if (picks.length !== 2 || picks.some((z) => !z) || picks[0] === picks[1]) return fail(400, 'zones');
      const now = state.zones.get(subject.id) || [];
      if (!(now.length === 2 && picks.every((z) => now.some((n) => norm(n) === norm(z))))) store.append({ type: 'zones.pick', rep: subject.id, ...actor, zones: picks });
      return answer();
    }
    if (route === 'ladder' && req.method === 'POST') {
      const step = str(body.step);
      if (!LADDER.includes(step)) return fail(400, 'step');
      // A rep ticks their own three steps (and so does a manager acting as the practice rep). Only a manager names a rep,
      // and only for the first approved hour.
      if (body.rep !== undefined && !boss) return fail(403, 'step_locked');
      const target = body.rep === undefined ? subject.id : str(body.rep);
      if (target !== subject.id || step === 'hour') {
        if (!boss || step !== 'hour') return fail(403, 'step_locked');
        if (body.rep === undefined) return fail(400, 'rep');
      } else if (!SELF_STEPS.includes(step)) return fail(403, 'step_locked');
      if (!state.reps.has(target)) return fail(404, 'rep');
      if (acting && target !== subject.id) return fail(403, 'read_only');   // acting ticks the practice rep's own steps only
      // `undo` takes back the first approved hour, a manager's tick only: the rep's own ticks stay as they were.
      if (body.undo !== undefined && body.undo !== true) return fail(400, 'fields');
      if (body.undo) {
        if (step !== 'hour') return fail(403, 'step_locked');
        if (state.ticks.has(`${target}|hour`)) store.append({ type: 'ladder.untick', rep: target, step, by: viewer.id });
        return answer();
      }
      if (!state.ticks.has(`${target}|${step}`)) store.append({ type: 'ladder.tick', rep: target, step, by: viewer.id });
      return answer();
    }
    if (route === 'seen' && req.method === 'POST') {
      const video = str(body.video);
      if (!Object.hasOwn(VIDEOS, video)) return fail(400, 'video');
      if (!state.seen.get(subject.id)?.has(video)) store.append({ type: 'video.seen', rep: subject.id, ...actor, video });
      return answer();
    }
    if (route === 'lang' && req.method === 'POST') {
      if (body.lang !== 'es' && body.lang !== 'en') return fail(400, 'lang');
      if (viewer.lang !== body.lang) store.append({ type: 'rep.updated', id: viewer.id, patch: { lang: body.lang } });
      return viewer.role === 'leader' ? json(200, leaderMe()) : answer();
    }

    // -- the documents: one list for the whole team, read by everyone (a leader and the practice rep too), written only
    // by a manager or an admin on their own screens. Opening a document appends nothing.
    if (docsRoute) {
      const docs = () => [...state.docs.values()];
      const list = () => json(200, { ok: true, groups: docGroups(docs()).map((g) => ({ group: g.group, docs: g.docs.map(({ id: docId, title, note, url, group, lang, step, order, t }) => ({ id: docId, title, note, url, group, lang, step, order, t })) })) });
      if (route === 'docs' && req.method === 'GET') return list();
      if (req.method !== 'POST') return fail(405, 'method');
      if (!boss) return fail(403, 'manager_only');
      if (acting) return fail(403, 'read_only');   // managing documents is never done while acting as anyone
      if (!docsRoute[1]) {
        const docId = DOC_ID.test(str(body.id)) ? body.id : id('d');
        if (state.docs.has(docId)) return list();   // the same form again: one document
        const got = checkDoc(body);
        if (got.error) return fail(400, got.error);
        store.append({ type: 'doc.added', id: docId, ...got.doc, order: got.doc.order ?? nextOrder(docs(), got.doc.group), by: viewer.id });
        return list();
      }
      const doc = state.docs.get(docsRoute[1]);
      if (!doc) return fail(404, 'doc');
      if (docsRoute[2] === 'remove') { store.append({ type: 'doc.removed', id: doc.id, by: viewer.id }); return list(); }
      if (docsRoute[2] === 'move') {
        if (body.dir !== 'up' && body.dir !== 'down') return fail(400, 'fields');
        for (const change of moveOrders(docs(), doc.id, body.dir)) store.append({ type: 'doc.updated', id: change.id, patch: { order: change.order }, by: viewer.id });
        return list();
      }
      // An edit: the patch is laid over the document and the whole is checked. Only what changes is written.
      const p = body.patch && typeof body.patch === 'object' ? body.patch : {};
      const given = Object.fromEntries(['title', 'note', 'url', 'group', 'lang', 'step', 'order'].filter((k) => k in p).map((k) => [k, p[k]]));
      const got = checkDoc({ ...doc, ...given });
      if (got.error) return fail(400, got.error);
      const next = { ...got.doc };
      if (next.group !== doc.group && given.order === undefined) next.order = nextOrder(docs(), next.group);   // a new group: at its end
      const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(doc[k])));
      if (Object.keys(patch).length) store.append({ type: 'doc.updated', id: doc.id, patch, by: viewer.id });
      return list();
    }

    // -- the route of a business, from interested to installed (route.mjs). The rep reads it, and opens the site from it
    // once a manager confirmed the signature: only for themself (the subject) and only for a business of their own. The
    // other three writes are what a manager does elsewhere, offered here only while a manager or an admin acts as the
    // practice rep, on the practice rep's own business: they append the same events, by the real person. For anyone
    // else they do not exist.
    if (routeRoute) {
      const what = routeRoute[1];
      if (!what) {
        if (req.method !== 'GET') return fail(405, 'method');
        const asked = str(q.get('lead'));
        if (!asked) return fail(400, 'lead');
        // A screen opened before the CRM mapped the business asks by the old id: it gets the business's route under the id
        // it asked by, so it finds it, and what it writes next is read through the mapping too.
        const found = routeOf(state, subject.id, realLeadId(state, asked));
        return json(200, { ok: true, route: found.lead.id === asked ? found : { ...found, lead: { ...found.lead, id: asked } } });
      }
      if (req.method !== 'POST') return fail(405, 'method');
      if (what !== 'site' && !(acting && subject.practice)) return fail(403, 'practice_only');
      // a practice site's accepted minutes, recorded by the manager acting as its practice rep: the manager route is a
      // real site's only
      if (what === 'hours') {
        const site = state.sites.get(str(body.site));
        if (!site || site.void || site.rep !== subject.id) return fail(404, 'site');
        const no = hoursRefused(site, body);
        if (no) return fail(...no);
        saveSiteHours(site, body);
        return answer();
      }
      const leadId = realLeadId(state, str(body.lead));
      if (!leadId) return fail(400, 'lead');
      const way = routeOf(state, subject.id, leadId);
      if (what === 'site') {
        // The id is made where the form is filled: the same id again is the same site.
        const siteId = SITE_ID.test(str(body.id)) ? body.id : id('s'), same = state.sites.get(siteId);
        if (same) return same.rep === subject.id && same.lead.id === leadId ? answer() : fail(409, 'id_taken');
        if (way.site) return fail(409, 'site_exists');
        if (!way.contract || !way.contract.signed) return fail(403, 'contract_unsigned');
        const facts = siteFacts(body);
        if (facts.error) return fail(400, facts.error);
        // The name comes from the business; with no city typed, the site is in the rep's city; a site for the practice
        // rep is a practice site.
        store.append({ type: 'site', id: siteId, rep: subject.id, lead: { id: leadId, name: way.lead.name }, ...facts.extra, city: facts.extra.city || subject.city || '', ...(subject.practice ? { practice: true } : {}), by: viewer.id });
        return answer();
      }
      if (what === 'confirm') {
        const part = str(body.what), c = way.contract;
        if (!c) return fail(404, 'log');
        if (part !== 'contract_sent' && part !== 'contract_signed') return fail(400, 'what');
        if (part === 'contract_signed' && !c.sent) return fail(409, 'order');
        if (!c[part === 'contract_sent' ? 'sent' : 'signed']) {
          const entry = ledger(state, subject.id, ctx()).find((e) => e.id === `${c.logId}:${part}`);
          if (entry && entry.status === 'expired') return fail(409, 'expired');
          store.append({ type: 'confirm', logId: c.logId, what: part, by: viewer.id });
        }
        return answer();
      }
      const site = way.site && state.sites.get(way.site.id);
      if (!site) return fail(404, 'site');
      if (what === 'phones') {
        if (!Number.isInteger(body.count) || body.count < 1 || body.count > 500) return fail(400, 'fields');
        store.append({ type: 'site.phones', siteId: site.id, count: body.count, by: viewer.id });
        return answer();
      }
      // the same rule as a manager's confirmation: a site that has workers is installed once its rep closed it
      if (!site.legacy && site.workers.length && !site.closed) return fail(409, 'install_not_closed');
      if (!site.steps.installed) store.append({ type: 'site.step', siteId: site.id, what: 'installed', by: viewer.id });
      return answer();
    }

    // -- the audit record of a site: who signed, which phone they were given, when it came back --
    if (recordRoute) {
      if (req.method !== 'GET') return fail(405, 'method');
      if (!boss && viewer.role !== 'leader') return fail(403, 'manager_only');
      const site = state.sites.get(recordRoute[1]);
      // a voided site keeps its record: the consents signed there are the proof a buyer or the site may still ask for
      if (!site || site.practice) return fail(404, 'site');
      // The last two columns point at the signed consent: the worker's id and the app's address of the photo.
      const consentAt = (r) => (state.workers.get(r.workerId)?.consent ? `${API}/consent/${r.workerId}` : '');
      const rows = siteRecord(state, site.id).map((r) => [r.worker, r.email, r.signedOn, r.form, r.imei, r.givenOn, r.returnedOn, r.workerId, consentAt(r), r.removedOn].map(csv).join(','));
      const body = ['worker,email,signed_on,form,imei,given_on,returned_on,worker_id,consent,removed_on', ...rows].join('\n') + '\n';
      return send(200, 'text/csv; charset=utf-8', body, { 'content-disposition': `attachment; filename="record-${site.id}.csv"` });
    }

    // -- the install of a site --
    if (installRoute || workerRoute || consentRoute) {
      const worker = workerRoute ? state.workers.get(workerRoute[1]) : consentRoute ? state.workers.get(consentRoute[1]) : null;
      const site = installRoute ? state.sites.get(installRoute[1]) : worker ? state.sites.get(worker.site) : null;
      // A voided real site keeps its signed consents for whoever reads the record (a manager, an admin, a leader): the
      // photos are the proof of what was signed there. Nothing else of it opens again.
      const kept = !!site && site.void && !site.practice && !!consentRoute && (boss || viewer.role === 'leader');
      // Nothing there, or voided: only someone who could have used it is told so. Everyone else gets the same 403 as for a
      // site that exists, so an id cannot be probed.
      if (!site || (site.void && !kept)) {
        const may = site ? canInstall(viewer, site) : boss;
        if (!may && !(consentRoute && viewer.role === 'leader')) return fail(403, 'not_yours');
        return fail(404, installRoute ? 'site' : 'worker');
      }
      // A removed worker takes nothing more. Their consent photo still answers at its address, for the record.
      if (workerRoute && worker.removed) return canInstall(viewer, site) ? fail(404, 'worker') : fail(403, 'not_yours');
      if (consentRoute) {
        if (req.method !== 'GET') return fail(405, 'method');
        if (!canInstall(viewer, site) && viewer.role !== 'leader') return fail(403, 'not_yours');
        const bytes = worker.consent ? readConsent(dir, worker.id, worker.consent.ext, worker.consent.v) : null;
        return bytes ? send(200, photoType(worker.consent.ext), bytes, { 'cache-control': 'private, no-store' }) : fail(404, 'consent');
      }
      if (!canInstall(viewer, site)) return fail(403, 'not_yours');
      // While acting, a manager writes on the practice rep's own sites only: a real site is changed on their own screens.
      if (acting && req.method !== 'GET' && site.rep !== subject.id) return fail(403, 'read_only');
      const view = () => ({
        ok: true,
        site: { id: site.id, name: site.lead.name, city: site.city, state: siteState(site), eligible: site.eligible, phones: site.phones, prep: site.prep, coordinator: site.coordinator, practice: site.practice, legacy: site.legacy, closed: site.closed, installed: !!site.steps.installed },
        workers: site.workers.map((wid) => state.workers.get(wid)).filter(Boolean).map((w) => ({ id: w.id, name: w.name, email: w.email, phone: w.phone,
          status: workerStatus(w), consent: w.consent ? { v: w.consent.v, form: w.consent.form, t: w.consent.t, signedOn: w.consent.signedOn || siteDay(state, site, w.consent.t) } : null, imei: w.imei, clip: w.clip })),
        progress: siteProgress(state, site.id),
      });
      if (installRoute && !installRoute[2]) return req.method === 'GET' ? json(200, view()) : fail(405, 'method');
      if (req.method === 'GET') return fail(405, 'method');
      // A site signed before installs went on the board has nothing to install here: no phones, no clips, no close. A
      // manager or an admin loads the consents it already has: a worker with a name (an email if there is one) and the
      // consent photo, and can correct or remove them. It pays nothing and posts nothing, as before.
      if (site.legacy) {
        const kind = installRoute ? installRoute[2] : workerRoute[2];
        if (!boss || !['workers', 'consent', 'edit', 'remove'].includes(kind)) return fail(409, 'legacy');
      }
      if (installRoute) {
        const what = installRoute[2];
        if (what === 'prep') {
          if (body.what !== 'signs' && body.what !== 'zones') return fail(400, 'what');
          if (!site.prep[body.what]) store.append({ type: 'site.prep', siteId: site.id, what: body.what, by: viewer.id });
          return json(200, view());
        }
        if (what === 'coordinator') {
          const name = text(body.name, 80), phone = text(body.phone, 30);
          if (name.length < 2 || phone.length < 5) return fail(400, 'fields');
          store.append({ type: 'site.coordinator', siteId: site.id, name, phone, by: viewer.id });
          return json(200, view());
        }
        if (what === 'workers') {
          const wid = str(body.id), name = text(body.name, 80), email = emailOf(body.email);
          if (!WORKER_ID.test(wid)) return fail(400, 'id');
          if (name.length < 2) return fail(400, 'fields');
          // On a legacy site the email is optional (a past consent may have none) and nobody is given a phone.
          if (!email && !(site.legacy && !str(body.email).trim())) return fail(400, 'email');
          if (body.phone !== undefined && typeof body.phone !== 'boolean') return fail(400, 'fields');
          const known = state.workers.get(wid);
          if (known && known.site !== site.id) return fail(409, 'id_taken');
          // The same id again is the same worker: a retry after a bad connection adds nobody.
          if (!known) store.append({ type: 'worker.added', siteId: site.id, id: wid, name, email, phone: site.legacy ? false : body.phone !== false, by: viewer.id });
          return json(200, view());
        }
        if (what === 'close') {
          if (!site.closed) {
            if (!siteProgress(state, site.id).ready) return fail(409, 'nobody_ready');
            store.append({ type: 'install.close', siteId: site.id, by: viewer.id });
          }
          return json(200, view());
        }
      }
      const kind = workerRoute[2];
      if (kind === 'consent') {
        if (req.method !== 'PUT') return fail(405, 'method');
        const said = consentFacts(q, site, siteDay(state, site, nowIso()));
        if (said.error) return fail(400, said.error);
        if (!photoKind(raw)) return fail(400, 'image');
        if (raw.length > MAX_CONSENT) return fail(413, 'too_big');
        const old = worker.consent, kept = saveConsent(dir, worker.id, raw);
        if (!kept) return fail(400, 'image');
        // The new photo is on disk under its own name; the one in force goes only once the event naming the new one is
        // written. A log that cannot be written takes the new file back: the consent the worker signed stays on file.
        try { store.append({ type: 'worker.consent', workerId: worker.id, ext: kept.ext, v: kept.v, form: said.form || 'v1', ...(said.signedOn ? { signedOn: said.signedOn } : {}), by: viewer.id }); } catch (err) { discardConsent(dir, worker.id, kept); throw err; }
        keepOnlyConsent(dir, worker.id, kept, old);
        return json(200, view());
      }
      if (req.method !== 'POST') return fail(405, 'method');
      // A name or an email typed wrong. The email follows the rule it was added under: required, except on a legacy site.
      if (kind === 'edit') {
        const name = text(body.name, 80), email = emailOf(body.email);
        if (name.length < 2) return fail(400, 'fields');
        if (!email && !(site.legacy && !str(body.email).trim())) return fail(400, 'email');
        if (name !== worker.name || email !== worker.email) store.append({ type: 'worker.edited', workerId: worker.id, name, email, by: viewer.id });
        return json(200, view());
      }
      // Someone who should not be on the site. A phone in their hands comes back first; on a real site their consent
      // photo stays on disk for the record, on a practice site it goes with them.
      if (kind === 'remove') {
        if (worker.imei) return fail(409, 'return_phone_first');
        const had = worker.consent;
        store.append({ type: 'worker.removed', workerId: worker.id, by: viewer.id });
        if (site.practice) dropConsent(dir, worker.id, had);
        return json(200, view());
      }
      if (kind === 'phone') {
        if (worker.phone === false) return fail(409, 'consent_only');
        if (!worker.consent) return fail(409, 'consent_first');
        // A real site takes a real IMEI; a practice site takes any IMEI-shaped text, still once per site.
        const imei = imeiFor(site, body.imei);
        if (!imei) return fail(400, 'imei');
        const holder = state.workers.get(state.imeis.get(imeiKey(site, imei)));
        // The site that holds the phone is named to a manager only: a rep learns that it is taken, not where.
        if (holder && holder.id !== worker.id) return fail(409, 'imei_taken', boss ? { site: state.sites.get(holder.site)?.lead.name || '' } : {});
        if (worker.imei && worker.imei !== imei) return fail(409, 'has_phone');
        if (!worker.imei) store.append({ type: 'worker.phone', workerId: worker.id, imei, by: viewer.id });
        return json(200, view());
      }
      if (!worker.imei) return fail(409, 'no_phone');
      if (kind === 'phone/return') { store.append({ type: 'worker.phone.returned', workerId: worker.id, by: viewer.id }); return json(200, view()); }
      if (!worker.clip) store.append({ type: 'worker.clip', workerId: worker.id, by: viewer.id });
      return json(200, view());
    }

    // -- the daily report of a live site: its rep, or a manager or an admin, once per site and local day; a second one
    // the same day replaces the first (a new event: the log keeps both). While acting, only the practice rep's own sites.
    if (siteReportRoute) {
      const site = state.sites.get(siteReportRoute[1]);
      // as for an install: a site that does not exist is named only to someone who could have used one, so ids cannot be probed
      if (!site) return boss ? fail(404, 'site') : fail(403, 'not_yours');
      if (!canInstall(viewer, site)) return fail(403, 'not_yours');
      if (acting && site.rep !== subject.id) return fail(403, 'read_only');
      if (!reportable(site)) return fail(409, 'not_live');
      // Which day: today, or yesterday until noon, so a report sent after midnight lands on the day it describes
      // instead of being replaced by the real next day's report (reportDays in report.mjs).
      const days = reportDays(state, site, nowIso());
      const asked = req.method === 'GET' ? q.get('day') : body && body.day;
      if (asked !== undefined && asked !== null && asked !== '' && !days.includes(asked)) return fail(400, 'day');
      const day = asked || days[0];
      const view = () => ({ ok: true, site: { id: site.id, name: site.lead.name, city: site.city, practice: site.practice }, day, days, prefill: prefillOf(state, site, viewer), report: reportOf(state, site.id, day) });
      if (req.method === 'GET') return json(200, view());
      if (req.method !== 'POST') return fail(405, 'method');
      const got = checkReport(body);
      if (got.error) return fail(400, got.error);
      store.append({ type: 'site.report', id: id('sr'), siteId: site.id, day, report: got.report, leadName: viewer.name, by: viewer.id });
      return json(200, { ...view(), me: mine() });
    }

    // -- managers --
    if (!MANAGER_ROUTES.test(route)) return fail(405, 'method');
    if (!boss) return fail(403, 'manager_only');
    const team = (more = {}) => {
      const view = teamView(state, { ...ctx(), lang: viewer.lang, tz: viewer.tz }), leads = [...store.leads().values()];
      // The cities the lead list really uses, and how many businesses each rep can pick: a city typed another way finds none.
      const cities = [...new Set(leads.map((l) => l.city).filter((c) => typeof c === 'string' && c))].sort((a, b) => a.localeCompare(b, 'es'));
      for (const r of view.reps) r.leadsInCity = leads.filter((l) => pickable(l, r.city)).length;
      return json(200, { ok: true, ...view, leadCount: leads.length, cities, ...more });
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
      const name = text(body.name, 80), tz = text(body.tz, 40) || 'America/Panama';
      if (name.length < 2 || !validTz(tz)) return fail(400, 'fields');
      // A real rep with no access yet (`access: 'none'`): listed, counted and filled in like anyone, but with no address
      // nobody signs in as them. Always a rep; an email sent along is ignored. A manager adds the address later.
      const noAccess = body.access === 'none';
      const made = noAccess ? { email: '' } : newEmail(body.email);
      if (made.error) return fail(...made.error);
      const workdays = weekdays(body.workdays);
      const repId = id('r');
      store.append({ type: 'rep.created', id: repId, handle: noAccess ? handleFromName(name) : handleFor(made.email), email: made.email, name, role: !noAccess && viewer.role === 'admin' && ['manager', 'admin', 'leader'].includes(body.role) ? body.role : 'rep',
        country: text(body.country, 2).toUpperCase() || 'PA', city: text(body.city, 60), tz, workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
        startDate: isDay(body.startDate) ? body.startDate : today, lang: body.lang === 'en' ? 'en' : 'es' });
      // No link to hand over: from now on that Google account opens the board.
      return team({ id: repId });
    }
    const repRoute = route.match(/^reps\/([^/]+)$/);
    if (repRoute && req.method === 'POST') {
      const rep = state.reps.get(repRoute[1]);
      if (!rep || rep.practice) return fail(404, 'rep');   // the practice rep is made and removed whole, never edited
      if (rep.role !== 'rep' && viewer.role !== 'admin') return fail(403, 'admin_only');
      const p = body.patch && typeof body.patch === 'object' ? body.patch : {}, patch = {};
      // A person's address is their way in, so nobody changes their own: a slip would lock them out.
      // The form sends the address back with everything else: only a new one is checked, so a person who came from a
      // list with no address, or with one from elsewhere, can still be edited.
      if (typeof p.email === 'string' && rep.id !== viewer.id && p.email.trim().toLowerCase() !== rep.email) {
        const made = newEmail(p.email, rep.id);
        if (made.error) return fail(...made.error);
        patch.email = made.email;
      }
      if (typeof p.name === 'string' && text(p.name, 80).length >= 2) patch.name = text(p.name, 80);
      if (typeof p.city === 'string') patch.city = text(p.city, 60);
      if (typeof p.country === 'string') patch.country = text(p.country, 2).toUpperCase();
      if (weekdays(p.workdays).length) patch.workdays = weekdays(p.workdays);
      if (typeof p.active === 'boolean' && rep.id !== viewer.id) patch.active = p.active;
      if (isDay(p.startDate)) patch.startDate = p.startDate;
      if (viewer.role === 'admin' && ['rep', 'manager', 'admin', 'leader'].includes(p.role) && rep.id !== viewer.id) patch.role = p.role;
      if (!Object.keys(patch).length) return fail(400, 'patch');
      store.append({ type: 'rep.updated', id: rep.id, patch });
      return team();
    }
    if (route === 'dayoff' && req.method === 'POST') {
      const scope = text(body.scope, 40);
      if (!isDay(body.date) || !(scope === 'all' || /^[A-Z]{2}$/.test(scope) || state.reps.has(scope))) return fail(400, 'fields');
      if (state.reps.get(scope)?.practice) return fail(409, 'practice');
      store.append({ type: body.undo === true ? 'dayoff.undo' : 'dayoff', scope, date: body.date });
      return team();
    }
    if (route === 'site' && req.method === 'POST') {
      const rep = state.reps.get(str(body.rep)), lead = body.lead && typeof body.lead === 'object' ? body.lead : {};
      // Its rep is someone active on the team who may hold a site: a rep, the practice rep, or a manager or an admin (a
      // lone admin opens one for themself). Never a leader, who reads only, nor someone taken off the team.
      if (!rep || !rep.active || rep.role === 'leader' || text(lead.name, 120).length < 2) return fail(400, 'fields');
      // What a manager may say about the site when opening it: the rep's facts, and whether it is practice or legacy.
      const facts = siteFacts(body, { kinds: true });
      if (facts.error) return fail(400, facts.error);
      const { extra } = facts;
      // A site for the practice rep is a practice site, whatever the form said.
      if (rep.practice) { extra.practice = true; delete extra.legacy; }
      // The id is made where the form is filled: the same id again is the same site, so a retry never doubles it.
      const siteId = SITE_ID.test(str(body.id)) ? body.id : id('s');
      // With no business id, the site belongs to the rep's own business of that name (accents and case aside), so the
      // route sees it and the rep cannot open a second one for it.
      const name = text(lead.name, 120), named = norm(name);
      const known = realLeadId(state, text(lead.id, 40)) || logsOf(rep.id).filter((l) => !state.voids.has(l.id) && norm(l.lead.name) === named).at(-1)?.lead.id || null;
      if (!state.sites.has(siteId)) store.append({ type: 'site', id: siteId, rep: rep.id, lead: { id: known, name }, ...extra, by: viewer.id });
      return team();
    }
    const siteRoute = route.match(/^site\/([^/]+)$/);
    if (siteRoute && req.method === 'POST') {
      const site = state.sites.get(siteRoute[1]), what = str(body.what);
      // A voided site takes nothing more, except a practice one being removed (its consent files go with it) and the
      // accepted minutes of a week that ended before the void: those weeks still pay (pay.mjs), and the buyers' report
      // brings their minutes days after the week ends.
      const before = what === 'hours' && !!site && !!site.void && !site.practice && isMonday(body.week) && body.week < weekStart(siteDay(state, site, site.void));
      if (!site || (site.void && !(site.practice && what === 'remove') && !before)) return fail(404, 'site');
      if (what === 'void') { store.append({ type: 'site.void', siteId: site.id, by: viewer.id }); return team(); }
      if (what === 'hours') {
        if (site.void && !before) return fail(404, 'site');
        if (site.practice) return fail(409, 'practice');   // recorded while acting as its practice rep (route/hours)
        const no = hoursRefused(site, body);
        if (no) return fail(...no);
        saveSiteHours(site, body);
        return team();
      }
      if (what === 'phones') {
        if (!Number.isInteger(body.count) || body.count < 1 || body.count > 500) return fail(400, 'fields');
        store.append({ type: 'site.phones', siteId: site.id, count: body.count, by: viewer.id });
        return team();
      }
      if (what === 'remove') {
        if (!site.practice) return fail(409, 'not_practice');
        const files = site.workers.map((wid) => [wid, state.workers.get(wid)?.consent || null]);
        store.append({ type: 'site.removed', siteId: site.id, by: viewer.id });
        for (const [wid, consent] of files) dropConsent(dir, wid, consent);
        return team();
      }
      if (!['installed', 'first_hour'].includes(what)) return fail(400, 'what');
      // The first approved hour comes after the install: on a site that records nothing yet it would pay for nothing. A
      // legacy site was installed before the app.
      if (what === 'first_hour' && !site.steps.installed && !site.legacy) return fail(409, 'not_installed');
      // A site that has workers is installed once the rep closed it. A legacy site and one with nobody on it keep the old way.
      if (what === 'installed' && !site.legacy && site.workers.length && !site.closed) return fail(409, 'install_not_closed');
      store.append({ type: 'site.step', siteId: site.id, what, by: viewer.id });
      return team();
    }
    // -- the practice rep: one at a time, made and removed whole --
    if (route === 'practice' && req.method === 'POST') {
      if (practiceRep(state)) return fail(409, 'practice_exists');
      const repId = id('r');
      store.append({ type: 'rep.practice', id: repId, handle: handleFor('practica@x'), name: PRACTICE_NAME, country: viewer.country || 'PA', city: viewer.city || '', tz: viewer.tz,
        workdays: [1, 2, 3, 4, 5], startDate: today, lang: viewer.lang, by: viewer.id });
      return team({ id: repId });
    }
    if (route === 'practice/remove' && req.method === 'POST') {
      const prac = practiceRep(state);
      if (!prac) return fail(404, 'rep');
      const sites = [...state.sites.values()].filter((x) => x.rep === prac.id), files = sites.flatMap((x) => x.workers).map((wid) => [wid, state.workers.get(wid)?.consent || null]);
      // Each practice site goes first with an event every build understands: one that does not know the practice rep
      // would otherwise keep showing its sites after it is gone.
      for (const x of sites) store.append({ type: 'site.removed', siteId: x.id, by: viewer.id });
      store.append({ type: 'rep.practice.removed', id: prac.id, by: viewer.id });
      for (const [wid, consent] of files) dropConsent(dir, wid, consent);
      store.dropPracticeLeads(prac.id);
      return team();
    }
    // -- the example team: four practice reps made from one fixed recipe, and taken out whole --
    // Pressed again the same day, it adds nothing. Pressed on a later day (the screen then says "Actualizar"), it takes
    // the team out exactly and makes today's in the same stretch: nothing is awaited between the check and the last
    // append, so two presses at once cannot interleave and the second finds today's team already there.
    if (route === 'practice/example' && req.method === 'POST') {
      const now = nowIso(), have = exampleReps(state);
      if (have.length && !exampleStale(have, now)) return team();
      const recipe = exampleTeam({ now, tz: viewer.tz, country: viewer.country || 'PA', city: viewer.city || '' });
      // an id of the recipe that someone else already holds (ids can come from a form): the recipe is not written over it
      const ours = new Set(have.map((r) => r.id)), oursSite = (siteId) => !!siteId && ours.has(state.sites.get(siteId)?.rep);
      const taken = recipe.events.some((e) => (e.type === 'rep.practice.example' && ((state.reps.has(e.id) && !ours.has(e.id)) || (state.handles.has(e.handle) && !ours.has(state.handles.get(e.handle)))))
        || (e.type === 'site' && state.sites.has(e.id) && !oursSite(e.id)) || (e.type === 'worker.added' && state.workers.has(e.id) && !oursSite(state.workers.get(e.id).site))
        // a log is skipped on replay when its id is taken, and the recipe's confirmations would land on whoever holds it
        || (e.type === 'log' && state.logs.has(e.id) && !ours.has(state.logs.get(e.id).rep)));
      if (taken) return fail(409, 'id_taken');
      if (have.length) removeExample(have);
      for (const e of recipe.events) {
        if (e.type === 'worker.consent') {   // the example consent placeholder, filed like any consent photo
          const kept = saveConsent(dir, e.workerId, recipe.consent);
          if (!kept) continue;
          try { store.append({ ...e, ext: kept.ext, v: kept.v, by: viewer.id }); } catch (err) { discardConsent(dir, e.workerId, kept); throw err; }
          keepOnlyConsent(dir, e.workerId, kept);
        } else store.append({ ...e, by: viewer.id });
      }
      return team();
    }
    if (route === 'practice/example/remove' && req.method === 'POST') {
      const reps = exampleReps(state);
      if (!reps.length) return fail(404, 'rep');
      removeExample(reps);
      return team();
    }
    // -- what a rep earns per accepted hour: one rate, set by an admin, from a week on (this one unless said) --
    if (route === 'pay' && req.method === 'POST') {
      if (viewer.role !== 'admin') return fail(403, 'admin_only');
      const from = body.from === undefined ? weekStart(today) : body.from;
      if (!Number.isInteger(body.cents) || body.cents < 1 || body.cents > MAX_RATE_CENTS) return fail(400, 'fields');
      if (!isMonday(from) || from > weekStart(today)) return fail(400, 'week');
      store.append({ type: 'pay.rate', cents: body.cents, from, by: viewer.id });
      return team();
    }
    if (route === 'hours' && req.method === 'POST') {
      const got = hoursIn(body);
      if (got.error) return fail(400, got.error);
      const source = text(body.source, 40) || 'manual';
      saveHours(got.weeks, source, viewer.id);
      return json(200, { ok: true, ...leaderView(state, ctx()) });
    }
    if (route === 'badge' && req.method === 'POST') {
      const rep = state.reps.get(str(body.rep));
      if (!rep || !text(body.text, 140)) return fail(400, 'fields');
      if (rep.practice) return fail(409, 'practice');   // the practice world takes nothing from a manager who is not acting
      store.append({ type: 'badge.give', id: id('b'), rep: rep.id, text: text(body.text, 140), by: viewer.id });
      return team();
    }
    return fail(405, 'method');
  }

  /** The handler the service mounts. Whatever goes wrong inside, the answer is a 500 and the process goes on. */
  return async function handle(req, res, pathname) {
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
    try { return await answerRequest(req, res, pathname); } catch (err) {
      log(`team: ${req.method} ${pathname} failed: ${(err && err.stack) || err}`);
      if (!res.headersSent) res.writeHead(500, { ...HEADERS, 'cache-control': 'no-store', 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'server' }));
      else res.end();
      return true;
    }
  };
}
