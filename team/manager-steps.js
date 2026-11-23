// manager-steps.js: what the manager's site and hours controls decide before the server answers, away from the page so
// it can be tested. Who the site form offers, what the site form sends, what the hours form sends, which controls a site offers, and which roles
// the person form lists. The server stays the judge: a refusal here only says it sooner, in words.

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

/** The controls a site offers a manager, in the order they show.
 *  install: open its install screens (on a legacy site, the screens that load the consents it already had);
 *  phones: "Llegaron teléfonos", until the install is closed;
 *  confirm: "Confirmar instalación" once the rep closed it;
 *  installed: the old way of marking, for a legacy site or one with nobody on it;
 *  first_hour, hours (accepted minutes per week, once installed), record (the audit file, once someone is on it), void: real sites only. A practice site is removed instead, and has no record. */
export function siteActions(site) {
  const out = [], done = !!(site.steps && site.steps.installed), closed = site.state === 'closed' || (site.practice && !!site.closed);
  out.push('install');   // on a legacy site it loads the consents signed before the app, and nothing else
  if (!site.legacy && !done && !closed) out.push('phones');
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

/** Which roles the person form lists. Only an admin chooses one, and only an admin can make a leader. */
export const roleOptions = (viewerRole) => (viewerRole === 'admin' ? ['rep', 'manager', 'admin', 'leader'] : []);

/** The body of POST reps. "No access for now" sends `access: 'none'` with no email and no role: the server makes a rep
 *  nobody signs in as until a manager adds an email. Otherwise the email path, as before. */
export function newRepBody(v) {
  const base = { name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays };
  return v.access === 'none' ? { access: 'none', ...base } : { email: v.email, ...base, role: v.role };
}

/** The address of a site's record, relative to the page. */
export const recordUrl = (siteId) => `api/site/${encodeURIComponent(siteId)}/record.csv`;
