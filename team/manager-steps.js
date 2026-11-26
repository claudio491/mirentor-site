// manager-steps.js: what the manager's site and hours controls decide before the server answers, away from the page so
// it can be tested. Who the site form offers, what the site form sends, what the hours form sends, which controls a site offers, and which roles
// the person form lists. The server stays the judge: a refusal here only says it sooner, in words.

import { phoneCount } from './route-steps.js';
import { docsAt, guionDocs } from './docs-steps.js';

const refuse = (code) => { throw Object.assign(new Error(code), { code }); };
const trim = (v) => String(v ?? '').trim();
const KINDS = { normal: {}, practice: { practice: true }, legacy: { legacy: true } };

/** The body of POST site, with the business id when the name is one the rep already has (siteLeadId). Optional facts are sent only when typed: `eligible` is left out when empty (the server
 *  refuses null), the coordinator goes with both a name and a phone or not at all. A site is one kind: normal, practice
 *  or legacy, so practice and legacy can never both be set. */
export function siteBody(v, id, leadId = null) {
  const name = trim(v.name);
  if (!v.rep || name.length < 2) refuse('fields');
  if (!Object.hasOwn(KINDS, v.kind || 'normal')) refuse('site_kind');
  const body = { id, rep: v.rep, lead: leadId ? { id: leadId, name } : { name } };
  const city = trim(v.city);
  if (city) body.city = city;
  const eligible = trim(v.eligible);
  if (eligible) {
    if (!/^\d+$/.test(eligible) || Number(eligible) > 5000) refuse('site_eligible');
    body.eligible = Number(eligible);
  }
  const cn = trim(v.coordName), cp = trim(v.coordPhone);
  if (cn || cp) {
    if (cn.length < 2 || cp.length < 5) refuse('site_coordinator');
    body.coordinator = { name: cn, phone: cp };
  }
  if (trim(v.request)) body.request = phoneCount(v.request);   // how many phones it needs: optional for a manager
  return Object.assign(body, KINDS[v.kind || 'normal']);
}

const plain = (v) => trim(v).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** The business a site is for, when its name is one of that rep's businesses on the way (`team.routes`), accents and
 *  case aside: the site form then sends its id, so the rep's route sees the site and cannot open a second one. */
export function siteLeadId(team, rep, name) {
  const want = plain(name);
  if (!want) return null;
  const hit = ((team && team.routes) || []).find((r) => r && r.rep === rep && r.lead && r.lead.id && plain(r.lead.name) === want);
  return hit ? hit.lead.id : null;
}

const isMonday = (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day && d.getUTCDay() === 1;
};
/** Hours and minutes typed as two fields, as minutes, or null when they cannot be read. Each is a whole number written
 *  with digits only, minutes 0 to 59: "51,5" or "51.5" is refused, never read as 515 or as 51. One of the two may stay
 *  empty (51 h, or 45 min); both empty is no number at all, never a zero, since the server records a zero as a fact.
 *  At most 100,000 minutes, as the server takes. */
const minutesOf = (hh, mm) => {
  const a = trim(hh), b = trim(mm);
  if (!a && !b) return null;
  if ((a && !/^[0-9]+$/.test(a)) || (b && !/^[0-9]+$/.test(b)) || Number(b || 0) > 59) return null;
  const total = Number(a || 0) * 60 + Number(b || 0);
  return total <= 100000 ? total : null;
};
/** The body of POST hours for one week typed by hand: the week starts on a Monday, both counts are minutes (a week with
 *  nothing delivered is typed as 0), and the buyers cannot accept more than was delivered. */
export function hoursBody(v) {
  const week = trim(v.week);
  if (!isMonday(week)) refuse('week');
  const delivered = minutesOf(v.dh, v.dm), accepted = minutesOf(v.ah, v.am);
  if (delivered == null || accepted == null) refuse('hours_minutes');   // a week with nothing delivered is a real week
  if (accepted > delivered) refuse('hours_order');
  return { weeks: [{ week, delivered, accepted }] };
}

