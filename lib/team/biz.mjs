// biz.mjs: a business as the reps see it. Each one is the CRM's row (the lead list PUT leads caches) with an overlay the
// reducer builds from events (state.biz): who holds it, its next step, Lost and its reason, Waitlist, the contact and
// "do not call". Pure reads over the state and the lead list; nothing here writes. The routes and views only call it.
//
// The app's value wins over the CRM's until a push carries the same value (one biz.synced event): from then on the CRM's
// cell is the truth for that field, so a correction typed in the sheet shows in the app.
import { RULES, LOST_TAGS, checkNext, localDay, addDays, daysBetween, isCalendarDay, qualOf, checkQ, mergeQ, WORKERS_FLOOR, KINDS, crmRow } from './rules.mjs';
import { repOf } from './crm.mjs';
import { pickable, norm } from './store.mjs';
import { routeOf, STOPS } from './route.mjs';
import { sheetText } from './sheet.mjs';
import { firstOf } from './names.mjs';

/** The tags that close a business (LOST_TAGS) and the rule of a next step (checkNext) live in rules.mjs, so the reducer
 *  reads them without importing this module (state.mjs is imported by store.mjs, which this module reads). */
export { LOST_TAGS, checkNext, qualOf, checkQ, mergeQ };
/** The stages a business is worked in. */
export const OPEN_STAGES = ['New', 'Contacted', 'Intro call booked', 'Intro call done'];
/** The CRM's stages in order: the app's logs raise a business along it, never down. */
export const STAGE_LADDER = ['New', 'Contacted', 'Intro call booked', 'Intro call done', 'Contract sent', 'Contract signed'];

/** How far one app log raises its business along STAGE_LADDER, as the export's stages say it: a contact to Contacted, a
 *  meeting to Intro call booked (Intro call done once a manager confirmed it held), a contract to Contract sent and
 *  Contract signed once a manager confirmed each. */
const raiseOf = (log, conf) => (log.kind === 'meeting' ? (conf.meeting_held ? 3 : 2) : log.kind === 'contract' ? (conf.contract_signed ? 5 : conf.contract_sent ? 4 : 1) : 1);
/** The stages from which a business keeps its holder: the contract is out, so the name of who brought it stays on it. */
const KEPT = new Set(['Contract sent', 'Contract signed', 'Setup day set', 'Live']);

const memo = new WeakMap();
/** The CRM's Outcome of a booked meeting, as the bridge writes it. */
const BOOKED = KINDS.meeting.outcome({});
/** What every view of a business reads from the log, worked out in one pass and kept until the log or the lead list
 *  changes: the latest contact on each business (`last`), each rep's latest day on each business (`repDay`), how far the
 *  app's own logs raise its stage (`top`, an index of STAGE_LADDER: raiseOf), the latest day a row imported from the CRM
 *  says a meeting was booked (`rebooked`), and the rep the CRM's Owner cell names. Voided logs are left out, and so is a
 *  log of the other world (a practice rep's on a real business, or the reverse). */
export function bizIndex(state, leads) {
  const hit = memo.get(state);
  if (hit && hit.leads === leads && hit.count === state.count) return hit.index;
  const last = new Map(), repDay = new Map(), top = new Map(), rebooked = new Map(), owners = new Map();
  const practiceLead = (id) => !!(leads.get(id)?.practice || state.appLeads.get(id)?.practice);
  for (const log of state.logs.values()) {
    if (state.voids.has(log.id)) continue;
    const rep = state.reps.get(log.rep), id = log.lead.id;
    if (!rep || !!rep.practice !== practiceLead(id)) continue;
    const had = last.get(id);
    if (!had || log.t >= had.t) last.set(id, { day: log.day, rep: log.rep, kind: log.kind, crm: !!log.crm, t: log.t });
    const key = `${id}|${log.rep}`;
    if (!(repDay.get(key) >= log.day)) repDay.set(key, log.day);
    // a meeting or a contract that never happened ("No ocurrió") was still a contact
    if (!log.crm) top.set(id, Math.max(top.get(id) || 0, state.missed.has(log.id) ? 1 : raiseOf(log, state.confirms.get(log.id) || {})));
    // a row of the CRM's Activities that says the meeting was booked: its latest day
    else if (crmRow(log)?.outcome === BOOKED && !(rebooked.get(id) >= log.day)) rebooked.set(id, log.day);
  }
  for (const [id, l] of last) last.set(id, { day: l.day, rep: l.rep, kind: l.kind, crm: l.crm });
  const ownerRep = (name) => { const k = typeof name === 'string' ? name : ''; if (!owners.has(k)) owners.set(k, repOf(state, k)); return owners.get(k); };
  const index = { last, repDay, top, rebooked, ownerRep };
  memo.set(state, { leads, count: state.count, index });
  return index;
}

