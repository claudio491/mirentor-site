const EASE_TRACK = 'cubic-bezier(0.2, 0.8, 0.2, 1)'; // the brand's track curve: a line draws like a bone
const EASE_LOCK = 'cubic-bezier(0.34, 1.56, 0.64, 1)'; // the brand's lock curve: a point or a corner locks
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const D_JOINT = 160; // --d-joint: a joint locks
const D_BONE = 320; // --d-bone: a bone draws
const D_STAGGER = 60; // --d-stagger: bones reached together draw one after another
const LINE = 0.6; // a step counts as reached once its joint is above 60% of the viewport height
const DRAW_MS = [700, 700, 360, 480, 360, 360, 480, 600, 360];
const STAGGER = 110;
const TYPE_MS = 14; // a label prints one character every 14 ms, as the HUD does
const VF_OUT = 12; // the viewfinder's corners lock from 12 units out, as the page's viewfinder does (motion.js)
const ring = (i) => (i === 0 ? 0 : ((i - 1) % 4) + 1);

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
  const tips = 'animate' in Element.prototype ? steps.slice(0, -1).map((s) => {
    const t = Object.assign(document.createElement('i'), { className: 'ch02-tip' });
    t.setAttribute('aria-hidden', 'true');
    return s.appendChild(t);
  }) : [];
  const riding = new Map();
  let shown = -1;
  let frame = 0;
  const apply = (n) => {
    if (n === shown) return;
    const was = shown < 0 ? n : shown;
    shown = n;
    let k = 0;
    steps.forEach((s, i) => {
      const drawn = i < n - 1; // the bone from step i to step i + 1
      const grows = drawn && i >= was - 1;
      const at = grows ? k++ * D_STAGGER : 0;
      s.style.setProperty('--bone-at', `${at}ms`);
      steps[i + 1]?.style.setProperty('--lock-at', `${grows ? at + D_BONE : 0}ms`);
      s.classList.toggle('is-reached', i < n);
      s.classList.toggle('is-current', i === n - 1);
      s.classList.toggle('is-done', drawn);
      if (grows) ride(i, at); else if (!drawn) drop(i);
    });
  };
  const ride = (i, at) => {
    const tip = tips[i];
    if (!tip) return;
    drop(i);
    const s = steps[i], css = getComputedStyle(s, '::after'); // also starts the bone's transition, read just below
    const length = s.offsetHeight - parseFloat(css.top) - parseFloat(css.bottom);
    const dot = tip.animate([
      { transform: 'translateY(0)', opacity: 1, easing: EASE_TRACK },
      { transform: `translateY(${length}px)`, opacity: 1, offset: D_BONE / (D_BONE + D_JOINT), easing: EASE_OUT },
      { transform: `translateY(${length}px)`, opacity: 0 },
    ], { duration: D_BONE + D_JOINT, delay: at });
    riding.set(i, dot);
    const bone = s.getAnimations({ subtree: true }).find((a) => a.effect?.target === s && a.effect.pseudoElement === '::after' && a.transitionProperty === 'transform');
    bone?.ready.then(() => { if (riding.get(i) === dot && bone.startTime !== null) dot.startTime = bone.startTime; }).catch(() => {});
  };
  const drop = (i) => { riding.get(i)?.cancel(); riding.delete(i); };
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
  const corners = splitFrame(kit);
  const calls = [...kit.querySelectorAll('.ch02-call')].map(spell);
  kit.classList.add('is-armed');
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    play(kit, corners, calls);
  }, { threshold: 0.35 });
  io.observe(kit);
}

function splitFrame(kit) {
  const frame = kit.querySelector('svg path.k-ln[data-g="6"]');
  const parts = frame?.getAttribute('d').match(/M[^M]+/g) || [];
  if (parts.length !== 4) return [];
  const at = parts.map((d) => d.match(/-?[\d.]+/g).map(Number).slice(2, 4));
  const cx = at.reduce((s, p) => s + p[0], 0) / 4, cy = at.reduce((s, p) => s + p[1], 0) / 4;
  const corners = parts.map((d, i) => {
    const c = frame.cloneNode();
    c.setAttribute('d', d);
    c.classList.add('k-vf');
    c.dataset.dx = String(Math.sign(at[i][0] - cx));
    c.dataset.dy = String(Math.sign(at[i][1] - cy));
    return c;
  });
  frame.replaceWith(...corners);
  return corners;
}

function spell(call) {
  call.replaceChildren(...Array.from(call.textContent, (ch) => Object.assign(document.createElement('span'), { className: 'ch02-ch', textContent: ch })));
  call.classList.add('is-typing');
  return call;
}

function play(kit, corners, calls) {
  const parts = [...kit.querySelectorAll('svg [data-g]')].filter((p) => !p.classList.contains('k-vf'));
  const hand = [...kit.querySelectorAll('svg circle.k-joint')]; // 21 points a hand, wrist first, as tracked
  kit.classList.remove('is-armed');
  let end = 0;
  for (const p of parts) {
    const g = +p.dataset.g;
    const delay = g * STAGGER;
    if (p.classList.contains('k-ln')) {
      const ms = DRAW_MS[g] ?? 480;
      p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: ms, delay, easing: EASE_TRACK, fill: 'backwards' });
      end = Math.max(end, delay + ms);
    } else if (p.tagName === 'circle') {
      const i = hand.indexOf(p);
      const at = delay + 240 + (i < 0 ? 0 : ring(i % 21) * D_STAGGER);
      p.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: D_JOINT, delay: at, easing: EASE_LOCK, fill: 'backwards' });
      end = Math.max(end, at + D_JOINT);
    } else {
      p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: delay + 240, easing: EASE_OUT, fill: 'backwards' });
    }
  }
  corners.forEach((c) => c.animate([
    { transform: `translate(${c.dataset.dx * VF_OUT}px, ${c.dataset.dy * VF_OUT}px)`, opacity: 0 },
    { transform: 'translate(0px, 0px)', opacity: 1 },
  ], { duration: D_JOINT, delay: end, easing: EASE_LOCK, fill: 'backwards' }));
  print(calls, end);
}

function print(calls, at) {
  let t = at;
  calls.forEach((call, k) => {
    const chars = [...call.querySelectorAll('.ch02-ch')];
    if (!chars.length) return;
    const ends = chars.map((ch) => ch.offsetLeft + ch.offsetWidth); // where the cursor stands after each letter
    const run = chars.length * TYPE_MS;
    const cur = Object.assign(document.createElement('i'), { className: 'ch02-cur' });
    call.appendChild(cur);
    chars.forEach((ch, i) => ch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: t + i * TYPE_MS, fill: 'backwards' }));
    const x = (i) => `translateX(${ends[i]}px)`;
    const moves = cur.animate([
      ...ends.map((_, i) => ({ transform: x(i), opacity: 1, offset: i / chars.length, easing: 'steps(1, end)' })),
      { transform: x(ends.length - 1), opacity: 1 },
    ], { duration: run, delay: t });
    const gone = k < calls.length - 1 ? moves : cur.animate([
      { transform: x(ends.length - 1), opacity: 1 }, { transform: x(ends.length - 1), opacity: 1, offset: 0.5 },
      { transform: x(ends.length - 1), opacity: 0, offset: 0.5 }, { transform: x(ends.length - 1), opacity: 0 },
    ], { duration: 420, iterations: 2, delay: t + run });
    moves.finished.then(() => call.classList.remove('is-typing')).catch(() => {});
    gone.finished.then(() => cur.remove()).catch(() => {});
    t += run + D_STAGGER;
  });
}
