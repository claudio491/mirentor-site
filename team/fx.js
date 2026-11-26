// fx.js: the moments of the app. The entrance that finds the person, the box that marks an achievement, and the small
// rewards around a number. Everything here is extra: with reduced motion, or in a browser that lacks a feature, the
// screens underneath say the same thing without it.
import { $, h, giant, reduce, EASE, lock, buzz, isQuiet, holdToast, releaseToast } from './ui.js';
import { portrait, setPortrait } from './hand.js';
import { changedChars, CELEBRATE_HOLD } from './moments.js';

/** While a full-screen moment is on, the app behind it takes no focus and no tap: Tab cannot slip behind the moment, and
 *  Enter cannot reach a button there. Moments can follow one another, so it counts. A toast waits out of sight meanwhile
 *  (body.moment in app.css): it lives in the top layer, above the moment, and would talk over it. */
let shields = 0, unveil = 0;
function shield(on) {
  const was = shields > 0;
  shields = Math.max(0, shields + (on ? 1 : -1));
  const now = shields > 0, app = document.getElementById('app');
  if (app) app.inert = now;
  clearTimeout(unveil);
  if (now) { document.body.classList.add('moment'); if (!was) holdToast(); return; }
  // Moments follow one another with a short breath between them: the toast comes back only once no other one started.
  if (was) unveil = setTimeout(() => { document.body.classList.remove('moment'); releaseToast(); }, reduce ? 50 : 450);
}

/** Change what is on screen with a short cross-fade, where the browser can do it. */
export function swap(run) {
  // A page nobody is looking at changes at once: a browser holds a transition back until it draws again.
  if (reduce || isQuiet() || !document.startViewTransition || document.visibilityState !== 'visible') { run(); return; }
  let ran = false;
  const once = () => { if (!ran) { ran = true; run(); } };
  try {
    const move = document.startViewTransition(once);
    // A second change that arrives mid-fade skips the first one: that is expected, not an error.
    for (const p of [move.ready, move.finished, move.updateCallbackDone]) if (p && p.catch) p.catch(() => {});
  } catch { once(); }
}

/** Write a short number line; the characters that changed lock into place instead of just appearing. */
export function roll(node, text) {
  const flags = changedChars(node.dataset.roll, text);
  node.dataset.roll = text;
  if (isQuiet() || !node.animate || !flags.some(Boolean)) { node.textContent = text; return; }
  node.replaceChildren(...[...text].map((ch, i) => {
    if (!flags[i] || ch === ' ') return ch;
    const cell = h('span', { class: 'rollc', text: ch });
    cell.animate([{ transform: 'translateY(.3em) scale(.82)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: 360, delay: i * 40, easing: EASE.lock, fill: 'backwards' });
    return cell;
  }));
}

/** Points that leave the place where they were counted: they rise beside it, so they never cover it. */
export function floatUp(anchor, text) {
  if (reduce || !anchor) return;
  const r = anchor.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
  const chip = h('span', { class: 'ptsfloat', text, 'aria-hidden': 'true' });
  // It starts under the place and rises into it, on that place's right edge: the room there is free of text.
  chip.style.left = `${r.right}px`; chip.style.top = `${r.bottom + 34}px`;
  document.body.append(chip);
  chip.animate([{ transform: 'translate(-100%,8px) scale(.8)', opacity: 0 }, { transform: 'translate(-100%,0) scale(1)', opacity: 1, offset: 0.2 }, { transform: 'translate(-100%,-8px) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-100%,-28px) scale(.9)', opacity: 0 }],
    { duration: 1300, easing: EASE.out }).onfinish = () => chip.remove();
}

/** A joint travels from where something was earned to where it is counted, then `then` runs. */
export function flyDot(from, to, then = () => {}) {
  const a = from && from.getBoundingClientRect(), b = to && to.getBoundingClientRect();
  if (reduce || !a || !b || !a.width || !b.width || a.bottom < 0 || a.top > innerHeight || b.bottom < 0 || b.top > innerHeight) { then(); return; }
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, dx = b.left + b.width / 2 - x0, dy = b.top + b.height / 2 - y0;
  const dot = h('i', { class: 'flydot', 'aria-hidden': 'true' });
  dot.style.left = `${x0}px`; dot.style.top = `${y0}px`;
  document.body.append(dot);
  // The path bows to one side, the way a thrown thing does.
  const bow = Math.min(70, Math.hypot(dx, dy) * 0.22), nx = -dy / (Math.hypot(dx, dy) || 1), ny = dx / (Math.hypot(dx, dy) || 1);
  const fly = dot.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: `translate(${dx * 0.12}px,${dy * 0.12}px) scale(1.25)`, opacity: 1, offset: 0.12 },
    { transform: `translate(${dx / 2 + nx * bow}px,${dy / 2 + ny * bow}px) scale(1.1)`, opacity: 1, offset: 0.55 }, { transform: `translate(${dx}px,${dy}px) scale(.7)`, opacity: 1 }],
  { duration: 620, easing: 'cubic-bezier(.45,0,.2,1)' });
  const done = () => { dot.remove(); then(); };
  fly.onfinish = done; fly.oncancel = done;
}

