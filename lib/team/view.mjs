// view.mjs: what each person is allowed to see, as codes and numbers. The client turns them into words in either language.
// The rep's table follows the spec's privacy rule: the podium, the rep's own place, and everyone else in
// alphabetical order with no number.
import { RULES, localDay, localMinutes, addDays, daysBetween, weekStart, monthStart, isoWeekday, podiumSize, flagsOf, goalWindow } from './rules.mjs';
import { dayStats, ledger, earnedPoints, weekOf, streak, goalOf, levelOf, lifetime, isWorkDay, logsByDay, meetingAnchor } from './score.mjs';
// One rule for telling two people with the same first name apart, on the server and on the screen: the screen's own.
import { shortNames } from '../../team/moments.js';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
/** The version of a person's photo, which the client puts in the photo's address, or null when there is none. */
const photoOf = (rep) => (rep.photo ? rep.photo.v : null);
const players = (state) => [...state.reps.values()].filter((r) => r.role === 'rep' && r.active).sort((a, b) => a.name.localeCompare(b.name, 'es'));
const isNewRep = (rep, today) => daysBetween(rep.startDate, today) < RULES.newRepDays;
const lastEarnedAt = (entries) => entries.reduce((m, e) => (e.status === 'earned' && e.at > m ? e.at : m), '');
const FEED_SKIP = new Set(['message', 'noanswer', 'baddata']);
const STAGE_PTS = { meeting_held: RULES.points.meetingHeld, contract_sent: RULES.points.contractSent, contract_signed: RULES.points.contractSigned,
  site_signed: RULES.points.siteSigned, site_installed: RULES.points.siteInstalled, site_first_hour: RULES.points.siteFirstHour };

/** One row per player with everything the tables need, computed once per request. */
function rows(state, ctx) {
  return players(state).map((rep) => {
    const today = localDay(ctx.now, rep.tz), ws = weekStart(today), ms = monthStart(today);
    const week = weekOf(state, rep.id, ws, ctx);
    const all = ledger(state, rep.id, ctx);
    const inWeek = all.filter((e) => e.day >= ws && e.day <= addDays(ws, 6));
    const inDay = all.filter((e) => e.day === today);
    const inMonth = all.filter((e) => e.day >= ms && e.status === 'earned');
    return { rep, today, ws, week, all,
      isNew: isNewRep(rep, today),
      weekScore: week.scaledPoints, weekAt: lastEarnedAt(inWeek),
      dayScore: earnedPoints(inDay), dayAt: lastEarnedAt(inDay),
      sites: inMonth.filter((e) => e.code === 'site_signed').length, meetings: inMonth.filter((e) => e.code === 'meeting_held').length, monthAt: lastEarnedAt(inMonth) };
  });
}

const PERIODS = {
  week: { score: (r) => r.weekScore, at: (r) => r.weekAt, cmp: (a, b) => b.weekScore - a.weekScore },
  day: { score: (r) => r.dayScore, at: (r) => r.dayAt, cmp: (a, b) => b.dayScore - a.dayScore },
  month: { score: (r) => r.sites * 1000 + r.meetings, at: (r) => r.monthAt, cmp: (a, b) => b.sites - a.sites || b.meetings - a.meetings },
};

/** Ranked rows for a period: new reps and zero scores are left out; a tie keeps whoever got there first. */
function rankedFor(all, period) {
  const p = PERIODS[period];
  return all.filter((r) => !r.isNew && p.score(r) > 0).sort((a, b) => p.cmp(a, b) || (p.at(a) < p.at(b) ? -1 : p.at(a) > p.at(b) ? 1 : 0));
}

