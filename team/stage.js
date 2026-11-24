// stage.js: Hoy. A rep's day is a route of four stops, and the stop the day stands on fills the stage: an illustration
// of four frames that plays while it waits and answers when a log lands on it. What to show is decided in stops.js and
// in app.js; this file only draws it. Which image and which frame are told to the stylesheet through data-art and
// data-f, so nothing here writes an address.
import { $, $$, h, s, t, reduce } from './ui.js';
import { LIGHT } from './art.js';
import { STOPS } from './stops.js';
import { createPlayer } from './player.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
/** Play a one-shot class again from its start. */
const again = (node, cls) => { node.classList.remove(cls); void node.getBoundingClientRect(); node.classList.add(cls); };

export function createStage({ onPick = () => {} } = {}) {
  const box = $('#stopStage'), dio = $('#dio'), route = $('#route'), ring = $('#burst');
  let shown = null, ticket = 0, ringTimer = 0;
  // What plays once on the stop is put away when it ends. Left on, an arrival would hold the stop still under the
  // pointer, and every one of them would play again each time this screen comes back.
  const ONCE = { 'dio-in': 'arriving', 'dio-hit': 'bump' };
  dio.addEventListener('animationend', (e) => { if (ONCE[e.animationName]) dio.classList.remove(ONCE[e.animationName]); });

  let art = null;   // the illustration the frames belong to
  const player = createPlayer((f) => {
    dio.dataset.f = String(f);
    // the pool of light under the stop follows how much of the frame is lit
    box.style.setProperty('--light', (0.16 + Math.min(0.8, ((LIGHT[art] || [])[f] || 0) * 8)).toFixed(2));
  }, { still: reduce });
  /** Play [frame, ms] pairs of an illustration: in a loop, or once. See player.js for what the promise answers. */
  function play(of, seq, opts) { art = of; return player.play(seq, opts); }
  /** Put an illustration on the stage and start its loop. With `swap`, the one that was there leaves first. A show
   *  that is overtaken while it waits for that (another show, or a hold) is dropped: the last one asked for wins. */
  async function show(of, seq, { swap = false } = {}) {
    const mine = ++ticket, changed = shown !== of;
    if (swap && changed && shown && !reduce) {
      dio.classList.remove('arriving'); dio.classList.add('leaving');
      await sleep(170);
      if (mine !== ticket) return;
    }
    shown = of; dio.dataset.art = of; dio.classList.remove('leaving');
    play(of, seq);
    if (swap && changed && !reduce) { dio.classList.remove('bump'); again(dio, 'arriving'); }
  }
  /** A log is about to be answered on this stop: it takes the stage now, still, on frame f. A stop that was on its
   *  way out comes back, and one that was on its way in is dropped. */
  async function hold(of, f) {
    if (shown === of) { ticket += 1; dio.classList.remove('leaving'); play(of, [[f, 0]]); return; }
    await show(of, [[f, 0]], { swap: true });
  }
  /** A ring of joints locks on around the stop and its bones draw: the brand's tracking move, as the answer to a log. */
  function burst() {
    if (reduce) return;
    const pts = Array.from({ length: 10 }, (_, k) => { const a = ((k * 36 - 90) * Math.PI) / 180; return [50 + 47 * Math.cos(a), 52 + 43 * Math.sin(a)]; });
    const lines = pts.map((p, k) => {
      const q = pts[(k + 1) % pts.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]).toFixed(1);
      const line = s('line', { x1: p[0].toFixed(2), y1: p[1].toFixed(2), x2: q[0].toFixed(2), y2: q[1].toFixed(2), 'stroke-dasharray': len, 'stroke-dashoffset': len });
      line.style.setProperty('--k', String(k)); line.style.setProperty('--len', len);
      return line;
    });
    const joints = pts.map((p, k) => { const c = s('circle', { cx: p[0].toFixed(2), cy: p[1].toFixed(2), r: 1.7 }); c.style.setProperty('--k', String(k)); return c; });
    ring.replaceChildren(...lines, ...joints);
    dio.classList.remove('arriving'); again(ring, 'fire'); again(dio, 'bump');
    // ten joints 34 ms apart, 560 ms lit and 420 ms to fade: then the ring is taken down
    clearTimeout(ringTimer); ringTimer = setTimeout(() => { ring.classList.remove('fire'); ring.replaceChildren(); }, 1500);
  }

  // ---- the route: the four stops, small, with the line between them ----
  function buildRoute() {
    route.replaceChildren(...STOPS.map((art, i) => h('button', { class: 'stop', type: 'button', 'data-i': String(i), onclick: () => onPick(i) },
      s('svg', { class: 'sring', viewBox: '0 0 74 74', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: 'M37 3 A34 34 0 0 1 71 37' }), s('circle', { cx: 71, cy: 37, r: 4.2 })),
      h('span', { class: 'sl' }, h('i', { 'data-art': art })),
      h('span', { class: 'stick', 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 12 12', focusable: 'false' }, s('path', { d: 'M2.5 6.4l2.4 2.4 4.6-5.2' }))),
      h('b', { class: 'slabel' }), h('span', { class: 'n num' }))));
  }
  /** stops: from stopsOf(). sel: the one on the stage. at: the one the day stands on (null when nothing is next). */
  function paintRoute(stops, { sel = null, at = null } = {}) {
    if (!route.childElementCount) buildRoute();
    $$('.stop', route).forEach((btn, i) => {
      const st = stops[i];
      btn.classList.toggle('done', st.done); btn.classList.toggle('sel', sel === i); btn.classList.toggle('next', at === i && !st.done);
      $('b', btn).textContent = t(`stop.short.${i}`);
      $('.n', btn).textContent = `${st.have}/${st.need}`;
      btn.setAttribute('aria-label', t('stop.aria', { name: t(`stop.short.${i}`), a: st.have, b: st.need }));   // the name says the word on screen
      btn.setAttribute('aria-pressed', String(sel === i));
    });
  }
  /** Small lights that rise through the stage: placed once, each on its own clock. */
  function motes(n = 12) {
    const host = $('#motes');
    if (!host || host.childElementCount) return;
    host.replaceChildren(...Array.from({ length: n }, (_, k) => {
      const m = h('i');
      m.style.left = `${14 + ((k * 53) % 72)}%`;
      m.style.setProperty('--x', `${((k * 37) % 40) - 20}px`); m.style.setProperty('--t', `${5 + (k % 5) * 0.9}s`); m.style.setProperty('--d', `${-(k * 0.83).toFixed(2)}s`);
      return m;
    }));
  }
  /** On a screen with a pointer the stop leans a little toward it. */
  function lean(host) {
    if (reduce || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    host.addEventListener('pointermove', (e) => {
      const r = box.getBoundingClientRect(); if (!r.width) return;
      dio.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2)}deg`);
      dio.style.setProperty('--rx', `${(-((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(2)}deg`);
    });
    host.addEventListener('pointerleave', () => { dio.style.setProperty('--ry', '0deg'); dio.style.setProperty('--rx', '0deg'); });
  }
  motes(matchMedia('(pointer: coarse)').matches ? 6 : 12);   // half as many on a phone: the same feel for less work
  return { show, play, hold, burst, paintRoute, lean, node: dio, shown: () => shown };
}
