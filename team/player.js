// player.js: plays [frame, milliseconds] pairs on a clock, one sequence at a time. Starting another sequence ends the
// one before it, and whoever was waiting for that one goes on: a wait that could be left hanging would freeze the
// screen that depends on it (a log's answer on the stage is such a wait). Nothing here touches the page; the stage
// gives it the function that shows a frame. Tests: tests/team-player.test.mjs.

/** onFrame(f) shows frame f. `still` is for reduced motion: a sequence shows where it ends, a loop where it starts. */
export function createPlayer(onFrame, { still = false } = {}) {
  let timer = 0, settle = null;
  /** End whatever is playing. A sequence that was being waited for answers false: it was cut short. */
  function stop() {
    clearTimeout(timer);
    if (settle) { const done = settle; settle = null; done(false); }
  }
  /** Play in a loop, or once. The promise of a once-sequence resolves true after its last frame, or false if another
   *  sequence replaced it first. A pair with 0 ms holds its frame, and the promise resolves there. */
  function play(seq, { once = false } = {}) {
    stop();
    if (still) { onFrame(seq[once ? seq.length - 1 : 0][0]); return Promise.resolve(true); }
    return new Promise((resolve) => {
      const done = (whole) => { if (settle === done) settle = null; resolve(whole); };
      if (once) settle = done;
      let k = 0;
      const step = () => {
        const [f, ms] = seq[k % seq.length];
        onFrame(f); k += 1;
        if (!ms) { done(true); return; }
        timer = setTimeout(() => { if (once && k >= seq.length) done(true); else step(); }, ms);
      };
      step();
    });
  }
  return { play, stop };
}
