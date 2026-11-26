// art-lead.js: the illustration the later screens lead with, and the picture an empty list rests on. It is the .robj
// of Semana's results (a base and a glow, lit when the screen's state is done), drawn from the app's own files: the
// addresses come from art.js, so the one-page copy that carries the images inside works too. Which picture and when it
// is lit are decided in craft-steps.js; how tall each may be is decided there too (art never costs a tap), from what
// this file measures on the screen shown.
import { $, $$, h, put, reduce, EASE } from './ui.js';
import { ART } from './art.js';
import { artFit, bandArt, artArrives } from './craft-steps.js';

// each file's own size, so the page knows its shape before it loads (a strip's small file holds the same four frames)
const SIZE = { meeting: [460, 460], contract: [460, 460], summit: [720, 720], hand: [760, 760], talk: [2240, 560], follow: [2240, 560], rest: [2240, 560],
  talkThumb: [800, 200], followThumb: [800, 200], restThumb: [800, 200] };
const glowOf = { meetingGlow: 'meeting', contractGlow: 'contract', summitGlow: 'summit', handLit: 'hand' };

function image(name, cls) {
  const [width, height] = SIZE[glowOf[name] || name];
  return h('img', { class: cls, src: ART[name], alt: '', loading: 'lazy', decoding: 'async', width: String(width), height: String(height) });
}

/** Put a picture in its slot (a span.robj.k-art), or hide the slot when the screen leads with none. Its images are
 *  built once per picture; lit and dim follow the screen. The screen it sits on is fitted again when it is shown. */
export function paintArt(slot, spec) {
  if (!slot) return;
  slot.hidden = !spec;
  if (spec) {
    const key = `${spec.art}|${spec.glow || ''}|${spec.frame ?? ''}`;
    if (slot.dataset.key !== key) {
      slot.dataset.key = key;
      put(slot, image(spec.art, 'base'), spec.glow ? image(spec.glow, 'glow') : null);   // a strip has no glow: the base alone
    }
    if (spec.frame != null) slot.dataset.f = String(spec.frame); else delete slot.dataset.f;
    slot.classList.toggle('strip', spec.frame != null);
    slot.classList.toggle('lit', !!spec.lit);
    slot.classList.toggle('dim', !!spec.dim);
    slot.classList.toggle('empty-art', !!spec.rest);   // a screen with nothing in it rests, at an empty list's size
  }
  const screen = slot.closest('.screen');
  if (screen && !screen.hidden) fitArt(screen);
}

/** An empty list's picture: the rest strip's first frame (its small file) at 120 px, above its one line. */
export function restArt() {
  const slot = h('span', { class: 'robj k-art empty-art strip', 'aria-hidden': 'true', 'data-f': '0' });
  slot.dataset.key = 'restThumb||0';
  slot.append(image('restThumb', 'base'));
  return slot;
}

/** Where a screen's first action is: its first control that is not the way back, a chip or a number's source. */
const ACTION = 'button:not([disabled]), a[href], label.btn, label.inst-scan, input, select, textarea';
function firstAction(screen) {
  return $$(ACTION, screen).find((n) => !n.matches('.src, [data-pop]') && !n.closest('.hud-row, .giant, .k-art, [hidden]') && n.getClientRects().length > 0) || null;
}
/** Where an element ends on the page as laid out: a row still sliding in (a transform) counts where it will rest. */
function layoutBottom(n) {
  let top = 0;
  for (let e = n; e; e = e.offsetParent) top += e.offsetTop;
  return top + n.offsetHeight;
}
/** Size every illustration of a screen so that its first action stays where a thumb reaches it without scrolling:
 *  measured with no art drawn, then each picture above that action takes what room is left (craft-steps.js artFit);
 *  a picture below it takes its full size. Synchronous, so the screen is never painted in between. */
export function fitArt(screen) {
  if (!screen || screen.hidden) return;
  const all = $$('.k-art', screen).filter((a) => !a.hidden && !a.closest('[hidden]'));
  // beside a short giant: as tall as the giant's box (the band), if the giant leaves it 96 px and its air (craft-steps.js)
  const inBand = (a) => a.parentElement.classList.contains('k-band');
  for (const a of all.filter(inBand)) {
    const giant = $('.giant', a.parentElement), text = document.createRange();
    text.selectNodeContents(giant);
    const room = a.parentElement.getBoundingClientRect().right - text.getBoundingClientRect().right;
    a.dataset.px = bandArt({ band: giant.getBoundingClientRect().height, room }) ? 'band' : '0';
  }
  const arts = all.filter((a) => !inBand(a));
  if (!arts.length) return;
  for (const a of arts) a.dataset.px = '0';
  const nav = $('#nav'), navBox = nav && !nav.hidden ? nav.getBoundingClientRect() : null;
  // the tab bar at the bottom (a phone) is the fold; a wide screen keeps its bar on top and nothing is under a thumb
  const bottomBar = !!navBox && navBox.top > innerHeight / 2;
  const first = firstAction(screen);
  const room = first && bottomBar ? navBox.top - 8 - layoutBottom(first) : Infinity;
  const above = (a) => !!first && !!(a.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  const lead = arts.find((a) => a.classList.contains('lead-art') && !a.classList.contains('empty-art'));
  const emptiesAbove = arts.filter((a) => a.classList.contains('empty-art') && above(a));
  const fit = artFit({ room, width: innerWidth, height: innerHeight, lead: !!lead && above(lead), above: emptiesAbove.length });
  const full = artFit({ room: Infinity, width: innerWidth, height: innerHeight }).lead;
  for (const a of arts) {
    if (a === lead) a.dataset.px = String(above(a) ? fit.lead : full);
    else a.dataset.px = String(above(a) ? fit.empties[emptiesAbove.indexOf(a)] : 120);
  }
}

/** The screen's picture arrives as Hoy's does: it settles in from a little above, without a bounce; the first time its
 *  screen is opened in a visit, not on every return to it. */
const arrived = new Set();
export function arriveArt(screen) {
  if (reduce || !screen || !artArrives(arrived, screen.id)) return;
  const a = $('.lead-art', screen);
  if (!a || a.hidden || a.dataset.px === '0' || !a.animate) return;
  a.animate([{ opacity: 0, transform: 'translateY(-12px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 160, easing: EASE.out, fill: 'backwards' });
}
