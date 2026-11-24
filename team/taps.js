// taps.js: one tap, one meaning. A step that is hard to take back asks twice, and its second tap counts only after a
// pause: one double tap is one gesture, so it can never pass both taps at once. The decision is a plain function
// (tests/team-taps-client.test.mjs); the rest wires it to a button.

/** The second tap of "asks twice" counts only this long after the first, and the first keeps the button armed this long. */
export const PAUSE_MS = 300, WINDOW_MS = 6000;

/** "Asks twice", one tap at a time. `armedAt` is when the button was armed (null when it is not), `now` this tap's time
 *  and `detail` the browser's click count (0 for a key). 'arm': the first tap, or one after the window closed. 'wait': too
 *  soon after the first, or the second click of a double click, however slow: still the same gesture. 'run': the
 *  second tap, after the pause and inside the window. */
export function twiceStep(armedAt, { now = 0, detail = 0 } = {}, { pause = PAUSE_MS, window = WINDOW_MS } = {}) {
  if (armedAt == null || now - armedAt > window) return 'arm';
  if (detail > 1 || now - armedAt < pause) return 'wait';
  return 'run';
}

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