/** The body of a site's accepted hours for one week (POST site/<id> what=hours): a Monday, whole hours and minutes. */
export function siteHoursBody(v) {
  const week = trim(v.week);
  if (!isMonday(week)) refuse('week');
  const accepted = minutesOf(v.h, v.m);
  if (accepted == null) refuse('hours_minutes');
  return { what: 'hours', week, accepted };
}
/** The last `n` Mondays up to the week of `today`, newest first: the weeks a site's hours can be recorded for. */
export function recentMondays(today, n = 6) {
  const d = new Date(`${today}T12:00:00Z`), back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return Array.from({ length: n }, (_, i) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - 7 * i); return x.toISOString().slice(0, 10); });
}
/** The weeks the pay form offers: the recent ones for the first rate (they showed no amount), only this week once a rate
 *  is in force (a week already shown keeps what it paid; the server says the same). */
export const payWeeks = (today, pay, n = 6) => (pay ? recentMondays(today, 1) : recentMondays(today, n));
/** The body of POST pay: dollars typed with up to two decimals become integer cents, read as text so no float rounds
 *  them; from US$0.01 to US$1,000 per accepted hour, from a Monday. */
export function payBody(v) {
  const text = trim(v.usd), m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) refuse('pay_amount');
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  if (cents < 1 || cents > 100000) refuse('pay_amount');
  if (!isMonday(trim(v.from))) refuse('week');
  return { cents, from: trim(v.from) };
}

/** The body of POST site/<id> for a shipment of phones that arrived ("Llegaron teléfonos"): it adds to what came. */
export const arrivedBody = (v) => ({ what: 'arrived', count: phoneCount(v.count) });
/** The body of "Corregir el total": the count that replaces the total of phones that arrived, checked as every
 *  phone count is (1 to 500). */
export const fixBody = (v) => ({ what: 'phones', count: phoneCount(v.count) });

/** The controls a site offers a manager, in the order they show.
 *  install: open its install screens (on a legacy site, the screens that load the consents it already had);
 *  request: "Cambiar pedido", how many phones it needs, until it is installed (never on a legacy site);
 *  arrived: "Llegaron teléfonos", a shipment that adds, until the install is closed;
 *  phones: "Corregir el total", the correction that sets how many came, once some came and until the install is closed;
 *  confirm: "Confirmar instalación" once the rep closed it;
 *  installed: the old way of marking, for a legacy site or one with nobody on it;
 *  first_hour, hours (accepted minutes per week, once installed), record (the audit file, once someone is on it), void: real sites only. A practice site is removed instead, and has no record. */
export function siteActions(site) {
  const out = [], done = !!(site.steps && site.steps.installed), closed = site.state === 'closed' || (site.practice && !!site.closed);
  out.push('install');   // on a legacy site it loads the consents signed before the app, and nothing else
  if (!site.legacy && !done) out.push('request');
  if (!site.legacy && !done && !closed) out.push('arrived');
  if (!site.legacy && !done && !closed && site.phones != null) out.push('phones');
  if (closed && !done) out.push('confirm');
  if (!site.practice && !done && (site.legacy || !site.workers)) out.push('installed');
  if (!site.practice && done && !(site.steps && site.steps.first_hour)) out.push('first_hour');
  if (!site.practice && !site.legacy && done) out.push('hours');   // accepted hours, per week, once it is live
  if (!site.practice && site.workers) out.push('record');   // a record with nobody in it is an empty file
  out.push(site.practice ? 'remove' : 'void');
  return out;
}

/** Who the site form offers to install a site: the active reps, then the active managers and admins (a leader changes
 *  nothing, so never), then the practice rep, marked `practice` (its site is always a practice site). The default is the
 *  first rep; with no reps it is the viewer, so a lone admin can open a site. */
export function siteReps(team, viewerId) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const reps = (team.reps || []).filter((r) => r.active !== false).sort(byName);
  const bosses = (team.others || []).filter((r) => r.active && (r.role === 'manager' || r.role === 'admin')).sort(byName);
  const options = [...reps, ...bosses].map((r) => ({ value: r.id, label: r.name }));
  if (team.practice) options.push({ value: team.practice.id, label: team.practice.name, practice: true });
  const value = reps.length ? reps[0].id : (bosses.find((r) => r.id === viewerId) || bosses[0] || { id: '' }).id;
  return { options, value };
}

