// pay.mjs: what a rep earns, as pure reads over the state. Accepted minutes are recorded per site and per week (a
// Monday) by a manager or an admin; one rate per accepted hour, in cents, is set by an admin and applies from the week it
// names. A practice rep reads the practice rate only, so the example rate never pays a real person and the real rate
// never pays practice. While no rate is in force nothing is computed: the amount is null, never zero.
import { localDay, weekStart } from './rules.mjs';

/** The highest rate the app takes, in cents per accepted hour (US$1,000). */
export const MAX_RATE_CENTS = 100000;

/** Cents for accepted minutes at a rate in cents per hour, to the nearest cent. */
export const centsFor = (minutes, rate) => Math.round((minutes * rate) / 60);

/** A week as the events name it: a Monday written YYYY-MM-DD. */
export function isMonday(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day && d.getUTCDay() === 1;
}

/** The rate in force for a week, in cents per hour, or null. The newest rate whose week is on or before it wins; two
 *  rates for the same week, the later one. */
export function rateFor(state, rep, week) {
  const list = rep && rep.practice ? state.practiceRates : state.payRates;
  let hit = null;
  for (const r of list) if (r.from <= week && (!hit || r.from >= hit.from)) hit = r;
  return hit ? hit.cents : null;
}

/** A site that is live for its rep: installed through the app (confirmed), not voided, not signed before the app, and
 *  not a practice site unless the rep is a practice rep (a real person's practice site is a rehearsal, never theirs). */
export const isActive = (site, rep) => !site.void && !site.legacy && !!site.steps.installed && (!site.practice || !!(rep && rep.practice));

/** A person's active sites, oldest first. */
export const activeSites = (state, repId) => {
  const rep = state.reps.get(repId);
  return [...state.sites.values()].filter((s) => s.rep === repId && isActive(s, rep)).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
};

/** Accepted minutes of one site in one week; nothing recorded is zero. */
export const siteMinutes = (state, siteId, week) => state.siteHours.get(siteId)?.get(week)?.accepted ?? 0;

/** The sites whose accepted minutes pay a person for a week: their active sites, and a site voided since, for the weeks up
 *  to and including the week of the void. Ruling: what a site earned before it was voided stays earned; the week of the
 *  void keeps the minutes recorded for it. */
function paidSites(state, rep, week) {
  return [...state.sites.values()].filter((s) => s.rep === rep.id && !s.legacy && !!s.steps.installed && (!s.practice || !!rep.practice)
    && (!s.void || week <= weekStart(localDay(s.void, rep.tz || 'America/Panama')))).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/** A week's pay, site by site: the total is rounded once, to the nearest cent, and the cents are shared out over the
 *  sites by largest remainder (ties to the older site), so the rows always add up to the total. */
function weekPay(state, rep, week) {
  const sites = paidSites(state, rep, week).map((s) => ({ site: s, minutes: siteMinutes(state, s.id, week) }));
  const minutes = sites.reduce((a, x) => a + x.minutes, 0), rate = rateFor(state, rep, week);
  const cents = rate == null ? null : centsFor(minutes, rate), bySite = new Map();
  if (cents != null) {
    const parts = sites.map((x, i) => ({ id: x.site.id, i, floor: Math.floor((x.minutes * rate) / 60), rem: (x.minutes * rate) % 60 }));
    let left = cents - parts.reduce((a, p) => a + p.floor, 0);
    for (const p of [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i)) { if (left <= 0) break; if (p.rem > 0) { p.floor += 1; left -= 1; } }
    for (const p of parts) bySite.set(p.id, p.floor);
  }
  // what voided sites still bring this week: shown apart, so the active rows plus this line make the total
  const off = sites.filter((x) => !isActive(x.site, rep) && x.minutes > 0);
  const gone = off.length ? { minutes: off.reduce((a, x) => a + x.minutes, 0), cents: cents == null ? null : off.reduce((a, x) => a + bySite.get(x.site.id), 0) } : null;
  return { minutes, rate, cents, bySite, gone };
}

/** What a person earned in a week: the accepted minutes of the week across the sites that pay them, the rate in force and
 *  the amount in cents (null while no rate is in force). `gone` (only when there is one) is the part of it from sites
 *  voided since. */
export function earnOf(state, rep, week) {
  const p = weekPay(state, rep, week);
  return { week, minutes: p.minutes, rate: p.rate, cents: p.cents, ...(p.gone ? { gone: p.gone } : {}) };
}

const workersOf = (state, site) => site.workers.map((id) => state.workers.get(id)).filter(Boolean);

/** A person's own active sites, as their "Mis sitios activos" screen shows them: who records, the phones on site, the
 *  consents on file, the accepted minutes of this week and the last, and what the site earned them this week (its share
 *  of the week's total). */
export function mySites(state, rep, week, lastWeek) {
  const p = weekPay(state, rep, week);
  return activeSites(state, rep.id).map((s) => {
    const ws = workersOf(state, s), minutes = siteMinutes(state, s.id, week);
    return { id: s.id, name: s.lead.name, city: s.city, practice: s.practice, workers: ws.length, recording: ws.filter((w) => w.phone !== false).length,
      phones: ws.filter((w) => w.imei).length, consents: ws.filter((w) => w.consent).length, week: minutes, last: siteMinutes(state, s.id, lastWeek), cents: p.cents == null ? null : p.bySite.get(s.id) ?? 0 };
  });
}

/** What anyone on the team may know about a person: their active sites by name with a count of workers and the week's
 *  minutes, the week's minutes and earnings, and what sites voided this week still bring (no name). Never a worker's name,
 *  address, consent or phone. */
export function publicEarn(state, rep, week) {
  const e = earnOf(state, rep, week);
  return { id: rep.id, sites: activeSites(state, rep.id).map((s) => ({ name: s.lead.name, workers: workersOf(state, s).length, minutes: siteMinutes(state, s.id, week) })), minutes: e.minutes, cents: e.cents,
    ...(e.gone ? { gone: e.gone } : {}) };
}