/** Whether the overlay's own value of a field stands: it was said in the app and the CRM has not taken it yet. */
const live = (o, key, field) => !!o && key in o && !o.synced.has(field);
/** An active rep of the business's world: the only one who can hold it. */
const validHolder = (rep, lead) => !!rep && rep.active && rep.role === 'rep' && !!rep.practice === !!lead.practice;

/** The next step in force: the overlay's while it stands, else the CRM's (a day is needed). */
function nextOf(o, lead) {
  if (live(o, 'next', 'next')) return o.next ? { day: o.next.day, step: o.next.step } : null;
  return isCalendarDay(lead.nextDay) ? { day: lead.nextDay, step: typeof lead.nextStep === 'string' ? lead.nextStep : '' } : null;
}

/** Whether a "No ocurrió" lowering stands: the overlay says from which stage (`lower.from`), the CRM has not shown it
 *  moved (not synced), the CRM still says exactly that stage, and no other log of the app raises the business that far.
 *  One from Intro call booked does not stand while a row imported from the CRM (not voided) says a meeting was booked on
 *  a day after the missed log's day (`rebooked`, from bizIndex): someone booked it again in the sheet. */
const lowering = (o, lead, top, rebooked) => live(o, 'lower', 'lower') && !!o.lower && (lead.stage || 'New') === o.lower.from && top < STAGE_LADDER.indexOf(o.lower.from)
  && !(o.lower.from === 'Intro call booked' && isCalendarDay(o.lower.day) && rebooked > o.lower.day);

/** A business's stage: the overlay's Lost or Waitlist while it stands; while a "No ocurrió" lowering stands (lowering),
 *  the app's own (Contacted at least); otherwise the CRM's (Contacted after a reopen over the CRM's Lost or Waitlist),
 *  raised by the app's own logs along STAGE_LADDER, never lowered. */
function stageOf(o, lead, index) {
  if (live(o, 'lost', 'stage') && o.lost) return 'Lost';
  if (live(o, 'waitlist', 'stage') && o.waitlist) return 'Waitlist';
  const crm = lead.stage || 'New';
  const top = index.top.get(lead.id) || 0;
  if (lowering(o, lead, top, index.rebooked.get(lead.id))) return STAGE_LADDER[Math.max(1, top)];
  const base = live(o, 'lost', 'stage') && o.lost === null && (crm === 'Lost' || crm === 'Waitlist') ? 'Contacted' : crm;
  const at = STAGE_LADDER.indexOf(base);
  return at >= 0 && top > at ? STAGE_LADDER[top] : base;
}

/** Who holds a business. The candidate is the overlay's owner while it stands, else the rep the CRM's Owner cell names.
 *  A holder is an active rep of the business's world. A holder whose last contact on it is more than 30 days old, with
 *  no next step dated today or later, has let it lapse: it is free. A take (or a manager's gift) is day zero. From
 *  Contract sent on, it never lapses: only a manager releases or gives it. */
