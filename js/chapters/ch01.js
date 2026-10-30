// ch01.js: Chapter 01 "Qué compran los laboratorios". The "Espejo": the almacén plate, the plate dimmed, the hand
// points alone, then the points glide onto a robot's two hands. The four figures are server-rendered with their final
// points, so the chapter reads without JS. Full tier (wide and tall enough): one pinned stage scrubbed over 250% of a
// viewport (GSAP ScrollTrigger; the camera wall above pins first and refreshes first). Lite: each figure locks on once
// as it enters and the fourth glides from the worker's hands to the robot's. Still: final states, nothing moves.
import { loadGsap } from '../vendor.js';

const STAGE_MQ = '(min-width: 900px) and (min-height: 640px)';
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
// MediaPipe hand topology, as in the hero overlay.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const SPREAD = 0.3; // share of the glide over which the joints set off: wrist first, fingertips last

/** The brand's --ease-move, cubic-bezier(0.65, 0, 0.35, 1). */
const easeMove = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The hands drawn in one figure: joints, bone path and their baked coordinates. */
function handsOf(beat) {
  return [...beat.querySelectorAll('.ch01-hand')].map((g) => {
    const joints = [...g.querySelectorAll('.ch01-j')];
    return { joints, bone: g.querySelector('.ch01-bone'), pts: joints.map((c) => [+c.getAttribute('cx'), +c.getAttribute('cy')]) };
  });
}

/** Draws the hands at progress p (0 to 1) of the glide from one set of points to the other. */
export function glideTo(hands, from, to, p) {
  hands.forEach((h, k) => {
    const pts = from[k].map(([x0, y0], i) => {
      const t = easeMove(Math.min(1, Math.max(0, (p - (i / 20) * SPREAD) / (1 - SPREAD))));
      return [x0 + (to[k][i][0] - x0) * t, y0 + (to[k][i][1] - y0) * t];
    });
    pts.forEach(([x, y], i) => { h.joints[i].setAttribute('cx', x.toFixed(1)); h.joints[i].setAttribute('cy', y.toFixed(1)); });
    h.bone.setAttribute('d', BONES.map(([a, b]) => `M${pts[a][0].toFixed(1)} ${pts[a][1].toFixed(1)}L${pts[b][0].toFixed(1)} ${pts[b][1].toFixed(1)}`).join(''));
  });
}

export function init(el, { tier }) {
  const beats = [...el.querySelectorAll('.ch01-beat')];
  if (beats.length !== 4) return;
  const human = handsOf(beats[2]).map((h) => h.pts);
  const robot = handsOf(beats[3]).map((h) => h.pts);
  if (human.length !== 2 || robot.length !== 2) return;
  el.dataset.tier = tier;
  if (tier === 'still') { el.dataset.mode = 'still'; el.dataset.ready = 'true'; return; }
  if (tier === 'full' && matchMedia(STAGE_MQ).matches) {
    // Returned so main.js waits for the pin: it adds 250% of a viewport and moves everything below it.
    return stage(el, beats, human, robot).catch(() => { el.classList.remove('is-stage'); lite(el, beats, human, robot); });
  }
  lite(el, beats, human, robot);
}

/* Lite: one lock-on per figure as it enters (joints, then bones); the robot figure then glides once. */
function lite(el, beats, human, robot) {
  el.dataset.mode = 'lite';
  if (typeof el.animate !== 'function' || !('IntersectionObserver' in window)) { el.dataset.ready = 'true'; return; }
  const robotHands = handsOf(beats[3]);
  glideTo(robotHands, human, robot, 0); // the robot figure starts on the worker's hands
  el.classList.add('is-armed');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const played = lockOn(e.target);
      if (e.target === beats[3]) played.then(() => wait(240)).then(() => glide(robotHands, human, robot, 1400)).then(() => { el.dataset.glided = 'true'; });
    }
  }, { threshold: 0.5 });
  beats.forEach((b) => io.observe(b));
  el.dataset.ready = 'true';
}