function tableFor(all, viewerId, period) {
  const p = PERIODS[period], ranked = rankedFor(all, period), size = podiumSize(ranked.length);
  const line = (r, place) => ({ place, id: r.rep.id, name: r.rep.name, first: first(r.rep.name), city: r.rep.city, photo: photoOf(r.rep),
    ...(period === 'month' ? { sites: r.sites, meetings: r.meetings } : { score: p.score(r) }), marks: r.week.marks, marksMax: r.week.marksMax, hand: r.week.days.map((d) => ({ kind: d.kind, habits: d.habits })) });
  const podium = ranked.slice(0, size).map((r, i) => ({ ...line(r, i + 1), mine: r.rep.id === viewerId }));
  const onPodium = new Set(podium.map((r) => r.id));
  const mineRow = all.find((r) => r.rep.id === viewerId);
  const idx = ranked.findIndex((r) => r.rep.id === viewerId);
  // Whoever is named in a sentence (the person ahead, the person behind) is named so nobody else on the team answers to it.
  const short = shortNames(all.map((r) => ({ id: r.rep.id, name: r.rep.name })));
  let me = null, gap = null, behind = null;
  if (mineRow) {
    me = { ...line(mineRow, idx >= 0 ? idx + 1 : null), isNew: mineRow.isNew, onPodium: onPodium.has(viewerId) };
    if (period !== 'month' && idx > 0) {
      const ahead = ranked[idx - 1], named = onPodium.has(ahead.rep.id);
      gap = { pts: p.score(ahead) - p.score(mineRow), aheadOnPodium: named, aheadName: named ? short.get(ahead.rep.id) : null };
    }
    const next = idx >= 0 ? ranked[idx + 1] : null;
    if (period !== 'month' && next && onPodium.has(next.rep.id)) behind = { pts: p.score(mineRow) - p.score(next), name: short.get(next.rep.id) };
  }
  // Everyone else: alphabetical (the list is already sorted by name), the hand only, never a score or a place.
  const rest = all.filter((r) => !onPodium.has(r.rep.id) && r.rep.id !== viewerId)
    .map((r) => ({ id: r.rep.id, name: r.rep.name, first: first(r.rep.name), city: r.rep.city, photo: photoOf(r.rep), marks: r.week.marks, marksMax: r.week.marksMax, isNew: r.isNew, hand: r.week.days.map((d) => ({ kind: d.kind, habits: d.habits })) }));
  return { period, podium, me, gap, behind, rest, ranked: ranked.length };
}

function teamNumbers(state, all, ctx) {
  const working = all.filter((r) => isWorkDay(state, r.rep, r.today));
  return { meetings: all.reduce((a, r) => a + r.week.counts.meetings, 0), target: RULES.teamMeetingsPerRep * all.length,
    closedToday: working.filter((r) => state.closes.has(`${r.rep.id}|${r.today}`)).length, working: working.length, players: all.length };
}

/** The team's recent moves, newest first, with no business names. Points show only on the viewer's own moves (a manager
 * sees them all): with everyone's points a rep could add up the score of a teammate outside the podium. */
export function feedOf(state, viewerId, ctx, limit = 30) {
  const out = [], statCache = new Map();
  const viewer = state.reps.get(viewerId), seesAll = !!viewer && viewer.role !== 'rep';
  const stat = (repId, day) => { const k = `${repId}|${day}`; if (!statCache.has(k)) statCache.set(k, dayStats(state, repId, day, ctx)); return statCache.get(k); };
  for (let i = state.feed.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const f = state.feed[i], rep = state.reps.get(f.rep);
    if (!rep) continue;
    let code = f.type, pts = 0, channel = null, play = null;
    if (f.type === 'log') {
      const log = state.logs.get(f.id);
      if (!log || state.voids.has(f.id) || FEED_SKIP.has(log.kind)) continue;
      code = log.kind; channel = log.channel || null; play = state.plays.get(f.id) || null;
      pts = stat(rep.id, log.day).entries.filter((e) => e.logId === f.id).reduce((a, e) => a + e.pts, 0);
    } else if (f.type === 'day_closed') {
      const day = f.id.split(':')[2];
      pts = stat(rep.id, day).closedOnTime ? RULES.points.dayClosedOnTime : 0;
    } else if (f.type === 'badge') { play = state.badges.find((b) => b.id === f.ref)?.text || null; }
    else { if (f.ref && state.voids.has(f.ref)) continue; pts = STAGE_PTS[f.type] || 0; }
    const claps = state.kudos.get(f.id);
    out.push({ id: f.id, rep: rep.id, name: first(rep.name), city: rep.city, code, channel, pts: seesAll || rep.id === viewerId ? pts : null, at: f.t, kudos: claps ? claps.size : 0, clapped: !!claps?.has(viewerId), mine: rep.id === viewerId, play });
  }
  return out;
}