export function holderOf(state, lead, { now, index }) {
  const o = state.biz.get(lead.id), fromApp = live(o, 'owner', 'owner');
  const rep = fromApp ? (o.owner.rep ? state.reps.get(o.owner.rep) : null) : index.ownerRep(lead.owner);
  if (!validHolder(rep, lead)) return { rep: null, free: true, lapsed: false };
  const today = localDay(now, rep.tz);
  let last = index.repDay.get(`${lead.id}|${rep.id}`) || '';
  // the app's take or gift to this rep is a contact day, before and after the CRM took it
  if (o?.owner?.rep === rep.id && typeof o.owner.t === 'string') { const d = localDay(o.owner.t, rep.tz); if (d > last) last = d; }
  if (!fromApp && isCalendarDay(lead.lastContact) && lead.lastContact > last) last = lead.lastContact;
  const next = nextOf(o, lead);
  const lapsed = (!last || daysBetween(last, today) > RULES.ownerLapseDays) && !(next && next.day >= today) && !KEPT.has(stageOf(o, lead, index));
  return lapsed ? { rep: null, free: true, lapsed: true } : { rep, free: false, lapsed: false };
}

/** The business as every reader gets it: the overlay over the CRM's row. */
export function bizView(state, lead, { now, index }) {
  const o = state.biz.get(lead.id), h = holderOf(state, lead, { now, index }), stage = stageOf(o, lead, index);
  const contactLive = live(o, 'contact', 'contact') && typeof o.contact.name === 'string', phoneLive = live(o, 'contact', 'phone') && typeof o.contact.phone === 'string';
  return {
    id: lead.id, name: lead.company, zone: lead.zone || '', city: lead.city || '', lead,
    holder: h.rep, free: h.free, lapsed: h.lapsed, stage,
    next: nextOf(o, lead),
    lost: stage === 'Lost' ? { reason: live(o, 'lost', 'stage') && o.lost ? o.lost.reason : null } : null,
    waitlist: stage === 'Waitlist',
    dnc: !!lead.doNotCall || !!o?.dnc,
    contact: contactLive ? o.contact.name : lead.contact || '', phone: phoneLive ? o.contact.phone : lead.phone || '',
    last: index.last.get(lead.id) || null,
    known: !!(lead.lastContact || state.leadFirstDay.get(lead.id)),
  };
}

/** One business as a list or a search names it. `name(rep)` says a holder's name in the reader's language. */
export function rowOf(view, subject, name) {
  const lead = view.lead;
  return { id: view.id, name: view.name, zone: view.zone, known: view.known, stage: view.stage, free: view.free,
    owner: view.holder ? { name: name(view.holder), mine: view.holder.id === subject.id } : null,
    next: view.next, lost: view.lost,
    lastDay: view.last ? view.last.day : isCalendarDay(lead.lastContact) ? lead.lastContact : null, lastKind: view.last ? view.last.kind : null,
    workers: typeof lead.workers === 'number' ? lead.workers : null, walkin: typeof lead.walkin === 'number' ? lead.walkin : null };
}

/** What a log by `rep` does to the business: a free one is taken (by any result but "Dato malo"), the holder's moves it,
 *  and another rep's moves nothing (`owned` names the holder as the rows do, firstOf in the reader's `lang`). A rep of
 *  the other world (practice on a real business, or the reverse) moves nothing either. */
export function logEffect(view, rep, kind, lang = 'es') {
  if (!!rep.practice !== !!view.lead.practice) return { holds: false, took: false, owned: null };
  if (view.holder && view.holder.id === rep.id) return { holds: true, took: false, owned: null };
  if (view.holder) return { holds: false, took: false, owned: { name: firstOf(view.holder, lang) } };
  const took = kind !== 'baddata';
  return { holds: took, took, owned: null };
}

/** How many rows a list gives at a time. */
export const PAGE = 30;
/** The lists a rep reads (GET leads?list=). */
export const LISTS = ['due', 'soon', 'nonext', 'mine', 'free'];
const SOON_DAYS = 7;
const closed = (v) => v.stage === 'Lost' || v.stage === 'Waitlist';
const byName = (a, b) => a.name.localeCompare(b.name, 'es');
const byDay = (a, b) => (a.next.day < b.next.day ? -1 : a.next.day > b.next.day ? 1 : byName(a, b));

