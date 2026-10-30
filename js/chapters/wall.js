// wall.js: the camera wall ("muro de cámaras"), the signature moment between the hero and chapter 01. Nine first-person
// cameras, each with its hand points; the server renders them in their final state, so the wall reads without JS.
//
// Full tier, viewport 900 x 640 and up: the stage sticks under the header for 210% of a viewport (position: sticky, so
// no layout shifts and no jitter whatever moves the page; the scroll scrubs the pull-back, reversibly). From the first
// pixel of scroll the visor stays on CAM 01 ("visor:hold", js/hero/visor.js), the camera its clone carries down. While
// the hero scrolls away, the clone (same almacen plate, frame, bevel, HUD row and tracked hands) holds still where the
// visor sat. Then it pulls back into CAM 01, the middle of a 3 x 3 wall, and never loses its tracking: joints and bones
// keep their size on screen and land at the tile's, while only what the visor alone shows (the HUD row, the scrims) lets
// go, and the CAM 01 chip prints once the row has gone. Hand boxes and tags let go when the hold starts: neither the held
// visor (hero.css) nor the clone carries them, so no text ever crosses the hero's copy. The other cameras wait on standby (the
// panel, dim brackets, a mist CAM chip) and light in two waves: the four corners together once the clone has cleared
// them, then, after a rest, the four edges together once it has landed. Lighting: the CAM chip prints, the brackets
// settle, the picture fades up, the other chips print. The band's head prints with the edges, as the setup (kicker,
// headline, source). Then the hit, alone: a scan line crosses the wall, every camera's hands lock at once and "Tiempo
// que cuenta" steps from x1 to x9 inside a viewfinder. Then the caption: the band's line prints at the lock's last bone,
// and the meter's brackets let go once it has. The full wall holds before the stage lets go. On a screen taller than
// the hero (the visor stops growing), the wall takes the whole stage and fades in under the clone as it pulls back. The
// scroll arms each of these moments; each plays in time, in order (never before the one ahead of it allows), and goes
// back to standby when the visitor scrolls above it, so nothing ever stops halfway.
// Lite tier (phones, short screens): no stage; each camera lights as it enters, hands still. When the meter under the
// wall comes into view, any camera still waiting lights, then one beat locks every camera's hands at once with x9.
// Still tier: the final wall, standing still.
//
// One loop (at most 10 updates a second, only while the wall is on screen, below the header, and not paused) runs the
// cameras' clock (the visitor's time, HH:MM:SS, every camera on the same second) and "Tiempo que cuenta": the hero's
// own count (CAM 01 is the visor's camera), continued without a jump, plus eight more cameras' time once their hands
// lock. Only the wall's own pause holds it. Visitor time, never invented data. The clone's REC readout, the visor's own format with frames, is painted every frame.
import { loadGsap } from '../vendor.js';
import { timecode, duration } from '../hero/clock.js';
import { PLATE_ZOOM, coverMap } from '../hero/overlay.js';
import { SHOTS } from '../hero/shots.js';

const STAGE_MQ = '(min-width: 900px) and (min-height: 640px)';
const PLATE = { w: 1536, h: 864 };
const VISOR = { inset: 14, arm: 22, bevel: 12, hud: 24 }; // the visor's brackets, chamfer and HUD row (hero.css)
const FY0 = SHOTS.find((s) => s.id === 'almacen')?.fy ?? 0.5; // the visor's framing of CAM 01's plate
// How long the stage stays, in % of a viewport. The moments after the landing are chained in time (about 1.9 s from the
// corners to the last bone), so the pin must outlast them at a brisk wheel: at 600 px/s from the stage start the last
// bone lands at 79% of a 210% pin (it landed after the stage let go at 150%), and the lit wall still holds after it.
const PIN = 210;
// The stage's scroll timeline, in units of the stage (a unit is a third of a viewport: 210% is 6.3 units). The zoom
// starts 0.1 in (30 px at 900 px tall) and runs with the scroll. Where the scroll arms each moment: the CAM 01 chip once
// the HUD row has gone, the corners once the clone has cleared them (measured), the edges (and the band's head) a rest
// later and after the landing, the beat once the wall has stood lit a while.
const T = { zoom: 0.1, zoomFor: 1.6, camChip: 0.5, rest: 0.25, toBeat: 0.8, end: PIN * 3 / 100 };
// In time, in seconds: cameras of one wave light this far apart; a moment never starts sooner than this after the one
// ahead of it started (the edges after the corners, the beat after the edges).
const WAVE = { stagger: 0.025, edges: 0.35, beat: 0.3, back: 3 };
const CAPTION = 0.6; // the band's line, printed at the lock's last bone (reveal, rising 12 px)
const SWEEP = true; // the beat opens with one scan line over the whole wall
// MediaPipe hand topology (the partial's bone path follows it) and each joint's ring, from the wrist to the tips.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const ring = (i) => (i === 0 ? 0 : ((i - 1) % 4) + 1);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The page ships each hand's bones as one path (compact, reads without JS). To draw them bone by bone, they become
 *  one line per bone, built once from the joints. */
function bonesOf(hand) {
  if (!hand._bones) {
    const pts = [...hand.querySelectorAll('circle')].map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]);
    hand._bones = BONES.map(([a, b]) => {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', pts[a][0]); line.setAttribute('y1', pts[a][1]);
      line.setAttribute('x2', pts[b][0]); line.setAttribute('y2', pts[b][1]);
      line.dataset.ring = String(ring(a));
      return line;
    });
    const path = hand.querySelector('.wall-bones');
    hand._bones.forEach((l) => hand.insertBefore(l, path));
    path?.remove();
  }
  return hand._bones;
}

