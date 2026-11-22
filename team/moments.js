// moments.js: what deserves a moment on screen, decided apart from the screens so it can be tested without a browser.
// Everything here reads the numbers the server sent and answers with codes; the words and the drawings live elsewhere.

export const NEW_REP_DAYS = 14;   // the same first days the server leaves out of the table

/** How much of an entrance a visit gets: the full one on the first open of a day, or when another person used this
 *  phone last (signing out forgets who that was); a short one after that. */
export function entrance({ lastDay = null, lastId = null, today, id }) {
  return lastDay !== today || lastId !== id ? 'full' : 'short';
}

/** Which greeting an hour asks for, from the minutes since midnight. */
export const dayPart = (minutes) => (minutes < 12 * 60 ? 'morning' : minutes < 19 * 60 ? 'afternoon' : 'evening');

/** A moment the server gives as a day alone (YYYY-MM-DD): a row from the CRM, which has no time of its own. */
export const dayOnly = (at) => typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at);

/** The minutes since midnight of a moment in a time zone. */
export function localMinutes(iso, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

/** The next thing today asks for and what it pays: the first habit still open. `minutes` is the local time, because
 *  closing the day pays only before the hour in the rules. */
export function nextStep(today, rules, minutes = 0) {
  if (!today) return null;
  if (!today.isWork) return { code: 'rest' };
  if (today.habits.every(Boolean)) return { code: 'done' };
  if (today.closed) return { code: 'closed' };
  const P = rules.points, H = rules.habits, left = (need, have) => Math.max(1, need - have);
  if (!today.habits[0]) return { code: 'visit', habit: 0, pts: P.visit, left: left(H.visits, today.visits) };
  if (!today.habits[1]) return { code: 'conversation', habit: 1, pts: P.conversation, left: left(H.conversations, today.conversations) };
  if (!today.habits[2]) return { code: 'followup', habit: 2, pts: P.followup, left: left(H.followups, today.followups) };
  const [h, m] = String(rules.closeBy).split(':').map(Number);
  return { code: 'close', habit: 3, pts: minutes < h * 60 + m ? P.dayClosedOnTime : 0, left: 1 };
}

const fullFinger = (v) => !!v.today && v.today.isWork && v.today.habits.every(Boolean);
const fullHand = (v) => !!v.week && v.week.workFingers > 0 && v.week.fullFingers === v.week.workFingers;
const WEIGHT = { lead: 0, level: 1, badge: 2, hand: 3, finger: 4, step: 5 };

/** What changed between two reads of a person's own numbers that deserves a moment, heaviest first, two at most.
 *  Taking the lead is the server's to say (`tookLead`). Points taken back are never a moment. */
export function moments(before, after, { tookLead = false } = {}) {
  if (!before || !after || !after.today || !before.today) return [];
  const out = [];
  if (tookLead) out.push({ kind: 'lead' });
  const a = before.level, b = after.level;
  if (a && b && b.xp > a.xp) {
    if (b.name !== a.name) out.push({ kind: 'level', name: b.name, xp: b.xp });
    else if (b.step > a.step) out.push({ kind: 'step', name: b.name, step: b.step, xp: b.xp });
  }
  const had = new Map((before.badges || []).map((x) => [x.code, x.level]));
  for (const x of after.badges || []) if (x.level > (had.get(x.code) ?? 0)) out.push({ kind: 'badge', code: x.code, level: x.level });
  const handBadge = out.some((m) => m.kind === 'badge' && m.code === 'full_hand');
  if (fullHand(after) && !fullHand(before)) { if (!handBadge) out.push({ kind: 'hand' }); }
  else if (fullFinger(after) && !fullFinger(before)) out.push({ kind: 'finger' });
  return out.sort((x, y) => WEIGHT[x.kind] - WEIGHT[y.kind]).slice(0, 2);
}

const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** Which day of their first days a new rep is on, or null for anyone else. */
export function firstDays(view) {
  if (!view.today || !view.me.isNew) return null;
  return { day: Math.min(NEW_REP_DAYS, Math.max(1, days(view.me.startDate, view.today.day) + 1)), of: NEW_REP_DAYS };
}

/** Whether anything was logged in a day. */
export const anyLog = (today) => !!today && !!(today.visits || today.conversations || today.followups || today.messages || today.replies || today.meetings);
/** A working day nobody has logged in yet: the screen then invites a start instead of counting zero. */
/** The history as a person reads it: what waits for them comes first (a meeting they still have to report as held),
 *  then everything else in the order the server sends it, newest first. */
export function historyRows(ledger, pending) {
  const theirs = new Set(pending.filter((p) => p.code === 'meeting_held' && !p.held).map((p) => `${p.logId}:${p.code}`));
  const waits = (e) => e.status === 'pending' && theirs.has(`${e.logId}:${e.code}`);
  return [...ledger.filter(waits), ...ledger.filter((e) => !waits(e))];
}
/** The faces on the team's staircase: at most `max`, by name, and the viewer always one of them. T is a table as the
 *  server sends it: the viewer's row, the podium (their own row marked `mine`) and everybody else. */
export function crewOf(T, max = 5) {
  const byName = (x, y) => x.name.localeCompare(y.name, 'es');
  const others = [...T.podium.filter((r) => !r.mine), ...T.rest].sort(byName);
  if (!T.me) return others.slice(0, max);
  return [T.me, ...others.slice(0, max - 1)].sort(byName);
}
/** The card that closes the day, under the route. A working day closes through the route's last stop, so the card
 *  waits until there is a report to read. A day off has no route: work logged on it needs its close too (a full day
 *  on a day off completes a finger missed earlier), so the card is there as soon as something is logged. */
export const closeCard = (today) => !!today && (!!today.closed || (!today.isWork && anyLog(today)));
export const untouched = (today) => !!today && today.isWork && !today.closed && !anyLog(today);

/** Why a table has no places: 'ranked' when it has them, 'new' when everyone on it is in their first days (they may
 *  have points, so nothing may say they have none), 'empty' when nobody has scored. */
export function tableNote(T) {
  if (T.ranked > 0) return 'ranked';
  const people = [...(T.me ? [T.me] : []), ...(T.rest || [])];
  return people.length > 0 && people.every((p) => p.isNew) ? 'new' : 'empty';
}

/** The one fact a person is greeted with: what is at stake for them today. */
export function stake(view) {
  if (!view.today) return { kind: 'team', working: view.team.working, players: view.team.players, closed: view.team.closedToday };
  if (!view.today.isWork) return { kind: 'rest' };
  if (view.today.closed) return { kind: 'closed' };
  const T = view.table.week, mine = T.me;
  if (mine && mine.place === 1) return { kind: 'lead', score: mine.score, behind: T.behind ? { name: T.behind.name, pts: T.behind.pts } : null };
  if (mine && mine.place != null) return { kind: 'place', place: mine.place, ranked: T.ranked, gap: T.gap ? { pts: T.gap.pts, name: T.gap.aheadOnPodium ? T.gap.aheadName : null } : null };
  if (view.me.isNew) return { kind: 'new', ...firstDays(view) };
  return { kind: T.ranked === 0 ? 'zero' : 'nopts' };
}

/** How far a score is along the race to the leader's, from 0 to 1. */
export const raceShare = (score, lead) => (lead > 0 ? Math.max(0, Math.min(1, score / lead)) : 0);

/** What a counter shows at `k` (0 to 1) of its run from `from` to `to`: whole numbers on the way, eased out, and the
 *  exact value on the last frame, so a percentage with a decimal ends as it is written beside it. */
export function countFrame(from, to, k) {
  if (k >= 1) return to;
  const e = 1 - (1 - Math.max(0, k)) ** 4;
  return Math.round(from + (to - from) * e);
}

/** Which characters of a number changed, so only those roll. Another length rolls them all; a first paint rolls none. */
export function changedChars(from, to) {
  const b = String(to);
  if (from == null) return [...b].map(() => false);
  const a = String(from);
  if (a.length !== b.length) return [...b].map(() => true);
  return [...b].map((ch, i) => ch !== a[i]);
}

/** A short label per person for a lens: the first name, and only when two share it, what it takes to tell them apart
 *  (the next word's initial, or the whole name). Answers a Map from id to label. */
export function shortNames(people) {
  const words = (p) => String(p.name || '').trim().split(/\s+/).filter(Boolean);
  const first = (p) => words(p)[0] || '';
  const more = (p) => { const w = words(p); return w.length < 2 ? first(p) : `${w[0]} ${w[1].length === 1 ? w[1] : `${w[1][0]}.`}`; };
  const tally = (list, key) => list.reduce((m, p) => m.set(key(p), (m.get(key(p)) || 0) + 1), new Map());
  const firsts = tally(people, first), mores = tally(people.filter((p) => firsts.get(first(p)) > 1), more);
  return new Map(people.map((p) => [p.id, firsts.get(first(p)) <= 1 ? first(p) : mores.get(more(p)) <= 1 ? more(p) : words(p).join(' ')]));
}
