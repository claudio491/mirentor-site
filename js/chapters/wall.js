import { loadGsap } from '../vendor.js';
import { timecode, duration } from '../hero/clock.js';
import { PLATE_ZOOM, coverMap } from '../hero/overlay.js';
import { SHOTS } from '../hero/shots.js';

const STAGE_MQ = '(min-width: 900px) and (min-height: 640px)';
const PLATE = { w: 1536, h: 864 };
const VISOR = { inset: 14, arm: 22, bevel: 12, hud: 24 }; // the visor's brackets, chamfer and HUD row (hero.css)
const PIN = 210;
const T = { zoom: 0.1, zoomFor: 1.6, camChip: 0.5, rest: 0.25, toBeat: 0.8, end: PIN * 3 / 100 };
const WAVE = { stagger: 0.025, edges: 0.35, beat: 0.3, back: 3 };
const CAPTION = 0.6; // the band's line, risen once the total has settled into the meter (reveal, rising 12 px)
const SWEEP = true; // the beat opens with one scan line over the whole wall
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const ring = (i) => (i === 0 ? 0 : ((i - 1) % 4) + 1);
const SVG_NS = 'http://www.w3.org/2000/svg';

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

export function init(el, { tier }) {
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
  for (const t of tiles) {
    const cam = t.querySelector('.wall-cam');
    if (!cam || t.querySelector('.wall-sb')) continue;
    const sb = cam.cloneNode(true);
    sb.className = 'chip wall-sb';
    cam.before(sb);
    const plate = t.querySelector('.wall-plate');
    const veil = ['wall-mono', 'wall-scan'].map((k) => { const n = node('i', k); n.setAttribute('aria-hidden', 'true'); return n; });
    plate?.after(...veil);
  }
  el.classList.add('is-motion');
  clock.start();
  return afterLoad().then(() => run(el, tiles, clock, tier)).catch((err) => {
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

export function readerReached(el) {
  return scrollY > 0 && location.hash.length <= 1 && el.getBoundingClientRect().top < innerHeight;
}

function sizePoints(el) {
  for (const svg of el.querySelectorAll('.wall-frame .wall-pts')) {
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) continue;
    svg.style.setProperty('--u', (1 / Math.max(width / PLATE.w, height / PLATE.h)).toFixed(3));
  }
}

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

function createClock(el, tiles) {
  const tcs = tiles.map((t) => t.querySelector('.wall-tc')).filter(Boolean);
  const count = el.querySelector('[data-wall-count]');
  const x = el.querySelector('[data-wall-x]');
  const mirrors = []; // the beat's total over the wall shows the same count
  const hero = heroCount();
  let rate = 1; // cameras counting: the centre (the hero's count), then nine once their hands lock
  let extra = 0; // ms the other cameras added: (rate - 1) times the time the wall ran at that rate
  let held = 0; // ms of the hero's count that went by while the wall was paused: the meter holds, then goes on
  let pausedH = 0;
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
    for (const m of mirrors) if (m.textContent !== c) m.textContent = c;
    const s = `×${rate}`;
    if (x && x.textContent !== s) x.textContent = s;
  }
  function frame(t) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (!last) { last = t; paint(); } else if (t - last >= 100) { extra += (t - last) * (rate - 1); last = t; paint(); }
    raf = requestAnimationFrame(frame);
  }
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
    const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }, { rootMargin: `-${headerH + 1}px 0px -1px 0px` }).observe(el);
  } else visible = true;
  document.addEventListener('visibilitychange', kick);
  return {
    x,
    mirror(n) { if (n && !mirrors.includes(n)) { mirrors.push(n); paint(); } },
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
  };
}

const shown = (n) => [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 && getComputedStyle(c).display !== 'none' ? shown(c) : '')).join('');

function printChip(tl, chip, at, k) {
  const n = Math.max(4, shown(chip).trim().length);
  const d = (n * 0.014 + 0.08) * k;
  tl.fromTo(chip, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: d, ease: `steps(${n})` }, at);
  return at + d;
}

