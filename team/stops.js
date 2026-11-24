// stops.js: a rep's day as four stops on a route, and the team's week as a staircase. Nothing here touches the screen:
// what a stop has and needs, the frames it shows while it waits and the ones it plays when a log lands, where a log
// landed, and the step the team stands on. The drawing is in stage.js; the tests are tests/team-stops.test.mjs.

/** The illustration of each stop, in the order of the four habits. Each is a strip of four frames:
 *  0 it waits, 1 it starts, 2 it happened, 3 it is celebrated. */
export const STOPS = ['visit', 'talk', 'follow', 'close'];
/** The staircase has this many steps above the ground; the last one holds the flag. */
export const LAST_STEP = 8;

/** The four stops from a day's numbers: how much each has (never more than it needs), how much it needs, done or not.
 *  Whether a habit is done is the server's to say (`today.habits`). */
export function stopsOf(today, rules) {
  const need = [rules.habits.visits, rules.habits.conversations, rules.habits.followups, 1];
  const have = [today.visits, today.conversations, today.followups, today.closed ? 1 : 0];
  return need.map((n, i) => ({ have: Math.min(Number(have[i]) || 0, n), need: n, done: !!today.habits[i] }));
}

/** Where the day stands: the first of the three habits still open, and the close once they are done. */
export function standOn(stops) {
  if (stops[3].done) return 3;   // a closed day stands on its close whatever is left open: nothing more to do today
  const i = stops.findIndex((s, k) => k < 3 && !s.done);
  return i >= 0 ? i : 3;
}

/** What a stop shows while nothing happens, as [frame, milliseconds] in a loop. A single pair holds its frame (0 ms). */
export function loopOf(i, stop) {
  if (i === 0) return stop.done ? [[2, 1500], [3, 800]] : [[0, 1600], [1, 700]];           // the shutter is tried, then the open shop waves
  // one speech bubble per conversation; before the first one, a bubble comes and goes, so the stop is never a still picture
  if (i === 1) return stop.done ? [[2, 1400], [3, 1000]] : stop.have >= 1 ? [[1, 0]] : [[0, 1900], [1, 600]];
  if (i === 2) return stop.done ? [[3, 0]] : [[0, 1600], [1, 800]];
  return stop.done ? [[3, 0]] : [[0, 1400], [1, 1400]];
}

/** The frames a stop plays, once, when a log lands on it: from what it had to what it has now. */
export function rewardOf(i, before, after, need) {
  if (after <= before) return [[after >= need ? 3 : Math.min(after, 1), 500]];
  if (after < need) return [[1, 620]];                                           // part of the way: only the conversations can be
  if (i === 1) return before >= 1 ? [[2, 360], [3, 620]] : [[1, 240], [2, 360], [3, 620]];
  if (i === 0) return [[1, 240], [2, 320], [3, 520]];
  if (i === 2) return [[1, 240], [2, 520], [3, 560]];
  return [[1, 260], [2, 560], [3, 620]];
}

/** The stop a change landed on: the first one whose number grew between two reads of the day, or null when no habit moved. */
export function landed(before, after, rules) {
  if (!before || !after) return null;
  const a = stopsOf(before, rules), b = stopsOf(after, rules);
  const i = b.findIndex((s, k) => s.have > a[k].have);
  return i >= 0 ? i : null;
}

/** The step the team stands on: every meeting moves it, and the flag is reached only at the goal. */
export function stepOf(meetings, target) {
  if (!(target > 0) || !(meetings > 0)) return 0;
  if (meetings >= target) return LAST_STEP;
  return Math.min(LAST_STEP - 1, Math.ceil((meetings / target) * LAST_STEP));
}

/** The team's climb to its step, for Equipo's arrival: keyframes relative to where the team stands (that is where the
 *  crew is placed), starting on the ground and hopping `hop` px up between each pair of steps. `w` and `h` are the
 *  staircase's size in px, and `steps` its positions as shares of it (art.js). */
export function climbFrames(at, steps, w, h, hop = 14) {
  if (!(at > 0)) return [];
  const end = steps[at], path = steps.slice(0, at + 1), frames = [];
  const tr = ([x, y], up = 0) => `${((x - end[0]) * w).toFixed(1)}px ${((y - end[1]) * h - up).toFixed(1)}px`;
  path.forEach((p, i) => {
    frames.push({ translate: tr(p), offset: i / at });
    if (i < at) { const q = path[i + 1]; frames.push({ translate: tr([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], hop), offset: (i + 0.5) / at }); }
  });
  return frames;
}