const lerp = (a, b, t) => a + (b - a) * t;
const node = (tag, className) => Object.assign(document.createElement(tag), { className });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function init(el, { tier, strings }) {
  const tiles = [...el.querySelectorAll('.wall-tile')];
  if (tiles.length !== 9) return;
  el.dataset.tier = tier;
  requestAnimationFrame(() => sizePoints(el)); // after the first layout, never in its way
  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => sizePoints(el), 150); });

  const clock = createClock(el, tiles);
  if (tier === 'still') {
    clock.paintOnce();
    el.dataset.mode = 'still';
    el.dataset.ready = 'true';
    return;
  }
  const pause = el.querySelector('.wall-pause');
  pause?.addEventListener('click', () => {
    const on = pause.getAttribute('aria-pressed') !== 'true';
    pause.setAttribute('aria-pressed', String(on));
    clock.setPaused(on);
  });
  // Standby: under each CAM chip, a mist copy with a grey dot (shown only while the camera waits, see the CSS)
  for (const t of tiles) {
    const cam = t.querySelector('.wall-cam');
    if (!cam || t.querySelector('.wall-sb')) continue;
    const sb = cam.cloneNode(true);
    sb.className = 'chip wall-sb';
    cam.before(sb);
  }
  el.classList.add('is-motion');
  clock.start();
  // GSAP waits for the page's load and an idle moment, like the global motion layer: on a slow phone, fetching it any
  // earlier pushes the hero's largest paint back. Until then the wall simply shows its final state.
  // Returned so main.js waits for the stage before it measures the page: the stage adds 210% of a viewport.
  return afterLoad().then(() => run(el, tiles, clock, tier, strings)).catch((err) => {
    el.dataset.moduleError = String(err?.message || err);
    el.classList.remove('is-motion');
    tiles.forEach((t) => t.classList.add('is-on'));
    el.dataset.ready = 'true';
  });
}

function afterLoad() {
  const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1200 }) : setTimeout(r, 200)));
  const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true }));
  return loaded.then(idle);
}

/** A visitor who has scrolled to an element, or past it, before the scripts arrive: a stage built there now would move
 *  what they are reading. At the top nothing has moved yet (a tall screen may show the wall's first lines under the
 *  hero), and a deep link (#hash) lands again once the page has settled (main.js). Shared with chapter 01. */
export function readerReached(el) {
  return scrollY > 0 && location.hash.length <= 1 && el.getBoundingClientRect().top < innerHeight;
}

/* Joint radii follow the tile: --u is plate pixels per CSS pixel for the tile's cover crop. */
function sizePoints(el) {
  for (const svg of el.querySelectorAll('.wall-frame .wall-pts')) {
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) continue;
    svg.style.setProperty('--u', (1 / Math.max(width / PLATE.w, height / PLATE.h)).toFixed(3));
  }
}

/* ---------- the hero's own count, read from its counter ---------- */
/** Returns now => the visor's counted time in ms. The visor writes its counter once a second while it plays on screen;
 *  between writes (and once it has paused or scrolled away) the count runs on with the clock: on the wall, only the
 *  wall's own pause holds the meter (a visitor who paused the hero to read, then scrolled on, finds the wall counting).
 *  The page's no-JS value (before the visor writes, data-live) counts as zero. Without a visor, CAM 01 counts from the
 *  wall's start. */
function heroCount() {
  const b = document.querySelector('#visor [data-counter="counted"] b');
  const t0 = performance.now();
  if (!b) return (t) => t - t0;
  const read = () => ('live' in b.dataset ? (b.textContent.match(/^(\d+):(\d\d):(\d\d)$/) || []).slice(1).reduce((a, n) => a * 60 + +n, 0) * 1000 : 0);
  let base = read();
  let at = performance.now();
  new MutationObserver(() => { base = read(); at = performance.now(); }).observe(b, { childList: true, characterData: true, subtree: true });
  return (t) => base + Math.max(0, t - at);
}

/* ---------- the one loop: the cameras' clock and the time that counts ---------- */
function createClock(el, tiles) {
  const tcs = tiles.map((t) => t.querySelector('.wall-tc')).filter(Boolean);
  const count = el.querySelector('[data-wall-count]');
  const x = el.querySelector('[data-wall-x]');
  const hero = heroCount();
  let rate = 1; // cameras counting: CAM 01 (the hero's count), then nine once their hands lock
  let extra = 0; // ms the other cameras added: (rate - 1) times the time the wall ran at that rate
  let held = 0; // ms of the hero's count that went by while the wall was paused: the meter holds, then goes on
  let pausedH = 0;
  let extras = []; // [node, live]: the clone's REC timecode, painted every frame while live() says its row shows
  let lastTc = '';
  let last = 0;
  let raf = 0;
  let visible = false;
  let paused = false;
  let started = false;
  const running = () => started && visible && !paused && !document.hidden;

  function paint() {
    const now = performance.now();
    const tc = timecode(new Date()).slice(0, 8); // HH:MM:SS: every camera turns on the same second
    if (tc !== lastTc) { lastTc = tc; tcs.forEach((n) => { n.textContent = tc; }); }
    const c = duration(Math.max(0, hero(now) - held + extra));
    if (count && count.textContent !== c) count.textContent = c;
    const s = `×${rate}`;
    if (x && x.textContent !== s) x.textContent = s;
  }
  function paintRec() {
    if (!extras.length) return;
    const tc = timecode(new Date());
    for (const [n, live] of extras) if (live() && n.textContent !== tc) n.textContent = tc;
  }
  function frame(t) {
    raf = 0;
    if (!running()) { last = 0; return; }
    paintRec();
    if (!last) { last = t; paint(); } else if (t - last >= 100) { extra += (t - last) * (rate - 1); last = t; paint(); }
    raf = requestAnimationFrame(frame);
  }
  /** REC dots: one shared phase, lit on the clock's second (they dim in its last third, as the visor's do). */
  function sync() {
    const phase = Date.now() % 1000;
    for (const a of el.getAnimations({ subtree: true })) if (a.animationName === 'wall-rec') a.currentTime = phase;
  }
  function kick() {
    const on = running();
    if (on !== el.classList.contains('is-run')) {
      el.classList.toggle('is-run', on);
      if (on) requestAnimationFrame(sync);
    }
    if (on && !raf) raf = requestAnimationFrame(frame);
  }
  if ('IntersectionObserver' in window) {
    // A 1 px inset on the viewport, and the sticky header's height on top: a wall that only touches the bottom edge
    // (1440 x 900, scrolled to the top) or only shows behind the header is off screen
    const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }, { rootMargin: `-${headerH + 1}px 0px -1px 0px` }).observe(el);
  } else visible = true;
  document.addEventListener('visibilitychange', kick);
  return {
    x,
    paintOnce: paint,
    start() { started = true; paint(); kick(); },
    setPaused(on) {
      const now = performance.now();
      if (on && !paused) pausedH = hero(now);
      if (!on && paused) held += hero(now) - pausedH;
      paused = on;
      el.classList.toggle('is-paused', on);
      kick();
    },
    setRate(n) {
      if (n === rate) return;
      const now = performance.now();
      if (running() && last) { extra += (now - last) * (rate - 1); last = now; }
      rate = n;
      paint();
    },
    sync,
    attach(n, live = () => true) { extras.push([n, live]); n.textContent = timecode(new Date()); },
    detach(n) { extras = extras.filter(([e]) => e !== n); },
  };
}

