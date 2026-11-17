// fx.js: the moments of the app. The entrance that finds the person, the box that marks an achievement, and the small
// rewards around a number. Everything here is extra: with reduced motion, or in a browser that lacks a feature, the
// screens underneath say the same thing without it.
import { $, h, giant, reduce, EASE, lock, buzz, isQuiet } from './ui.js';
import { portrait, setPortrait } from './hand.js';
import { changedChars } from './moments.js';

/** Change what is on screen with a short cross-fade, where the browser can do it. */
export function swap(run) {
  if (reduce || isQuiet() || !document.startViewTransition) { run(); return; }
  try { document.startViewTransition(run); } catch { run(); }
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
  chip.style.left = `${r.left - 8}px`; chip.style.top = `${r.top}px`;
  document.body.append(chip);
  chip.animate([{ transform: 'translate(-100%,10px) scale(.8)', opacity: 0 }, { transform: 'translate(-100%,0) scale(1)', opacity: 1, offset: 0.2 }, { transform: 'translate(-100%,-4px) scale(1)', opacity: 1, offset: 0.74 }, { transform: 'translate(-100%,-16px) scale(1)', opacity: 0 }],
    { duration: 1400, easing: EASE.out }).onfinish = () => chip.remove();
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

/** Loops run only while their element is on screen. */
export function alive(...nodes) {
  if (reduce || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => { for (const e of entries) e.target.classList.toggle('alive', e.isIntersecting); }, { threshold: 0.15 });
  for (const n of nodes) if (n) io.observe(n);
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
  box.classList.remove('go', 'out', 'fade'); box.hidden = false;
  document.documentElement.classList.add('greeting');
  box.focus({ preventScroll: true });
  greeting = new Promise((resolve) => {
    const timers = [];
    let left = false;
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const end = () => {
      box.hidden = true; box.classList.remove('go', 'out', 'fade'); slot.replaceChildren();
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
/** n: a short number to show large, or glyph: a drawing. a + b: the title, b in signal. Resolves when it closes. */
export function celebrate({ n = '', glyph = null, a, b, sub = '', label = '' }) {
  const box = $('#lockon');
  if (!box) return Promise.resolve();
  const back = document.activeElement;
  $('#loN').textContent = n; $('#loG').replaceChildren(...(glyph ? [glyph] : []));
  $('#loA').textContent = a; $('#loB').textContent = b; $('#loS').textContent = sub;
  box.setAttribute('aria-label', label || `${a} ${b}`);
  return new Promise((resolve) => {
    let timer;
    const off = () => {
      clearTimeout(timer); box.classList.remove('on'); box.setAttribute('aria-hidden', 'true'); box.tabIndex = -1;
      box.removeEventListener('click', off); document.removeEventListener('keydown', onKey);
      if (back && back.focus) back.focus({ preventScroll: true });
      setTimeout(resolve, reduce ? 0 : 300);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); off(); } };
    box.classList.add('on'); box.setAttribute('aria-hidden', 'false'); box.tabIndex = 0; box.focus({ preventScroll: true });
    buzz([14, 60, 22]);
    box.addEventListener('click', off); document.addEventListener('keydown', onKey);
    timer = setTimeout(off, 3800);
  });
}
