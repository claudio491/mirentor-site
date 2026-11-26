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

/** The answer "Sí, todo volvió y funciona", given first. With an earlier report of the site (`last`, from the server),
 *  each group whose count that report knew takes what worked at its close (the iPhones: the larger of that and what the
 *  site is known to have today) as handed out, returned and working today,
 *  none damaged; `same` says those counts, for the one line the folded groups show. A group the report did not know,
 *  and every group when there is no earlier report, keeps what it had: the app never fills a count it does not know.
 *  The draft given is not changed. */
export function answerYes(d, last) {
  const r = last && last.report, draft = { ...d, allOk: true }, same = {};
  const known = (v) => Number.isInteger(v) && v >= 0;
  for (const g of GEAR) {
    // phones that arrived since the earlier report are not under-reported: the larger of its count and today's
    const before = r && r[g] ? r[g].working : null, now = d[g] ? d[g].working : null;
    const n = g === 'phones' && known(before) && known(now) ? Math.max(before, now) : before;
    if (known(n)) { draft[g] = { out: n, back: n, broken: 0, working: n }; same[g] = n; }
  }
  const s = r && r.surge ? r.surge.working : null;
  if (known(s)) { draft.surge = { working: s, broken: 0 }; same.surge = s; }
  return { draft, same };
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

/** The body the server takes, from the draft, or { error } with the server's own code, so the refusal reads the same.
 *  Checked in the server's order: the people first (an emptied "Personas" box asks for the people, not for the
 *  hardware), then the hours, the hardware and the yes or no. */
export function bodyOf(d) {
  if (!Number.isInteger(d.people) || d.people < 0) return { error: 'report_people' };
  const delivered = hoursOf(d.delivered), accepted = hoursOf(d.accepted);
  if (Number.isNaN(delivered) || Number.isNaN(accepted)) return { error: 'report_hours' };
  const counts = [d.sets, ...GEAR.flatMap((g) => GEAR_COUNTS.map((k) => d[g][k])), ...SURGE_COUNTS.map((k) => d.surge[k])];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) return { error: 'report_counts' };
  if (typeof d.allOk !== 'boolean') return { error: 'report_answer' };
  return { body: { people: d.people, delivered, accepted, ...Object.fromEntries(GEAR.map((g) => [g, { ...d[g] }])), surge: { ...d.surge }, sets: d.sets,
    allOk: d.allOk, missing: String(d.missing || '').trim(), need: String(d.need || '').trim(), notes: String(d.notes || '').trim() } };
}

/** Whether a report is for yesterday: until noon the server offers [today, yesterday], and this one is the second. */
export const forYesterday = (got) => !!got && Array.isArray(got.days) && got.days.length > 1 && got.day === got.days[1];
/** The words of a label on yesterday's report. A label that says "hoy" may have a version for yesterday, `<key>.yesterday`,
 *  used when the dictionary has it (`has`); until then, the label as it is. */
export const dayKey = (key, yesterday, has = () => false) => (yesterday && has(`${key}.yesterday`) ? `${key}.yesterday` : key);

/** The live site Hoy reminds a rep of: from NUDGE_HOUR local time, the first active site with no report today. Null
 *  otherwise. Read-only screens never nudge. */
export function nudgeOf(me, readOnly = false) {
  if (readOnly || !me || !Array.isArray(me.active) || !me.active.length || !me.me) return null;
  if (localMinutes(me.serverTime, me.me.tz) < NUDGE_HOUR * 60) return null;
  return me.active.find((x) => !x.report) || null;
}
