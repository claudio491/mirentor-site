// report-steps.js: what the daily site report ("Reporte del día") decides before it draws, away from the page so it can
// be tested. The server imports the hardware list from here too, so the form and the sheet's columns never drift apart.
import { localMinutes } from './moments.js';

/** The four kinds of hardware counted four ways each, in the sheet's order; surge protectors are counted two ways. */
export const GEAR = Object.freeze(['phones', 'headsets', 'batteries', 'cords']);
export const GEAR_COUNTS = Object.freeze(['out', 'back', 'broken', 'working']);
export const SURGE_COUNTS = Object.freeze(['working', 'broken']);
/** From this local hour Hoy reminds a rep of a live site with no report today. */
export const NUDGE_HOUR = 17;

/** The form's starting values: today's report when there is one (to edit it), otherwise what the app knows. People and
 *  the iPhones working tonight come from the phones on site; every other count starts at 0; the hours start empty,
 *  because an empty hour is unknown and a 0 would be a claim; the yes or no waits for an answer. */
export function draftOf(prefill, report) {
  if (report) {
    const r = report.report;
    return { people: r.people, delivered: r.delivered == null ? '' : String(r.delivered), accepted: r.accepted == null ? '' : String(r.accepted),
      ...Object.fromEntries(GEAR.map((g) => [g, Object.fromEntries(GEAR_COUNTS.map((k) => [k, r[g][k] ?? 0]))])),
      surge: Object.fromEntries(SURGE_COUNTS.map((k) => [k, r.surge[k] ?? 0])), sets: r.sets ?? 0, allOk: r.allOk, missing: r.missing, need: r.need, notes: r.notes };
  }
  const p = prefill || {};
  const gear = Object.fromEntries(GEAR.map((g) => [g, Object.fromEntries(GEAR_COUNTS.map((k) => [k, 0]))]));
  gear.phones.working = Number.isInteger(p.phones) ? p.phones : 0;
  return { people: Number.isInteger(p.people) ? p.people : 0, delivered: '', accepted: '', ...gear,
    surge: Object.fromEntries(SURGE_COUNTS.map((k) => [k, 0])), sets: 0, allOk: null, missing: '', need: '', notes: '' };
}

/** Hours as a person types them: "7,5" and "7.5" are the same; empty is unknown (null). NaN when it is not a number. */
export function hoursOf(text) {
  const v = String(text ?? '').trim().replace(',', '.');
  if (!v) return null;
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

/** A count from a stepper's box: a whole number from 0, or NaN. */
export function countOf(text) {
  const v = String(text ?? '').trim();
  return /^\d{1,4}$/.test(v) ? Number(v) : NaN;
}

/** The body the server takes, from the draft, or { error } with the server's own code, so the refusal reads the same. */
export function bodyOf(d) {
  const delivered = hoursOf(d.delivered), accepted = hoursOf(d.accepted);
  if (Number.isNaN(delivered) || Number.isNaN(accepted)) return { error: 'report_hours' };
  const counts = [d.people, d.sets, ...GEAR.flatMap((g) => GEAR_COUNTS.map((k) => d[g][k])), ...SURGE_COUNTS.map((k) => d.surge[k])];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) return { error: 'report_counts' };
  if (typeof d.allOk !== 'boolean') return { error: 'report_answer' };
  return { body: { people: d.people, delivered, accepted, ...Object.fromEntries(GEAR.map((g) => [g, { ...d[g] }])), surge: { ...d.surge }, sets: d.sets,
    allOk: d.allOk, missing: String(d.missing || '').trim(), need: String(d.need || '').trim(), notes: String(d.notes || '').trim() } };
}

/** The live site Hoy reminds a rep of: from NUDGE_HOUR local time, the first active site with no report today. Null
 *  otherwise. Read-only screens never nudge. */
export function nudgeOf(me, readOnly = false) {
  if (readOnly || !me || !Array.isArray(me.active) || !me.active.length || !me.me) return null;
  if (localMinutes(me.serverTime, me.me.tz) < NUDGE_HOUR * 60) return null;
  return me.active.find((x) => !x.report) || null;
}