function badgesOf(state, repId, me, ctx) {
  const visits = me.all.filter((e) => e.code === 'visit' && e.status === 'earned').length;
  const step = (have, marks) => ({ have, level: marks.filter((m) => have >= m).length, next: marks.find((m) => have < m) ?? null });
  const st = streak(state, repId, me.today, ctx);
  let hands = 0;
  for (let i = 0; i < 12; i += 1) { const w = weekOf(state, repId, addDays(me.ws, -7 * i), ctx); if (w.workFingers > 0 && w.fullFingers === w.workFingers) hands += 1; }
  return [
    { code: 'first_log', ...step((state.byRep.get(repId) || []).length ? 1 : 0, [1]) },
    { code: 'first_meeting', ...step(me.all.some((e) => e.code === 'meeting_booked') ? 1 : 0, [1]) },
    { code: 'streak', ...step(st.best, [5, 20, 60]) },
    { code: 'full_hand', ...step(hands, [1, 4, 12]) },
    { code: 'visits', ...step(visits, [25, 100, 500]) },
    { code: 'first_site_live', ...step(me.all.some((e) => e.code === 'site_first_hour' && e.status === 'earned') ? 1 : 0, [1]) },
  ];
}

const publicRep = (rep, today) => ({ id: rep.id, handle: rep.handle, name: rep.name, first: first(rep.name), photo: photoOf(rep), role: rep.role, city: rep.city, country: rep.country, lang: rep.lang, tz: rep.tz, workdays: rep.workdays, startDate: rep.startDate, isNew: isNewRep(rep, today) });

/** Everything the rep's screens need. A manager who does not play gets the tables and the feed, with `today` and `week` null. */
export function repView(state, repId, ctx) {
  const rep = state.reps.get(repId);
  const all = rows(state, ctx), mine = all.find((r) => r.rep.id === repId) || null;
  const today = localDay(ctx.now, rep.tz), ws = weekStart(today);
  const out = {
    serverTime: ctx.now, me: publicRep(rep, today),
    today: null, week: null, goal: null, goalPick: null, streak: null, level: null, ledger: [], pending: [], badges: [], recentLeads: [],
    table: { week: tableFor(all, repId, 'week'), day: tableFor(all, repId, 'day'), month: tableFor(all, repId, 'month') },
    feed: feedOf(state, repId, ctx), team: teamNumbers(state, all, ctx),
    rules: { points: RULES.points, caps: RULES.caps, habits: RULES.habits, goals: RULES.goals, closeBy: RULES.closeBy, levels: RULES.levels, spares: RULES.streakSpares, pendingDays: RULES.pendingDays },
  };
  if (!mine) return out;
  const st = dayStats(state, repId, today, ctx);
  out.today = { day: today, weekday: isoWeekday(today), isWork: isWorkDay(state, rep, today), habits: st.habits, points: mine.dayScore,
    visits: st.visits, conversations: st.conversations, followups: st.followups, messages: st.messages, replies: st.replies, meetings: st.meetings,
    closed: st.closed, closedOnTime: st.closedOnTime, closedAt: st.closedAt };
  out.week = { start: ws, days: mine.week.days, marks: mine.week.marks, marksMax: mine.week.marksMax, fullFingers: mine.week.fullFingers, workFingers: mine.week.workFingers,
    counts: mine.week.counts, points: mine.week.points, weekendPoints: mine.week.weekendPoints, scaledPoints: mine.week.scaledPoints, anyLog: mine.week.anyLog };
  out.goal = goalOf(state, repId, ws, ctx);
  // The goal the rep can set right now, if any: this week's on a Monday, next week's from Friday.
  const win = goalWindow(today);
  out.goalPick = win ? { which: win.which, week: win.week, ...goalOf(state, repId, win.week, ctx) } : null;
  out.streak = streak(state, repId, today, ctx);
  out.level = levelOf(earnedPoints(mine.all));
  // The history a phone gets: the last 40 rows, and whatever still waits to be confirmed however old it is. A rep
  // reports a meeting as held from its own row, and a meeting can be two weeks ahead of the day it was booked.
  const recent = mine.all.slice(-40), shown = new Set(recent.map((e) => e.id));
  const waiting = mine.all.filter((e) => e.status === 'pending' && e.logId && !shown.has(e.id));
  out.ledger = [...waiting, ...recent].reverse().map((e) => ({ id: e.id, logId: e.logId, code: e.code, pts: e.pts, status: e.status, at: e.at, lead: e.lead ? { id: e.lead.id, name: e.lead.name } : null }));
  out.pending = mine.all.filter((e) => e.status === 'pending' && e.logId).map((e) => ({ logId: e.logId, code: e.code, pts: e.pts, at: e.at, lead: e.lead ? { id: e.lead.id, name: e.lead.name } : null, held: state.held.has(e.logId), when: state.logs.get(e.logId)?.when || null }));
  out.badges = badgesOf(state, repId, mine, ctx);
  const seen = new Set();
  for (const id of [...(state.byRep.get(repId) || [])].reverse()) {
    const log = state.logs.get(id);
    if (seen.has(log.lead.id) || state.voids.has(id)) continue;
    seen.add(log.lead.id);
    out.recentLeads.push({ id: log.lead.id, name: log.lead.name, zone: log.lead.zone || '', lastDay: log.day });
    if (out.recentLeads.length >= 8) break;
  }
  return out;
}