/* ---------- one camera lighting up, then locking on (shared by the stage and the lite tier) ---------- */
/** The characters a chip shows (its hidden parts left out; innerText reads nothing inside a hidden frame). */
const shown = (n) => [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 && getComputedStyle(c).display !== 'none' ? shown(c) : '')).join('');

/** A chip prints one character every 14 ms (k = 1), behind its clip. Returns when it is done. */
function printChip(tl, chip, at, k) {
  const n = Math.max(4, shown(chip).trim().length);
  const d = (n * 0.014 + 0.08) * k;
  tl.fromTo(chip, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: d, ease: `steps(${n})` }, at);
  return at + d;
}

/** Standby to lit, added to tl at `at`, durations in seconds times k: the CAM chip prints at once over its standby copy,
 *  which fades as the picture starts; the brackets settle out of their corners and brighten (track), the picture fades
 *  up (reveal), the other chips print. No hands: they lock on their own beat. Returns the time the camera is lit. */
function lightSequence(tl, tile, at, k, { brackets = true, plate = true, cam = true } = {}) {
  let end = at;
  if (brackets) {
    tl.fromTo([...tile.querySelectorAll('.wall-vf i')], { opacity: 0.5, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.32 * k, ease: 'track' }, at);
    end = at + 0.32 * k;
  }
  if (plate) {
    tl.fromTo(tile.querySelector('.wall-plate'), { opacity: 0 }, { opacity: 1, duration: 0.6 * k, ease: 'reveal' }, at + 0.1 * k);
    end = Math.max(end, at + 0.7 * k);
  }
  const sb = tile.querySelector('.wall-sb');
  if (cam && sb) tl.fromTo(sb, { opacity: 1 }, { opacity: 0, duration: 0.12 * k, ease: 'none' }, at + 0.1 * k);
  const chips = [...tile.querySelectorAll('.wall-hud .chip:not(.wall-sb)')].filter((c) => c.offsetParent && (cam || !c.classList.contains('wall-cam')));
  let i = 0;
  for (const c of chips) {
    const first = c.classList.contains('wall-cam');
    end = Math.max(end, printChip(tl, c, first ? at : at + (0.3 + i++ * 0.08) * k, k));
  }
  return end;
}

/** The hands lock, in time: joints from the wrist out to the fingertips (lock, 160 ms, 60 ms a ring), then each bone
 *  draws out of the joint it starts from (track, 320 ms). Both hands together. Returns when the last bone is drawn. */
function lockSequence(tl, tile, at) {
  for (const hand of tile.querySelectorAll('.wall-hand')) {
    // Fixed origins in plate pixels (the joint's centre, the bone's first joint), x and y pinned to 0 and no origin
    // compensation: whatever GSAP re-reads from the element, a scale that starts small never leaves a shift behind.
    [...hand.querySelectorAll('circle')].forEach((j, i) => {
      const origin = { svgOrigin: `${j.getAttribute('cx')} ${j.getAttribute('cy')}`, smoothOrigin: false, x: 0, y: 0 };
      tl.fromTo(j, { opacity: 0, scale: 0.4, ...origin }, { opacity: 1, scale: 1, ...origin, duration: 0.16, ease: 'lock' }, at + ring(i) * 0.06);
    });
    for (const b of bonesOf(hand)) {
      const origin = { svgOrigin: `${b.getAttribute('x1')} ${b.getAttribute('y1')}`, smoothOrigin: false, x: 0, y: 0 };
      tl.fromTo(b, { opacity: 0, scale: 0.02, ...origin }, { opacity: 1, scale: 1, ...origin, duration: 0.32, ease: 'track' }, at + b.dataset.ring * 0.06 + 0.16);
    }
  }
  return at + 4 * 0.06 + 0.16 + 0.32;
}

/** x9 arrives as a readout: four brackets lock onto the meter (lock, 160 ms), hold for `hold` seconds and let go
 *  (120 ms), while the new rate prints. play() clips the rate at once (call it before the rate changes, so x9 never
 *  shows unprinted for a frame) and runs it; settle() leaves the meter plain (brackets gone, rate shown). */
