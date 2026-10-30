import { SHOTS, SHOT_MS } from './shots.js';
import { counters } from './clock.js';
import { drawShot } from './overlay.js';
import { createHud } from './hud.js';
import { createDepthRenderer } from './depth.js';

const RELEASE_MS = 120;
const LOCK_DELAY_MS = 400;
const asset = (name) => new URL(`../../assets/hero/${name}`, import.meta.url).href;
const portrait = () => matchMedia('(max-width: 767px)').matches;

function makePicture(id) {
  const p = document.createElement('picture');
  p.className = 'plate';
  const srcset = (o, ext) => `${asset(`${id}-${o}.${ext}`)} ${o === 'land' ? 1536 : 864}w, ${asset(`${id}-${o}@2x.${ext}`)} ${o === 'land' ? 2560 : 1080}w`;
  const add = (type, media, o) => {
    const s = document.createElement('source');
    s.type = type;
    if (media) s.media = media;
    s.srcset = srcset(o, type === 'image/avif' ? 'avif' : 'webp');
    s.sizes = o === 'land' ? 'calc(100vw - 48px)' : 'calc(100vw - 32px)';
    p.appendChild(s);
  };
  add('image/avif', '(max-width: 767px)', 'port');
  add('image/webp', '(max-width: 767px)', 'port');
  add('image/avif', '', 'land');
  const img = document.createElement('img');
  img.alt = '';
  img.width = 1536;
  img.height = 864;
  img.decoding = 'async';
  img.src = asset(`${id}-land.webp`);
  img.srcset = srcset('land', 'webp');
  img.sizes = 'calc(100vw - 48px)';
  p.appendChild(img);
  return p;
}

function loadImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => img);
}