const STANDBY = 0.42; // the picture's opacity on standby, over the graphite panel
function lightSequence(tl, tile, at, k, { brackets = true, plate = true, cam = true } = {}) {
  let end = at;
  if (brackets) {
    tl.fromTo([...tile.querySelectorAll('.wall-vf i')], { opacity: 0.5, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.32 * k, ease: 'track' }, at);
    end = at + 0.32 * k;
  }
  if (plate) {
    tl.fromTo(tile.querySelector('.wall-plate'), { opacity: STANDBY }, { opacity: 1, duration: 0.5 * k, ease: 'reveal' }, at + 0.12 * k);
    const veil = [...tile.querySelectorAll('.wall-mono, .wall-scan')];
    if (veil.length) tl.fromTo(veil, { opacity: 1, yPercent: 0 }, { opacity: 1, yPercent: 101, duration: 0.46 * k, ease: 'track' }, at + 0.06 * k);
    end = Math.max(end, at + 0.62 * k);
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

function lockBox(hand) {
  if (!hand._lk) {
    const pts = [...hand.querySelectorAll('circle')].map((c) => [+c.getAttribute('cx'), +c.getAttribute('cy')]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const pad = 0.12 * Math.max(w, h) + 14;
    const [x0, y0, x1, y1] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    const a = Math.max(18, 0.24 * Math.min(x1 - x0, y1 - y0));
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wall-lk');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M${x0} ${y0 + a}V${y0}H${x0 + a}M${x1 - a} ${y0}H${x1}V${y0 + a}M${x1} ${y1 - a}V${y1}H${x1 - a}M${x0 + a} ${y1}H${x0}V${y1 - a}`);
    g.appendChild(path);
    hand.after(g);
    hand._lk = { g, origin: `${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}` };
  }
  return hand._lk;
}

function lockSequence(tl, tile, at) {
  for (const hand of tile.querySelectorAll('.wall-hand')) {
    const lk = lockBox(hand);
    const o = { svgOrigin: lk.origin, smoothOrigin: false, x: 0, y: 0 };
    tl.fromTo(lk.g, { opacity: 0, scale: 1.6, ...o }, { opacity: 1, scale: 1, ...o, duration: 0.2, ease: 'lock' }, at)
      .to(lk.g, { opacity: 0, duration: 0.24, ease: 'none' }, at + 0.95);
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

function buildTotal(el, host, clock) {
  let root = host.querySelector('.wall-total');
  if (!root) {
    root = node('div', 'wall-total mono');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<span class="wall-total-vf"><i></i><i></i><i></i><i></i></span><b class="wall-total-x num">×1</b><span class="wall-total-k"></span><b class="wall-total-n num"></b>';
    root.querySelector('.wall-total-k').textContent = el.querySelector('.wall-long')?.textContent.trim() || '';
    host.appendChild(root);
  }
  const t = { root, vf: root.querySelector('.wall-total-vf'), x: root.querySelector('.wall-total-x'), k: root.querySelector('.wall-total-k'), n: root.querySelector('.wall-total-n') };
  clock.mirror(t.n);
  return t;
}

const HIT = { count: 0.36, hold: 1.15, travel: 0.42 };

function hitSequence(gsap, el, tl, at, { tiles, clock, total, target, line, meterIn, onHit, gate = () => true }) {
  const lastBone = Math.max(at, ...tiles.map((t) => lockSequence(tl, t, at)));
  const mx = el.querySelector('[data-wall-x]');
  const host = total.root.parentElement;
  const R = { from: null, to: null };
  const trav = { t: 0 };
  const cnt = { v: 1 };
  let tcPrint = null;
  const put = () => {
    if (!R.from) return;
    const t = trav.t;
    gsap.set(total.root, { x: lerp(R.from.x, R.to.x, t), y: lerp(R.from.y, R.to.y, t), scale: lerp(1, R.to.s, t) });
  };
  const clip = (n, at2, d, steps) => tl.fromTo(n, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: d, ease: `steps(${steps})` }, at2);
  tl.call(() => {
    if (!gate()) return;
    if (mx) gsap.set(mx, { clipPath: 'inset(0% 100% 0% 0%)' }); // the meter's x9 waits for the total to land in it
    clock.setRate(9);
    onHit?.();
    const tcs = [...el.querySelectorAll('.wall-tc')].filter((c) => c.offsetParent);
    tcPrint?.kill();
    tcPrint = gsap.fromTo(tcs, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.13, ease: 'steps(8)' });
    total.x.textContent = '×1';
    const r = target();
    const h = host.getBoundingClientRect();
    gsap.set(total.root, { x: Math.round(r.left - h.left + (r.width - total.root.offsetWidth) / 2), y: Math.round(r.top - h.top + (r.height - total.root.offsetHeight) / 2), scale: 1, transformOrigin: '0 0' });
    R.from = null;
  }, null, at);
  tl.fromTo(total.root, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: 'none' }, at)
    .fromTo(total.vf, { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.2, ease: 'lock' }, at)
    .fromTo(cnt, { v: 1 }, { v: 9, duration: HIT.count, ease: 'steps(8)', onUpdate: () => { total.x.textContent = `×${Math.round(cnt.v)}`; } }, at + 0.06);
  clip(total.k, at + 0.06, 0.2, 12);
  clip(total.n, at + 0.12, 0.13, 8);
  const go = at + HIT.hold;
  tl.call(() => {
    const rr = total.root.getBoundingClientRect();
    const gr = total.x.getBoundingClientRect();
    const mr = mx?.getBoundingClientRect();
    if (!mr || !mr.width) { R.from = null; return; }
    const s = parseFloat(getComputedStyle(mx).fontSize) / parseFloat(getComputedStyle(total.x).fontSize);
    const x0 = +gsap.getProperty(total.root, 'x');
    const y0 = +gsap.getProperty(total.root, 'y');
    R.from = { x: x0, y: y0 };
    R.to = { x: x0 + (mr.left + mr.width / 2) - (gr.left + gr.width / 2 - rr.left) * s - rr.left, y: y0 + (mr.top + mr.height / 2) - (gr.top + gr.height / 2 - rr.top) * s - rr.top, s };
  }, null, go);
  tl.to(total.vf, { opacity: 0, duration: 0.12, ease: 'none' }, go)
    .fromTo(trav, { t: 0 }, { t: 1, duration: HIT.travel, ease: 'track', onUpdate: put, immediateRender: false }, go)
    .to(total.root, { opacity: 0, duration: 0.14, ease: 'none' }, go + HIT.travel - 0.12);
  const arrive = go + HIT.travel;
  tl.call(() => { if (gate()) meterIn.play(); }, null, arrive);
  if (line) tl.fromTo(line, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: CAPTION, ease: 'reveal', immediateRender: true }, arrive + 0.04);
  const reset = () => {
    tcPrint?.progress(1).kill();
    tcPrint = null;
    R.from = null;
    gsap.set(total.root, { opacity: 0 });
  };
  return { arrive, lastBone, reset };
}

async function run(el, tiles, clock, tier) {
  const g = await loadGsap('SplitText');
  const lateStage = readerReached(el);
  const mm = g.gsap.matchMedia();
  await new Promise((resolve) => {
    mm.add({ stage: tier === 'full' ? STAGE_MQ : 'not all', flat: tier === 'full' ? `not all and ${STAGE_MQ}` : 'all' }, (ctx) => {
      let undo = null;
      if (ctx.conditions.stage && !lateStage) {
        try { undo = stage(g, el, tiles, clock); } catch (err) {
          el.dataset.stageError = String(err?.message || err);
          el.classList.remove('is-stage', 'is-held');
          el.style.removeProperty('--wall-pin');
          el.querySelectorAll('.wall-fly, .wall-sweep, .wall-total').forEach((n) => n.remove());
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

function flat(g, el, tiles, clock) {
  const { gsap, ScrollTrigger, SplitText } = g;
  el.dataset.mode = 'flat';
  sizePoints(el);
  const inView = (n) => { const r = n.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
  const meter = el.querySelector('.wall-meter');
  const [cam1, ...others] = tiles;
  const done = (t) => { gsap.set(t.querySelector('.wall-sb'), { opacity: 0 }); t.classList.add('is-on'); };
  const kickerEl = el.querySelector('.wall-kicker');
  const grid = el.querySelector('.wall-grid');
  const line = el.querySelector('.wall-line');
  const late = !!line && !!grid && line.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom;
  const meterAt = !meter || inView(meter) || !('IntersectionObserver' in window);
  if (kickerEl && kickerEl.getBoundingClientRect().top >= innerHeight) {
    const kicker = printer(gsap, SplitText, kickerEl);
    const tl = gsap.timeline({ paused: true });
    headSequence(gsap, SplitText, el, tl, 0.3, 1, !late || meterAt);
    ScrollTrigger.create({ trigger: kickerEl, start: 'top 88%', once: true, onEnter: () => { kicker.play(); tl.play(); } });
  }
  if (meterAt) {
    tiles.forEach(done);
    clock.setRate(9);
    return () => { clock.setRate(1); };
  }

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
  const headerH = document.querySelector('.site-header')?.offsetHeight || 0;
  const target = () => {
    const g = grid.getBoundingClientRect();
    const top = Math.max(g.top, headerH);
    const bottom = Math.min(g.bottom, innerHeight);
    return { left: g.left, width: g.width, top, height: Math.max(0, bottom - top) };
  };
  const total = buildTotal(el, el.querySelector('.wall-stage'), clock);
  const meterIn = meterLock(gsap, el, CAPTION + 0.16);
  hitSequence(gsap, el, beat, 0, { tiles: waiting, clock, total, target, line: late ? line : null, meterIn, onHit: () => others.forEach((t) => t.classList.add('is-on')) });

  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, k) => {
      io.unobserve(e.target);
      const tl = lights.get(e.target);
      if (tl && !tl.isActive() && tl.progress() === 0) gsap.delayedCall(k * 0.12, () => tl.play());
    });
  }, { threshold: 0.35 });
  lights.forEach((_, t) => io.observe(t));
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
      part.progress(Math.min(1, Math.max(0, (tl.time() - part.startTime()) / part.duration())));
    };
    SplitText.create(title, { type: 'lines', mask: 'lines', linesClass: 'mo-line', autoSplit: true, onSplit: (self) => { place(self.lines); } });
  }
  if (src) tl.fromTo(src, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 * k, ease: 'reveal' }, at + 0.5 * k);
  if (line) tl.fromTo(line, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6 * k, ease: 'reveal' }, at + 0.5 * k);
}

function stage(g, el, tiles, clock) {
  const { gsap, ScrollTrigger, SplitText } = g;
  const stageEl = el.querySelector('.wall-stage');
  const grid = el.querySelector('.wall-grid');
  const visor = document.getElementById('visor');
  const header = document.querySelector('.site-header');
  const headerH = () => header?.offsetHeight || 64;
  const pinPx = () => Math.round((innerHeight * PIN) / 100);

  const setPin = () => el.style.setProperty('--wall-pin', `${pinPx()}px`);
  setPin();
  ScrollTrigger.addEventListener('refreshInit', setPin);
  el.classList.add('is-stage');
  el.dataset.mode = 'stage';
  const fly = buildFlyer();
  stageEl.appendChild(fly.root);
  const sweep = node('i', 'wall-sweep');
  sweep.setAttribute('aria-hidden', 'true');
  stageEl.appendChild(sweep);
  const total = buildTotal(el, stageEl, clock);
  requestAnimationFrame(clock.sync);

  const area0 = new Map(tiles.map((t) => [t, t.style.getPropertyValue('--area').trim()]));
  const CENTER = area0.get(tiles[0]);
  const slotOf = (a) => (a === CENTER ? 'center' : a.split('/').every((n) => +n !== 2) ? 'corner' : 'edge');
  let center = null; // the camera in the middle: the visor's held shot
  let c = null; // what hangs on it: its frame, the waves, the beat (rebuilt when the centre changes)

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
    geo.C = rel(c.frame);
    tiles.forEach((t) => cells.set(t, rel(t.querySelector('.wall-frame'))));
    const num = (name, fallback) => parseFloat(cs.getPropertyValue(name)) || fallback;
    geo.end = { inset: num('--wall-inset', 6), arm: num('--wall-arm', 14), bevel: num('--wall-ch', 8), pad: num('--wall-pad', 12) };
    sweep.style.top = `${grid.offsetTop}px`;
    sweep.style.height = `${grid.offsetHeight}px`;
    fly.layout(geo.V);
    sizePoints(el);
  }

  const proxy = { u: 0 };
  const draw = () => {
    const landed = fly.draw(proxy.u, geo);
    c.frame.style.opacity = landed ? '' : '0';
    grid.style.opacity = tall && proxy.u < 0.15 ? (proxy.u / 0.15).toFixed(3) : '';
  };

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  tl.to(proxy, { u: 1, duration: T.zoomFor, ease: 'none', onUpdate: draw }, T.zoom)
    .to({}, { duration: 0.01 }, T.end - 0.01);
  const zoomAt = (u) => T.zoom + u * T.zoomFor; // ease none: the zoom runs with the scroll, the scrub smooths it
  const land = zoomAt(1);
  const line = el.querySelector('.wall-line');
  const L = SWEEP ? 0.5 : 0;
  const kicker = printer(gsap, SplitText, el.querySelector('.wall-kicker'));
  const head = gsap.timeline({ paused: true });
  headSequence(gsap, SplitText, el, head, 0.1, 1, false);

  function cast(tile) {
    if (c?.center === tile) return;
    if (c) { c.ctx.revert(); c.center.classList.remove('is-on'); c.frame.style.opacity = ''; }
    center = tile;
    tiles.forEach((t) => {
      const a = t === tile ? CENTER : t === tiles[0] ? area0.get(tile) : area0.get(t);
      t.style.setProperty('--area', a);
      t.dataset.slot = slotOf(a);
      if (t === tile) t.dataset.center = ''; else delete t.dataset.center;
    });
    const shot = SHOTS.find((s) => s.id === tile.dataset.scene);
    fly.load(tile, shot);
    const at = (n) => tiles.find((t) => t.style.getPropertyValue('--area').trim() === area0.get(tiles[n - 1]));
    const CORNERS = [2, 4, 6, 8].map(at); // clockwise from the top left, by slot
    const EDGES = [3, 5, 7, 9].map(at);
    const others = tiles.filter((t) => t !== tile);
    c = { center: tile, frame: tile.querySelector('.wall-frame'), others };
    measure();
    draw();
    c.cornersAt = Math.max(...CORNERS.map((t) => zoomAt(Math.min(1, clearAt(geo.V, geo.C, cells.get(t)) + 0.01))));
    c.edgesAt = Math.max(land + 0.06, c.cornersAt + T.rest);
    c.beatAt = c.edgesAt + T.toBeat;
    c.ctx = gsap.context(() => {
      c.camPrint = gsap.timeline({ paused: true });
      printChip(c.camPrint, fly.cam, 0, 1);
      c.corners = gsap.timeline({ paused: true });
      CORNERS.forEach((t, i) => lightSequence(c.corners, t, i * WAVE.stagger, 1));
      gsap.set(tile.querySelector('.wall-sb'), { opacity: 0 });
      c.edges = gsap.timeline({ paused: true });
      lightSequence(c.edges, tile, 0, 1, { brackets: false, plate: false, cam: false });
      EDGES.forEach((t, i) => lightSequence(c.edges, t, i * WAVE.stagger, 1));
      c.beat = gsap.timeline({ paused: true });
      if (SWEEP) {
        c.beat.fromTo(sweep, { yPercent: 0 }, { yPercent: 100, duration: L, ease: 'none' }, 0)
          .fromTo(sweep, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: 'none' }, 0)
          .to(sweep, { opacity: 0, duration: 0.08, ease: 'none' }, L);
      }
      c.meterIn = meterLock(gsap, el, CAPTION + 0.16);
      c.hit = hitSequence(gsap, el, c.beat, L, {
        tiles: others, clock, total, line, meterIn: c.meterIn,
        target: () => c.frame.getBoundingClientRect(),
        gate: () => state[BEAT].armed,
        onHit: () => others.forEach((t) => t.classList.add('is-on')),
      });
      c.hands = others.flatMap((t) => [...t.querySelectorAll('.wall-hand')]);
      const hands = c.hands;
      const beat = c.beat;
      const hit = c.hit;
      const lks = others.flatMap((t) => [...t.querySelectorAll('.wall-lk')]);
      c.release = gsap.to([...hands, ...lks, total.root, ...(line ? [line] : [])], { opacity: 0, duration: 0.12, ease: 'none', paused: true, onComplete: () => { beat.pause(0); hit.reset(); gsap.set(hands, { opacity: 1 }); } });
      el.dataset.schedule = JSON.stringify({ camChip: T.camChip, corners: +c.cornersAt.toFixed(3), land, edges: +c.edgesAt.toFixed(3), beat: +c.beatAt.toFixed(3), hitFor: +c.hit.lastBone.toFixed(3), arrive: +c.hit.arrive.toFixed(3), caption: CAPTION, end: T.end, wave: WAVE, center: +tile.dataset.cam });
    });
    tile.classList.add('is-on'); // the centre is the visor's camera: its hands are tracked from the first pixel
    cues[1].at = c.cornersAt;
    cues[2].at = c.edgesAt;
    cues[3].at = c.beatAt;
  }

  const play = (t) => { t.timeScale(1).play(); };
  const back = (t) => { t.timeScale(WAVE.back).reverse(); }; // back to standby, three times faster than it came
  const cues = [
    { at: T.camChip, play: () => play(c.camPrint), back: () => back(c.camPrint) },
    { at: 0, play: () => play(c.corners), back: () => back(c.corners) },
    { at: 0, gap: WAVE.edges, play: () => { play(c.edges); kicker.play(); play(head); }, back: () => { back(c.edges); kicker.out(); back(head); } },
    {
      at: 0, gap: WAVE.beat,
      play: () => { c.release.pause(0); c.hit.reset(); gsap.set(c.hands, { opacity: 1 }); if (line) gsap.set(line, { opacity: 0, y: 12 }); c.beat.play(0); },
      back: () => { clock.setRate(1); c.meterIn.settle(); c.others.forEach((t) => t.classList.remove('is-on')); c.beat.pause(); gsap.set(sweep, { opacity: 0 }); c.release.invalidate().restart(); },
    },
  ];
  const BEAT = 3;
  const state = cues.map(() => ({ armed: false, t0: null, call: null }));
  const atStart = () => tl.time() === 0 && state.every((s) => !s.armed && s.t0 === null && !s.call);
  cast(tiles[0]);

  const now = () => gsap.ticker.time;
  function start(i) {
    const cue = cues[i];
    const s = state[i];
    if (!cue || !s.armed || s.t0 !== null || s.call) return;
    let at = now();
    if (cue.gap) {
      const prev = state[i - 1].t0;
      if (prev === null) return; // the one ahead has not started: it starts this one when it does
      at = Math.max(at, prev + cue.gap);
    }
    const go = () => { s.call = null; s.t0 = now(); cue.play(); start(i + 1); };
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
    cues.forEach((cue, i) => arm(i, t >= cue.at));
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
  const visorHold = (on) => {
    if (!visor) return;
    if (!on) {
      delete visor.dataset.hold;
      visor.dispatchEvent(new CustomEvent('visor:hold', { detail: { on: false } }));
      return;
    }
    const free = atStart();
    const detail = { on: true, index: free ? null : SHOTS.findIndex((s) => s.id === center.dataset.scene) };
    visor.dataset.hold = '';
    visor.dispatchEvent(new CustomEvent('visor:hold', { detail }));
    const k = Number.isInteger(detail.index) && detail.index >= 0 ? detail.index : 0; // no visor yet: it starts on shot 0
    visor.dataset.hold = String(k);
    if (free) cast(tiles.find((t) => t.dataset.scene === SHOTS[k]?.id) || tiles[0]);
  };
  const page = document.documentElement; // every trigger names an element (chapter tests look triggers up by theirs)
  const lift = ScrollTrigger.create({ trigger: page, start: 'top top-=1', end: 'bottom bottom', onToggle: (self) => visorHold(self.isActive) });
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hold = fine && gsap.fromTo(fly.root, { y: () => headerH() - innerHeight }, {
    y: 0, ease: 'none',
    scrollTrigger: { trigger: el, start: 'top bottom', end: () => `top ${headerH()}px`, scrub: true, invalidateOnRefresh: true, toggleClass: { targets: el, className: 'is-held' } },
  });
  const liftEnd = () => Math.max(1, Math.round(el.getBoundingClientRect().top + scrollY - headerH()));
  const still = fine && visor && gsap.fromTo(visor, { '--lift': '0px' }, {
    '--lift': () => `${liftEnd()}px`, ease: 'none',
    scrollTrigger: { trigger: page, start: 'top top', end: () => `+=${liftEnd()}`, scrub: true, invalidateOnRefresh: true },
  });
  const exits = fine ? [...document.querySelectorAll('#visor .hud, #visor .ruler, .hero-copy, .hero-side')].filter((n) => n.offsetParent).map((n) => gsap.fromTo(n, { opacity: 1 }, {
    opacity: 0, ease: 'none',
    scrollTrigger: { trigger: n, start: () => `top ${headerH() + 64}px`, end: () => `top ${headerH()}px`, scrub: true, invalidateOnRefresh: true },
  })) : [];
  warmImages(el, fly.img);
  return () => {
    for (const t of exits) { t.scrollTrigger?.kill(); t.revert?.(); t.kill(); }
    for (const t of [hold, still]) if (t) { t.scrollTrigger?.kill(); t.revert?.(); t.kill(); } // matchMedia may have reverted them already
    visor?.style.removeProperty('--lift');
    lift.kill();
    visorHold(false);
    st.kill();
    ScrollTrigger.removeEventListener('refreshInit', setPin);
    state.forEach((s) => s.call?.kill());
    c.ctx.revert();
    [tl, head].forEach((t) => t.kill());
    clock.setRate(1);
    fly.root.remove();
    sweep.remove();
    total.root.remove();
    c.frame.style.opacity = '';
    grid.style.opacity = '';
    el.classList.remove('is-stage', 'is-held');
    el.style.removeProperty('--wall-pb');
    el.style.removeProperty('--wall-pin');
    delete el.dataset.schedule;
    tiles.forEach((t) => { t.classList.remove('is-on'); t.style.setProperty('--area', area0.get(t)); delete t.dataset.slot; delete t.dataset.center; });
  };
}