/** The countries the person form offers: Panamá and Colombia, and the person's own when it is another two-letter code,
 *  so saving the form never changes it without anyone choosing. */
export function countryOptions(current) {
  const own = String(current ?? '').trim().toUpperCase(), out = ['PA', 'CO'];
  if (/^[A-Z]{2}$/.test(own) && !out.includes(own)) out.push(own);
  return out;
}
/** The countries a day off can be marked for: each one the team has, once, in order. A person with none adds nothing. */
export const teamCountries = (reps) => [...new Set((reps || []).map((r) => String((r && r.country) ?? '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
/** A country as the reader reads it: the app's own words when it has them (`own`), the browser's name for any other code
 *  (`region`, Intl.DisplayNames), the code itself as a last resort. Never a missing key. */
export function countryLabel(code, { own = () => null, region = () => null } = {}) {
  const c = String(code ?? '').trim().toUpperCase();
  return own(c) || region(c) || c;
}

/** Which roles the person form lists. Only an admin chooses one, and only an admin can make a leader. */
export const roleOptions = (viewerRole) => (viewerRole === 'admin' ? ['rep', 'manager', 'admin', 'leader'] : []);

/** The body of POST reps. "No access for now" sends `access: 'none'` with no email and no role: the server makes a rep
 *  nobody signs in as until a manager adds an email. Otherwise the email path, as before. */
export function newRepBody(v) {
  const base = { name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays };
  return v.access === 'none' ? { access: 'none', ...base } : { email: v.email, ...base, role: v.role };
}

/** How often a manager's screens read the team view by themselves while one of them is in front: what adds no line to
 *  the feed (a held meeting, phones, a closed install, a site's report, a worker) shows within a minute. */
export const REFRESH_MS = 60000;
const MANAGER_TABS = ['team', 'needs', 'reps'];
/** How long until the manager's team view is read again by itself, in milliseconds. With a view on screen, every
 *  REFRESH_MS. With none (a read failed, so the screens would stay blank) it tries again soon and waits longer each time:
 *  2, 4, 8 and 16 seconds, then every 30. */
export function readAgainIn({ hasTeam = false, failures = 0 } = {}) {
  if (hasTeam) return REFRESH_MS;
  return Math.min(30000, 2000 * 2 ** Math.max(0, failures - 1));
}
/** Whether that read goes out now. Never while the page is hidden, nor while a write is on its way (its answer is the
 *  view). With a view on screen, only while a manager screen is in front and no form is open over it; with none, whatever
 *  is open: the screens are blank. */
export function readNow({ hidden = false, writing = false, sheet = false, hasTeam = false, tab = null } = {}) {
  if (hidden || writing) return false;
  if (!hasTeam) return true;
  return !sheet && MANAGER_TABS.includes(tab);
}
/** Whether a read's answer may be shown. Reads and writes take numbers from one counter, in the order they happen:
 *  `start` is the read's, `shown` the one of what is on screen. An answer that went out before the last write the screen
 *  adopted (or before a newer read already shown) is dropped, and so is one that lands while a write is on its way. */
export const freshRead = ({ start, shown, writing = false }) => !writing && start > shown;

/** The address of a site's record, relative to the page. */
export const recordUrl = (siteId) => `api/site/${encodeURIComponent(siteId)}/record.csv`;

/** The line under a business on its way to a site, as { key, params } for t(key, params). `params.stop` is the stop's
 *  key: the page turns it into the stop's name. A wait the manager can still confirm waits on them; one that expired
 *  is the rep's, who logs the contract again (the server refuses to confirm it, 409 expired); any other stop is the rep's. */
export function wayLine(route, { repFirst = '' } = {}) {
  const st = route.complete ? null : route.stops[route.at];
  if (!st) return { key: 'needs.ways.done', params: {} };
  if (st.status === 'wait' && st.expired) return { key: 'needs.ways.expired', params: { name: repFirst } };
  if (st.status === 'wait') return { key: 'needs.ways.you', params: { stop: st.key } };
  return { key: 'needs.ways.rep', params: { name: repFirst, stop: st.key } };
}

/** A rep's businesses on the team table: how many they hold (with how many have no next step under it) and how many
 *  are overdue (with how many are due today under it). A line under a number shows only when it counts something. */
export function bookCells(book) {
  const b = book || {}, n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    owned: { n: n(b.owned), sub: n(b.nonext) ? { key: 'mgr.book.nonext', n: n(b.nonext) } : null },
    overdue: { n: n(b.overdue), sub: n(b.today) ? { key: 'mgr.book.today', n: n(b.today) } : null },
  };
}

/** "Seguimientos vencidos" in Pendientes: one line per rep, in the server's order (the oldest overdue first). */
export function overdueLines(needs) {
  const list = needs && Array.isArray(needs.overdue) ? needs.overdue : [];
  return list.map((x) => ({ rep: x.rep, name: x.name, key: 'needs.overdue.item', n: x.overdue, date: x.oldest }));
}

// ---- Pendientes: the week's meetings, what is stuck and the day's blockers (wave 2) ----
/** A meeting of today or the coming six days, as its row: when, the business, and the rep with the contact when known.
 *  `x` is GET team's needs.meetings[i]. */
export function meetingRow(x) {
  const contact = typeof x.contact === 'string' && x.contact.trim() ? x.contact.trim() : null;
  return { day: x.when, time: x.time || null, lead: x.lead, who: contact ? { key: 'needs.meet.with', name: x.name, contact } : { text: x.name }, demo: !!x.demo, held: !!x.held };
}
/** What a stuck item says: a meeting that passed n days ago and nobody marked, or a contract out n days, unsigned. */
/** What "No ocurrió" asks and answers: a meeting is rebooked, a contract is picked back up (the server writes the same). */
export const missedKeys = (kind) => (kind === 'contract' ? { sure: 'needs.stall.missed.sure.contract', done: 'needs.stall.missed.done.contract' } : { sure: 'needs.stall.missed.sure', done: 'needs.stall.missed.done' });
export const stalledLine = (x) => ({ key: x.kind === 'contract' ? 'needs.stall.contract' : 'needs.stall.meeting', n: x.days, lead: x.lead ? x.lead.name : '' });
/** What the new groups add to the count of Pendientes: every stuck item and every blocker nobody has seen. The week's
 *  meetings are a calendar, not something to act on, so they add nothing. */
export const extraNeeds = (needs) => ((needs && Array.isArray(needs.stalled)) ? needs.stalled.length : 0)
  + ((needs && Array.isArray(needs.blockers)) ? needs.blockers.filter((b) => !b.seen).length : 0)
  + ((needs && Array.isArray(needs.advances)) ? needs.advances.length : 0);   // the advances requested and not paid

/** The manager's "Adelanto" form as the body of POST site/<id>: the whole mark, an empty day as null; both empty clears
 *  it. Paid without requested, or before it, is refused with the server's own code ('fields'); the server judges the days. */
export function advanceBody(v) {
  const asked = trim(v.asked) || null, paid = trim(v.paid) || null;
  if (paid && (!asked || paid < asked)) refuse('fields');
  return { what: 'advance', asked, paid };
}
/** Only a real site takes an advance: never a practice one. */
export const canAdvance = (site) => !!site && !site.practice;
/** The points cell of the manager's table: the number it ranks by (scaled to five working days), and the points before
 *  scaling when they differ. */
export function pointsCell(week) {
  const raw = week ? week.points : 0, n = week && Number.isFinite(week.scaledPoints) ? week.scaledPoints : raw;
  return { n, raw: n !== raw ? raw : null };
}

/** "Por cargar", the quiet end of Pendientes: what a rep's screens point at and is not in Documents. The agreement (no
 *  document hooked to the contract step) and the script (the group "Para vender" empty), each with the group and step
 *  the document form opens with. It never counts in the tab's number. */
export function toLoad(docs) {
  const out = [];
  if (!docsAt(docs, 'contract').length) out.push({ key: 'needs.load.contract', group: 'contrato', step: 'contract' });
  if (!guionDocs(docs).length) out.push({ key: 'needs.load.guion', group: 'vender', step: null });
  return out;
}
