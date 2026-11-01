import { loadGsap } from '../vendor.js';

const NS = 'http://www.w3.org/2000/svg';
const r1 = (n) => Math.round(n * 10) / 10;
const FILL = 1.2; // s: the hour fills, 0 to 60 minutes (track)
const LOCK = 0.16; // s: a point or a viewfinder locks (lock)
const RIDE = 0.7; // s: a point rides its stream (track)
const GAP = 0.1; // s: between the three points
const LAP = 3.6; // s: one lap of the ring, at constant speed
const LIT_MS = 400; // a node stays lit this long after the dot passes it, then goes out in 320 ms (CSS)
const ENTRANCE_MS = 1000; // the ring's entrance (CSS) is over and the dot may start
const ABOVE = '100000px'; // trigger margin above the viewport: a piece the reader has already passed counts as reached

export function route(points, r = 12) {
  const p = points.reduce((acc, q) => {
    const last = acc[acc.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.5) acc.push(q);
    return acc;
  }, []);
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, ay] = p[i - 1];
    const [bx, by] = p[i];
    const [cx, cy] = p[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay);
    const l2 = Math.hypot(cx - bx, cy - by);
    const k = Math.min(r, l1 / 2, l2 / 2);
    d += `L${r1(bx - ((bx - ax) / l1) * k)} ${r1(by - ((by - ay) / l1) * k)}`;
    d += `Q${r1(bx)} ${r1(by)} ${r1(bx + ((cx - bx) / l2) * k)} ${r1(by + ((cy - by) / l2) * k)}`;
  }
  const z = p[p.length - 1];
  return `${d}L${r1(z[0])} ${r1(z[1])}`;
}

export function longestFirst(lengths) {
  return lengths.map((_, i) => i).sort((a, b) => (Math.abs(lengths[b] - lengths[a]) > 2 ? lengths[b] - lengths[a] : a - b));
}

function box(el, o) {
  const b = el.getBoundingClientRect();
  return { l: b.left - o.left, r: b.right - o.left, t: b.top - o.top, b: b.bottom - o.top, cx: (b.left + b.right) / 2 - o.left, cy: (b.top + b.bottom) / 2 - o.top };
}

function shape(svg, tag, cls) {
  const s = document.createElementNS(NS, tag);
  s.setAttribute('class', cls);
  if (tag === 'path') s.setAttribute('pathLength', '1');
  else s.setAttribute('r', '4.5');
  svg.appendChild(s);
  return s;
}

function fit(svg, host) {
  svg.setAttribute('viewBox', `0 0 ${host.clientWidth} ${host.clientHeight}`);
}

function drawStreams(split, s) {
  fit(s.svg, split);
  const o = split.getBoundingClientRect();
  const hour = box(split.querySelector('.ch04-hour'), o);
  const ruler = box(split.querySelector('.ch04-ruler'), o);
  const list = box(split.querySelector('.ch04-shares'), o);
  const figs = s.figs.map((f) => box(f, o));
  if (figs.length !== s.lines.length) return;
  const across = hour.r < figs[0].l;
  let start;
  let legs;
  if (across) {
    const sy = figs[1].cy >= ruler.t + 4 && figs[1].cy <= ruler.b - 4 ? figs[1].cy : ruler.cy;
    const xm = (hour.r + figs[0].l) / 2;
    start = [ruler.r, sy];
    legs = figs.map((f) => [start, [xm, sy], [xm, f.cy], [f.l, f.cy]]);
  } else {
    const xr = (ruler.r + hour.r) / 2;
    const by = (hour.b + list.t) / 2;
    const tx = figs[0].l - 28;
    start = [ruler.r, ruler.cy];
    legs = figs.map((f) => [start, [xr, ruler.cy], [xr, by], [tx, by], [tx, f.cy], [f.l, f.cy]]);
  }
  legs.forEach((pts, i) => {
    s.lines[i].setAttribute('d', route(pts, across ? 16 : 10));
    s.joints[i].setAttribute('cx', r1(figs[i].l));
    s.joints[i].setAttribute('cy', r1(figs[i].cy));
  });
  s.root.setAttribute('cx', r1(start[0]));
  s.root.setAttribute('cy', r1(start[1]));
}

