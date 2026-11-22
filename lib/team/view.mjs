// view.mjs: what each person is allowed to see, as codes and numbers. The client turns them into words in either language.
// The rep's table follows the spec's privacy rule: the podium, the rep's own place, and everyone else in
// alphabetical order with no number.
import { RULES, VIDEOS, localDay, localMinutes, addDays, daysBetween, weekStart, monthStart, isoWeekday, podiumSize, flagsOf, goalWindow } from './rules.mjs';
import { dayStats, ledger, earnedPoints, weekOf, streak, goalOf, levelOf, lifetime, isWorkDay, logsByDay, meetingAnchor } from './score.mjs';
// One rule for telling two people with the same first name apart, on the server and on the screen: the screen's own.
import { ladderOf, seenOf } from './ladder.mjs';
import { shortNames } from '../../team/moments.js';
import { siteProgress, siteState } from './install.mjs';
import { routesOf, teamRoutes } from './route.mjs';
import { earnOf, mySites, publicEarn, rateFor } from './pay.mjs';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
/** A person's name as the reader's language says it. An example rep is named by a letter, "Vendedor A" or "Rep A"; and
 *  since all four would share a first name, their whole name is their first. Everyone else is named as written. */
export const nameOf = (rep, lang) => (rep.example ? (lang === 'en' ? `Rep ${rep.example}` : `Vendedor ${rep.example}`) : rep.name);
export const firstOf = (rep, lang) => (rep.example ? nameOf(rep, lang) : first(rep.name));
/** The version of a person's photo, which the client puts in the photo's address, or null when there is none. */
export const photoOf = (rep) => (rep.photo ? rep.photo.v : null);
/** Who plays: the active reps. The practice rep never does, so it is in no table and no total. */
export const players = (state) => [...state.reps.values()].filter((r) => r.role === 'rep' && r.active && !r.practice).sort((a, b) => a.name.localeCompare(b.name, 'es'));
/** The practice world: every practice rep who plays (the free practice rep and the example team). A practice rep's
 *  table, feed and team numbers are made of these only, and a real person's never holds one of them. */
export const practicePlayers = (state) => [...state.reps.values()].filter((r) => r.role === 'rep' && r.active && r.practice).sort((a, b) => a.name.localeCompare(b.name, 'es'));
/** The world a person plays in. */
export const worldOf = (state, rep) => (rep && rep.practice ? practicePlayers(state) : players(state));
/** The free practice rep, when there is one: never one of the example team. */
export const practiceRep = (state) => [...state.reps.values()].find((r) => r.practice && !r.example) || null;
/** The example team, A to D. */
export const exampleReps = (state) => [...state.reps.values()].filter((r) => r.example).sort((a, b) => (a.example < b.example ? -1 : 1));
/** Whether the example team was made for a day before today (in its own time zone): its week is then not this one. */
export const exampleStale = (team, now) => team.some((r) => r.recipeDay !== localDay(now, r.tz));
export const isNewRep = (rep, today) => daysBetween(rep.startDate, today) < RULES.newRepDays;
/** When a ledger entry happened, as an answer says it: a CRM row's day, or the moment. */
const whenOf = (e) => (e.crm ? { at: e.day, crm: true } : { at: e.at });
/** The same for a log. */
const logWhen = (log) => (log.crm ? { at: log.day, crm: true } : { at: log.t });
const lastEarnedAt = (entries) => entries.reduce((m, e) => (e.status === 'earned' && e.at > m ? e.at : m), '');
const FEED_SKIP = new Set(['message', 'noanswer', 'baddata']);
const STAGE_PTS = { meeting_held: RULES.points.meetingHeld, contract_sent: RULES.points.contractSent, contract_signed: RULES.points.contractSigned,
  site_signed: RULES.points.siteSigned, site_installed: RULES.points.siteInstalled, site_first_hour: RULES.points.siteFirstHour };

