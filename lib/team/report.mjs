// report.mjs: the daily site report ("Reporte del día"). One report per live site per local day, filled by the site's
// rep or by a manager, and read by the ops lead's sheet one row per site and day. A second report the same day replaces
// the first: both stay in the event log, the state keeps the newest. Pure functions over the state; nothing here writes.
import { localDay, addDays } from './rules.mjs';
import { GEAR, GEAR_COUNTS, SURGE_COUNTS } from '../../team/report-steps.js';
import { sheetText } from './sheet.mjs';

const DEFAULT_TZ = 'America/Panama';

/** The ops lead's sheet, tab "Form Responses": its 31 headers, byte for byte, in order. They carry en dashes because
 *  they are her headers; nothing the app shows may. */
export const REPORT_HEADERS = Object.freeze([
  'Timestamp', 'Report title (site + date)', 'Report date', 'Site location', 'Your full name (City Lead)',
  'How many people worked at the site today?', 'Total hours delivered today (all workers combined)', 'Total hours accepted today (all workers combined)',
  'iPhones – handed out today', 'iPhones – returned at end of day', 'iPhones – returned damaged / not working', 'iPhones – total working on site tonight',
  'Headsets – handed out today', 'Headsets – returned at end of day', 'Headsets – returned damaged / not working', 'Headsets – total working on site tonight',
  'Battery packs – handed out today', 'Battery packs – returned at end of day', 'Battery packs – returned damaged / not working', 'Battery packs – total working on site tonight',
  'Charging cords – handed out today', 'Charging cords – returned at end of day', 'Charging cords – returned damaged / not working', 'Charging cords – total working on site tonight',
  'Surge protectors – total working on site', 'Surge protectors – damaged / not working',
  'How many complete, working hardware sets are on site right now?', 'Was ALL hardware returned today, and is it all working?',
  'What hardware is missing or damaged?', 'Do you need any new or replacement hardware?', 'Anything else we should know about today?',
]);

// The hardware counted, in the sheet's order: one list for the form and the export (team/report-steps.js).
export { GEAR, GEAR_COUNTS, SURGE_COUNTS };

// A count above this is a typo, not a site: the largest site on the contracts has 40 eligible workers.
export const MAX_COUNT = 1000;
const TEXT_MAX = 500;

const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;
/** A count that may be unknown: null, or a whole number from 0. Anything else is refused, never guessed. */
const countOr = (v) => (v === null || v === undefined || v === '' ? { v: null } : isCount(v) ? { v } : { bad: true });
const line = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : '');

/** Hours as the form sends them: empty is unknown (null, and empty in the export, never 0); otherwise a number from 0,
 *  kept to two decimals. */
function hoursOr(v) {
  if (v === null || v === undefined || v === '') return { v: null };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { bad: true };
  return { v: Math.round(v * 100) / 100 };
}

/** A report as it is kept, or the refusal code. The checks are deliberately few:
 *  - people is required: it bounds the hours and the form always fills it in (prefilled from the phones on site);
 *  - every count is a whole number from 0, or unknown;
 *  - hours are optional, from 0 to 24 per person who worked (more than that is a typo), and accepted cannot exceed
 *    delivered (the Scorecard defines accepted hours as a part of delivered ones);
 *  - the yes/no question needs an answer: it is the line the ops lead reads first.
 *  Nothing checks that returned <= handed out or that the totals add up: hardware handed out yesterday can come back
 *  today, and the person on site knows better than a rule here. */
export function checkReport(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!isCount(b.people)) return { error: 'report_people' };
  const delivered = hoursOr(b.delivered), accepted = hoursOr(b.accepted);
  if (delivered.bad || accepted.bad) return { error: 'report_hours' };
  const cap = 24 * b.people;
  if ((delivered.v !== null && delivered.v > cap) || (accepted.v !== null && accepted.v > cap)) return { error: 'report_hours' };
  if (delivered.v !== null && accepted.v !== null && accepted.v > delivered.v) return { error: 'report_hours' };
  const gear = {};
  for (const g of GEAR) {
    const given = b[g] && typeof b[g] === 'object' ? b[g] : {};
    gear[g] = {};
    for (const k of GEAR_COUNTS) { const c = countOr(given[k]); if (c.bad) return { error: 'report_counts' }; gear[g][k] = c.v; }
  }
  const surgeIn = b.surge && typeof b.surge === 'object' ? b.surge : {}, surge = {};
  for (const k of SURGE_COUNTS) { const c = countOr(surgeIn[k]); if (c.bad) return { error: 'report_counts' }; surge[k] = c.v; }
  const sets = countOr(b.sets);
  if (sets.bad) return { error: 'report_counts' };
  if (typeof b.allOk !== 'boolean') return { error: 'report_answer' };
  return { report: { people: b.people, delivered: delivered.v, accepted: accepted.v, ...gear, surge, sets: sets.v, allOk: b.allOk,
    missing: line(b.missing), need: line(b.need), notes: line(b.notes) } };
}