/** One list of the subject's businesses, a page at a time (`offset`), with how many there are in all.
 *  - due: theirs, with a next step dated today or earlier, the oldest first;
 *  - soon: theirs, with a next step in the next 7 days, the soonest first;
 *  - nonext: theirs, with no next step;
 *  - mine: theirs, by the day of the next step (none last);
 *  - free: the free businesses of their city, their two zones first, then the highest walk-in score (none last).
 *  A business marked "do not call" or Lost is on no list. A Waitlist business is in the rep's book (bookOf): it shows on
 *  `mine`, and on `due` and `soon` when it has a next step, never on `nonext` nor `free`. A business of the other world
 *  (practice or real) never shows. `zone` keeps one zone. Each row is rowOf, `name(rep)` names its holder. */
export function listOf(state, leads, subject, list, { now, zone = '', offset = 0, name }) {
  const index = bizIndex(state, leads), today = localDay(now, subject.tz), until = addDays(today, SOON_DAYS), only = norm(zone);
  const picked = new Set((state.zones.get(subject.id) || []).map(norm));
  const out = [];
  for (const lead of leads.values()) {
    if (!!lead.practice !== !!subject.practice || (only && norm(lead.zone) !== only)) continue;
    const v = bizView(state, lead, { now, index });
    if (v.dnc || v.stage === 'Lost') continue;
    const mine = !!v.holder && v.holder.id === subject.id;
    const keep = list === 'due' ? mine && !!v.next && v.next.day <= today
      : list === 'soon' ? mine && !!v.next && v.next.day > today && v.next.day <= until
        : list === 'nonext' ? mine && !v.next && !v.waitlist
          : list === 'mine' ? mine
            : !closed(v) && v.free && pickable(lead, subject.city, { practice: !!subject.practice, by: subject.id, stage: v.stage });
    if (keep) out.push(v);
  }
  if (list === 'free') {
    const walk = (v) => (typeof v.lead.walkin === 'number' ? v.lead.walkin : -Infinity);
    out.sort((a, b) => (picked.has(norm(b.zone)) - picked.has(norm(a.zone))) || (walk(b) - walk(a) || 0) || byName(a, b));
  } else if (list === 'nonext') out.sort(byName);
  else out.sort((a, b) => (!a.next || !b.next ? (!a.next - !b.next) || byName(a, b) : byDay(a, b)));
  return { rows: out.slice(offset, offset + PAGE).map((v) => rowOf(v, subject, name)), total: out.length };
}

const HISTORY = 15;
/** A business's qualification as the overlay keeps it (a copy), or null. */
const qOf = (state, leadId) => { const q = state.biz.get(leadId)?.q; return q ? { ...q } : null; };
const BOSS = ['manager', 'admin'];

/** Whether `viewer`, reading as `subject`, may open a business's card. A manager, an admin and a leader read any; a rep
 *  reads one they added, one with no city, and any of their own city. Nobody reads one of the other world (practice or
 *  real). */
export function canRead(lead, viewer, subject) {
  if (!!lead.practice !== !!subject.practice) return false;
  if (BOSS.includes(viewer.role) || viewer.role === 'leader') return true;
  if (lead.by && lead.by === subject.id) return true;
  return !lead.city || norm(lead.city) === norm(subject.city);
}

/** A business's card: its row, what the CRM knows of it (null where the CRM has nothing), the last 15 contacts by
 *  anyone (newest first), its route when it has one, and what the reader may do on it. `can.next`: the subject holds it
 *  and the viewer writes as the subject (themself, or a manager acting as the practice rep). `can.release`: that, or a
 *  manager or an admin while someone holds it. `can.assign`: a manager or an admin. A leader may do none. */
