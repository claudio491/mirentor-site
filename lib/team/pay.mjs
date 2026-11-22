// pay.mjs: what a rep earns, as pure reads over the state. Accepted minutes are recorded per site and per week (a
// Monday) by a manager or an admin; one rate per accepted hour, in cents, is set by an admin and applies from the week it
// names. A practice rep reads the practice rate only, so the example rate never pays a real person and the real rate
// never pays practice. While no rate is in force nothing is computed: the amount is null, never zero.

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

/** A site that is live: installed through the app (confirmed), not voided, not signed before the app. */
export const isActive = (site) => !site.void && !site.legacy && !!site.steps.installed;

/** A person's active sites, oldest first. */
export const activeSites = (state, repId) => [...state.sites.values()].filter((s) => s.rep === repId && isActive(s)).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

/** Accepted minutes of one site in one week; nothing recorded is zero. */
export const siteMinutes = (state, siteId, week) => state.siteHours.get(siteId)?.get(week)?.accepted ?? 0;

/** What a person earned in a week: the accepted minutes of the week across their active sites, the rate in force and the
 *  amount in cents (null while no rate is in force). */
export function earnOf(state, rep, week) {
  const minutes = activeSites(state, rep.id).reduce((a, s) => a + siteMinutes(state, s.id, week), 0);
  const rate = rateFor(state, rep, week);
  return { week, minutes, rate, cents: rate == null ? null : centsFor(minutes, rate) };
}

const workersOf = (state, site) => site.workers.map((id) => state.workers.get(id)).filter(Boolean);

/** A person's own active sites, as their "Mis sitios activos" screen shows them: who records, the phones on site, the
 *  consents on file, the accepted minutes of this week and the last, and what the site earned them this week. */
export function mySites(state, rep, week, lastWeek) {
  const rate = rateFor(state, rep, week);
  return activeSites(state, rep.id).map((s) => {
    const ws = workersOf(state, s), minutes = siteMinutes(state, s.id, week);
    return { id: s.id, name: s.lead.name, city: s.city, practice: s.practice, workers: ws.length, recording: ws.filter((w) => w.phone !== false).length,
      phones: ws.filter((w) => w.imei).length, consents: ws.filter((w) => w.consent).length, week: minutes, last: siteMinutes(state, s.id, lastWeek), cents: rate == null ? null : centsFor(minutes, rate) };
  });
}

/** What anyone on the team may know about a person: their active sites by name with a count of workers and the week's
 *  minutes, the week's minutes and earnings. Never a worker's name, address, consent or phone. */
export function publicEarn(state, rep, week) {
  const e = earnOf(state, rep, week);
  return { id: rep.id, sites: activeSites(state, rep.id).map((s) => ({ name: s.lead.name, workers: workersOf(state, s).length, minutes: siteMinutes(state, s.id, week) })), minutes: e.minutes, cents: e.cents };
}