/** A site takes reports once it is live: installed through the app, or installed before the app existed (legacy), and
 *  not voided. A practice site follows the same rule; its reports are kept and never exported. */
export const reportable = (site) => !!site && !site.void && (!!site.steps.installed || !!site.legacy);

/** The site's day: the local day of the rep the site belongs to, as every other site record reads it. */
export const siteDay = (state, site, iso) => localDay(iso, state.reps.get(site.rep)?.tz || DEFAULT_TZ);

/** The days a report may be sent for: today first, and yesterday while it is still before noon on the site's clock
 *  (a City Lead closing late reports the day that just ended; by noon that day is over for reporting). */
export function reportDays(state, site, iso) {
  const today = siteDay(state, site, iso);
  const morning = siteDay(state, site, new Date(Date.parse(iso) - 12 * 3600000).toISOString()) !== today;
  return morning ? [today, addDays(today, -1)] : [today];
}

/** The newest report of a site for a day, or null. */
export const reportOf = (state, siteId, day) => state.siteReports.get(`${siteId}|${day}`) || null;

/** What the app already knows when the form opens: who holds a phone on the site (each of them works there today, as
 *  far as the app can tell) and the phones assigned there now. The site's name and city, and the name of the person
 *  filling it in, who is the City Lead of the report. */
export function prefillOf(state, site, person) {
  const holding = site.workers.map((id) => state.workers.get(id)).filter((w) => w && w.imei).length;
  return { people: holding, phones: holding, name: site.lead.name, city: site.city || '', lead: person ? person.name : '' };
}

/** The site as the sheet names it: its name, and its city after a comma when it has one. */
const locationOf = (site) => (site.city ? `${site.lead.name}, ${site.city}` : site.lead.name);
const cell = (v) => (v === null || v === undefined ? '' : v);

/** One report as the sheet's row: 31 values in REPORT_HEADERS' order. Unknown is an empty string, never 0. What people
 *  typed (the site's name, the City Lead, the three lines of text) is defused: the bridge writes the row into her sheet. */
export function reportRow(site, r) {
  const x = r.report;
  return [r.t, sheetText(`${site.lead.name} ${r.day}`), r.day, sheetText(locationOf(site)), sheetText(r.leadName), x.people, cell(x.delivered), cell(x.accepted),
    ...GEAR.flatMap((g) => GEAR_COUNTS.map((k) => cell(x[g][k]))), ...SURGE_COUNTS.map((k) => cell(x.surge[k])), cell(x.sets),
    x.allOk ? 'Yes' : 'No', sheetText(x.missing), sheetText(x.need), sheetText(x.notes)];
}

/** The rows for the ops lead's sheet: the newest report of each site and day written at or after `since`, so a report
 *  changed after the last sync comes back with a new event id and replaces its row. Practice sites, and the sites of a
 *  practice rep, never leave the app; nor does a voided site, whatever it reported before. `ids[i]` is
 *  `<site id>|<day>|<event id>`: the first two parts are the row's stable key, the third says which version it is. */
export function reportRows(state, since, nowIso) {
  const from = Date.parse(typeof since === 'string' ? since : '') || 0;
  const out = [];
  for (const r of state.siteReports.values()) {
    const site = state.sites.get(r.siteId);
    if (!site || site.void || site.practice || state.reps.get(site.rep)?.practice) continue;
    if (Date.parse(r.t) < from) continue;
    out.push({ r, site });
  }
  out.sort((a, b) => (a.r.day < b.r.day ? -1 : a.r.day > b.r.day ? 1 : a.site.lead.name.localeCompare(b.site.lead.name, 'es') || (a.site.id < b.site.id ? -1 : 1)));
  return { since: new Date(from).toISOString(), until: nowIso, headers: [...REPORT_HEADERS], rows: out.map(({ r, site }) => reportRow(site, r)), ids: out.map(({ r }) => `${r.siteId}|${r.day}|${r.id}`) };
}