export function cardOf(state, view, { subject, viewer, now, name }) {
  const lead = view.lead, cell = (k) => (typeof lead[k] === 'string' && lead[k] ? lead[k] : null), num = (k) => (typeof lead[k] === 'number' ? lead[k] : null);
  const logs = [];
  for (const log of state.logs.values()) {
    const rep = state.reps.get(log.rep);
    if (log.lead.id === lead.id && rep && !state.voids.has(log.id) && !!rep.practice === !!lead.practice) logs.push(log);
  }
  const history = logs.reverse().sort((a, b) => (a.t > b.t ? -1 : a.t < b.t ? 1 : 0)).slice(0, HISTORY).map((log) => {
    const rep = state.reps.get(log.rep);
    return { day: log.day, who: name(rep), mine: rep.id === subject.id, kind: log.kind, channel: log.channel || null, tag: log.tag || null, note: log.note || null, crm: !!log.crm };
  });
  const way = routeOf(state, (view.holder || subject).id, lead.id, { now });
  const boss = BOSS.includes(viewer.role), asSubject = viewer.id === subject.id || (boss && !!subject.practice);
  const next = viewer.role !== 'leader' && !!view.holder && view.holder.id === subject.id && asSubject;
  const row = rowOf(view, subject, name);
  // a manager or an admin is told who holds it by id, to leave the holder out when giving it to another rep
  if (boss && row.owner) row.owner.id = view.holder.id;
  return { ...row, city: view.city || null, type: cell('type'), industry: cell('industry'), category: cell('category'), address: cell('address'), maps: cell('maps'), website: cell('website'),
    contact: view.contact || null, title: cell('title'), phone: view.phone || null, email: cell('email'), rating: num('rating'), reviews: num('reviews'), notes: cell('notes'),
    // what the app was told of its qualification, and whether it qualifies
    q: qOf(state, lead.id), qual: qualOf(qOf(state, lead.id)),
    history, route: way.at >= 1 ? { at: way.at, of: STOPS.length } : null,
    can: { next, release: next || (boss && !!view.holder), assign: boss } };
}

const DUE_MAX = 30, SOON_MAX = 20;

/** Every rep's businesses in one pass over the lead list: how many each holds (`owned`), how many are overdue, due today,
 *  coming in the next 7 days and with no next step, the oldest overdue day, and the views themselves. Each rep's today
 *  is in their own time zone. The book is the one definition of "owned" and "overdue" (the agenda, the lists, the
 *  manager's Pendientes and the Scorecard read it): what the CRM's sheet counts and a rep can act on. A business marked
 *  "do not call" or Lost is not in it. A Waitlist business is: it counts in `owned`, and in `overdue`, `today` or `soon`
 *  when it has a next step, but never in `nonext` (it is parked on purpose). */
export function bookOf(state, leads, { now }) {
  const index = bizIndex(state, leads), out = new Map(), days = new Map();
  for (const lead of leads.values()) {
    const v = bizView(state, lead, { now, index });
    if (!v.holder || v.dnc || v.stage === 'Lost') continue;
    const rep = v.holder;
    if (!days.has(rep.id)) { const today = localDay(now, rep.tz); days.set(rep.id, { today, until: addDays(today, SOON_DAYS) }); }
    const { today, until } = days.get(rep.id);
    const b = out.get(rep.id) || out.set(rep.id, { owned: 0, overdue: 0, today: 0, soon: 0, nonext: 0, oldest: null, views: [] }).get(rep.id);
    b.owned += 1; b.views.push(v);
    if (!v.next) { if (!v.waitlist) b.nonext += 1; }
    else if (v.next.day < today) { b.overdue += 1; if (!b.oldest || v.next.day < b.oldest) b.oldest = v.next.day; }
    else if (v.next.day === today) b.today += 1;
    else if (v.next.day <= until) b.soon += 1;
  }
  return out;
}

/** What a rep has to do: the businesses due today and overdue (the list due, 30 at most), those of the next 7 days (20
 *  at most), the meetings they booked for today and tomorrow (by day, then time, one with no time last) and the counts. */
