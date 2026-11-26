// score.mjs: every number a rep or a manager sees, derived from the state. Pure functions: same events, same answers.
// Nothing here reads the lead list: what the CRM knew at the moment of a log is stamped on the log itself.
// ctx = { now: ISO time }
import { RULES, flagsOf, localDay, localMinutes, addDays, isoWeekday, weekStart } from './rules.mjs';
import { isOff } from './state.mjs';

const P = RULES.points;
const DAY_MS = 86400000;
const CLOSE_MIN = (() => { const [h, m] = RULES.closeBy.split(':').map(Number); return h * 60 + m; })();
const iso = (ms) => new Date(ms).toISOString();
const sum = (list, key) => list.reduce((a, x) => a + x[key], 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A rep's logs that still count, grouped by local day, in the order they arrived. */
export function logsByDay(state, repId) {
  const out = new Map();
  for (const id of state.byRep.get(repId) || []) {
    if (state.voids.has(id)) continue;
    const log = state.logs.get(id);
    if (!out.has(log.day)) out.set(log.day, []);
    out.get(log.day).push(log);
  }
  return out;
}

/** A follow-up: the business had a contact on an earlier day. Either the CRM said so when the log was made
 * (`prior`, stamped on the log) or someone on the team logged it before. Decided once, so it never changes afterwards. */
export function isFollowUp(state, log, day) {
  if (typeof log.prior === 'string' && log.prior < day) return true;
  const first = state.leadFirstDay.get(log.lead.id);
  return !!first && first < day;
}

/** When a booked meeting's wait starts: the day of the meeting if it is later than the booking. */
export function meetingAnchor(log) {
  const when = typeof log.when === 'string' && DAY_RE.test(log.when) ? Date.parse(`${log.when}T23:59:59Z`) : NaN;
  return Number.isFinite(when) && when > Date.parse(log.t) ? iso(when) : log.t;
}

/** What a manager can still confirm on a log at `now` (an ISO time or milliseconds), by the windows the ledger pays:
 *  a meeting's holding RULES.pendingDays from meetingAnchor, a contract's sending RULES.pendingDays from the log, its
 *  signature RULES.pendingSignDays from the sending. Null when nothing is left to confirm or its window closed. The one
 *  rule needs.confirm (teamView) and "Trabados" (stalledOf) read; a void, a missed mark or practice is theirs to check. */
export function confirmable(log, conf, now) {
  const ms = typeof now === 'number' ? now : Date.parse(now), within = (from, days) => (ms - Date.parse(from)) / DAY_MS <= days;
  if (log.kind === 'meeting') return !conf.meeting_held && within(meetingAnchor(log), RULES.pendingDays) ? 'meeting_held' : null;
  if (log.kind !== 'contract') return null;
  if (!conf.contract_sent) return within(log.t, RULES.pendingDays) ? 'contract_sent' : null;
  return !conf.contract_signed && within(conf.contract_sent, RULES.pendingSignDays) ? 'contract_signed' : null;
}

export function dayStats(state, repId, day, ctx, dayLogs) {
  const rep = state.reps.get(repId);
  const logs = dayLogs || logsByDay(state, repId).get(day) || [];
  const visited = new Set(), talked = new Set(), followed = new Set(), replied = new Set(), seen = new Set();
  let messages = 0, meetings = 0;
  const entries = [];
  // A row from the CRM carries a day and no time: `crm` tells the answers to show the day where a time would be.
  const add = (log, code, pts) => entries.push({ id: `${log.id}:${code}`, logId: log.id, at: log.t, day, code, pts, status: 'earned', lead: log.lead, ...(log.crm ? { crm: true } : {}) });
  for (const log of logs) {
    // One scored log per business and result per day: a repeat earns nothing.
    const key = `${log.lead.id}|${log.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = flagsOf(log), L = log.lead.id;
    if (f.visit && !visited.has(L)) { visited.add(L); add(log, 'visit', P.visit); }
    if (f.conversation && !talked.has(L)) { talked.add(L); add(log, 'conversation', P.conversation); }
    if (f.followup && !followed.has(L) && isFollowUp(state, log, day)) { followed.add(L); add(log, 'followup', P.followup); }
    if (f.message) { messages += 1; if (messages <= RULES.caps.messagesPerDay) add(log, 'message', P.message); }
    if (f.reply && !replied.has(L)) { replied.add(L); add(log, 'reply', P.reply); }
    if (f.meeting) { meetings += 1; add(log, 'meeting_booked', P.meetingBooked); }
  }
  const c = state.closes.get(`${repId}|${day}`);
  const closed = !!c;
  const closedOnTime = closed && localMinutes(c.t, rep.tz) < CLOSE_MIN;
  if (closedOnTime) entries.push({ id: `close:${repId}:${day}`, logId: null, at: c.t, day, code: 'day_closed', pts: P.dayClosedOnTime, status: 'earned', lead: null });
  return { day, visits: visited.size, conversations: talked.size, followups: followed.size, messages, replies: replied.size, meetings, logs: logs.length,
    closed, closedOnTime, closedAt: c?.t || null,
    habits: [visited.size >= RULES.habits.visits, talked.size >= RULES.habits.conversations, followed.size >= RULES.habits.followups, closed], entries };
}

/** "Contract sent" is earned once per rep and business: by the earliest contract log of that rep for it (not voided) whose
 *  sending was confirmed. Business id -> that log's id. A later contract log for the business earns no "sent". */
export function contractSentBy(state, repId) {
  const out = new Map();
  for (const id of state.byRep.get(repId) || []) {
    const log = state.logs.get(id);
    if (state.voids.has(id) || log.kind !== 'contract' || !state.confirms.get(id)?.contract_sent) continue;
    const held = out.get(log.lead.id);
    if (!held || log.t < state.logs.get(held).t) out.set(log.lead.id, id);
  }
  return out;
}

/** The parts of a meeting, a contract and a signed site that are paid after the log itself. */
function stageEntries(state, repId, ctx) {
  const rep = state.reps.get(repId);
  const now = ctx?.now ? Date.parse(ctx.now) : Date.now();
  const out = [];
  const push = (base, code, pts, status, at) => out.push({ ...base, id: `${base.ref}:${code}`, at, day: localDay(at, rep.tz), code, pts, status });
  // `since` is where the line sits in the history; `anchor` is where the wait starts counting.
  const waiting = (base, code, pts, since, days, anchor = since) => { const exp = Date.parse(anchor) + days * DAY_MS; if (now > exp) push(base, code, pts, 'expired', iso(exp)); else push(base, code, pts, 'pending', since); };
  // a wait that starts on a CRM row's day has no time of its own either
  const fromCrm = (log, n) => { if (log.crm) for (const e of out.slice(n)) if (e.status !== 'earned') e.crm = true; };
  const sentBy = contractSentBy(state, repId);
  for (const id of state.byRep.get(repId) || []) {
    if (state.voids.has(id)) continue;
    const log = state.logs.get(id), conf = state.confirms.get(id) || {}, base = { ref: id, logId: id, lead: log.lead };
    // "No ocurrió": nothing of it waits any more; what was already earned stays
    if (state.missed.has(id)) {
      if (log.kind === 'contract' && conf.contract_sent && !(sentBy.has(log.lead.id) && sentBy.get(log.lead.id) !== id && log.t >= state.logs.get(sentBy.get(log.lead.id)).t)) push(base, 'contract_sent', P.contractSent, 'earned', conf.contract_sent);
      if (log.kind === 'contract' && conf.contract_signed) push(base, 'contract_signed', P.contractSigned, 'earned', conf.contract_signed);
      if (log.kind === 'meeting' && conf.meeting_held) push(base, 'meeting_held', P.meetingHeld, 'earned', conf.meeting_held);
      continue;
    }
    if (log.kind === 'meeting') {
      if (conf.meeting_held) push(base, 'meeting_held', P.meetingHeld, 'earned', conf.meeting_held);
      else { const n = out.length; waiting(base, 'meeting_held', P.meetingHeld, log.t, RULES.pendingDays, meetingAnchor(log)); fromCrm(log, n); }
    }
    if (log.kind === 'contract') {
      // a later log of a business whose sending was already paid earns no "sent"; its signature part is its own
      const paid = sentBy.has(log.lead.id) && sentBy.get(log.lead.id) !== id && log.t >= state.logs.get(sentBy.get(log.lead.id)).t;
      if (!conf.contract_sent) { if (!paid) waiting(base, 'contract_sent', P.contractSent, log.t, RULES.pendingDays); continue; }
      if (!paid) push(base, 'contract_sent', P.contractSent, 'earned', conf.contract_sent);
      if (conf.contract_signed) push(base, 'contract_signed', P.contractSigned, 'earned', conf.contract_signed);
      else waiting(base, 'contract_signed', P.contractSigned, conf.contract_sent, RULES.pendingSignDays);
    }
  }
  for (const site of state.sites.values()) {
    // a practice site is labeled and counts in no total; a legacy one was signed before the board and pays nothing here
    if (site.rep !== repId || site.void || site.practice || site.legacy) continue;
    const base = { ref: site.id, logId: null, siteId: site.id, lead: site.lead };
    push(base, 'site_signed', P.siteSigned, 'earned', site.t);
    for (const [what, code, pts] of [['installed', 'site_installed', P.siteInstalled], ['first_hour', 'site_first_hour', P.siteFirstHour]]) {
      if (site.steps[what]) push(base, code, pts, 'earned', site.steps[what]); else push(base, code, pts, 'pending', site.t);
    }
  }
  return out.map(({ ref, ...e }) => e);
}

/** Every point entry of a rep, earned, pending or expired, oldest first. `from` and `to` are local days, inclusive. */
export function ledger(state, repId, ctx = {}) {
  const byDay = logsByDay(state, repId);
  const { from, to } = ctx;
  const inRange = (day) => (!from || day >= from) && (!to || day <= to);
  // Only the days asked for are worked out: a week's ledger does not walk the rep's whole history.
  const days = [...new Set([...byDay.keys(), ...(state.closesByRep.get(repId) || [])])].filter(inRange);
  const all = days.flatMap((day) => dayStats(state, repId, day, ctx, byDay.get(day) || []).entries).concat(stageEntries(state, repId, ctx).filter((e) => inRange(e.day)));
  return all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export const earnedPoints = (entries) => entries.reduce((a, e) => a + (e.status === 'earned' ? e.pts : 0), 0);

/** A day a rep is expected to work: one of their working days, from their start date on, and not a day off. */
export const isWorkDay = (state, rep, day) => day >= rep.startDate && rep.workdays.includes(isoWeekday(day)) && !isOff(state, rep, day);

/** The week as the hand shows it: Monday to Friday are the fingers, each with four marks, one per habit. */
export function weekOf(state, repId, ws, ctx) {
  const rep = state.reps.get(repId);
  const today = localDay(ctx.now, rep.tz);
  const byDay = logsByDay(state, repId);
  const all = Array.from({ length: 7 }, (_, i) => { const day = addDays(ws, i); return dayStats(state, repId, day, ctx, byDay.get(day) || []); });
  const days = all.slice(0, 5).map((st) => {
    const kind = !isWorkDay(state, rep, st.day) ? 'rest' : st.day > today ? 'future' : 'work';
    const habits = kind === 'work' ? st.habits : [false, false, false, false];
    return { day: st.day, kind, habits, marks: habits.filter(Boolean).length, closed: st.closed, closedAt: st.closedAt, visits: st.visits, conversations: st.conversations, followups: st.followups };
  });
  // A full day of work on a rest day (a Saturday, say) completes one finger missed earlier that week.
  const extraFull = all.some((st, i) => (i >= 5 || !isWorkDay(state, rep, st.day)) && st.day <= today && st.habits.every(Boolean));
  if (extraFull) {
    const miss = days.find((d) => d.kind === 'work' && d.day < today && d.marks < 4);
    if (miss) { miss.habits = [true, true, true, true]; miss.marks = 4; miss.repaired = true; }
  }
  const workFingers = days.filter((d) => d.kind !== 'rest').length;
  const anyLog = all.some((st) => st.logs > 0);
  const entries = ledger(state, repId, { ...ctx, from: ws, to: addDays(ws, 6) });
  const points = earnedPoints(entries);
  for (const d of days) d.points = earnedPoints(entries.filter((e) => e.day === d.day));   // what each day brought, for the chart of the week
  const weekendPoints = points - sum(days, 'points');   // Saturday and Sunday have no finger; the chart gives them one bar
  return {
    week: ws, days, anyLog, workFingers,
    marks: (anyLog ? 1 : 0) + sum(days, 'marks'), marksMax: 1 + 4 * workFingers,
    fullFingers: days.filter((d) => d.kind === 'work' && d.marks === 4).length,
    counts: { visits: sum(all, 'visits'), conversations: sum(all, 'conversations'), meetings: sum(all, 'meetings'),
      contracts: entries.filter((e) => e.code === 'contract_sent' && e.status === 'earned').length, replies: sum(all, 'replies') },
    points, weekendPoints, scaledPoints: Math.round(points * 5 / Math.max(1, rep.workdays.length)),
  };
}

/** Consecutive working days with at least one conversation. Spare days absorb a miss; a clean week gives one back. */
export function streak(state, repId, today, ctx) {
  const rep = state.reps.get(repId);
  const byDay = logsByDay(state, repId);
  const talked = (day) => dayStats(state, repId, day, ctx, byDay.get(day) || []).conversations >= 1;
  let current = 0, best = 0, spares = RULES.streakSpares, todayCounted = false;
  let weekClean = true, weekHadDays = false, curWeek = null;
  const endWeek = () => { if (weekHadDays && weekClean && current > 0) spares = Math.min(RULES.streakSpares, spares + 1); weekClean = true; weekHadDays = false; };
  const start = rep.startDate > addDays(today, -400) ? rep.startDate : addDays(today, -400);
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const ws = weekStart(day);
    if (curWeek && ws !== curWeek) endWeek();
    curWeek = ws;
    if (!isWorkDay(state, rep, day)) continue;
    if (day === today) { if (talked(day)) { current += 1; todayCounted = true; } break; }
    weekHadDays = true;
    if (talked(day)) { current += 1; continue; }
    weekClean = false;
    if (spares > 0) spares -= 1; else { best = Math.max(best, current); current = 0; }
  }
  return { current, best: Math.max(best, current), spares, todayCounted };
}

/** The weekly goal: three sizes built from the rep's working days. The default is last week's result plus one. */
export function goalOf(state, repId, ws, ctx) {
  const w = weekOf(state, repId, ws, ctx), D = w.workFingers;
  const options = [...new Set([Math.max(1, D - 2), Math.max(1, D - 1), D])].filter((k) => k >= 1 && k <= D).sort((a, b) => a - b);
  if (!options.length) return { options, picked: 0, isDefault: true, fullFingers: w.fullFingers, reached: false };
  const last = weekOf(state, repId, addDays(ws, -7), ctx).fullFingers;
  const fallback = Math.min(D, Math.max(options[0], last + 1));
  const pick = state.picks.get(`${repId}|${ws}`);
  const mine = options.includes(pick);
  const picked = mine ? pick : fallback;
  return { options, picked, isDefault: !mine, fullFingers: w.fullFingers, reached: w.fullFingers >= picked };
}

const LEVELS = RULES.levels.flatMap((l) => l.steps.map((floor, i) => ({ name: l.name, step: i + 1, floor })));
export function levelOf(xp) {
  let i = 0;
  LEVELS.forEach((l, k) => { if (xp >= l.floor) i = k; });
  return { name: LEVELS[i].name, step: LEVELS[i].step, xp, floor: LEVELS[i].floor, next: LEVELS[i + 1]?.floor ?? null };
}

/** Lifetime points: everything earned, never scaled, never reset. */
export const lifetime = (state, repId, ctx) => earnedPoints(ledger(state, repId, { now: ctx?.now, leads: ctx?.leads }));