function meterLock(gsap, el, hold = 0.76) {
  const chip = el.querySelector('.wall-count');
  const x = el.querySelector('[data-wall-x]');
  if (!chip || !x) return { play() {}, settle() {} };
  let vf = chip.querySelector('.wall-x-vf');
  if (!vf) {
    vf = node('span', 'wall-x-vf');
    vf.setAttribute('aria-hidden', 'true');
    vf.innerHTML = '<i></i><i></i><i></i><i></i>';
    chip.appendChild(vf);
  }
  const tl = gsap.timeline({ paused: true })
    .fromTo(vf, { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.16, ease: 'lock', immediateRender: false }, 0)
    .fromTo(x, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.108, ease: 'steps(2)', immediateRender: false }, 0)
    .to(vf, { opacity: 0, duration: 0.12, ease: 'none' }, hold);
  return { play: () => { gsap.set(x, { clipPath: 'inset(0% 100% 0% 0%)' }); tl.play(0); }, settle: () => tl.progress(1).pause() };
}

async function run(el, tiles, clock, tier, strings) {
  const g = await loadGsap('SplitText');
  const lateStage = readerReached(el);
  const mm = g.gsap.matchMedia();
  await new Promise((resolve) => {
    mm.add({ stage: tier === 'full' ? STAGE_MQ : 'not all', flat: tier === 'full' ? `not all and ${STAGE_MQ}` : 'all' }, (ctx) => {
      let undo = null;
      if (ctx.conditions.stage && !lateStage) {
        try { undo = stage(g, el, tiles, clock, strings); } catch (err) {
          el.dataset.stageError = String(err?.message || err);
          el.classList.remove('is-stage', 'is-held');
          el.style.removeProperty('--wall-pin');
          el.querySelectorAll('.wall-fly, .wall-sweep').forEach((n) => n.remove());
          undo = null;
        }
      }
      if (!undo) undo = flat(g, el, tiles, clock);
      el.dataset.ready = 'true';
      resolve();
      return undo;
    });
  });
}

/* ---------- lite, phones, short screens: each camera lights as it enters, the hands lock in one beat ---------- */
function flat(g, el, tiles, clock) {
  const { gsap, ScrollTrigger, SplitText } = g;
  el.dataset.mode = 'flat';
  sizePoints(el);
  const inView = (n) => { const r = n.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
  const meter = el.querySelector('.wall-meter');
  const [cam1, ...others] = tiles;
  const done = (t) => { gsap.set(t.querySelector('.wall-sb'), { opacity: 0 }); t.classList.add('is-on'); };
  const head = el.querySelector('.wall-head');
  if (head && head.getBoundingClientRect().top >= innerHeight) {
    // The head, still below: the kicker prints, the headline's lines rise out of their masks, the line follows (once)
    const kicker = printer(gsap, SplitText, el.querySelector('.wall-kicker'));
    const tl = gsap.timeline({ paused: true });
    headSequence(gsap, SplitText, el, tl, 0.3, 1);
    ScrollTrigger.create({ trigger: head, start: 'top 88%', once: true, onEnter: () => { kicker.play(); tl.play(); } });
  }
  // A visitor already at the meter when the scripts arrive (or a browser without observers): the final wall, at x9
  if (!meter || inView(meter) || !('IntersectionObserver' in window)) {
    tiles.forEach(done);
    clock.setRate(9);
    return () => { clock.setRate(1); };
  }

  // Each camera on standby lights in time; CAM 01, the visor's camera, is tracked from its lighting. A camera already on
  // screen keeps its final state. The others keep their hands still for the beat.
  const lights = new Map();
  const waiting = [];
  tiles.forEach((t) => {
    if (inView(t)) { done(t); return; }
    const tl = gsap.timeline({ paused: true });
    lightSequence(tl, t, 0, 1);
    if (t === cam1) { lockSequence(tl, t, 0.3); tl.call(() => t.classList.add('is-on'), null, 0.3); } else waiting.push(t);
    lights.set(t, tl);
  });
  const beat = gsap.timeline({ paused: true });
  waiting.forEach((t) => lockSequence(beat, t, 0));
  const meterIn = meterLock(gsap, el);
  beat.call(() => { meterIn.play(); clock.setRate(9); others.forEach((t) => t.classList.add('is-on')); }, null, 0);

  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, k) => {
      io.unobserve(e.target);
      const tl = lights.get(e.target);
      if (tl && !tl.isActive() && tl.progress() === 0) gsap.delayedCall(k * 0.12, () => tl.play());
    });
  }, { threshold: 0.35 });
  lights.forEach((_, t) => io.observe(t));
  // The beat, once: when the meter is well in view, any camera still waiting lights (together), and once every camera
  // is lit, the hands lock at once and x9 prints on the lock's first frame.
  const mo = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    mo.disconnect();
    io.disconnect();
    let k = 0;
    const pending = [];
    lights.forEach((tl) => {
      if (tl.progress() === 1) return;
      if (!tl.isActive()) gsap.delayedCall(k++ * WAVE.stagger, () => tl.play());
      pending.push(new Promise((r) => tl.eventCallback('onComplete', r)));
    });
    Promise.all(pending).then(() => beat.play());
  }, { threshold: 0.6 });
  mo.observe(meter);
  return () => { io.disconnect(); mo.disconnect(); clock.setRate(1); };
}

/* The kicker prints like the global layer's (js/motion.js): one character every 14 ms behind a block cursor that
   blinks twice and goes; the bar draws first. In time, on both tiers: play() starts it over, reset() hides it again,
   out() fades it (120 ms, the hands' release) before it hides it.
   The split letters are hidden from assistive tech; a plain copy of the text, visually hidden, speaks for them. */
