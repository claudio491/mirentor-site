// leader.mjs: what a leader sees, every city at once: its sites, its reps' week and the hours delivered.
// Pure reads over the state; a leader changes nothing, and a practice site is counted but never shown.
import { localDay, weekStart, SCORECARD_ACCEPTED_GOAL_HOURS } from './rules.mjs';
import { weekOf } from './score.mjs';
import { siteState } from './install.mjs';
import { ladderOf, seenOf } from './ladder.mjs';
import { players, photoOf, isNewRep } from './view.mjs';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
/** Accepted over delivered, in percent with one decimal. Nothing delivered means nothing to divide: null. */
const pct = (h) => (h.delivered > 0 ? Math.round((h.accepted / h.delivered) * 1000) / 10 : null);

export function leaderView(state, ctx) {
  const cities = new Map();
  const city = (name) => cities.get(name) || cities.set(name, { city: name, sites: [], reps: [] }).get(name);
  let practiceHidden = 0;
  for (const site of state.sites.values()) {
    if (site.void) continue;
    if (site.practice) { practiceHidden += 1; continue; }
    const workers = site.workers.map((id) => state.workers.get(id)).filter(Boolean);
    city(site.city || '').sites.push({ id: site.id, name: site.lead.name, state: siteState(site), eligible: site.eligible,
      consents: site.legacy ? 0 : workers.filter((w) => w.consent).length, phones: workers.filter((w) => w.imei).length, workers: workers.length });
  }
  for (const rep of players(state)) {
    const today = localDay(ctx.now, rep.tz), c = weekOf(state, rep.id, weekStart(today), ctx).counts;
    city(rep.city || '').reps.push({ id: rep.id, first: first(rep.name), photo: photoOf(rep), week: { visits: c.visits, conversations: c.conversations, meetings: c.meetings, contracts: c.contracts }, isNew: isNewRep(rep, today), seen: seenOf(state, rep.id), ladderDone: ladderOf(state, rep.id, ctx).filter((x) => x.done).length });
  }
  const list = [...cities.values()].sort((a, b) => (a.city === '') - (b.city === '') || a.city.localeCompare(b.city, 'es'));
  for (const c of list) c.sites.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const hours = [...state.hours].sort(([a], [b]) => (a < b ? 1 : -1)).map(([week, h]) => ({ week, delivered: h.delivered, accepted: h.accepted, pct: pct(h), source: h.source }));
  // The Scorecard's goal travels with the hours, in the same unit (minutes), so the screen never holds a number of its own.
  return { cities: list, hours, practiceHidden, goalAccepted: SCORECARD_ACCEPTED_GOAL_HOURS * 60 };
}
