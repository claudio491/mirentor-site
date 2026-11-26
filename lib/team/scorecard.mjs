// scorecard.mjs: the CRM's Rep Scorecard, read from the app's events, so nobody types it by hand. One cell per rep, week
// and column, and behind every cell the list it counts: each cell is the sum of `n` over its list. Pure reads over the
// state (and the lead list, for what a rep holds now); nothing here writes.
//
// Each column counts what the sheet's own formula counts:
// - the activity columns count what the bridge writes to Activities (crmRow in rules.mjs), never ledger entries;
// - owned, overdue, progress, out and ready are "live now" in the sheet (read from the Leads tab, with no history), so
//   they exist for the current week only and are null for a past one; owned and overdue are the rep's book (bookOf);
// - the site columns are read as of the end of the week (or now, for this week).
import { CHANNELS, KINDS, crmRow, channelOf, localDay, addDays, dayEndIso, weekStart } from './rules.mjs';
import { bizIndex, bizView, bookOf } from './biz.mjs';
import { phonesOf } from './install.mjs';
import { players, nameOf, firstOf } from './view.mjs';
import { sheetText } from './sheet.mjs';

/** The twenty columns, in the sheet's order. */
export const SCORECARD_COLS = ['touches', 'calls', 'visits', 'touched', 'talks', 'replies', 'booked', 'held', 'owned', 'overdue', 'progress', 'out', 'ready',
  'signed', 'installed', 'live', 'consents', 'working', 'owed', 'qualified'];
/** The columns the sheet reads "live now": only the current week has them. */
export const NOW_ONLY = ['owned', 'overdue', 'progress', 'out', 'ready'];
/** What each column's list holds. */
const KIND = { touches: 'logs', calls: 'logs', visits: 'logs', touched: 'biz', talks: 'logs', replies: 'logs', booked: 'logs', held: 'logs',
  owned: 'biz', overdue: 'biz', progress: 'biz', out: 'biz', ready: 'biz', signed: 'sites', installed: 'sites', live: 'sites', consents: 'workers',
  working: 'sites', owed: 'sites', qualified: 'biz' };
/** The CRM outcomes the activity columns read, taken from the kinds themselves so they never drift from what the bridge writes. */
const OUTCOME = { talks: [KINDS.talk.outcome({}), KINDS.call.outcome({})], replies: [KINDS.reply.outcome({})], booked: [KINDS.meeting.outcome({})] };
/** The stages each "live now" column counts (biz.mjs's stage, as the app reads it). */
const STAGES = { progress: ['Intro call booked', 'Intro call done'], out: ['Contract sent'], ready: ['Contract signed', 'Setup day set'] };

/** The four weeks the Scorecard offers: this one and the three before, each a Monday, newest first. */
export const scorecardWeeks = (today) => [0, 1, 2, 3].map((i) => addDays(weekStart(today), -7 * i));

const held = new WeakMap();
/** Every business someone holds now, by holder: the views, worked out once per state, lead list and moment. */
function heldBy(state, leads, now) {
  const hit = held.get(state);
  if (hit && hit.leads === leads && hit.count === state.count && hit.now === now) return hit.by;
  const index = bizIndex(state, leads), by = new Map();
  for (const lead of leads.values()) {
    const v = bizView(state, lead, { now, index });
    if (v.holder) (by.get(v.holder.id) || by.set(v.holder.id, []).get(v.holder.id)).push(v);
  }
  held.set(state, { leads, count: state.count, now, by });
  return by;
}

const books = new WeakMap();
/** The book (biz.mjs bookOf), worked out once per state, lead list and moment: `owned` and `overdue` are read from it,
 *  so the Scorecard, the manager's Pendientes and the rep's agenda never disagree. */
function bookFor(state, leads, now) {
  const hit = books.get(state);
  if (hit && hit.leads === leads && hit.count === state.count && hit.now === now) return hit.book;
  const book = bookOf(state, leads, { now });
  books.set(state, { leads, count: state.count, now, book });
  return book;
}

/** The list behind one cell: `{ kind, items }`, each item with its `n`. A "live now" column of a past week is
 *  `{ kind: null, items: [] }`: the sheet has no number for it, and none is invented. */
