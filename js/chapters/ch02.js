const EASE_TRACK = 'cubic-bezier(0.2, 0.8, 0.2, 1)'; // the brand's track curve: a line draws like a bone
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const LINE = 0.6; // a step counts as reached once its number is above 60% of the viewport height
const DRAW_MS = [700, 700, 360, 480, 360, 360, 480, 600, 360];
const STAGGER = 110;

export function init(el, { tier } = {}) {
  const kit = el.querySelector('.ch02-kit');
  const list = el.querySelector('.ch02-steps');
  if (kit) keepStroke(kit);
  if (tier === 'still') return;
  if (list) rail(el, list);
  if (kit) drawOnEnter(kit);
}

function keepStroke(kit) {
  const svg = kit.querySelector('svg');
  if (!svg) return;
  const set = () => {
    const w = svg.getBoundingClientRect().width;
    if (w) svg.style.setProperty('--u', (svg.viewBox.baseVal.width / w).toFixed(4));
  };
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(svg);
}

function rail(el, list) {
  const steps = [...list.querySelectorAll('.ch02-step')];
  const nums = steps.map((s) => s.querySelector('.ch02-n'));
  let shown = -1;
  let frame = 0;
  const apply = (n) => {
    if (n === shown) return;
    shown = n;
    steps.forEach((s, i) => {
      s.classList.toggle('is-reached', i < n);
      s.classList.toggle('is-current', i === n - 1);
      s.classList.toggle('is-done', i < n - 1);
    });
  };
  const measure = () => {
    frame = 0;
    const line = innerHeight * LINE;
    apply(nums.filter((n) => n.getBoundingClientRect().top < line).length);
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };

  el.classList.add('is-live', 'no-trans');
  measure();
  void el.offsetHeight;
  el.classList.remove('no-trans');

  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) {
      addEventListener('scroll', onScroll, { passive: true });
      addEventListener('resize', onScroll, { passive: true });
    } else {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    }
    measure();
  }, { rootMargin: '25% 0px' });
  io.observe(el);
}

function drawOnEnter(kit) {
  const r = kit.getBoundingClientRect();
  if (r.top < innerHeight && r.bottom > 0) return; // already in view: final state, no replay
  if (!('animate' in Element.prototype) || !('IntersectionObserver' in window)) return;
  kit.classList.add('is-armed');
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    play(kit);
  }, { threshold: 0.35 });
  io.observe(kit);
}

function play(kit) {
  const parts = [...kit.querySelectorAll('svg [data-g]')];
  const calls = [...kit.querySelectorAll('.ch02-call')];
  const last = Math.max(...parts.map((p) => +p.dataset.g));
  kit.classList.remove('is-armed');
  for (const p of parts) {
    const g = +p.dataset.g;
    const delay = g * STAGGER;
    if (p.classList.contains('k-ln')) {
      p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: DRAW_MS[g] ?? 480, delay, easing: EASE_TRACK, fill: 'backwards' });
    } else {
      p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: delay + 240, easing: EASE_OUT, fill: 'backwards' });
    }
  }
  const start = last * STAGGER + 240;
  calls.forEach((c, i) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: start + i * 60, easing: EASE_OUT, fill: 'backwards' }));
}