export function agendaOf(state, rep, { now, leads, name }) {
  const b = bookOf(state, leads, { now }).get(rep.id) || { owned: 0, overdue: 0, today: 0, soon: 0, nonext: 0, views: [] };
  const today = localDay(now, rep.tz), until = addDays(today, SOON_DAYS), tomorrow = addDays(today, 1);
  const dated = b.views.filter((v) => v.next).sort(byDay);
  const meetings = (state.byRep.get(rep.id) || []).map((id) => state.logs.get(id))
    .filter((l) => l && l.kind === 'meeting' && !state.voids.has(l.id) && !state.missed.has(l.id) && (l.when === today || l.when === tomorrow))
    .map((l) => ({ logId: l.id, lead: { id: l.lead.id, name: l.lead.name }, when: l.when, time: typeof l.time === 'string' ? l.time : null, contact: l.contact || null, demo: l.demo === true }))
    .sort((x, y) => (x.when !== y.when ? (x.when < y.when ? -1 : 1) : x.time === y.time ? 0 : x.time === null ? 1 : y.time === null ? -1 : x.time < y.time ? -1 : 1));
  return {
    due: dated.filter((v) => v.next.day <= today).slice(0, DUE_MAX).map((v) => rowOf(v, rep, name)),
    soon: dated.filter((v) => v.next.day > today && v.next.day <= until).slice(0, SOON_MAX).map((v) => rowOf(v, rep, name)),
    meetings,
    counts: { overdue: b.overdue, today: b.today, soon: b.soon, nonext: b.nonext, owned: b.owned },
  };
}

// ---- what goes to the CRM, and when the CRM holds it ----

const WORKERS_WORDS = { lt10: 'fewer than 10', '10_29': '10 to 29', '30_49': '30 to 49', '50plus': '50 or more' };
/** The qualification as the line the bridge appends to the CRM's Notes, naming only the rows known, or null. */
export function qualNote(q) {
  if (!q) return null;
  const parts = [];
  if (WORKERS_WORDS[q.workers]) parts.push(`${WORKERS_WORDS[q.workers]} hands-on workers`);
  if (q.wifi) parts.push(`Wi-Fi ${q.wifi}`);
  if (q.lead) parts.push(`coordinator ${q.lead}`);
  return parts.length ? sheetText(`Qualification: ${parts.join(', ')}`) : null;
}

/** The stage the overlay says, while it stands: 'Lost', 'Waitlist', or 'open' after a reopen. */
const stageSaid = (o) => (o.lost ? 'Lost' : o.waitlist ? 'Waitlist' : 'open');

/** The overlay's fields, not yet synced, that the pushed row of the CRM (`lead`) now holds too. `owner`: the CRM's owner
 *  is the overlay's rep, or the business was released and the CRM's owner is nobody who can hold it. `next`: the same day
 *  and words, or both empty after a clear. `stage`: the CRM is at the overlay's Lost or Waitlist, or at an open stage
 *  after a reopen. `contact` and `phone`: the CRM's cell is no longer empty (the bridge writes them only into an empty
 *  cell, so whatever is there is the CRM's). */
export function syncedFields(state, leadId, lead) {
  const o = state.biz.get(leadId);
  if (!o) return [];
  const out = [];
  if (live(o, 'owner', 'owner')) {
    const crm = repOf(state, typeof lead.owner === 'string' ? lead.owner : '');
    if (o.owner.rep ? crm && crm.id === o.owner.rep : !validHolder(crm, lead)) out.push('owner');
  }
  if (live(o, 'next', 'next')) {
    const day = isCalendarDay(lead.nextDay) ? lead.nextDay : '', words = typeof lead.nextStep === 'string' ? lead.nextStep.replace(/\s+/g, ' ').trim() : '';
    if (o.next ? day === o.next.day && words === o.next.step : !day && !words) out.push('next');
  }
  if (!o.synced.has('stage') && ('lost' in o || 'waitlist' in o)) {
    const said = stageSaid(o), crm = lead.stage || 'New';
    if (said === 'open' ? crm !== 'Lost' && crm !== 'Waitlist' : crm === said) out.push('stage');
  }
  if (live(o, 'contact', 'contact') && typeof o.contact.name === 'string' && typeof lead.contact === 'string' && lead.contact.trim()) out.push('contact');
  if (live(o, 'contact', 'phone') && typeof o.contact.phone === 'string' && typeof lead.phone === 'string' && lead.phone.trim()) out.push('phone');
  // the bridge writes Hands-on workers only into an empty cell, so a number there is the CRM's; the qualification line
  // is in Notes once it was appended
  if (o.q?.workers && !o.synced.has('workers') && typeof lead.workers === 'number') out.push('workers');
  if (o.q && !o.synced.has('qual') && typeof lead.notes === 'string' && lead.notes.includes(qualNote(o.q))) out.push('qual');
  // a "No ocurrió" lowering: the CRM's stage is no longer the one it lowers from (the bridge lowered it, or a person
  // changed it)
  if (live(o, 'lower', 'lower') && o.lower && (lead.stage || 'New') !== o.lower.from) out.push('lower');
  return out;
}

