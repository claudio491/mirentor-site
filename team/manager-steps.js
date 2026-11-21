// manager-steps.js: what the manager's site and hours controls decide before the server answers, away from the page so
// it can be tested. What the site form sends, what the hours form sends, which controls a site offers, and which roles
// the person form lists. The server stays the judge: a refusal here only says it sooner, in words.

const refuse = (code) => { throw Object.assign(new Error(code), { code }); };
const trim = (v) => String(v ?? '').trim();
const KINDS = { normal: {}, practice: { practice: true }, legacy: { legacy: true } };

/** The body of POST site. Optional facts are sent only when typed: `eligible` is left out when empty (the server
 *  refuses null), the coordinator goes with both a name and a phone or not at all. A site is one kind: normal, practice
 *  or legacy, so practice and legacy can never both be set. */
export function siteBody(v, id) {
  const name = trim(v.name);
  if (!v.rep || name.length < 2) refuse('fields');
  if (!Object.hasOwn(KINDS, v.kind || 'normal')) refuse('site_kind');
  const body = { id, rep: v.rep, lead: { name } };
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
  return Object.assign(body, KINDS[v.kind || 'normal']);
}

const isMonday = (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day && d.getUTCDay() === 1;
};
/** Hours and minutes typed as two fields, as minutes. Empty is zero; minutes run 0 to 59. */
const minutesOf = (hh, mm) => {
  const a = trim(hh) || '0', b = trim(mm) || '0';
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || Number(b) > 59) return null;
  const total = Number(a) * 60 + Number(b);
  return total <= 100000 ? total : null;
};
/** The body of POST hours for one week typed by hand: the week starts on a Monday, both counts are minutes (zero is a
 *  week too), and the buyers cannot accept more than was delivered. */
export function hoursBody(v) {
  const week = trim(v.week);
  if (!isMonday(week)) refuse('week');
  const delivered = minutesOf(v.dh, v.dm), accepted = minutesOf(v.ah, v.am);
  if (delivered == null || accepted == null) refuse('hours_minutes');   // a week with nothing delivered is a real week
  if (accepted > delivered) refuse('hours_order');
  return { weeks: [{ week, delivered, accepted }] };
}

/** The controls a site offers a manager, in the order they show.
 *  install: open its install screens (any site but a legacy one, which is not installed here);
 *  phones: "Llegaron teléfonos", until the install is closed;
 *  confirm: "Confirmar instalación" once the rep closed it;
 *  installed: the old way of marking, for a legacy site or one with nobody on it;
 *  first_hour, record (the audit file, once someone is on it), void: real sites only. A practice site is removed instead, and has no record. */
export function siteActions(site) {
  const out = [], done = !!(site.steps && site.steps.installed), closed = site.state === 'closed' || (site.practice && !!site.closed);
  if (!site.legacy) out.push('install');
  if (!site.legacy && !done && !closed) out.push('phones');
  if (closed && !done) out.push('confirm');
  if (!site.practice && !done && (site.legacy || !site.workers)) out.push('installed');
  if (!site.practice && done && !(site.steps && site.steps.first_hour)) out.push('first_hour');
  if (!site.practice && !site.legacy && site.workers) out.push('record');   // a record with nobody in it is an empty file
  out.push(site.practice ? 'remove' : 'void');
  return out;
}

/** Which roles the person form lists. Only an admin chooses one, and only an admin can make a leader. */
export const roleOptions = (viewerRole) => (viewerRole === 'admin' ? ['rep', 'manager', 'admin', 'leader'] : []);

/** The address of a site's record, relative to the page. */
export const recordUrl = (siteId) => `api/site/${encodeURIComponent(siteId)}/record.csv`;