export function createVisor(root, { tier, tracking, strings }) {
  const media = root.querySelector('.visor-media');
  const svg = root.querySelector('.overlay');
  const pauseBtn = root.querySelector('.pause');
  const hud = createHud(root, { shots: SHOTS, shotMs: SHOT_MS, strings });
  const byId = Object.fromEntries(tracking.shots.map((s) => [s.id, s]));
  const pictures = [media.querySelector('picture')];
  let orient = portrait() ? 'port' : 'land';
  let overlay = null;
  let index = -1;
  let ready = false;
  let playing = false;
  let userPaused = false;
  let onScreen = true;
  let startAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let releasing = false;
  let raf = 0;
  let depth = null;
  let held = -1;
  let holdBase = 0;
  let holdSince = 0;
  let shift = 0;
  let cutting = false;
  const cycleMs = SHOTS.length * SHOT_MS;
  root.dataset.tier = tier;

  const elapsed = (now) => (ready ? (playing ? now : pausedAt) - startAt - pausedTotal : 0);
  function shotClock(t) {
    if (held < 0) return t + shift;
    const last = Math.floor(holdBase / SHOT_MS) * SHOT_MS + SHOT_MS - RELEASE_MS - 1;
    return Math.min(holdBase + (t - holdSince), Math.max(holdBase, last));
  }

  function applyFocus(i) {
    if (orient === 'land') root.style.setProperty('--fy', String(SHOTS[i].fy));
    else root.style.removeProperty('--fy');
  }

  function show(i, animate) {
    index = i;
    applyFocus(i);
    pictures.forEach((p, k) => p.classList.toggle('is-on', k === i));
    depth?.show(`${SHOTS[i].id}-${orient}`);
    overlay = drawShot(svg, byId[SHOTS[i].id], orient, strings);
    releasing = false;
    if (animate) overlay.lock();
    root.dispatchEvent(new CustomEvent('visor:shot', { detail: { index: i, id: SHOTS[i].id, hands: SHOTS[i].hands } }));
  }

  function step(now) {
    const t = elapsed(now);
    const s = shotClock(t);
    const c = counters(s, SHOTS, SHOT_MS);
    if (ready && !cutting && c.index !== index) show(c.index, true);
    else if (ready && playing && !releasing && held < 0 && SHOT_MS - (s % SHOT_MS) <= RELEASE_MS) { releasing = true; overlay?.release(); }
    hud.update({ recordedMs: c.recordedMs, countedMs: counters(t, SHOTS, SHOT_MS).countedMs, index: cutting ? Math.max(0, index) : c.index });
  }

  function frame(now) {
    step(now);
    raf = 0;
    if (onScreen && !document.hidden && (playing || !ready)) raf = requestAnimationFrame(frame);
  }

  function hold(i) {
    if (tier === 'still') return 0;
    const t = elapsed(performance.now());
    const s = shotClock(t);
    if (i === undefined) {
      if (held >= 0) return held;
      if (!ready || index < 0) i = 0;
      else if (cutting || !releasing) i = index;
      else { // the release is out: the cut lands on the next shot, on its own beat
        i = (index + 1) % SHOTS.length;
        held = i;
        holdBase = Math.floor(s / SHOT_MS) * SHOT_MS + SHOT_MS;
        holdSince = t;
        depth?.stop();
        return i;
      }
    }
    if (held === i) return i;
    depth?.stop();
    const same = ready && index === i && !releasing;
    holdBase = same || !ready ? s : Math.floor(s / cycleMs) * cycleMs + i * SHOT_MS;
    holdSince = t;
    held = i;
    if (!ready || same) return i;
    cutting = true;
    (overlay ? overlay.release() : Promise.resolve()).then(() => {
      cutting = false;
      if (held !== i) return; // let go meanwhile: the loop goes on from its own clock
      show(i, true);
      step(performance.now());
    });
    return i;
  }

  function unhold() {
    if (held < 0) return;
    const t = elapsed(performance.now());
    shift = shotClock(t) - t;
    held = -1;
    if (playing && onScreen && !document.hidden) depth?.start();
    kick();
  }

  function kick() { if (tier !== 'still' && !raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame); }

  function setPlaying(on) {
    const now = performance.now();
    if (on && !playing) { pausedTotal += now - pausedAt; playing = true; if (onScreen && !document.hidden && held < 0) depth?.start(); }
    if (!on && playing) {
      pausedAt = now; playing = false; depth?.stop();
      if (releasing) { svg.querySelector('.trk')?.getAnimations().forEach((a) => a.cancel()); releasing = false; }
    }
    root.dataset.playing = String(playing);
    kick();
  }

  function onPauseClick() {
    userPaused = !userPaused;
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    if (ready) setPlaying(!userPaused);
  }

  async function setupDepth() {
    const canvas = document.createElement('canvas');
    canvas.className = 'depth';
    canvas.setAttribute('aria-hidden', 'true');
    let r = null;
    r = createDepthRenderer(canvas, { onLost: () => {
      canvas.remove();
      if (depth === r) depth = null;
      root.dataset.tier = 'lite';
      document.documentElement.classList.replace('full', 'lite');
    } });
    if (!r) return null;
    const pairs = await Promise.all(SHOTS.map(async (s, i) => {
      const color = pictures[i].querySelector('img');
      await color.decode();
      return [s.id, color, await loadImage(asset(`${s.id}-${orient}-depth.png`))];
    }));
    if (r.lost) return null;
    for (const [id, color, d] of pairs) r.addPlate(`${id}-${orient}`, color, d);
    media.after(canvas);
    return r;
  }

  async function start() {
    hud.setShot(0);
    if (tier === 'still') {
      ready = true;
      show(0, false);
      hud.final();
      return;
    }
    root.dataset.playing = 'false';
    kick();
    setTimeout(() => { if (index < 0) show(0, true); }, LOCK_DELAY_MS);
    for (let i = 1; i < SHOTS.length; i++) { pictures[i] = makePicture(SHOTS[i].id); media.appendChild(pictures[i]); }
    pictures[0].classList.add('is-on');
    try {
      await Promise.all(pictures.map((p) => p.querySelector('img').decode()));
    } catch {
      root.dataset.error = 'decode';
      return; // first shot keeps holding, with its overlay: never an empty frame
    }
    if (tier === 'full') {
      try { depth = await setupDepth(); } catch { depth = null; }
      if (!depth) { root.dataset.tier = 'lite'; document.documentElement.classList.replace('full', 'lite'); }
    }
    if (index < 0) show(0, true);
    else depth?.show(`${SHOTS[0].id}-${orient}`);
    ready = true;
    startAt = performance.now();
    pausedAt = startAt;
    root.dataset.ready = 'true';
    setPlaying(!userPaused);
  }

  pauseBtn?.addEventListener('click', onPauseClick);
  document.addEventListener('visibilitychange', kick);
  root.addEventListener('visor:hold', (e) => {
    if (!e.detail?.on) { unhold(); return; }
    e.detail.index = hold(Number.isInteger(e.detail.index) ? e.detail.index : undefined);
  });
  if ('hold' in root.dataset) hold(+root.dataset.hold || 0); // the wall asked before the loop existed
  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    root.dataset.onscreen = String(onScreen);
    if (onScreen) { if (playing && held < 0) depth?.start(); kick(); } else depth?.stop();
  });
  io.observe(root);
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = portrait() ? 'port' : 'land';
      if (next !== orient) {
        orient = next;
        if (depth) {
          depth.destroy();
          root.querySelector('canvas.depth')?.remove();
          depth = null;
          setupDepth().then((r) => {
            depth = r;
            if (r && index >= 0) { r.show(`${SHOTS[index].id}-${orient}`); if (playing && onScreen && held < 0) r.start(); }
          }).catch(() => {});
        }
      }
      if (index >= 0) { applyFocus(index); overlay = drawShot(svg, byId[SHOTS[index].id], orient, strings); }
    }, 120);
  });

  return {
    start,
    pause: () => { userPaused = true; setPlaying(false); },
    resume: () => { userPaused = false; setPlaying(true); },
    currentIndex: () => index,
    hold,
    unhold,
    destroy: () => { cancelAnimationFrame(raf); io.disconnect(); depth?.destroy(); },
  };
}