/** The stages a business goes back to: one a rep can still be at. */
const LOWER_TO = ['Contacted', 'Intro call booked', 'Intro call done'];
/** The lowering the CRM should make, `{ from, to }`, while a "No ocurrió" lowering stands and the business's stage (`to`)
 *  is below `from` and one of LOWER_TO; else null (any other stage asks for nothing). The CRM's row is needed to know. */
function lowerOf(state, o, lead, leads) {
  if (!lead || !live(o, 'lower', 'lower') || !o.lower) return null;
  const to = stageOf(o, lead, bizIndex(state, leads));
  return LOWER_TO.includes(to) && STAGE_LADDER.indexOf(to) < STAGE_LADDER.indexOf(o.lower.from) ? { from: o.lower.from, to } : null;
}

/** What the CRM should write, for each real business whose overlay changed at `fromMs` or later. `fields` names the
 *  keys that carry a change (said in the app, not yet synced): only those mean "write", and a row with none is left
 *  out. `owner` is the holder's name, or 'Libre' when released; `next` is `{ day, step }` or null (clear the follow-up
 *  and the step); `stage` is 'Lost' or 'Waitlist' (and in `fields` then), with its `reason`. A business the app opened
 *  again while the CRM (`leads`, the cached list) still says Lost carries `reopen: true`, `stage: null` and 'stage' in
 *  `fields`: the CRM takes it out of Lost. `workers` is the lower bound of the workers' range the app was told (for
 *  Hands-on workers, written only into an empty cell), `qual` the qualification's rows and `qualNote` its line for Notes;
 *  'workers' and 'qual' are in `fields` until the CRM holds them. `lower` is `{ from, to }` while a meeting or a contract
 *  that did not happen ("No ocurrió") should take the CRM's stage back from `from` to `to` (lowerOf), with 'lower' last in
 *  `fields`; null otherwise. Text a person typed goes through sheetText. A practice business never goes out. */
export function exportBiz(state, fromMs, leads = new Map()) {
  const out = [];
  for (const [lead, o] of state.biz) {
    if (state.appLeads.get(lead)?.practice || !(Date.parse(o.at) >= fromMs)) continue;
    const owner = o.owner ? (o.owner.rep ? sheetText(state.reps.get(o.owner.rep)?.name || '') : 'Libre') : null;
    const stage = o.lost ? 'Lost' : o.waitlist ? 'Waitlist' : null;
    const contact = typeof o.contact?.name === 'string' ? sheetText(o.contact.name) : null, phone = typeof o.contact?.phone === 'string' ? sheetText(o.contact.phone) : null;
    const reopen = !stage && live(o, 'lost', 'stage') && o.lost === null && leads.get(lead)?.stage === 'Lost';
    const fields = [];
    if (live(o, 'owner', 'owner')) fields.push('owner');
    if (live(o, 'next', 'next')) fields.push('next');
    if ((stage && !o.synced.has('stage')) || reopen) fields.push('stage');
    if (contact !== null && live(o, 'contact', 'contact')) fields.push('contact');
    if (phone !== null && live(o, 'contact', 'phone')) fields.push('phone');
    const workers = o.q?.workers ? WORKERS_FLOOR[o.q.workers] : null;
    if (workers !== null && !o.synced.has('workers')) fields.push('workers');
    if (o.q && !o.synced.has('qual')) fields.push('qual');
    const lower = lowerOf(state, o, leads.get(lead), leads);
    if (lower) fields.push('lower');
    if (!fields.length) continue;
    out.push({ lead, owner, next: o.next ? { day: o.next.day, step: sheetText(o.next.step) } : null, stage, reopen, reason: o.lost ? o.lost.reason : null, workers, contact, phone,
      qual: o.q ? { ...o.q } : null, qualNote: qualNote(o.q || null), lower, at: o.at, fields });
  }
  return out;
}
