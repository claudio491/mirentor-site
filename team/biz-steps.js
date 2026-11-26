// biz-steps.js: how a business is worded on the phone, away from the page so it can be tested. Whose it is, its stage,
// when its next step is due, its last contact, the links that call, write or map it, the Para hoy card and what the
// business's card offers in each mode. The server computes the rows and the card and stays the judge.

import { defaultNext } from './next-steps.js';
import { DICT, LANGS } from './i18n.js';
import { actingMode, readOnlyIn } from './practice-steps.js';

/** How a rep's screens are open (practice-steps actingMode), and whether they only read: one place for the card,
 *  the lists and Para hoy. */
export const modeOf = (S) => actingMode(S.as, S.me);
export const readOnlyOf = (S) => readOnlyIn(modeOf(S));

/** The CRM's stages, as the CRM writes them, and the code of their words (biz.stage.<code>). */
export const STAGE_CODE = {
  New: 'new', Contacted: 'contacted', 'Intro call booked': 'booked', 'Intro call done': 'done', 'Contract sent': 'sent',
  'Contract signed': 'signed', 'Setup day set': 'setup', Live: 'live', Lost: 'lost', Waitlist: 'waitlist',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (day) => (typeof day === 'string' && DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Whose the business is: yours, free (no holder, or the holder's time lapsed) or another rep's, by name. */
export function ownerLine(row) {
  const owner = row && row.owner;
  if (!owner || (row && row.free)) return { key: 'biz.own.free' };
  return owner.mine ? { key: 'biz.own.mine' } : { key: 'biz.own.other', name: owner.name };
}

/** Whose the business is, as the log sheet's strip says it before saving: a free business will be the rep's once
 *  logged ('biz.own.free.take'), except with "Dato malo", which takes nothing. */
export function ownerWords(row, kind) {
  const o = ownerLine(row);
  return o.key === 'biz.own.free' && kind !== 'baddata' ? { key: 'biz.own.free.take' } : o;
}

/** The stage's words; a stage the app does not know shows as the CRM wrote it; none shows nothing. */
export function stageLine(stage) {
  const s = text(stage);
  if (!s) return null;
  return STAGE_CODE[s] ? { key: `biz.stage.${STAGE_CODE[s]}` } : { text: s };
}

/** When the next step is due, against the subject's today. */
export function dueLine(next, today) {
  const at = dayMs(next && next.day), now = dayMs(today);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  if (at < now) return { key: 'biz.due.late', n: Math.round((now - at) / 86400000) };
  if (at === now) return { key: 'biz.due.today' };
  return { key: 'biz.due.on', day: next.day };
}

/** When a next step is due, in words: `t` gives the words of a key, `dayMonth` a day. Empty with no valid day. */
export function dueText(next, today, t, dayMonth) {
  const d = dueLine(next, today);
  return d ? t(d.key, { n: d.n, date: d.day ? dayMonth(d.day) : '' }) : '';
}

/** A card's answer opens the card only when the rep is still where they tapped: the same screen (`tab`) and no newer
 *  tap since (`n`). `ticket` is what the tap took, `state` what holds now. */
export const stillHere = (ticket, state) => !!ticket && !!state && ticket.n === state.n && ticket.tab === state.tab;

/** The reps a manager can give a business to: those of its city, its holder left out (by id when the card carries
 *  it, else by first name). A free business can go to anyone of the city. */
export function assignList(reps, biz) {
  const b = biz || {}, owner = b.owner && !b.free ? b.owner : null;
  return (Array.isArray(reps) ? reps : []).filter((r) => (!b.city || r.city === b.city)
    && (!owner || (owner.id ? r.id !== owner.id : String(r.name || '').split(/\s+/)[0] !== owner.name)));
}

// "Hecho" on a next step: the steps the next-step table proposes, by the result that proposes them. Every default step
// is done by a call (answered or not), except going back for the owner ("Visité, no estaba"), done by a visit.
const DONE_BY = [[['talk', 'call', 'noanswer', 'message', 'reply', 'contract'], ['call', 'noanswer']], [['absent'], ['talk', 'absent']]];
const DONE_WORDS = new Map(DONE_BY.flatMap(([kinds, first]) => kinds.flatMap((kind) => {
  const key = defaultNext(kind, null, { today: '2026-01-05' }).key;
  return LANGS.map((lang) => [DICT[lang][key], first]);
})));
/** The results the log sheet shows first when "Hecho" opens it for a step: when the step is one of the next-step
 *  table's own sentences (in either language). Null for anything else: the sheet opens as it does for "Registrar". */
export function donePreset(step) {
  const first = DONE_WORDS.get(text(step));
  return first ? { first: [...first] } : null;
}

/** Mis negocios after reading its four lists (`settled`, Promise.allSettled in BOOK_LISTS order): each list read,
 *  or the one read before for the same person (`before`), or null; `failed` holds the lists this read could not get,
 *  and `none` says nothing at all could be shown. */
export function listsAfter(settled, before) {
  const lists = {}, failed = new Set();
  BOOK_LISTS.forEach((l, i) => {
    const r = settled[i];
    if (r && r.status === 'fulfilled' && r.value) lists[l] = { leads: r.value.leads || [], total: r.value.total || 0 };
    else { failed.add(l); lists[l] = (before && before[l]) || null; }
  });
  return { lists, failed, none: BOOK_LISTS.every((l) => !lists[l]) };
}

/** The last contact: the newest line of the card's history, else the row's last day and kind (with no kind, the day
 *  is the CRM's own last contact). `who` is the name the server gave, `mine` says it was the subject ("Tú").
 *  `step` is the business's next step, shown beside it. */
export function lastLine(biz) {
  if (!biz) return null;
  const step = (biz.next && biz.next.step) || null;
  const h = Array.isArray(biz.history) && biz.history[0];
  if (h) return { who: h.who || null, mine: !!h.mine, kind: h.kind || null, day: h.day, crm: !!h.crm, step };
  if (!biz.lastDay) return null;
  return { who: null, mine: false, kind: biz.lastKind || null, day: biz.lastDay, crm: !biz.lastKind, step };
}

const digitsOf = (phone) => (typeof phone === 'string' ? phone.replace(/\D/g, '') : '');

/** A phone number to call: tel: with its digits, a leading + kept. Fewer than 7 digits is not a number. */
export function telHref(phone) {
  const d = digitsOf(phone);
  if (d.length < 7 || d.length > 15) return null;
  return `tel:${/^\s*\+/.test(phone) ? '+' : ''}${d}`;
}

/** A WhatsApp chat: wa.me with the digits. Eight digits is a Panama mobile, so 507 goes in front. Seven digits or
 *  fewer is a landline or not a number: no WhatsApp. */
export function waHref(phone) {
  const d = digitsOf(phone);
  if (d.length < 8 || d.length > 15) return null;
  return `https://wa.me/${d.length === 8 ? `507${d}` : d}`;
}

/** An http(s) address as the browser reads it, or null (javascript:, data:, an account in the address...). */
function webUrl(v) {
  const s = text(v);
  if (!/^https?:\/\//i.test(s)) return null;
  try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && !u.username && !u.password ? u.href : null; } catch { return null; }
}

/** The map: the CRM's Maps link when it is http(s), else a search for "address, city". Without an address, none. */
export function mapsHref(biz) {
  if (!biz) return null;
  if (webUrl(biz.maps)) return text(biz.maps);
  const address = text(biz.address);
  if (!address) return null;
  const query = [address, text(biz.city)].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** A read made while viewing a rep's screens names whose they are with `as`, once. Practice is left to api(). */
export function readPath(path, mode, as) {
  if (mode !== 'view' || !as || /[?&]as=/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}`;
}

const SHOWN = 3;
/** The due rows Para hoy draws: a business whose meeting it already asks about ("¿Se hizo la reunión con X?") is left
 *  out, so a meeting shows once. `asked` is heldAsk's list. */
const dueOf = (agenda, asked = []) => {
  const ids = new Set((Array.isArray(asked) ? asked : []).map((a) => a && a.id).filter(Boolean));
  const all = agenda && Array.isArray(agenda.due) ? agenda.due : [];
  return { rows: all.filter((r) => r && !ids.has(r.id)), left: all.filter((r) => r && ids.has(r.id)).length };
};
/** The Para hoy card: the first three due businesses (oldest first, as the server sends them), else the first three
 *  free ones in the rep's areas, else nothing. `more` is how many are left out; `late` and `today` are the counts.
 *  A business whose meeting is asked about (`asked`, heldAsk's list) is not a row: the question already shows it. */
export function todoCard(agenda, free, asked = []) {
  const { rows: due, left } = dueOf(agenda, asked);
  const counts = (agenda && agenda.counts) || {};
  const late = counts.overdue || 0, today = counts.today || 0;
  if (due.length || left) return { mode: 'due', rows: due.slice(0, SHOWN), more: Math.max(0, Math.max(due.length, late + today - left) - SHOWN), late, today };
  const pool = Array.isArray(free) ? free : [];
  if (pool.length) return { mode: 'free', rows: pool.slice(0, SHOWN), more: Math.max(0, pool.length - SHOWN), late, today };
  return { mode: 'empty', rows: [], more: 0, late, today };
}

/** The one line of Para hoy above Hoy's stage, when something is due: the first business due and how late it is
 *  ('bk.line.late' with `n` days, or 'bk.line.today'), or the question about a meeting that should have happened when
 *  that is the oldest thing ('bk.held.ask'); `more` is how many more are due, questions included. Null when nothing is
 *  due. `pending` is GET me's pending list (an empty list where questions are not asked, as through view-as). */
export function hoyLine(agenda, pending, today) {
  const ask = heldAsk(pending, agenda && agenda.meetings, today);
  const { rows, left } = dueOf(agenda, ask);
  const counts = (agenda && agenda.counts) || {};
  const due = rows.filter((r) => r.next && DAY.test(r.next.day || ''));
  const total = ask.length + Math.max(due.length, (counts.overdue || 0) + (counts.today || 0) - left);
  const first = due[0], held = ask[0];
  if (held && (!first || held.when <= first.next.day)) return { key: 'bk.held.ask', name: held.name, n: null, more: Math.max(0, total - 1) };
  if (!first) return null;
  const d = dueLine(first.next, today);
  const more = Math.max(0, total - 1);
  return d && d.key === 'biz.due.late' ? { key: 'bk.line.late', name: first.name, n: d.n, more } : { key: 'bk.line.today', name: first.name, n: null, more };
}

/** The follow-up stop of Hoy names the oldest due business and its step, when there is one. */
export function followStop(agenda) {
  const first = agenda && Array.isArray(agenda.due) ? agenda.due[0] : null;
  const step = first && first.next && text(first.next.step);
  return step && first.name ? { name: first.name, step } : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The CRM's facts, in the card's order, and the link each one may carry.
const FACTS = [
  ['contact'], ['title'], ['phone', (v) => telHref(v)], ['email', (v) => (EMAIL.test(v) ? `mailto:${v}` : null)],
  ['address', (v, biz) => mapsHref({ address: v, city: biz.city })], ['industry'], ['category'], ['website', (v) => webUrl(v)],
  ['type'], ['workers'], ['walkin'], ['rating'], ['reviews'], ['notes'],
];

/** What the business's card offers. `mode` is practice-steps' actingMode: 'view' (a manager reading a rep's screens)
 *  writes nothing; 'self' and 'practice' write what the server's `can` allows. Calling, writing and the map are
 *  links and stay in every mode. */
export function cardModel(biz, mode) {
  const b = biz || {}, can = b.can || {}, write = mode !== 'view';
  const closed = b.stage === 'Lost' || b.stage === 'Waitlist';
  const facts = [];
  for (const [field, link] of FACTS) {
    const raw = b[field];
    const value = typeof raw === 'number' ? (Number.isFinite(raw) ? raw : null) : text(raw) || null;
    if (value === null) continue;
    const href = link && typeof value === 'string' ? link(value, b) : null;
    facts.push(href ? { key: `biz.f.${field}`, value, href } : { key: `biz.f.${field}`, value });
  }
  return {
    acts: { call: telHref(b.phone), wa: waHref(b.phone), map: mapsHref(b), log: write },
    next: { has: !!b.next, done: write && !!can.next && !!b.next, move: write && !!can.next },
    release: write && !!can.release,
    reopen: write && closed && (!!can.next || !!can.assign),
    assign: write && !!can.assign,
    facts,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The meetings that should have happened and nobody said whether they did: on and after their day, oldest first, with
 *  their time: the pending item's own (the server sends it for a past meeting too), else the agenda's. "Para hoy"
 *  leads with them. */
export function heldAsk(pending, meetings, today) {
  const times = new Map((Array.isArray(meetings) ? meetings : []).map((m) => [m.logId, m.time || null]));
  const timeOf = (p) => (typeof p.time === 'string' && HHMM.test(p.time) ? p.time : times.get(p.logId) || null);
  return (Array.isArray(pending) ? pending : [])
    .filter((p) => p && p.code === 'meeting_held' && !p.held && typeof p.when === 'string' && DAY.test(p.when) && p.when <= today)
    .sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0))
    .map((p) => ({ logId: p.logId, id: p.lead ? p.lead.id : null, name: p.lead ? p.lead.name : '', when: p.when, time: timeOf(p) }));
}

/** The button on Hoy's stage opens the sheet with that stop's results first and marked: the visit stop and the
 *  conversations stop. The follow-up stop opens Para hoy instead when it has rows; the close has its own sheet. */
export function stopPreset(sel) {
  if (sel === 0) return { first: ['talk', 'absent'] };
  if (sel === 1) return { first: ['talk', 'call'] };
  return null;
}

/** The four lists of "Mis negocios", in the order they are drawn. */
export const BOOK_LISTS = ['due', 'soon', 'nonext', 'free'];

/** One section of "Mis negocios": its title, the rows shown, whether "Ver más" has more to load, and its empty line.
 *  `answer` is GET leads?list= ({ leads, total }); `shown` is how many rows are on screen after this page. */
export function sectionOf(list, answer, shown) {
  const rows = answer && Array.isArray(answer.leads) ? answer.leads : [];
  const total = answer && Number.isFinite(answer.total) ? answer.total : rows.length;
  return { key: `bk.sec.${list}`, rows, more: shown < total, empty: `bk.empty.${list}` };
}