function warmImages(el, flyImg) {
  const go = () => {
    const imgs = [flyImg(), ...el.querySelectorAll('.wall-plate img')];
    imgs.forEach((img) => { img.loading = 'eager'; });
    Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => { el.dataset.decoded = 'true'; });
  };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 300));
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
}

const heroAsset = (name) => new URL(`../../assets/hero/${name}`, import.meta.url).href;
function heroPicture(id) {
  const pic = document.createElement('picture');
  const set = (ext) => `${heroAsset(`${id}-land.${ext}`)} 1536w, ${heroAsset(`${id}-land@2x.${ext}`)} 2560w`;
  const src = Object.assign(document.createElement('source'), { type: 'image/avif', srcset: set('avif'), sizes: 'calc(100vw - 48px)' });
  const img = Object.assign(document.createElement('img'), { alt: '', width: 1536, height: 864, decoding: 'async', loading: 'eager', srcset: set('webp'), sizes: 'calc(100vw - 48px)', src: heroAsset(`${id}-land.webp`) });
  pic.append(src, img);
  return pic;
}

function buildFlyer() {
  const root = node('div', 'wall-fly');
  root.setAttribute('aria-hidden', 'true');
  const win = node('div', 'wall-fly-win');
  const plate = node('div', 'wall-fly-plate');
  win.append(plate);
  const bars = Array.from({ length: 8 }, (_, i) => node('i', `wall-fly-bar ${i % 2 ? 'v' : 'h'}`));
  const cam = node('span', 'chip mono wall-fly-cam');
  root.append(win, ...bars, cam);
  let base = 1;
  let fy = 0.5;
  let pts = null;
  let img = null;
  let V = null;

  function load(tile, shot) {
    fy = shot?.fy ?? 0.5;
    const pic = shot ? heroPicture(shot.id) : tile.querySelector('.wall-plate').cloneNode(true);
    pic.className = '';
    img = pic.querySelector('img');
    img.alt = '';
    img.decode?.().catch(() => {});
    pts = tile.querySelector('.wall-pts').cloneNode(true);
    pts.setAttribute('preserveAspectRatio', 'none');
    pts.classList.add('wall-fly-pts');
    pts.removeAttribute('style');
    pts.querySelectorAll('[style], [transform]').forEach((n) => { n.removeAttribute('style'); n.removeAttribute('transform'); });
    plate.replaceChildren(pic, pts);
    cam.innerHTML = tile.querySelector('.wall-cam')?.innerHTML || '';
    if (V) layout(V);
  }

  function layout(rect) {
    V = rect;
    win.style.width = `${V.w}px`;
    win.style.height = `${V.h}px`;
    base = coverMap(V.w, V.h, PLATE.w, PLATE.h, PLATE_ZOOM, fy).s;
    plate.style.width = `${PLATE.w * base}px`;
    plate.style.height = `${PLATE.h * base}px`;
  }

  function draw(u, { V, C, end }) {
    const R = rectAt(u, V, C);
    const ax = R.w / V.w;
    const ay = R.h / V.h;
    win.style.transform = `translate(${R.x.toFixed(2)}px, ${R.y.toFixed(2)}px) scale(${ax.toFixed(5)}, ${ay.toFixed(5)})`;
    const ch = lerp(VISOR.bevel, end.bevel, u);
    const cx = (ch / ax).toFixed(2);
    const cy = (ch / ay).toFixed(2);
    win.style.clipPath = `polygon(0 0, 100% 0, 100% calc(100% - ${cy}px), calc(100% - ${cx}px) 100%, ${cx}px 100%, 0 calc(100% - ${cy}px))`;
    const { s, ox, oy } = coverMap(R.w, R.h, PLATE.w, PLATE.h, lerp(PLATE_ZOOM, 1, u), lerp(fy, 0.5, u));
    plate.style.transform = `translate(${(ox / ax).toFixed(2)}px, ${(oy / ay).toFixed(2)}px) scale(${(s / base / ax).toFixed(5)}, ${(s / base / ay).toFixed(5)})`;
    pts.style.setProperty('--u', (1 / s).toFixed(4));
    pts.style.setProperty('--k', u.toFixed(4));
    pts.style.setProperty('--sc', (s / base).toFixed(5)); // the CSS scale on the points: strokes divide by it
    const i = lerp(VISOR.inset, end.inset, u);
    const a = lerp(VISOR.arm, end.arm, u);
    const k = (a / VISOR.arm).toFixed(4);
    const L = R.x + i;
    const Rt = R.x + R.w - i;
    const Tp = R.y + i;
    const B = R.y + R.h - i;
    const at = [[L, Tp], [L, Tp], [Rt - a, Tp], [Rt - 1.5, Tp], [L, B - 1.5], [L, B - a], [Rt - a, B - 1.5], [Rt - 1.5, B - a]];
    bars.forEach((b, n) => { b.style.transform = `translate(${at[n][0].toFixed(2)}px, ${at[n][1].toFixed(2)}px) ${n % 2 ? 'scaleY' : 'scaleX'}(${k})`; });
    const p = lerp(VISOR.hud, end.pad, u);
    cam.style.transform = `translate(${(R.x + p).toFixed(2)}px, ${(R.y + p).toFixed(2)}px)`;
    const landed = u >= 0.999;
    root.style.visibility = landed ? 'hidden' : '';
    return landed;
  }

  return { root, img: () => img, cam, load, layout, draw };
}

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

export function clearAt(V, C, R) {
  for (let i = 0; i <= 500; i++) {
    const u = i / 500;
    const A = rectAt(u, V, C);
    if (A.x + A.w <= R.x || R.x + R.w <= A.x || A.y + A.h <= R.y || R.y + R.h <= A.y) return u;
  }
  return 1;
}