function ride(line, joint, v) {
  const p = line.getPointAtLength(v * line.getTotalLength());
  joint.style.transform = `translate(${r1(p.x - +joint.getAttribute('cx'))}px, ${r1(p.y - +joint.getAttribute('cy'))}px)`;
  line.style.strokeDashoffset = String(1 - v);
}

const minutes = (v) => String(Math.round(v)).padStart(2, '0');

function playHour(gsap, split, s, done) {
  const m = { v: 0 };
  const tl = gsap.timeline({ onComplete: done });
  tl.to(m, {
    v: 60, duration: FILL, ease: 'track',
    onUpdate: () => {
      const p = m.v / 60;
      s.fill.style.clipPath = `inset(-4px calc(${(100 - p * 100).toFixed(3)}% - ${(4 * p).toFixed(3)}px) -4px -4px)`;
      s.count.textContent = minutes(m.v);
    },
  });
  tl.call(() => { s.fill.style.clipPath = 'none'; s.count.textContent = '60'; split.classList.add('is-full'); }, null, FILL);
  longestFirst(s.lines.map((l) => l.getTotalLength())).forEach((i, n) => {
    const q = { v: 0 };
    tl.to(q, {
      v: 1, duration: RIDE, ease: 'track',
      onStart: () => { s.joints[i].style.opacity = '1'; ride(s.lines[i], s.joints[i], 0); },
      onUpdate: () => ride(s.lines[i], s.joints[i], q.v),
      onComplete: () => { s.joints[i].style.transform = 'none'; s.shares[i].dataset.arrived = ''; },
    }, FILL + LOCK + n * GAP);
  });
  tl.to({}, { duration: LOCK }); // the last viewfinder locks
}

function settleHour(split, s) {
  split.classList.remove('is-armed');
  s.fill.style.clipPath = '';
  s.count.textContent = '60';
  for (const c of [s.root, ...s.joints]) { c.style.opacity = ''; c.style.transform = ''; }
  for (const l of s.lines) l.style.strokeDashoffset = '';
  s.shares.forEach((li) => { li.dataset.arrived = ''; });
}

function ring(loop, gsapNow) {
  const svg = loop.querySelector('.ch04-ring-svg');
  const track = loop.querySelector('.ch04-ring');
  const items = [...loop.querySelectorAll('.ch04-loop-list li')];
  if (!svg || !track || items.length !== 3) return null;
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('class', 'ch04-ring-dot');
  dot.setAttribute('r', '6');
  dot.style.opacity = '0';
  svg.appendChild(dot);
  const pos = { f: 0 };
  const timers = [];
  let geo = null;
  let last = null;
  let tween = null;
  let ready = false;
  let seen = false;

  const light = (k) => {
    items[k].classList.add('is-lit');
    clearTimeout(timers[k]);
    timers[k] = setTimeout(() => items[k].classList.remove('is-lit'), LIT_MS);
  };
  const place = () => {
    if (!geo) return;
    const g = (geo.at[0] + pos.f) % 1; // the lap starts on the first step
    const a = g * 2 * Math.PI;
    dot.style.transform = `translate(${r1(geo.cx + geo.r * Math.sin(a))}px, ${r1(geo.cy - geo.r * Math.cos(a))}px)`;
    if (last !== null) {
      const run = (g - last + 1) % 1;
      geo.at.forEach((n, k) => { const to = (n - last + 1) % 1; if (to > 0 && to <= run) light(k); });
    }
    last = g;
  };
  const measure = () => {
    const b = svg.getBoundingClientRect();
    if (!b.width) return;
    const cx = b.width / 2;
    const cy = b.height / 2;
    const at = items.map((li) => {
      const n = li.querySelector('.ch04-pt').getBoundingClientRect();
      const x = n.left + n.width / 2 - b.left - cx;
      const y = n.top + n.height / 2 - b.top - cy;
      return (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1; // clockwise from the top
    });
    geo = { cx, cy, r: track.getBBox().width / 2, at };
    if (tween) { last = null; place(); }
  };
  const sync = () => {
    if (!tween) return;
    if (ready && seen) {
      if (tween.paused()) {
        if (!loop.classList.contains('is-live')) { loop.classList.add('is-live'); place(); light(0); }
        dot.style.opacity = '1';
        tween.play();
      }
    } else if (!tween.paused()) {
      tween.pause();
      items.forEach((li, k) => { clearTimeout(timers[k]); li.classList.remove('is-lit'); });
    }
  };
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); }).observe(loop.querySelector('.ch04-ring-box') || svg);
  measure();
  return {
    measure,
    start() {
      if (ready) return;
      ready = true;
      gsapNow().then((gsap) => {
        tween = gsap.to(pos, { f: 1, duration: LAP, ease: 'none', repeat: -1, paused: true, onUpdate: place });
        sync();
      }).catch(() => {});
    },
  };
}

