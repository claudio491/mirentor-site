// ladder.mjs: a new rep's first days as ten steps. Pure reads over the state; nothing here writes.
// Most steps tick on their own from what the log already holds. Three are the rep's to tick, one is a manager's.
import { LADDER, VIDEOS, STEP_VIDEO } from './rules.mjs';
import { dayStats, logsByDay } from './score.mjs';
import { pickable, norm } from './store.mjs';

const BY = { video: 'rep', kit: 'rep', whatsapp: 'rep', zones: 'rep', hour: 'manager' };

/** The areas of the businesses a rep in this city may pick: the lead's own spelling, the first seen for each name, sorted. An empty area is never offered. */
export function zonesFor(leads, city) {
  const found = new Map();
  for (const lead of leads.values()) {
    const zone = typeof lead.zone === 'string' ? lead.zone.trim() : '';
    if (!zone || !pickable(lead, city) || found.has(norm(zone))) continue;
    found.set(norm(zone), zone);
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

const firstConversation = (state, repId, ctx) => {
  const byDay = logsByDay(state, repId);
  return [...byDay.keys()].sort().some((day) => dayStats(state, repId, day, ctx, byDay.get(day)).conversations > 0);
};

/** The ten steps in order. `video` is the key of the video that explains the step (null when it has none); `hasVideo` says an address exists for it. */
export function ladderOf(state, repId, ctx) {
  const logs = (state.byRep.get(repId) || []).filter((id) => !state.voids.has(id)).map((id) => state.logs.get(id));
  const doneBy = {
    video: () => state.ticks.has(`${repId}|video`),
    kit: () => state.ticks.has(`${repId}|kit`),
    whatsapp: () => state.ticks.has(`${repId}|whatsapp`),
    zones: () => (state.zones.get(repId) || []).length === 2,
    talk: () => firstConversation(state, repId, ctx),
    report: () => (state.closesByRep.get(repId) || []).length > 0,
    meeting: () => logs.some((l) => l.kind === 'meeting'),
    contract: () => logs.some((l) => l.kind === 'contract' && state.confirms.get(l.id)?.contract_signed),
    install: () => [...state.sites.values()].some((s) => !s.void && !s.practice && s.closed && s.closedBy === repId),
    hour: () => state.ticks.has(`${repId}|hour`),
  };
  return LADDER.map((step) => {
    const video = STEP_VIDEO[step] || null;
    return { step, done: !!doneBy[step](), by: BY[step] || 'app', video, hasVideo: !!(video && VIDEOS[video]) };
  });
}

/** The training videos a rep has opened, in the order the list of videos names them. */
export const seenOf = (state, repId) => Object.keys(VIDEOS).filter((k) => state.seen.get(repId)?.has(k));