/** A headline arrives: the line rises out of a mask and its full stop locks last, like a joint. */
export function reveal(node, delay = 0) {
  if (reduce || !node || !node.animate) return;
  // The clip and the move run together, so the edge of the mask stays where the line's foot will be.
  node.animate([{ clipPath: 'inset(0 0 100% 0)', transform: 'translateY(100%)' }, { clipPath: 'inset(-20% -10% -20% -10%)', transform: 'translateY(0)' }], { duration: 560, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
  const dot = $('em', node);
  if (dot) dot.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 200, delay: delay + 380, easing: EASE.lock, fill: 'backwards' });
}

/** Rows or tiles arrive one after another. */
export function stagger(nodes, { delay = 0, step = 55, y = 10 } = {}) {
  if (reduce) return;
  [...nodes].forEach((n, i) => { if (n.animate) n.animate([{ transform: `translateY(${y}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 360, delay: delay + i * step, easing: EASE.out, fill: 'backwards' }); });
}
/** Lenses lock on one after another. */
export function lockIn(nodes, { delay = 0, step = 70 } = {}) {
  if (reduce) return;
  [...nodes].forEach((n, i) => { if (n.animate) n.animate([{ transform: 'scale(.82)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, delay: delay + i * step, easing: EASE.lock, fill: 'backwards' }); });
}

// ---- the entrance: the system finds the person, then hands them their day ----
let greeting = null;
/** person: { id, name, photo }. share: what the arc of their lens measures. line: [the fact, what follows from it].
 *  land(): the element the lens flies to when the entrance ends, if there is one on screen. onLeave runs as the screen
 *  underneath is uncovered. */
export function greet({ person, share = 0, chip, lead, name, line, land = null, onLeave = () => {} }) {
  const box = $('#greet'), slot = $('#gLens');
  if (!box || greeting) { onLeave(); return Promise.resolve(); }
  const lens = portrait(person, { share: 0 });
  slot.replaceChildren(lens);
  $('#gChip').textContent = chip; $('#gLead').textContent = lead;
  $('#gLine').replaceChildren(h('b', { text: line[0] }), line[1] ? ` ${line[1]}` : '');
  // The name is set as large as its length allows on a phone.
  const title = $('#gName'), n = name.length; giant(title, name);
  title.classList.toggle('word', n >= 8); title.classList.toggle('long', n === 10); title.classList.toggle('xlong', n >= 11);
  box.classList.remove('go', 'out', 'fade'); box.hidden = false; shield(true);
  document.documentElement.classList.add('greeting');
  box.focus({ preventScroll: true });
  greeting = new Promise((resolve) => {
    const timers = [];
    let left = false;
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const end = () => {
      box.hidden = true; box.classList.remove('go', 'out', 'fade'); slot.replaceChildren(); shield(false);
      document.documentElement.classList.remove('greeting'); greeting = null; resolve();
    };
    const leave = () => {
      if (left) return;
      left = true; timers.forEach(clearTimeout);
      box.removeEventListener('click', leave); document.removeEventListener('keydown', onKey);
      setPortrait(lens, share);
      const to = land ? land() : null, a = lens.getBoundingClientRect(), b = to ? to.getBoundingClientRect() : null;
      box.classList.add('out');
      onLeave();
      // The lens flies to where the person's lens lives on the screen underneath, when that place is in view.
      if (!reduce && lens.animate && b && b.width && a.width && b.bottom > 0 && b.top < innerHeight) {
        to.style.visibility = 'hidden';
        const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
        const fly = lens.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px,${dy}px) scale(${b.width / a.width})` }], { duration: 600, easing: EASE.move, fill: 'forwards' });
        const land2 = () => { to.style.visibility = ''; end(); };
        fly.onfinish = land2; fly.oncancel = land2;
      } else { box.classList.add('fade'); later(reduce ? 180 : 420, end); }   // nowhere to land: the lens goes out with the rest
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); leave(); } };
    box.addEventListener('click', leave); document.addEventListener('keydown', onKey);
    void box.offsetWidth; box.classList.add('go');   // styles settle first, so the entrance plays even when the page was opened in the background
    later(reduce ? 0 : 520, () => setPortrait(lens, share));
    later(reduce ? 0 : 1120, () => { const dot = $('em', title); if (dot) lock(dot); });
    later(reduce ? 2000 : 2900, leave);
  });
  return greeting;
}
export const isGreeting = () => !!greeting;

