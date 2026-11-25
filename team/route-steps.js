// route-steps.js: what the route screens decide on the phone, away from the page so it can be tested. The server sends
// each business's route (lib/team/route.mjs): six stops, each 'done', 'now' (the rep's), 'wait' (a manager's) or
// 'later'. A wait on the contract that nobody confirmed in time carries `expired`: the rep logs the contract again. These only choose the words of a stop, the controls it offers in each mode, the business the Hoy card shows
// and what the "open the site" form sends. The server stays the judge of every write.

const refuse = (code) => { throw Object.assign(new Error(code), { code }); };
const trim = (v) => String(v ?? '').trim();

/** What a stop says, as an i18n key, and the time it carries (the day it was done). Sending the contract points at
 *  the agreement below only when a document is hooked to the contract step (`agreement`); without one it says the
 *  manager has not added it yet. */
export function stopLine(route, i, { agreement = false } = {}) {
  const s = route.stops[i];
  if (s.status === 'done') return s.at ? { key: 'route.done.at', at: s.at } : { key: 'route.done.passed', at: null };
  if (s.status === 'wait' && s.expired) return { key: `route.expired.${s.key}`, at: s.expired };
  if (s.status === 'now' && s.key === 'sent' && !agreement) return { key: 'route.now.sent.nodoc', at: null };
  return { key: `route.${s.status}.${s.key}`, at: null };
}

/** How far a route is: stops done of six. */
export const routeCount = (route) => ({ done: route.stops.filter((s) => s.status === 'done').length, of: route.stops.length });

// The stop that waits on a manager, and what the practice control there does in the manager's place.
const PRACTICE = { 1: 'contract_sent', 2: 'contract_signed', 4: 'phones', 5: 'installed' };

/** The controls a stop offers. `mode` is practice-steps.js's: 'self', 'view' (a real rep through view-as: nothing
 *  writes) or 'practice' (a manager acting as the practice rep).
 *  log: the result to log from here ('meeting' or 'contract'); docs: the contract documents at hand; openSite: the
 *  form that opens the site; install: open its install screens, or only look at them; practice: the manager's part,
 *  done from here, only on the practice rep's own route and only on the stop that waits on a manager. */
export function stopControls(route, i, mode) {
  const s = route.stops[i], current = i === route.at, write = mode !== 'view';
  const out = { log: null, docs: false, openSite: false, install: null, practice: null };
  if (!s) return out;
  out.docs = current && (i === 1 || i === 2);
  // once confirmed, the install is only looked at
  if (i === 5 && route.site && s.status !== 'later') out.install = write && s.status !== 'done' ? 'open' : 'view';
  if (!current) return out;
  if (write && s.status === 'now' && i === 0) out.log = 'meeting';
  if (write && s.status === 'now' && i === 1) out.log = 'contract';
  if (write && s.status === 'now' && i === 3) out.openSite = true;
  // a confirmation nobody gave in time is refused by the server: the contract is logged again from here
  if (write && s.status === 'wait' && s.expired && (i === 1 || i === 2)) out.log = 'contract';
  if (mode === 'practice' && route.practice && s.status === 'wait' && !s.expired && PRACTICE[i]) out.practice = PRACTICE[i];
  return out;
}

/** The Hoy card: of the businesses on the way, the one furthest along whose stop is the rep's to do now. The install
 *  stop keeps its own card (install.js). Acting as the practice rep, a stop that waits on a manager is something to do
 *  now as well: its control is on the route. */
export function routeCard(routes, mode) {
  const list = Array.isArray(routes) ? routes : [];
  const open = (r) => {
    if (r.complete) return false;
    const s = r.stops[r.at];
    if (s.status === 'now') return r.at >= 1 && r.at <= 4;
    if (s.status === 'wait' && s.expired) return mode !== 'view';   // the contract to log again
    return s.status === 'wait' && mode === 'practice' && !!r.practice;
  };
  return list.filter(open).sort((a, b) => b.at - a.at)[0] || null;
}

/** The body of POST route/site. The name comes from the business on the server; only the facts that were typed go,
 *  each well formed: eligible is a whole number up to 5000, the coordinator goes with a name and a phone or not at all. */
export function openSiteBody(v, id, leadId) {
  const body = { id, lead: leadId };
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
  return body;
}