/** Everything a manager sees: every rep with every number, and the list of things that need them. */
export function teamView(state, ctx) {
  const all = rows(state, ctx);
  const place = new Map(rankedFor(all, 'week').map((r, i) => [r.rep.id, i + 1]));
  const now = Date.parse(ctx.now);
  const confirm = [], late = [];
  for (const log of state.logs.values()) {
    if (state.voids.has(log.id)) continue;
    const rep = state.reps.get(log.rep); if (!rep) continue;
    const conf = state.confirms.get(log.id) || {}, age = (now - Date.parse(log.t)) / 86400000, meetingAge = (now - Date.parse(meetingAnchor(log))) / 86400000;
    const item = (what) => ({ logId: log.id, rep: rep.id, name: rep.name, what, lead: { id: log.lead.id, name: log.lead.name }, at: log.t, held: state.held.has(log.id), when: log.when || null, contact: log.contact || null });
    if (log.kind === 'meeting' && !conf.meeting_held && meetingAge <= RULES.pendingDays) confirm.push(item('meeting_held'));
    if (log.kind === 'contract') {
      if (!conf.contract_sent) { if (age <= RULES.pendingDays) confirm.push(item('contract_sent')); }
      else if (!conf.contract_signed && (now - Date.parse(conf.contract_sent)) / 86400000 <= RULES.pendingSignDays) confirm.push(item('contract_signed'));
    }
    if (log.late && age <= 7) late.push({ logId: log.id, rep: rep.id, name: rep.name, at: log.t, clientAt: log.clientAt || null, kind: log.kind, lead: { id: log.lead.id, name: log.lead.name } });
  }
  confirm.sort((a, b) => (a.at < b.at ? -1 : 1));
  const silent = [], pace = [];
  const reps = all.map((r) => {
    const byDay = logsByDay(state, r.rep.id), todays = byDay.get(r.today) || [];
    const lastLogAt = [...(state.byRep.get(r.rep.id) || [])].reverse().map((id) => state.logs.get(id)).find((l) => !state.voids.has(l.id))?.t || null;
    const works = isWorkDay(state, r.rep, r.today);
    if (works && !todays.length && localMinutes(ctx.now, r.rep.tz) >= 12 * 60) silent.push({ rep: r.rep.id, name: r.rep.name, lastLogAt });
    const done = r.week.days.filter((d) => d.kind === 'work' && d.day < r.today);
    const possible = done.length * 4, have = done.reduce((a, d) => a + d.marks, 0);
    if (done.length >= 2 && have < possible * 0.4) pace.push({ rep: r.rep.id, name: r.rep.name, marks: have, possible });
    const st = dayStats(state, r.rep.id, r.today, ctx, todays);
    return { ...publicRep(r.rep, r.today), active: r.rep.active, email: r.rep.email, place: place.get(r.rep.id) ?? null,
      today: { isWork: works, habits: st.habits, closed: st.closed, closedAt: st.closedAt, logs: todays.length, lastLogAt },
      week: { days: r.week.days, marks: r.week.marks, marksMax: r.week.marksMax, fullFingers: r.week.fullFingers, counts: r.week.counts, points: r.week.points, scaledPoints: r.week.scaledPoints },
      streak: streak(state, r.rep.id, r.today, ctx), level: levelOf(earnedPoints(r.all)), goal: goalOf(state, r.rep.id, r.ws, ctx) };
  });
  const others = [...state.reps.values()].filter((r) => r.role !== 'rep' || !r.active)
    .map((r) => ({ ...publicRep(r, localDay(ctx.now, r.tz)), active: r.active, email: r.email }));
  return { serverTime: ctx.now, reps, others, needs: { confirm, silent, late, pace }, team: teamNumbers(state, all, ctx),
    sites: [...state.sites.values()].filter((s) => !s.void).map((s) => ({ id: s.id, rep: s.rep, lead: s.lead, at: s.t, steps: s.steps })), goals: RULES.goals };
}

export { lifetime, flagsOf };