// ---- the moment box: taking the lead, a full finger, a new level, a badge ----
/** n: a short number to show large, or glyph: a drawing. a + b: the title, b in signal. With `face` ({ person, from,
 *  to }) the box shows the person instead: their lens, the arc going from one share to the other, and the number or the
 *  drawing pinned to it. Resolves when it closes. */
export function celebrate({ n = '', glyph = null, face = null, a, b, sub = '', label = '' }) {
  const box = $('#lockon');
  if (!box) return Promise.resolve();
  const back = document.activeElement, timers = [];
  box.classList.toggle('person', !!face);
  if (face) {
    const lens = portrait(face.person, { share: face.from });
    const pin = glyph || n ? h('span', { class: 'lo-emblem' }, glyph || h('b', { class: 'num', text: n })) : null;
    $('#loN').textContent = ''; $('#loG').replaceChildren(lens, ...(pin ? [pin] : []));
    timers.push(setTimeout(() => setPortrait(lens, face.to), reduce ? 0 : 520));
    // The lens keeps answering while the moment holds.
    timers.push(setTimeout(() => { if (lens.isConnected && !reduce) ring(lens); }, 1250));
  } else { $('#loN').textContent = n; $('#loG').replaceChildren(...(glyph ? [glyph] : [])); }
  $('#loA').textContent = a; $('#loB').textContent = b; $('#loS').textContent = sub;
  box.setAttribute('aria-label', label || `${a} ${b}`);
  return new Promise((resolve) => {
    let timer;
    const off = () => {
      timers.forEach(clearTimeout); shield(false);
      clearTimeout(timer); box.classList.remove('on'); box.setAttribute('aria-hidden', 'true'); box.tabIndex = -1;
      box.removeEventListener('click', off); document.removeEventListener('keydown', onKey);
      if (back && back.focus) back.focus({ preventScroll: true });
      setTimeout(resolve, reduce ? 0 : 300);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); off(); } };
    shield(true); box.classList.add('on'); box.setAttribute('aria-hidden', 'false'); box.tabIndex = 0; box.focus({ preventScroll: true });
    buzz([14, 60, 22]);
    box.addEventListener('click', off); document.addEventListener('keydown', onKey);
    // It holds the app for a breath, not for a pause in the rep's work: shorter still with nothing moving.
    timer = setTimeout(off, reduce ? CELEBRATE_HOLD.reduced : CELEBRATE_HOLD.full);
  });
}
/** A ring leaves the edge of a lens. */
function ring(el) {
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const node = h('i', { class: 'ringfx', 'aria-hidden': 'true' });
  node.style.left = `${r.left + r.width / 2}px`; node.style.top = `${r.top + r.height / 2}px`;
  node.style.width = `${r.width}px`; node.style.height = `${r.height}px`; node.style.margin = `${-r.height / 2}px 0 0 ${-r.width / 2}px`; node.style.zIndex = '41';
  document.body.append(node);
  node.animate([{ transform: 'scale(1)', opacity: 0.85 }, { transform: 'scale(1.42)', opacity: 0 }], { duration: 760, easing: EASE.track }).onfinish = () => node.remove();
}

