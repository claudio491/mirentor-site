import { loadGsap } from '../vendor.js';

export const SHIFT_MIN = 540; // 07:00 to 16:00
const START_MIN = 7 * 60;
const PLAY_MS = 4800; // lite: the whole shift in 4.8 s, linear (it is a clock)
const ROW_MS = 480; // narrow: one row's fill and count (matches the CSS transition)
const pad = (n) => String(n).padStart(2, '0');

export function countedAt(t, segs) {
  let m = 0;
  for (const s of segs) if (s.counts) m += Math.min(Math.max(t - s.a, 0), s.d);
  return m;
}

export function clockAt(t) {
  const m = Math.floor(START_MIN + t + 1e-6);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function hm(min) {
  const m = Math.floor(min + 1e-6);
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

export function init(el, { tier } = {}) {
  const fig = el.querySelector('[data-shift]');
  if (!fig || tier === 'still' || !('IntersectionObserver' in window)) return;
  const card = {
    fig,
    t: SHIFT_MIN,
    w: 0,
    ruler: fig.querySelector('.shift-ruler'),
    head: fig.querySelector('.shift-head'),
    clock: fig.querySelector('[data-clock]'),
    count: fig.querySelector('[data-count]'),
    segs: [...fig.querySelectorAll('.seg')].map((li) => ({
      li, a: Number(li.dataset.a), d: Number(li.dataset.d), counts: li.classList.contains('is-count'), fill: li.querySelector('.seg-fill'),
    })),
  };
  const wide = matchMedia('(min-width: 900px)');
  let stop = () => {};
  const setup = () => {
    stop();
    reset(card);
    card.ready = null;
    stop = !wide.matches ? rows(card) : tier === 'full' ? scrub(card) : play(card);
  };
  wide.addEventListener?.('change', setup);
  setup();
  return card.ready || undefined;
}

function reset(c) {
  delete c.fig.dataset.mode;
  c.fig.classList.remove('is-scan');
  for (const s of c.segs) {
    s.li.classList.remove('is-on', 'is-live');
    s.fill?.style.removeProperty('--f');
  }
  c.t = SHIFT_MIN;
  setText(c.clock, clockAt(SHIFT_MIN));
  setText(c.count, hm(countedAt(SHIFT_MIN, c.segs)));
}

function render(c, t) {
  t = Math.min(SHIFT_MIN, Math.max(0, t));
  if (SHIFT_MIN - t < 0.01) t = SHIFT_MIN;
  c.t = t;
  let scanning = false;
  for (const s of c.segs) {
    const f = Math.min(1, Math.max(0, (t - s.a) / s.d));
    if (s.fill) s.fill.style.setProperty('--f', f.toFixed(4));
    const live = t > s.a && t < s.a + s.d;
    s.li.classList.toggle('is-on', t > s.a);
    s.li.classList.toggle('is-live', live);
    if (live && s.counts) scanning = true;
  }
  c.fig.classList.toggle('is-scan', scanning);
  if (c.head) c.head.style.transform = `translateX(${((t / SHIFT_MIN) * c.w).toFixed(2)}px)`;
  setText(c.clock, clockAt(t));
  setText(c.count, hm(countedAt(t, c.segs)));
}

function measure(c) {
  c.w = c.ruler.clientWidth;
  const ro = new ResizeObserver(() => { c.w = c.ruler.clientWidth; render(c, c.t); });
  ro.observe(c.ruler);
  return ro;
}

function scrub(c) {
  c.fig.dataset.mode = 'scrub';
  const ro = measure(c);
  render(c, 0);
  let alive = true;
  let tween = null;
  let fallback = null;
  c.ready = loadGsap().then(({ gsap, ScrollTrigger }) => {
    if (!alive) return;
    const pin = c.fig.offsetHeight < innerHeight - 120;
    const proxy = { t: 0 };
    tween = gsap.to(proxy, {
      t: SHIFT_MIN,
      ease: 'none',
      onUpdate: () => render(c, proxy.t),
      scrollTrigger: {
        trigger: c.fig,
        start: pin ? 'center center' : 'top 70%',
        end: pin ? () => `+=${Math.round(innerHeight * 0.9)}` : 'bottom 30%',
        pin,
        scrub: 0.5,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  }).catch(() => { if (alive) { ro.disconnect(); fallback = play(c); } });
  return () => {
    alive = false;
    ro.disconnect();
    fallback?.();
    tween?.scrollTrigger?.kill(true);
    tween?.kill();
  };
}

function play(c) {
  c.fig.dataset.mode = 'play';
  const ro = measure(c);
  render(c, 0);
  let raf = 0;
  let t0 = 0;
  const step = (now) => {
    t0 ||= now;
    const t = ((now - t0) / PLAY_MS) * SHIFT_MIN;
    render(c, t);
    raf = t < SHIFT_MIN ? requestAnimationFrame(step) : 0;
  };
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    raf = requestAnimationFrame(step);
  }, { threshold: 0.5 });
  io.observe(c.fig);
  return () => { io.disconnect(); cancelAnimationFrame(raf); ro.disconnect(); };
}

function rows(c) {
  c.fig.dataset.mode = 'rows';
  let target = 0;
  let shown = 0;
  let from = 0;
  let t0 = 0;
  let raf = 0;
  setText(c.count, hm(0));
  const tick = (now) => {
    t0 ||= now;
    const k = Math.min(1, (now - t0) / ROW_MS);
    shown = from + (target - from) * k;
    setText(c.count, hm(shown));
    raf = k < 1 ? requestAnimationFrame(tick) : 0;
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const s = c.segs.find((x) => x.li === e.target);
      s.li.classList.add('is-on');
      if (!s.counts) continue;
      target += s.d;
      from = shown;
      t0 = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  for (const s of c.segs) io.observe(s.li);
  return () => { io.disconnect(); cancelAnimationFrame(raf); };
}
