// crm.mjs: the CRM's Activities rows the nightly routine brings in for reps who log there, not in the app yet. Pure
// decisions over the state: which rows become a `crm.log` event, which are the same row again, which are refused and why.
// Nothing here writes; api.mjs appends what this returns.
import { KINDS, localDay, daysBetween, isCalendarDay } from './rules.mjs';

/** The CRM's own id for a row. The app's log ids never hold an underscore, so the two can never meet. */
export const CRM_LOG_ID = /^crm_[A-Za-z0-9-]{1,60}$/;
export const CRM_SOURCE = 'crm';
export const MAX_ROWS = 2000;
/** How far back a row may be: a week of work and then some, never an old month rewritten. */
export const MAX_DAYS_BACK = 31;

const str = (v) => (typeof v === 'string' ? v : '');
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The rep a row names, by id or by handle. */
const repOf = (state, who) => (typeof who === 'string' && who ? state.reps.get(who) || state.reps.get(state.handles.get(who)) : null);

/** Sorts one push of rows. `now` is the server's time; `leads` the lead list (only read for what the CRM knew of a
 *  business before that day, the way a log made in the app reads it). Answers `{ error }` when the body itself is wrong,
 *  else the events to append and how many rows were added, repeated and refused, with each refusal's reason. */
export function activityRows(state, body, { now, leads = new Map() }) {
  if (!body || typeof body !== 'object' || body.source !== CRM_SOURCE) return { error: 'fields' };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > MAX_ROWS) return { error: 'fields' };
  const events = [], reasons = [], ids = new Set(), keys = new Set();
  let repeated = 0;
  // the same rep, day, business and kind already on the board (from the app or an earlier import), not voided
  for (const log of state.logs.values()) if (!state.voids.has(log.id)) keys.add(`${log.rep}|${log.day}|${log.lead.id}|${log.kind}`);
  rows.forEach((row, index) => {
    const refuse = (reason) => reasons.push({ index, id: row && typeof row === 'object' && typeof row.id === 'string' ? row.id : null, reason });
    if (!row || typeof row !== 'object' || Array.isArray(row)) return refuse('row');
    const id = str(row.id);
    if (!CRM_LOG_ID.test(id)) return refuse('id');
    if (state.logs.has(id) || ids.has(id)) { repeated += 1; return undefined; }   // the same row again: nothing changes
    const rep = repOf(state, row.rep);
    if (!rep) return refuse('rep');
    if (rep.role !== 'rep' || !rep.active || rep.practice) return refuse('not_a_rep');
    const day = str(row.day);
    if (!isCalendarDay(day)) return refuse('day');
    const today = localDay(now, rep.tz);
    if (day > today) return refuse('future');
    if (daysBetween(day, today) > MAX_DAYS_BACK) return refuse('too_old');
    const kind = str(row.kind);
    if (!Object.hasOwn(KINDS, kind)) return refuse('kind');
    if (KINDS[kind].contract) return refuse('contract');   // a contract is a lead stage in the CRM, not an activity
    const channel = str(row.channel);
    if (!KINDS[kind].channels.includes(channel)) return refuse('channel');
    const given = row.lead && typeof row.lead === 'object' ? row.lead : {};
    const leadId = text(given.id, 40), name = text(given.name, 120), zone = text(given.zone, 80);
    if (!leadId || name.length < 2) return refuse('lead');
    if (state.closes.has(`${rep.id}|${day}`)) return refuse('day_closed');
    const key = `${rep.id}|${day}|${leadId}|${kind}`;
    if (keys.has(key)) { repeated += 1; return undefined; }
    keys.add(key); ids.add(id);
    const event = { type: 'crm.log', id, rep: rep.id, day, kind, channel, lead: { id: leadId, name, ...(zone ? { zone } : {}) }, source: CRM_SOURCE };
    // What the CRM knew of the business before that day, as a log made in the app that day would carry it.
    const known = leads.get(leadId);
    if (known && isCalendarDay(known.lastContact) && known.lastContact < day) event.prior = known.lastContact;
    events.push(event);
    return undefined;
  });
  return { events, added: events.length, repeated, refused: reasons.length, reasons };
}

/** The days a DELETE takes out, both included: the CRM's source and two real days in order, or null. */
export function removalRange(q) {
  const from = str(q.from), to = str(q.to);
  if (q.source !== CRM_SOURCE || !isCalendarDay(from) || !isCalendarDay(to) || from > to) return null;
  return { from, to };
}