// ---- the day is complete: the four habits are done, and the screen says so before the week does ----
let ddClose = null;
/** Close the moment from outside (the phone's Back): the rep stays on Hoy. Answers whether it was open. */
export function closeDayDone() { if (!ddClose) return false; ddClose(false); return true; }
/** Closes in from where the last habit was logged (`from`), shows `glyph` (the hand, with today's finger about to
 *  light) and the title. It stays until the rep acts. `report`: the main control ({ label, hint, run }), where `run`
 *  answers whether it is done (then "Listo." shows for DONE_HOLD and it closes) or the moment stays. "Ver mi semana"
 *  resolves true; a tap anywhere else, Escape or Back resolves false (the rep stays on Hoy). */
export function dayDone({ title, sub = '', glyph = null, from = null, label = '', report = null, done = '', hold = 900 }) {
  const box = $('#dayDone');
  if (!box) return Promise.resolve(false);
  const back = document.activeElement, r = from && from.getBoundingClientRect();
  box.style.setProperty('--mx', `${r && r.width ? Math.round(r.left + r.width / 2) : Math.round(innerWidth / 2)}px`);
  box.style.setProperty('--my', `${r && r.width ? Math.round(r.top + r.height / 2) : Math.round(innerHeight * 0.7)}px`);
  giant($('#ddGiant'), title); $('#ddSub').textContent = sub; $('#ddHand').replaceChildren(...(glyph ? [glyph] : []));
  box.setAttribute('aria-label', label || title);
  const main = $('#ddMain'), hint = $('#ddHint'), week = $('#ddWeek');
  main.hidden = !report; hint.hidden = !report;
  if (report) { main.textContent = report.label; main.disabled = false; hint.textContent = report.hint; }
  return new Promise((resolve) => {
    let timer = 0, gone = false;
    const off = (go) => {
      if (gone) return;
      gone = true; ddClose = null;
      shield(false); clearTimeout(timer); box.classList.remove('on'); box.setAttribute('aria-hidden', 'true'); box.tabIndex = -1;
      box.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey);
      if (back && back.focus) back.focus({ preventScroll: true });
      setTimeout(() => resolve(go), reduce ? 0 : 420);
    };
    const onClick = async (e) => {
      if (e.target.closest('#ddWeek')) { off(true); return; }
      if (!e.target.closest('#ddMain')) { if (!e.target.closest('.dd-acts')) off(false); return; }
      if (!report || main.disabled) return;
      main.disabled = true;
      let ok = false;
      try { ok = await report.run(); } catch { ok = false; }
      if (gone) return;
      if (ok) { main.textContent = done; timer = setTimeout(() => off(false), hold); } else main.disabled = false;
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); off(false); } };
    ddClose = off;
    shield(true); box.classList.add('on'); box.setAttribute('aria-hidden', 'false'); box.tabIndex = 0; box.focus({ preventScroll: true });
    buzz([14, 60, 22, 60, 30]);
    box.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
  });
}