function printer(gsap, SplitText, kicker) {
  const kt = kicker?.querySelector('.wall-kt');
  if (!kt || !SplitText) return { play() {}, reset() {}, out() {} };
  const bar = kicker.querySelector('i');
  if (!kicker.querySelector('.sr-only')) kicker.appendChild(Object.assign(node('span', 'sr-only'), { textContent: kt.textContent.trim() }));
  const { chars } = SplitText.create(kt, { type: 'chars', charsClass: 'wall-ch', aria: 'hidden' });
  const cursor = node('span', 'mo-cursor');
  cursor.setAttribute('aria-hidden', 'true');
  const tl = gsap.timeline({ paused: true });
  if (bar) tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, transformOrigin: '0% 50%', duration: 0.24, ease: 'track' }, 0);
  tl.fromTo(chars, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: 'none', stagger: { each: 0.014, onStart() { this.targets()[0].after(cursor); } } }, 0.12)
    .call(() => cursor.classList.add('is-done'))
    .call(() => cursor.remove(), null, '+=0.9');
  let fade = null;
  const reset = () => { fade?.kill(); fade = null; gsap.set(kicker, { opacity: 1 }); tl.pause(0); cursor.remove(); cursor.classList.remove('is-done'); };
  const out = () => {
    if (fade || tl.time() === 0) { if (!fade) reset(); return; }
    fade = gsap.to(kicker, { opacity: 0, duration: 0.12, ease: 'none', onComplete: reset });
  };
  return { play() { reset(); chars[0]?.before(cursor); tl.play(0); }, reset, out };
}

/* Headline lines rise out of their masks (900 ms, reveal, 80 ms apart), then the source and the line: added to tl at
   `at`, durations times k. Both tiers play it in time; the stage prints the line later, as the beat's caption
   (withLine false). */
function headSequence(gsap, SplitText, el, tl, at, k, withLine = true) {
  const title = el.querySelector('.wall-title');
  const line = withLine && el.querySelector('.wall-line');
  const src = el.querySelector('.wall-src');
  if (title && SplitText && !title.classList.contains('mo-split')) {
    let part = null;
    const place = (lines) => {
      if (part) tl.remove(part);
      part = gsap.timeline().fromTo(lines, { yPercent: 108 }, { yPercent: 0, duration: 0.9 * k, ease: 'reveal', stagger: 0.08 * k });
      tl.add(part, at);
      // A re-split (fonts in, new width) must land the new lines where the reveal stands now, risen if it already ran
      part.progress(Math.min(1, Math.max(0, (tl.time() - part.startTime()) / part.duration())));
    };
    SplitText.create(title, { type: 'lines', mask: 'lines', linesClass: 'mo-line', autoSplit: true, onSplit: (self) => { place(self.lines); } });
  }
  if (src) tl.fromTo(src, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 * k, ease: 'reveal' }, at + 0.5 * k);
  if (line) tl.fromTo(line, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6 * k, ease: 'reveal' }, at + 0.5 * k);
}

