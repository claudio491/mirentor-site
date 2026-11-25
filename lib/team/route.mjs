// route.mjs: the road from an interested business to a site that records, as six stops. One pure read over the state
// that state.mjs builds; nothing here writes and nothing here pays. The screens only draw what this returns.
//
// A legacy site was signed and installed before the board: its route is complete, and it is on no list.
//
// Each stop is one of: 'done' (with the time it was done, or null when a later stop passed it without it on the board),
// 'now' (the rep's to do), 'wait' (a manager's to do, with the time the wait started) or 'later'. A wait on the contract
// that nobody confirmed in time carries when it expired (`expired`), by the same days as its points (score.mjs): the
// server refuses that confirmation, so the rep can log the contract again and the manager is no longer waited on.

import { norm } from './store.mjs';
import { RULES } from './rules.mjs';

const DAY_MS = 86400000;

export const STOPS = ['interested', 'sent', 'signed', 'site', 'phones', 'install'];

const done = (at) => ({ status: 'done', at: at || null, who: null, since: null });
const now = () => ({ status: 'now', at: null, who: 'rep', since: null });
const wait = (since, expired = null) => ({ status: 'wait', at: null, who: 'manager', since: since || null, expired });
const later = () => ({ status: 'later', at: null, who: null, since: null });

/** The route of one business for one rep. A business with two contract logs uses the latest; a voided log counts for
 *  nothing; a voided site is no site. A site a manager opened from the site form may carry no business id: one of this
 *  rep's with the business's name (accents and case aside) is that business's site. `now` (ISO) is the clock a wait is
 *  judged by; with none given, no wait expires. */
export function routeOf(state, repId, leadId, { now: clock = null } = {}) {
  const nowMs = clock ? Date.parse(clock) : NaN;
  /** When a wait from `anchor` that lasts `days` expired, or null while it still runs. */
  const lapse = (anchor, days) => { const exp = Date.parse(anchor) + days * DAY_MS; return Number.isFinite(nowMs) && Number.isFinite(exp) && nowMs > exp ? new Date(exp).toISOString() : null; };
  const rep = state.reps.get(repId);
  const logs = (state.byRep.get(repId) || []).map((id) => state.logs.get(id)).filter((l) => l && l.lead.id === leadId && !state.voids.has(l.id));
  const meeting = logs.find((l) => l.kind === 'meeting') || null;
  const contract = logs.filter((l) => l.kind === 'contract').at(-1) || null;
  const conf = (contract && state.confirms.get(contract.id)) || {};
  const named = contract || logs.at(-1), name = named ? norm(named.lead.name) : '';
  const ours = (s) => s.lead.id === leadId || (!s.lead.id && !!name && norm(s.lead.name) === name);
  const site = [...state.sites.values()].filter((s) => s.rep === repId && !s.void && ours(s)).at(-1) || null;
  const phones = !!site && site.phones !== null;
  const legacy = !!site && site.legacy;

  const raw = legacy ? STOPS.map(() => done(null)) : [
    // a contract or a site means the business was interested; a meeting from the CRM says its day, never a time
    meeting ? done(meeting.crm ? meeting.day : meeting.t) : contract || site ? done(null) : now(),
    conf.contract_sent ? done(conf.contract_sent) : contract ? wait(contract.t, lapse(contract.t, RULES.pendingDays)) : now(),
    conf.contract_signed ? done(conf.contract_signed) : conf.contract_sent ? wait(conf.contract_sent, lapse(conf.contract_sent, RULES.pendingSignDays)) : later(),
    site ? done(site.t) : conf.contract_signed ? now() : later(),
    phones ? done(site.phonesAt) : site ? wait(site.t) : later(),
    site && site.steps.installed ? done(site.steps.installed) : site && site.closed ? wait(site.closed) : phones ? now() : later(),
  ];
  // A stop that is done passes every stop before it: a site a manager opened with no contract on the board.
  const last = raw.map((x) => x.status).lastIndexOf('done');
  for (let i = 0; i < last; i += 1) if (raw[i].status !== 'done') raw[i] = done(null);
  // Only the first stop that is not done is the one to do or to wait on; anything after it comes later.
  const at = raw.findIndex((x) => x.status !== 'done');
  if (at >= 0) for (let i = at + 1; i < raw.length; i += 1) raw[i] = later();

  return {
    rep: repId, lead: { id: leadId, name: named ? named.lead.name : site ? site.lead.name : '' },
    practice: !!(rep && rep.practice) || !!(site && site.practice),
    stops: STOPS.map((key, i) => ({ key, ...raw[i] })),
    at: at < 0 ? STOPS.length : at, complete: at < 0,
    contract: contract ? { logId: contract.id, t: contract.t, sent: conf.contract_sent || null, signed: conf.contract_signed || null } : null,
    site: site ? { id: site.id, t: site.t, city: site.city, eligible: site.eligible, phones: site.phones, closed: site.closed, installed: site.steps.installed || null, practice: site.practice, legacy: site.legacy } : null,
  };
}

/** The time a route last moved: what orders two routes on the same stop. */
const movedAt = (r) => r.stops.reduce((m, s) => [s.at, s.since].reduce((a, t) => (t && t > a ? t : a), m), '');

/** "Mis sitios en camino": every business of the rep at stop 2 or further (a meeting booked, a contract, a site),
 *  furthest along first, and on the same stop the one that moved last. */
export function routesOf(state, repId, opts = {}) {
  const leads = new Set();
  for (const id of state.byRep.get(repId) || []) {
    const l = state.logs.get(id);
    if (l && !state.voids.has(id) && (l.kind === 'meeting' || l.kind === 'contract')) leads.add(l.lead.id);
  }
  for (const s of state.sites.values()) if (s.rep === repId && !s.void && !s.legacy && s.lead.id) leads.add(s.lead.id);
  return [...leads].map((lead) => routeOf(state, repId, lead, opts)).filter((r) => r.at >= 1 && !(r.site && r.site.legacy))
    .sort((a, b) => b.at - a.at || (movedAt(a) < movedAt(b) ? 1 : movedAt(a) > movedAt(b) ? -1 : 0));
}

/** The same list for every rep a manager sees: the stop that waits on a manager first (oldest wait first), then the
 *  rest as each rep's list orders them. The practice rep waits for nobody and is left out; a wait that expired is no
 *  longer on a manager (the confirmation is refused) and goes with the rest. */
export function teamRoutes(state, opts = {}) {
  const all = [...state.reps.values()].filter((r) => r.role === 'rep' && r.active && !r.practice).flatMap((r) => routesOf(state, r.id, opts));
  const waits = (r) => !r.complete && r.stops[r.at].status === 'wait' && !r.stops[r.at].expired;
  return [...all.filter(waits).sort((a, b) => (a.stops[a.at].since < b.stops[b.at].since ? -1 : 1)), ...all.filter((r) => !waits(r)).sort((a, b) => b.at - a.at || (movedAt(a) < movedAt(b) ? 1 : -1))];
}