/** One row per player with everything the tables need, computed once per request. `world` is who plays (the real
 *  players unless said otherwise). */
function rows(state, ctx, world = players(state)) {
  return world.map((rep) => rowOf(state, rep, ctx));
}
/** Everything the tables need about one rep. */
function rowOf(state, rep, ctx) {
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

function tableFor(all, viewerId, period, lang) {
  const p = PERIODS[period], ranked = rankedFor(all, period), size = podiumSize(ranked.length);
  const line = (r, place) => ({ place, id: r.rep.id, name: nameOf(r.rep, lang), first: firstOf(r.rep, lang), city: r.rep.city, photo: photoOf(r.rep),
    ...(period === 'month' ? { sites: r.sites, meetings: r.meetings } : { score: p.score(r) }), marks: r.week.marks, marksMax: r.week.marksMax, hand: r.week.days.map((d) => ({ kind: d.kind, habits: d.habits })) });
  const podium = ranked.slice(0, size).map((r, i) => ({ ...line(r, i + 1), mine: r.rep.id === viewerId }));
  const onPodium = new Set(podium.map((r) => r.id));
  const mineRow = all.find((r) => r.rep.id === viewerId);
  const idx = ranked.findIndex((r) => r.rep.id === viewerId);
  // Whoever is named in a sentence (the person ahead, the person behind) is named so nobody else on the team answers to it.
  const short = shortNames(all.map((r) => ({ id: r.rep.id, name: nameOf(r.rep, lang) })));
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
    .map((r) => ({ id: r.rep.id, name: nameOf(r.rep, lang), first: firstOf(r.rep, lang), city: r.rep.city, photo: photoOf(r.rep), marks: r.week.marks, marksMax: r.week.marksMax, isNew: r.isNew, hand: r.week.days.map((d) => ({ kind: d.kind, habits: d.habits })) }));
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
  const viewer = state.reps.get(viewerId), seesAll = !!viewer && viewer.role !== 'rep', practiceWorld = !!(viewer && viewer.practice);
  const stat = (repId, day) => { const k = `${repId}|${day}`; if (!statCache.has(k)) statCache.set(k, dayStats(state, repId, day, ctx)); return statCache.get(k); };
  for (let i = state.feed.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const f = state.feed[i], rep = state.reps.get(f.rep);
    // each world sees its own moves: a practice rep the practice reps' only, everyone else the real ones only
    if (!rep || !!rep.practice !== practiceWorld) continue;
    let code = f.type, pts = 0, channel = null, play = null, at = f.t, crm = false;
    if (f.type === 'log') {
      const log = state.logs.get(f.id);
      if (!log || state.voids.has(f.id) || FEED_SKIP.has(log.kind)) continue;
      code = log.kind; channel = log.channel || null; play = state.plays.get(f.id) || null;
      if (log.crm) { at = log.day; crm = true; }   // a CRM row has a day and no time
      pts = stat(rep.id, log.day).entries.filter((e) => e.logId === f.id).reduce((a, e) => a + e.pts, 0);
    } else if (f.type === 'day_closed') {
      const day = f.id.split(':')[2];
      pts = stat(rep.id, day).closedOnTime ? RULES.points.dayClosedOnTime : 0;
    } else if (f.type === 'badge') { play = state.badges.find((b) => b.id === f.ref)?.text || null; }
    else { if (f.ref && state.voids.has(f.ref)) continue; pts = STAGE_PTS[f.type] || 0; }
    const claps = state.kudos.get(f.id);
    out.push({ id: f.id, rep: rep.id, name: firstOf(rep, ctx.lang), city: rep.city, code, channel, pts: seesAll || rep.id === viewerId ? pts : null, at, ...(crm ? { crm: true } : {}), kudos: claps ? claps.size : 0, clapped: !!claps?.has(viewerId), mine: rep.id === viewerId, play });
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

/** The installs that wait for this person as the site's rep: phones marked, not voided, not a legacy site, not yet
 * confirmed installed. A practice site is listed under the same conditions and says so. */
export function installsOf(state, repId) {
  return [...state.sites.values()].filter((s) => s.rep === repId && !s.void && !s.legacy && s.phones !== null && !s.steps.installed)
    .map((s) => { const p = siteProgress(state, s.id); return { id: s.id, name: s.lead.name, state: siteState(s), ready: p.ready, total: p.total, phones: s.phones, practice: s.practice, closed: !!s.closed }; });
}

const publicRep = (rep, today, lang) => ({ id: rep.id, handle: rep.handle, name: nameOf(rep, lang), first: firstOf(rep, lang), photo: photoOf(rep), role: rep.role, city: rep.city, country: rep.country, lang: rep.lang, tz: rep.tz, workdays: rep.workdays, startDate: rep.startDate, isNew: isNewRep(rep, today),
  ...(rep.practice ? { practice: true } : {}), ...(rep.example ? { example: rep.example } : {}) });

/** Everything the rep's screens need. A manager who does not play gets the tables and the feed, with `today` and `week` null. */
export function repView(state, repId, ctx) {
  const rep = state.reps.get(repId);
  // A practice rep plays in the practice world: its table, feed and team numbers hold the practice reps only.
  const all = rows(state, ctx, worldOf(state, rep)), mine = all.find((r) => r.rep.id === repId) || (rep.practice ? rowOf(state, rep, ctx) : null);
  const today = localDay(ctx.now, rep.tz), ws = weekStart(today), lang = ctx.lang;
  // What the person earns this week and earned the last, their active sites, and what each teammate earns this week
  // (that teammate's own week). Every amount is null while no rate is in force.
  const week = earnOf(state, rep, ws), last = earnOf(state, rep, addDays(ws, -7));
  const out = {
    serverTime: ctx.now, me: publicRep(rep, today, lang),
    today: null, week: null, goal: null, goalPick: null, streak: null, level: null, ledger: [], pending: [], badges: [], recentLeads: [],
    table: { week: tableFor(all, repId, 'week', lang), day: tableFor(all, repId, 'day', lang), month: tableFor(all, repId, 'month', lang) },
    ladder: ladderOf(state, repId, ctx), seen: seenOf(state, repId), videos: { ...VIDEOS }, zones: [...(state.zones.get(repId) || [])], installs: installsOf(state, repId), routes: routesOf(state, repId),
    feed: feedOf(state, repId, ctx), team: teamNumbers(state, all, ctx),
    earn: { rate: rateFor(state, rep, ws), week: { start: ws, minutes: week.minutes, cents: week.cents, ...(week.gone ? { gone: week.gone } : {}) }, last: { start: last.week, minutes: last.minutes, cents: last.cents } },
    active: mySites(state, rep, ws, addDays(ws, -7)), crew: all.map((r) => publicEarn(state, r.rep, r.ws)),
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
  out.ledger = [...waiting, ...recent].reverse().map((e) => ({ id: e.id, logId: e.logId, code: e.code, pts: e.pts, status: e.status, ...whenOf(e), lead: e.lead ? { id: e.lead.id, name: e.lead.name } : null }));
  out.pending = mine.all.filter((e) => e.status === 'pending' && e.logId).map((e) => ({ logId: e.logId, code: e.code, pts: e.pts, ...whenOf(e), lead: e.lead ? { id: e.lead.id, name: e.lead.name } : null, held: state.held.has(e.logId), when: state.logs.get(e.logId)?.when || null }));
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
    const rep = state.reps.get(log.rep); if (!rep || rep.practice) continue;   // practice waits for nobody
    const conf = state.confirms.get(log.id) || {}, age = (now - Date.parse(log.t)) / 86400000, meetingAge = (now - Date.parse(meetingAnchor(log))) / 86400000;
    const item = (what) => ({ logId: log.id, rep: rep.id, name: rep.name, what, lead: { id: log.lead.id, name: log.lead.name }, ...logWhen(log), held: state.held.has(log.id), when: log.when || null, contact: log.contact || null });
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
    // the latest log by when it happened (a CRM row that arrives later can be from an earlier day): its day for a CRM row
    const last = (state.byRep.get(r.rep.id) || []).map((id) => state.logs.get(id)).filter((l) => !state.voids.has(l.id)).reduce((m, l) => (!m || l.t >= m.t ? l : m), null);
    const lastLogAt = last ? logWhen(last).at : null;
    const works = isWorkDay(state, r.rep, r.today);
    if (works && !todays.length && localMinutes(ctx.now, r.rep.tz) >= 12 * 60) silent.push({ rep: r.rep.id, name: r.rep.name, lastLogAt });
    const done = r.week.days.filter((d) => d.kind === 'work' && d.day < r.today);
    const possible = done.length * 4, have = done.reduce((a, d) => a + d.marks, 0);
    if (done.length >= 2 && have < possible * 0.4) pace.push({ rep: r.rep.id, name: r.rep.name, marks: have, possible });
    const st = dayStats(state, r.rep.id, r.today, ctx, todays);
    return { ...publicRep(r.rep, r.today, ctx.lang), active: r.rep.active, email: r.rep.email, place: place.get(r.rep.id) ?? null,
      today: { isWork: works, habits: st.habits, closed: st.closed, closedAt: st.closedAt, logs: todays.length, lastLogAt },
      week: { days: r.week.days, marks: r.week.marks, marksMax: r.week.marksMax, fullFingers: r.week.fullFingers, counts: r.week.counts, points: r.week.points, scaledPoints: r.week.scaledPoints },
      streak: streak(state, r.rep.id, r.today, ctx), level: levelOf(earnedPoints(r.all)), goal: goalOf(state, r.rep.id, r.ws, ctx),
      seen: seenOf(state, r.rep.id), ladderDone: ladderOf(state, r.rep.id, ctx).filter((x) => x.done).length };
  });
  const others = [...state.reps.values()].filter((r) => !r.practice && (r.role !== 'rep' || !r.active))
    .map((r) => ({ ...publicRep(r, localDay(ctx.now, r.tz), ctx.lang), active: r.active, email: r.email }));
  const prac = practiceRep(state), team = exampleReps(state), ws = weekStart(localDay(ctx.now, ctx.tz || 'America/Panama'));
  // The real pay rate in force this week, for the admin's control. The example team's rate is never here.
  const rate = state.payRates.filter((r) => r.from <= ws).reduce((hit, r) => (!hit || r.from >= hit.from ? r : hit), null);
  return { serverTime: ctx.now, reps, others, practice: prac ? publicRep(prac, localDay(ctx.now, prac.tz), ctx.lang) : null,
    // the example team shows in the "práctica" block only: none of its sites is listed below
    example: team.length ? team.map((r) => publicRep(r, localDay(ctx.now, r.tz), ctx.lang)) : null,
    // a team made for an earlier day shows that day's week: the screen offers to bring it up to date
    exampleStale: team.length ? exampleStale(team, ctx.now) : false, pay: rate ? { cents: rate.cents, from: rate.from } : null,
    needs: { confirm, silent, late, pace }, team: teamNumbers(state, all, ctx), routes: teamRoutes(state),
    sites: [...state.sites.values()].filter((s) => !s.void && !state.reps.get(s.rep)?.example).map((s) => { const p = siteProgress(state, s.id); return { id: s.id, rep: s.rep, lead: s.lead, at: s.t, steps: s.steps, practice: s.practice,
      // what the manager's site controls need: the state in one word, the facts given when it was opened, and its counts
      state: siteState(s), city: s.city, eligible: s.eligible, legacy: s.legacy, phones: s.phones, closed: s.closed, coordinator: s.coordinator, workers: p.total, consents: p.consents }; }), goals: RULES.goals };
}

export { lifetime, flagsOf };