/* ---------- full tier: the stage ---------- */
function stage(g, el, tiles, clock, strings) {
  const { gsap, ScrollTrigger, SplitText } = g;
  const stageEl = el.querySelector('.wall-stage');
  const grid = el.querySelector('.wall-grid');
  const visor = document.getElementById('visor');
  const header = document.querySelector('.site-header');
  const cam1 = tiles[0];
  const cam1Frame = cam1.querySelector('.wall-frame');
  const headerH = () => header?.offsetHeight || 64;
  const pinPx = () => Math.round((innerHeight * PIN) / 100);

  // The stage sticks for PIN% of the viewport: the section is that much taller than the stage (wall-cams.css). Set
  // before any scroll position is measured, on every refresh.
  const setPin = () => el.style.setProperty('--wall-pin', `${pinPx()}px`);
  setPin();
  ScrollTrigger.addEventListener('refreshInit', setPin);
  el.classList.add('is-stage');
  el.dataset.mode = 'stage';
  const fly = buildFlyer(cam1, strings);
  stageEl.appendChild(fly.root);
  const sweep = node('i', 'wall-sweep');
  sweep.setAttribute('aria-hidden', 'true');
  stageEl.appendChild(sweep);
  let rowShows = true; // the clone's HUD row, with its REC readout
  clock.attach(fly.tc, () => rowShows);
  requestAnimationFrame(clock.sync);
  cam1.classList.add('is-on'); // CAM 01 is the visor's camera: its hands are tracked from the first pixel

  const geo = { V: null, C: null, end: null };
  const cells = new Map();
  let tall = false; // a screen taller than the hero: the wall takes the whole stage, not just the visor's height
  function measure() {
    const stageH = innerHeight - headerH();
    const v = visor?.getBoundingClientRect();
    const vw = v?.width || stageEl.clientWidth - 48;
    const vh = v?.height || stageH - 24;
    const edge = parseFloat(getComputedStyle(el).getPropertyValue('--edge')) || 24;
    tall = stageH - vh > edge + 24;
    if (tall) el.style.removeProperty('--wall-pb'); // the edge gutter only: no empty strip under the band
    else el.style.setProperty('--wall-pb', `${Math.max(0, Math.round(stageH - vh))}px`);
    const s = stageEl.getBoundingClientRect();
    const rel = (n) => { const b = n.getBoundingClientRect(); return { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height }; };
    const cs = getComputedStyle(el);
    geo.V = { x: (v ? v.left : 24) - s.left, y: 0, w: vw, h: vh };
    geo.C = rel(cam1Frame);
    tiles.forEach((t) => cells.set(t, rel(t.querySelector('.wall-frame'))));
    const num = (name, fallback) => parseFloat(cs.getPropertyValue(name)) || fallback;
    geo.end = { inset: num('--wall-inset', 6), arm: num('--wall-arm', 14), bevel: num('--wall-ch', 8), pad: num('--wall-pad', 12) };
    sweep.style.top = `${grid.offsetTop}px`;
    sweep.style.height = `${grid.offsetHeight}px`;
    fly.layout(geo.V);
    sizePoints(el);
  }

  const proxy = { u: 0 };
  // CAM 01's own frame waits under the clone by opacity, so its picture and alt stay in the accessibility tree. On a
  // tall screen the wall reaches below the clone's first frame: it fades in as the clone pulls back.
  const draw = () => {
    const landed = fly.draw(proxy.u, geo);
    cam1Frame.style.opacity = landed ? '' : '0';
    grid.style.opacity = tall && proxy.u < 0.15 ? (proxy.u / 0.15).toFixed(3) : '';
  };
  measure();
  draw();

  // Where the scroll arms each moment, from the measured wall. CAM 01 sits in the middle, so the clone clears the four
  // corners within a few hundredths of the zoom: they light as one wave once it has cleared the last of them.
  const zoomAt = (u) => T.zoom + u * T.zoomFor; // ease none: the zoom runs with the scroll, the scrub smooths it
  const land = zoomAt(1);
  const cam = (n) => tiles[n - 1];
  const CORNERS = [2, 4, 6, 8].map(cam); // clockwise from the top left
  const EDGES = [3, 5, 7, 9].map(cam);
  const cornersAt = Math.max(...CORNERS.map((t) => zoomAt(Math.min(1, clearAt(geo.V, geo.C, cells.get(t)) + 0.01))));
  const edgesAt = Math.max(land + 0.06, cornersAt + T.rest);
  const beatAt = edgesAt + T.toBeat;

  // The scrubbed pull-back: the clone zooms into CAM 01 while what only the visor shows lets go (the HUD row, the scrims)
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  tl.to(proxy, { u: 1, duration: T.zoomFor, ease: 'none', onUpdate: draw }, T.zoom)
    .to(fly.row, { opacity: 0, y: -6, duration: 0.3 }, T.zoom)
    .to(fly.scrim, { opacity: 0, duration: 1.2 }, T.zoom)
    .to({}, { duration: 0.01 }, T.end - 0.01);

  // The moments, each in time. The CAM 01 chip prints once the row has gone (never text over text).
  const camPrint = gsap.timeline({ paused: true });
  printChip(camPrint, fly.cam, 0, 1);
  const corners = gsap.timeline({ paused: true });
  CORNERS.forEach((t, i) => lightSequence(corners, t, i * WAVE.stagger, 1));
  // CAM 01 lands lit and tracked (the clone carried it down): only its task and clock print, with the edges
  gsap.set(cam1.querySelector('.wall-sb'), { opacity: 0 });
  const edges = gsap.timeline({ paused: true });
  lightSequence(edges, cam1, 0, 1, { brackets: false, plate: false, cam: false });
  EDGES.forEach((t, i) => lightSequence(edges, t, i * WAVE.stagger, 1));

  // The beat: one scan line crosses the wall at full strength, then every camera's hands lock at once (CAM 01's
  // already are) and the meter steps to x9 inside its viewfinder; the band's line prints as its caption at the last
  // bone, and the meter's brackets hold until it has. Back above it, the hands and the line let go (120 ms, the visor's
  // release) and the meter counts at x1 again.
  const beat = gsap.timeline({ paused: true });
  const L = SWEEP ? 0.5 : 0;
  if (SWEEP) {
    beat.fromTo(sweep, { yPercent: 0 }, { yPercent: 100, duration: 0.5, ease: 'none' }, 0)
      .fromTo(sweep, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: 'none' }, 0)
      .to(sweep, { opacity: 0, duration: 0.06, ease: 'none' }, 0.5);
  }
  const others = tiles.slice(1);
  const lastBone = Math.max(L, ...others.map((t) => lockSequence(beat, t, L)));
  const line = el.querySelector('.wall-line');
  if (line) beat.fromTo(line, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: CAPTION, ease: 'reveal', immediateRender: true }, lastBone);
  const meterIn = meterLock(gsap, el, lastBone - L + CAPTION);
  el.dataset.schedule = JSON.stringify({ camChip: T.camChip, corners: +cornersAt.toFixed(3), land, edges: +edgesAt.toFixed(3), beat: +beatAt.toFixed(3), hitFor: +lastBone.toFixed(3), caption: CAPTION, end: T.end, wave: WAVE });
  const hands = others.flatMap((t) => [...t.querySelectorAll('.wall-hand')]);
  const fading = line ? [...hands, line] : hands;
  const release = gsap.to(fading, { opacity: 0, duration: 0.12, ease: 'none', paused: true, onComplete: () => { beat.pause(0); gsap.set(hands, { opacity: 1 }); } });
  const kicker = printer(gsap, SplitText, el.querySelector('.wall-kicker'));
  const head = gsap.timeline({ paused: true });
  headSequence(gsap, SplitText, el, head, 0.1, 1, false);

  const play = (t) => { t.timeScale(1).play(); };
  const back = (t) => { t.timeScale(WAVE.back).reverse(); }; // back to standby, three times faster than it came
  const cues = [
    { at: T.camChip, play: () => play(camPrint), back: () => back(camPrint) },
    { at: cornersAt, play: () => play(corners), back: () => back(corners) },
    // the setup: the band's head prints with the edges' wave, so the beat lands alone
    { at: edgesAt, gap: WAVE.edges, play: () => { play(edges); kicker.play(); play(head); }, back: () => { back(edges); kicker.out(); back(head); } },
    {
      at: beatAt, gap: WAVE.beat,
      play: () => { release.pause(0); gsap.set(hands, { opacity: 1 }); if (line) gsap.set(line, { opacity: 0, y: 12 }); beat.play(0); },
      back: () => { clock.setRate(1); meterIn.settle(); others.forEach((t) => t.classList.remove('is-on')); beat.pause(); gsap.set(sweep, { opacity: 0 }); release.invalidate().restart(); },
    },
  ];
  const BEAT = 3;
  beat.call(() => {
    if (!state[BEAT].armed) return;
    meterIn.play(); // the rate is clipped before it changes
    clock.setRate(9);
    others.forEach((t) => t.classList.add('is-on'));
  }, null, L);
  // Each cue: armed (the scroll is past it), t0 (when it started, ticker seconds) and its pending start
  const state = cues.map(() => ({ armed: false, t0: null, call: null }));
  const now = () => gsap.ticker.time;
  function start(i) {
    const c = cues[i];
    const s = state[i];
    if (!c || !s.armed || s.t0 !== null || s.call) return;
    let at = now();
    if (c.gap) {
      const prev = state[i - 1].t0;
      if (prev === null) return; // the one ahead has not started: it starts this one when it does
      at = Math.max(at, prev + c.gap);
    }
    const go = () => { s.call = null; s.t0 = now(); c.play(); start(i + 1); };
    if (at - now() > 0.008) s.call = gsap.delayedCall(at - now(), go); else go();
  }
  function arm(i, on) {
    const s = state[i];
    if (on === s.armed) return;
    s.armed = on;
    if (on) { start(i); return; }
    s.call?.kill();
    s.call = null;
    if (s.t0 !== null) cues[i].back();
    s.t0 = null;
  }
  tl.eventCallback('onUpdate', () => {
    const t = tl.time();
    rowShows = t < T.zoom + 0.3;
    cues.forEach((c, i) => arm(i, t >= c.at));
  });

  const st = ScrollTrigger.create({
    id: 'wall-stage',
    trigger: el, // the section, never the sticky stage: its box stays put whatever the scroll
    start: () => `top ${headerH()}px`,
    end: () => `+=${pinPx()}`,
    scrub: 0.5,
    animation: tl, // never invalidated on refresh: the clone is placed by draw(), which reads fresh geometry
    onRefresh: () => { measure(); draw(); },
  });
  // From the first pixel of scroll the visor stays on CAM 01, the clone's camera, until the page is back at the top: the
  // hero lifts off the camera that pulls back. On every pointer (touch scrolls the clone up under the visor instead).
  const visorHold = (on) => {
    if (!visor) return;
    if (on) visor.dataset.hold = '0'; else delete visor.dataset.hold;
    visor.dispatchEvent(new CustomEvent('visor:hold', { detail: { on, index: 0 } }));
  };
  const page = document.documentElement; // every trigger names an element (chapter tests look triggers up by theirs)
  const lift = ScrollTrigger.create({ trigger: page, start: 'top top-=1', end: 'bottom bottom', onToggle: (self) => visorHold(self.isActive) });
  // Before the stage sticks, while the hero scrolls away, the clone holds still where the visor sat: the page lifts off
  // a camera that stays, instead of a second visor sliding up under the first. The stage clips it to its own box. Wheel
  // only, where Lenis moves the page from script in step with this; under native touch scrolling a counter-moved layer
  // shakes. Meanwhile the wall itself stays out of sight (.is-held): below the held clone, the rising stage would show
  // slices of the standby cameras. When the stage sticks, the clone covers the whole wall, so the wall appears unseen.
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hold = fine && gsap.fromTo(fly.root, { y: () => headerH() - innerHeight }, {
    y: 0, ease: 'none',
    scrollTrigger: { trigger: el, start: 'top bottom', end: () => `top ${headerH()}px`, scrub: true, invalidateOnRefresh: true, toggleClass: { targets: el, className: 'is-held' } },
  });
  // The visor's own picture (plate, depth, tracking) holds still the same way (--lift, hero.css): the hero's frame, its
  // copy and the gutter slide off one continuous picture, the gutter passing over it like a scan line.
  const liftEnd = () => Math.max(1, Math.round(el.getBoundingClientRect().top + scrollY - headerH()));
  const still = fine && visor && gsap.fromTo(visor, { '--lift': '0px' }, {
    '--lift': () => `${liftEnd()}px`, ease: 'none',
    scrollTrigger: { trigger: page, start: 'top top', end: () => `+=${liftEnd()}`, scrub: true, invalidateOnRefresh: true },
  });
  warmImages(el, fly.img);
  return () => {
    for (const t of [hold, still]) if (t) { t.scrollTrigger?.kill(); t.revert?.(); t.kill(); } // matchMedia may have reverted them already
    visor?.style.removeProperty('--lift');
    lift.kill();
    visorHold(false);
    st.kill();
    ScrollTrigger.removeEventListener('refreshInit', setPin);
    state.forEach((s) => s.call?.kill());
    [tl, beat, camPrint, corners, edges, head, release].forEach((t) => t.kill());
    clock.detach(fly.tc);
    clock.setRate(1);
    fly.root.remove();
    sweep.remove();
    cam1Frame.style.opacity = '';
    grid.style.opacity = '';
    el.classList.remove('is-stage', 'is-held');
    el.style.removeProperty('--wall-pb');
    el.style.removeProperty('--wall-pin');
    delete el.dataset.schedule;
    tiles.forEach((t) => t.classList.remove('is-on'));
  };
}