function lockOn(beat) {
  beat.classList.add('is-played');
  const anims = [];
  beat.querySelectorAll('.ch01-hand').forEach((g, k) => {
    const at = 120 + k * 90;
    g.querySelectorAll('.ch01-j').forEach((j, i) => anims.push(j.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 160, delay: at + i * 14, easing: EASE_OUT, fill: 'backwards' })));
    anims.push(g.querySelector('.ch01-bone').animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: 240, delay: at + 21 * 14, easing: EASE_OUT, fill: 'backwards' }));
  });
  return Promise.all(anims.map((a) => a.finished.catch(() => {})));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function glide(hands, from, to, ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      glideTo(hands, from, to, p);
      if (p < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/* Full: the pinned, scrubbed stage. Timeline units: beat 1 holds to 1.2; beat 2 (plate dims) 1.2 to 2.2; beat 3
   (plate gone) 3.2 to 4.2; the glide 4.8 to 7.4; the robot plate comes up under the settled points 7.1 to 8.2;
   hold to 10. */
async function stage(el, beats, human, robot) {
  const { gsap, ScrollTrigger } = await loadGsap();
  // A reader who has already scrolled to the chapter, or past it, before the scripts arrive keeps it as it is: a pin
  // built now would move what they are reading by 250% of a viewport (as on the camera wall, js/chapters/wall.js).
  // At the top nothing has moved yet, and a deep link (#hash) lands again once the page has settled (main.js).
  if (scrollY > 0 && location.hash.length <= 1 && el.getBoundingClientRect().top < innerHeight) {
    lite(el, beats, human, robot);
    return;
  }
  const stageEl = el.querySelector('.ch01-stage');
  const fill = el.querySelector('.ch01-rail-fill');
  const steps = [...el.querySelectorAll('.ch01-rail li')];
  const frames = beats.map((b) => b.querySelector('.ch01-frame'));
  const caps = beats.map((b) => b.querySelector('.ch01-cap'));
  const chips = beats.map((b) => b.querySelector('.ch01-chip'));
  const moving = handsOf(beats[2]);

  const setStep = (n) => {
    if (el.dataset.step === String(n)) return;
    el.dataset.step = String(n);
    steps.forEach((s, i) => s.classList.toggle('is-on', i < n));
  };

  const mm = gsap.matchMedia();
  mm.add(STAGE_MQ, () => {
    el.classList.add('is-stage');
    el.dataset.mode = 'stage';
    setStep(1);
    const glider = { p: 0 };
    gsap.set([...frames.slice(1), ...caps.slice(1)], { opacity: 0 });
    gsap.set(fill, { scaleY: 0, transformOrigin: '50% 0%' });
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: stageEl, start: 'top top', end: '+=250%', pin: true, scrub: 0.6, anticipatePin: 1, refreshPriority: 1, invalidateOnRefresh: true },
      onUpdate: () => { const t = tl.time(); setStep(t < 1.7 ? 1 : t < 3.7 ? 2 : t < 5 ? 3 : 4); },
    });
    tl.to(fill, { scaleY: 1 / 3, duration: 1 }, 1.2)
      // 2: the plate dims to 40% and loses its color; points and bones stay at full strength
      .to(caps[0], { opacity: 0, duration: 0.4 }, 1.2)
      .to(frames[1], { opacity: 1, duration: 1 }, 1.2)
      .to(caps[1], { opacity: 1, duration: 0.5 }, 1.7)
      .set(frames[0], { opacity: 0 }, 2.2) // a covered frame is hidden so its anti-aliased edge never shows
      // 3: the plate is gone, the points remain on graphite
      .to(fill, { scaleY: 2 / 3, duration: 1 }, 3.2)
      .to([caps[1], chips[0], chips[1]], { opacity: 0, duration: 0.4 }, 3.2)
      .to(frames[2], { opacity: 1, duration: 1 }, 3.2)
      .fromTo(chips[2], { opacity: 0 }, { opacity: 1, duration: 0.5 }, 3.7)
      .to(caps[2], { opacity: 1, duration: 0.5 }, 3.7)
      .set(frames[1], { opacity: 0 }, 4.2)
      // 4: the points glide and settle on the robot's hands, then the robot plate comes up under them
      .to(fill, { scaleY: 1, duration: 3.2 }, 4.8)
      .to(caps[2], { opacity: 0, duration: 0.4 }, 4.8)
      .to(caps[3], { opacity: 1, duration: 0.5 }, 5.3)
      .to(glider, { p: 1, duration: 2.6, onUpdate: () => glideTo(moving, human, robot, glider.p) }, 4.8)
      .to(chips[2], { opacity: 0, duration: 0.4 }, 7)
      .to(frames[3], { opacity: 1, duration: 1.1 }, 7.1)
      .fromTo(chips[3], { opacity: 0 }, { opacity: 1, duration: 0.5 }, 7.8)
      .set(frames[2], { opacity: 0 }, 8.2)
      .to({}, { duration: 1.8 }, 8.2);
    el.dataset.ready = 'true';
    return () => {
      el.classList.remove('is-stage');
      el.dataset.mode = 'stack';
      glideTo(moving, human, human, 1);
      steps.forEach((s) => s.classList.remove('is-on'));
      delete el.dataset.step;
    };
  });
  if (!el.classList.contains('is-stage')) { el.dataset.mode = 'stack'; el.dataset.ready = 'true'; }
  ScrollTrigger.refresh();
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
