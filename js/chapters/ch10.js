const NS = 'http://www.w3.org/2000/svg';
const RUN_MS = 9000; // one lap of the orbit's dash
const ORBIT = 96; // the orbit's radius past the big lens's rim; on small lenses 65% of their radius, so on a phone the

export function init(el, { tier } = {}) {
  const close = el.querySelector('.ch10-close');
  if (!close) return;
  const cluster = close.querySelector('.ch10-cluster');
  const track = close.querySelector('.ch10-track');
  const motto = close.querySelector('.ch10-motto');
  if (!cluster || !track || !motto) return;
  const still = tier === 'still';
  if (!still) split(motto);
  let frame = 0, run = null, seen = false;
  const draw = () => {
    frame = 0;
    run = orbit(cluster, track, motto, still);
    if (run && !seen) run.pause();
  };
  const later = () => { if (!frame) frame = requestAnimationFrame(draw); };
  draw();
  if ('ResizeObserver' in window) new ResizeObserver(later).observe(close); else addEventListener('resize', later, { passive: true });
  document.fonts?.ready.then(later);
  if (still || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    if (run) seen ? run.play() : run.pause();
  }).observe(close);
  const r = close.getBoundingClientRect();
  if (r.top < innerHeight && r.bottom > 0) return; // already in view: final state, no replay
  close.classList.add('is-armed');
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    close.classList.add('is-in');
  }, { rootMargin: '0px 0px -18% 0px' });
  io.observe(close);
}

function split(motto) {
  let i = 0;
  for (const line of motto.querySelectorAll('.ch10-ln')) {
    const words = line.textContent.trim().split(/\s+/);
    line.replaceChildren(...words.flatMap((w, k) => {
      const mask = Object.assign(document.createElement('span'), { className: 'ch10-w' });
      const word = Object.assign(document.createElement('span'), { textContent: w });
      word.style.setProperty('--i', String(i++));
      mask.append(word);
      return k < words.length - 1 ? [mask, document.createTextNode(' ')] : [mask];
    }));
  }
}

function orbit(cluster, track, motto, still) {
  const box = cluster.getBoundingClientRect();
  const big = cluster.querySelector('.ch10-lens');
  if (!box.width || !box.height || !big) return null;
  track.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  const svg = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const r = big.offsetWidth / 2; // layout size: the lenses scale while they open
  const cx = big.offsetLeft + r, cy = big.offsetTop + r, rad = r + Math.min(ORBIT, r * 0.65);
  const per = 2 * Math.PI * rad;
  const top = motto.getBoundingClientRect().top - box.top - 28;
  const clip = svg('clipPath', { id: 'ch10-above' });
  clip.append(svg('rect', { x: -200, y: -200, width: box.width + 400, height: Math.max(0, top + 200) }));
  const g = svg('g', { 'clip-path': 'url(#ch10-above)' });
  const run = svg('circle', { class: 'ch10-run', cx, cy, r: rad, 'stroke-dasharray': `${per * 0.12} ${per}` });
  g.append(svg('circle', { class: 'ch10-orbit', cx, cy, r: rad }), run);
  track.replaceChildren(clip, g);
  if (still || !('animate' in run)) return null;
  return run.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -per }], { duration: RUN_MS, iterations: Infinity });
}