/* The wall's pictures load lazily, but on the stage they must be decoded before it starts: after the page has loaded
   (the hero first), every tile switches to eager loading and decodes. */
function warmImages(el, flyImg) {
  const go = () => {
    const imgs = [flyImg, ...el.querySelectorAll('.wall-plate img')];
    imgs.forEach((img) => { img.loading = 'eager'; });
    Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => { el.dataset.decoded = 'true'; });
  };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 300));
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
}

/* ---------- the visor's clone ---------- */
function buildFlyer(cam1, strings) {
  const root = node('div', 'wall-fly');
  root.setAttribute('aria-hidden', 'true');
  const win = node('div', 'wall-fly-win');
  const plate = node('div', 'wall-fly-plate');
  const pic = cam1.querySelector('.wall-plate').cloneNode(true);
  pic.className = '';
  pic.removeAttribute('style');
  pic.querySelectorAll('source, img').forEach((n) => n.setAttribute('sizes', 'calc(100vw - 48px)')); // the visor's own sizes
  const img = pic.querySelector('img');
  img.alt = '';
  img.loading = 'eager';
  const pts = cam1.querySelector('.wall-pts').cloneNode(true);
  pts.setAttribute('preserveAspectRatio', 'none');
  pts.classList.add('wall-fly-pts');
  pts.removeAttribute('style');
  pts.querySelectorAll('[style], [transform]').forEach((n) => { n.removeAttribute('style'); n.removeAttribute('transform'); });
  plate.append(pic, pts);
  const scrim = node('i', 'wall-fly-scrim');
  win.append(plate, scrim);
  const bars = Array.from({ length: 8 }, (_, i) => node('i', `wall-fly-bar ${i % 2 ? 'v' : 'h'}`));
  const hud = node('div', 'wall-fly-hud');
  const row = node('div', 'wall-fly-row mono');
  row.innerHTML = `<span class="chip"><b class="dot"></b>${esc(strings.hud_rec || 'REC')} <span class="num"></span></span>`
    + `<span class="chip">${esc(strings.shot1)}</span>`
    + `<span class="chip wall-fly-counts"><b class="wall-fly-sw"></b>${esc(strings.chip_counts)}</span>`;
  hud.appendChild(row);
  // The camera chip that rides the frame's corner down to the wall, where CAM 01's own chip takes over
  const cam = node('span', 'chip mono wall-fly-cam');
  cam.innerHTML = cam1.querySelector('.wall-cam')?.innerHTML || 'CAM 01';
  root.append(win, ...bars, hud, cam);
  let base = 1;

  function layout(V) {
    win.style.width = `${V.w}px`;
    win.style.height = `${V.h}px`;
    base = coverMap(V.w, V.h, PLATE.w, PLATE.h, PLATE_ZOOM, FY0).s;
    plate.style.width = `${PLATE.w * base}px`;
    plate.style.height = `${PLATE.h * base}px`;
  }

  /** Places the clone at zoom progress u (0: the visor, 1: CAM 01's cell). Returns true once it has landed. */
  function draw(u, { V, C, end }) {
    const R = rectAt(u, V, C);
    const ax = R.w / V.w;
    const ay = R.h / V.h;
    win.style.transform = `translate(${R.x.toFixed(2)}px, ${R.y.toFixed(2)}px) scale(${ax.toFixed(5)}, ${ay.toFixed(5)})`;
    const c = lerp(VISOR.bevel, end.bevel, u);
    const cx = (c / ax).toFixed(2);
    const cy = (c / ay).toFixed(2);
    win.style.clipPath = `polygon(0 0, 100% 0, 100% calc(100% - ${cy}px), calc(100% - ${cx}px) 100%, ${cx}px 100%, 0 calc(100% - ${cy}px))`;
    // the picture keeps the visor's cover framing (focus and 3% zoom) and eases into the tile's plain cover
    const { s, ox, oy } = coverMap(R.w, R.h, PLATE.w, PLATE.h, lerp(PLATE_ZOOM, 1, u), lerp(FY0, 0.5, u));
    plate.style.transform = `translate(${(ox / ax).toFixed(2)}px, ${(oy / ay).toFixed(2)}px) scale(${(s / base / ax).toFixed(5)}, ${(s / base / ay).toFixed(5)})`;
    // the hands stay tracked: joints and bones keep their size on screen (1 / s plate px a CSS px) and reach the tile's
    pts.style.setProperty('--u', (1 / s).toFixed(4));
    pts.style.setProperty('--k', u.toFixed(4));
    pts.style.setProperty('--sc', (s / base).toFixed(5)); // the CSS scale on the points: strokes divide by it
    // brackets travel with the frame and shrink from the visor's to the tile's
    const i = lerp(VISOR.inset, end.inset, u);
    const a = lerp(VISOR.arm, end.arm, u);
    const k = (a / VISOR.arm).toFixed(4);
    const L = R.x + i;
    const Rt = R.x + R.w - i;
    const Tp = R.y + i;
    const B = R.y + R.h - i;
    const at = [[L, Tp], [L, Tp], [Rt - a, Tp], [Rt - 1.5, Tp], [L, B - 1.5], [L, B - a], [Rt - a, B - 1.5], [Rt - 1.5, B - a]];
    bars.forEach((b, n) => { b.style.transform = `translate(${at[n][0].toFixed(2)}px, ${at[n][1].toFixed(2)}px) ${n % 2 ? 'scaleY' : 'scaleX'}(${k})`; });
    hud.style.transform = `translate(${(R.x + VISOR.hud).toFixed(2)}px, ${(R.y + VISOR.hud).toFixed(2)}px)`;
    const p = lerp(VISOR.hud, end.pad, u);
    cam.style.transform = `translate(${(R.x + p).toFixed(2)}px, ${(R.y + p).toFixed(2)}px)`;
    const landed = u >= 0.999;
    root.style.visibility = landed ? 'hidden' : '';
    return landed;
  }

  return { root, img, pts, row, cam, scrim, tc: row.querySelector('.num'), layout, draw };
}

/** Log-linear zoom from rect V to rect C (per axis, about the point that stays put), so the pull-back reads at an
 *  even pace from the first pixel to the last. */
export function rectAt(u, V, C) {
  const kx = C.w / V.w;
  const ky = C.h / V.h;
  const w = V.w * kx ** u;
  const h = V.h * ky ** u;
  const axis = (v0, c0, k, size0, size) => {
    const vc = v0 + size0 / 2;
    const cc = c0 + (size0 * k) / 2;
    const f = Math.abs(1 - k) < 1e-6 ? cc : (cc - vc * k) / (1 - k);
    return f + (vc - f) * (size / size0) - size / 2;
  };
  return { x: axis(V.x, C.x, kx, V.w, w), y: axis(V.y, C.y, ky, V.h, h), w, h };
}

/** The first zoom progress at which the clone (rectAt) no longer overlaps cell R. */
export function clearAt(V, C, R) {
  for (let i = 0; i <= 500; i++) {
    const u = i / 500;
    const A = rectAt(u, V, C);
    if (A.x + A.w <= R.x || R.x + R.w <= A.x || A.y + A.h <= R.y || R.y + R.h <= A.y) return u;
  }
  return 1;
}