function reach(el, line, { arm, play, settle }) {
  if (el.getBoundingClientRect().top < innerHeight) { settle(); return; }
  arm();
  const io = new IntersectionObserver((entries) => {
    const e = entries.find((x) => x.isIntersecting);
    if (!e) return;
    io.disconnect();
    if (e.boundingClientRect.bottom < 0) settle(); else play();
  }, { rootMargin: `${ABOVE} 0px ${line} 0px` });
  io.observe(el);
}

export function init(el, { tier } = {}) {
  const split = el.querySelector('.ch04-split');
  const band = el.querySelector('.ch04-band');
  const loop = el.querySelector('.ch04-loop');
  if (!split || !band || !loop) return;

  const svg = split.querySelector('.ch04-streams');
  const s = {
    svg,
    fill: split.querySelector('.ch04-ruler-fill'),
    count: split.querySelector('.ch04-count b'),
    figs: [...split.querySelectorAll('.ch04-share .ch04-fig')],
    shares: [...split.querySelectorAll('.ch04-share')],
    lines: [0, 1, 2].map(() => shape(svg, 'path', 'ln')),
  };
  s.root = shape(svg, 'circle', 'ch04-root');
  s.joints = [0, 1, 2].map(() => shape(svg, 'circle', 'jt'));

  let gsap = null;
  const gsapNow = () => (gsap ??= loadGsap().then((g) => g.gsap));
  const still = tier === 'still' || !('IntersectionObserver' in window);
  const lap = still ? null : ring(loop, gsapNow);
  const layout = () => { drawStreams(split, s); lap?.measure(); };
  layout();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(layout);
    ro.observe(split);
    ro.observe(loop);
  } else {
    addEventListener('resize', layout);
  }
  document.fonts?.ready.then(layout);

  const hour = {
    arm: () => { split.classList.add('is-armed'); s.count.textContent = '00'; },
    play: () => gsapNow().then((g) => playHour(g, split, s, () => settleHour(split, s))).catch(() => settleHour(split, s)),
    settle: () => settleHour(split, s),
  };
  const rule = { arm: () => band.classList.add('is-armed'), play: () => band.classList.add('is-on'), settle: () => band.classList.remove('is-armed') };
  const cycle = {
    arm: () => loop.classList.add('is-armed'),
    play: () => {
      loop.classList.add('is-on');
      setTimeout(() => { loop.classList.remove('is-armed', 'is-on'); lap?.start(); }, ENTRANCE_MS);
    },
    settle: () => { loop.classList.remove('is-armed'); lap?.start(); },
  };
  if (still) {
    for (const piece of [hour, rule, cycle]) piece.settle();
    loop.querySelectorAll('.ch04-loop-list li').forEach((li) => li.classList.add('is-lit')); // every node lit, nothing runs
  } else {
    reach(split, '-30%', hour); // the hour plays when the diagram's top reaches 70% of the viewport
    reach(band, '-20%', rule);
    reach(loop, '-20%', cycle);
  }
  el.dataset.ready = 'true';
}