export function scorecardItems(state, rep, week, col, { now, leads = new Map(), lang = 'es' } = {}) {
  if (!KIND[col]) return { kind: null, items: [] };
  const today = localDay(now, rep.tz), end = addDays(week, 6), current = weekStart(today) === week;
  if (NOW_ONLY.includes(col) && !current) return { kind: null, items: [] };
  const asOf = [now, dayEndIso(end, rep.tz)].sort()[0], who = firstOf(rep, lang);
  const inWeek = (day) => day >= week && day <= end;
  const out = (items) => ({ kind: KIND[col], items });

  // what the rep logged that week, as the bridge writes it to Activities
  const logs = () => (state.byRep.get(rep.id) || []).map((id) => state.logs.get(id)).filter((l) => l && !state.voids.has(l.id) && inWeek(l.day));
  const logItem = (l) => ({ id: l.id, day: l.day, rep: who, lead: { id: l.lead.id, name: l.lead.name }, kind: l.kind, channel: channelOf(l.kind, l.channel), n: 1 });
  const touches = () => logs().filter((l) => crmRow(l));
  const bizItem = (id, name, next = null) => ({ id, name, rep: who, next, n: 1 });
  const nextOf = (id) => { const lead = leads.get(id); return lead ? bizView(state, lead, { now, index: bizIndex(state, leads) }).next : null; };
  if (col === 'touches') return out(touches().map(logItem));
  if (col === 'calls' || col === 'visits') { const ch = CHANNELS[col === 'calls' ? 'call' : 'visit']; return out(touches().filter((l) => crmRow(l).channel === ch).map(logItem)); }
  if (OUTCOME[col]) return out(touches().filter((l) => OUTCOME[col].includes(crmRow(l).outcome)).map(logItem));
  if (col === 'touched') {
    const seen = new Map();
    for (const l of touches()) if (!seen.has(l.lead.id)) seen.set(l.lead.id, l.lead.name);
    return out([...seen].map(([id, name]) => bizItem(id, name, nextOf(id))));
  }
  if (col === 'held') {
    return out((state.byRep.get(rep.id) || []).map((id) => state.logs.get(id))
      .filter((l) => l && l.kind === 'meeting' && !state.voids.has(l.id) && state.confirms.get(l.id)?.meeting_held && inWeek(localDay(state.confirms.get(l.id).meeting_held, rep.tz))).map(logItem));
  }
  if (col === 'qualified') {
    const seen = new Map();
    for (const q of state.qualified) {
      const log = state.logs.get(q.logId);
      if (q.rep !== rep.id || !log || state.voids.has(log.id) || !inWeek(localDay(q.t, rep.tz)) || seen.has(q.lead)) continue;
      seen.set(q.lead, log.lead.name);
    }
    return out([...seen].map(([id, name]) => bizItem(id, name, nextOf(id))));
  }
  // what the rep holds now, by the stage the app reads
  if (NOW_ONLY.includes(col)) {
    const book = bookFor(state, leads, now).get(rep.id)?.views || [];
    const mine = (heldBy(state, leads, now).get(rep.id) || []).filter((v) => v.stage !== 'Lost');
    const keep = col === 'owned' ? book : col === 'overdue' ? book.filter((v) => v.next && v.next.day < today) : mine.filter((v) => STAGES[col].includes(v.stage));
    return out(keep.sort((a, b) => a.name.localeCompare(b.name, 'es')).map((v) => bizItem(v.id, v.name, v.next)));
  }
  // the rep's real sites, as of the end of the week
  const sites = [...state.sites.values()].filter((s) => s.rep === rep.id && !s.practice && s.t <= asOf);
  const standing = (s) => !s.void || s.void > asOf;
  const live = sites.filter((s) => standing(s) && ((s.steps.installed && s.steps.installed <= asOf) || s.legacy));
  const siteItem = (s, n = 1) => ({ id: s.id, name: s.lead.name, city: s.city, rep: who, n });
  if (col === 'signed') return out(sites.filter((s) => !s.void && !s.legacy && inWeek(localDay(s.t, rep.tz))).map((s) => siteItem(s)));
  if (col === 'installed') return out(sites.filter((s) => !s.void && !s.legacy && s.steps.installed && inWeek(localDay(s.steps.installed, rep.tz))).map((s) => siteItem(s)));
  if (col === 'live') return out(live.map((s) => siteItem(s)));
  if (col === 'consents') {
    const items = [];
    for (const s of live) {
      for (const w of state.workers.values()) {
        if (w.site !== s.id || !w.consent || w.consent.t > asOf || (w.removed && w.removed <= asOf)) continue;
        items.push({ id: w.id, name: w.name, site: { id: s.id, name: s.lead.name }, rep: who, n: 1 });
      }
    }
    return out(items);
  }
  if (col === 'working') {
    const items = [];
    for (const s of live) {
      let best = null;
      for (const r of state.siteReports.values()) if (r.siteId === s.id && r.day <= end && (!best || r.day > best.day)) best = r;
      const n = best?.report?.phones?.working;
      if (Number.isInteger(n)) items.push(siteItem(s, n));
    }
    return out(items);
  }
  // owed: the phones asked and not arrived by then
  return out(sites.filter((s) => !s.legacy && standing(s)).map((s) => [s, phonesOf(s, asOf).owed]).filter(([, n]) => n > 0).map(([s, n]) => siteItem(s, n)));
}

const total = (got) => (got.kind === null ? null : got.items.reduce((a, x) => a + x.n, 0));

/** One rep's row: every column's cell, each the sum of its list (null where the sheet has no number). */
export function scorecardOf(state, repId, week, ctx) {
  const rep = state.reps.get(repId);
  return Object.fromEntries(SCORECARD_COLS.map((col) => [col, total(scorecardItems(state, rep, week, col, ctx))]));
}

/** The team's sum of each column: null only when every rep's cell is null. */
const teamCells = (rows) => Object.fromEntries(SCORECARD_COLS.map((col) => {
  const cells = rows.map((r) => r.cells[col]);
  return [col, cells.length && cells.every((c) => c === null) ? null : cells.reduce((a, c) => a + (c ?? 0), 0)];
}));

/** The table: every player (practice reps never), by name, with their cells; and the team's. `defuse` sends a name and
 *  a city through sheetText (the service token's answer ends in a sheet). */
export function scorecardView(state, week, { now, leads = new Map(), lang = 'es', defuse = false } = {}) {
  const ctx = { now, leads, lang }, text = (v) => (defuse ? sheetText(v) : v);
  const reps = players(state).map((rep) => ({ id: rep.id, name: text(nameOf(rep, lang)), city: text(rep.city || ''), cells: scorecardOf(state, rep.id, week, ctx) }));
  return { week, cols: [...SCORECARD_COLS], reps, team: teamCells(reps) };
}

/** The list behind the team's cell: every player's list, one after another. */
export function scorecardTeamItems(state, week, col, ctx) {
  const all = players(state).map((rep) => scorecardItems(state, rep, week, col, ctx));
  return all.length && all.every((g) => g.kind === null) ? { kind: null, items: [] } : { kind: KIND[col], items: all.flatMap((g) => g.items) };
}
