// sheet-drag.js: what a sheet decides while it is dragged by its top, away from the page so it can be tested.
// Down, it follows the finger; up, it gives a little and resists, the way a real sheet does at its top. Let go, it
// closes past its share of the height or after a quick flick down, and goes back otherwise. The numbers follow Vaul.

const LIMIT = 56;         // the most a sheet rises when pulled up, in px
const WINDOW = 80;        // the last stretch of the drag the speed is read from, in ms
const SHARE = 0.3;        // let go past this share of its height, a sheet closes...
const FAR = 200;          // ...or past this many px, for a tall one
const FLICK = 0.4;        // a flick down this fast closes it (px/ms)...
const TWITCH = 16;        // ...once it moved at least this much, so a tremble is not a flick

/** Where the sheet stands for a finger that moved `dy` px (positive is down). */
export function follow(dy) {
  if (dy >= 0) return dy;
  const x = -dy;
  return -(1 - 1 / (x * 0.55 / LIMIT + 1)) * LIMIT;
}

/** How fast the finger went at the end, in px/ms: from the first sample of the last stretch to the last sample. */
export function speed(samples) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((p) => p.t >= last.t - WINDOW) || samples[samples.length - 2];
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/** Let go: 'close' or 'back'. */
export function release({ dy, vy, height }) {
  if (!(dy > 0)) return 'back';
  if (dy >= Math.min(height * SHARE, FAR)) return 'close';
  if (vy >= FLICK && dy >= TWITCH) return 'close';
  return 'back';
}
