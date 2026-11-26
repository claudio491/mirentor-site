// taps.js: one tap, one meaning. A double click is one gesture, so its second click never acts on what the first one
// changed; a list drawn again (after an action, the next row slides under the finger) takes no tap until it settles; and
// a step that is hard to take back asks twice, its second tap counting only after a pause, so one double tap can never
// pass both. The decisions are plain functions (tests/team-taps-client.test.mjs); the rest wires them to the page.

/** A list drawn again takes no tap for this long. */
export const SETTLE_MS = 400;
/** The second tap of "asks twice" counts only this long after the first, and the first keeps the button armed this long. */
export const PAUSE_MS = 300, WINDOW_MS = 6000;

/** Whether a click on a list's control acts. `detail` is the browser's click count: 0 for a key or a script, which always
 *  act (what has the focus does not move under a finger); 2 or more is the second click of a double click, which never
 *  does; a single click acts once the list has settled (`settledAt`, on the same clock as `now`). */
export function clickActs({ detail = 0, now = 0, settledAt = 0 } = {}) {
  if (!detail) return true;
  if (detail > 1) return false;
  return now >= settledAt;
}

const CONTROLS = 'button, a[href], input, select, textarea, label, summary, [role="button"]';
const guarded = new WeakSet();
/** Guard a list a person acts on: a click on one of its controls that clickActs refuses stops there, before the
 *  control hears it. Any change to the list's rows (a redraw after an action, a poll) starts its settling time again. */
export function guardList(node, { ms = SETTLE_MS } = {}) {
  if (!node || guarded.has(node)) return node;
  guarded.add(node);
  let settledAt = 0;
  new MutationObserver(() => { settledAt = performance.now() + ms; }).observe(node, { childList: true, subtree: true });
  node.addEventListener('click', (e) => {
    const hit = e.target instanceof Element ? e.target.closest(CONTROLS) : null;
    if (!hit || !node.contains(hit) || clickActs({ detail: e.detail, now: performance.now(), settledAt })) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  return node;
}

/** "Asks twice", one tap at a time. `armedAt` is when the button was armed (null when it is not), `now` this tap's time
 *  and `detail` the browser's click count (0 for a key). 'arm': the first tap, or one after the window closed. 'wait': too
 *  soon after the first, or the second click of a double click, however slow: still the same gesture. 'run': the
 *  second tap, after the pause and inside the window. */
export function twiceStep(armedAt, { now = 0, detail = 0 } = {}, { pause = PAUSE_MS, window = WINDOW_MS } = {}) {
  if (armedAt == null || now - armedAt > window) return 'arm';
  if (detail > 1 || now - armedAt < pause) return 'wait';
  return 'run';
}

/** Whether a screen change runs its screen's own arrival: only the last change asked for (`ask` is its number,
 *  `latest` the newest), and only when the screen shown (`open`) is the one it asked for (`name`). A second tap while
 *  the first transition runs makes the first one stand down, so a screen never arrives twice. */
export const arrives = (ask, latest, open, name) => ask === latest && open === name;

const timers = new WeakMap();
/** Take the arming off a button: its mark (data-armed, which the screens draw its words from), its look and its timer. */
export function disarm(btn) {
  if (!btn) return;
  clearTimeout(timers.get(btn)); timers.delete(btn);
  delete btn.dataset.armed; btn.classList.remove('armed');
}
/** "Asks twice" on a button, from its click event: returns 'arm', 'wait' or 'run' (twiceStep). Armed, the button carries
 *  data-armed and the class `armed`; left alone it disarms when the window closes, and `onDisarm` runs to redraw it. */
export function askTwice(btn, e, { pause = PAUSE_MS, window = WINDOW_MS, onDisarm = null } = {}) {
  const now = performance.now(), at = Number(btn.dataset.armed);
  const step = twiceStep(btn.dataset.armed && Number.isFinite(at) ? at : null, { now, detail: (e && e.detail) || 0 }, { pause, window });
  if (step === 'run') disarm(btn);
  if (step === 'arm') {
    disarm(btn);
    const mark = String(now);
    btn.dataset.armed = mark; btn.classList.add('armed');
    timers.set(btn, setTimeout(() => { if (btn.dataset.armed !== mark) return; disarm(btn); if (onDisarm) onDisarm(); }, window));
  }
  return step;
}
