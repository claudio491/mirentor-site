// motion.js: the global motion layer (docs/superpowers/specs/2026-10-29-mirentor-motion-system.md). Smooth wheel
// scrolling, Bodoni headlines rising out of line masks, kickers printing like a HUD readout, media drifting with the
// scroll and a viewfinder that locks onto whatever the pointer is on. Chapters add their own moments on top of this.
// Still tier (reduced motion) gets none of it; everything here starts from a readable page and only hides what it is
// about to reveal itself.
import { loadGsap, loadLenis } from './vendor.js';

const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const headerH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;

/** Starts the layer. Resolves once every split and trigger exists, so main.js can measure the page after it. */
export async function initMotion({ tier }) {
  if (tier === 'still') return;
  const { gsap, ScrollTrigger, SplitText } = await loadGsap('SplitText');
  if (tier === 'full' && finePointer()) await smoothScroll(gsap, ScrollTrigger);
  await document.fonts.ready;
  headlines(gsap, SplitText);
  kickers(gsap, SplitText);
  if (tier === 'full') parallax(gsap);
  if (finePointer()) viewfinder(gsap);
}

/* Lenis on the wheel only (touch stays native), driven by GSAP's ticker so pins and scrubs never drift. In-page links
   glide when clicked and jump when pressed from the keyboard (a key press never animates); the hash still changes and
   hashchange still fires (chapter 08 opens the linked question on it). Either way focus lands on the target, as the
   browser's own jump would do: the next Tab goes on from there and a screen reader moves with it. */
async function smoothScroll(gsap, ScrollTrigger) {
  const Lenis = await loadLenis();
  const lenis = new Lenis({ duration: 1.1, smoothWheel: true, autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  const land = (target) => {
    if (!target.matches('a[href], button, input, select, textarea, summary, [tabindex]')) {
      target.setAttribute('tabindex', '-1');
      target.dataset.landing = ''; // focus, no ring: a section is not a control (base.css)
    }
    target.focus({ preventScroll: true });
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    let id = '';
    try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch { return; }
    const target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target, { offset: -headerH(), duration: 1.2, immediate: e.detail === 0, force: true, onComplete: () => land(target) });
    history.pushState(null, '', `#${encodeURIComponent(id)}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  });
  window.mirentorLenis = lenis;
}

/* Chapter headlines: each line rises out of its own mask (900 ms, reveal, 80 ms apart) when the headline is 12% into
   the viewport. SplitText keeps the full text on the heading for screen readers and re-splits on resize. */
function headlines(gsap, SplitText) {
  for (const el of document.querySelectorAll('.ch-title')) {
    el.classList.add('mo-split');
    SplitText.create(el, {
      type: 'lines', mask: 'lines', linesClass: 'mo-line', autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, {
        yPercent: 108, duration: 0.9, ease: 'reveal', stagger: 0.08,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      }),
    });
  }
}

/* Kickers print like the visor's HUD: one character every 14 ms behind a block cursor that blinks twice and goes.
   The split letters are hidden from assistive tech; a plain copy of the text, visually hidden, speaks for them (as the
   camera wall's kicker does: a name on the split span would sit on a generic element, where ARIA ignores it). */
function kickers(gsap, SplitText) {
  for (const el of document.querySelectorAll('.ch-kicker')) {
    el.classList.add('mo-split');
    // The kicker is a flex row (bar + text): the text goes in one span so its letters still wrap on a phone.
    const text = Object.assign(document.createElement('span'), { className: 'mo-kt' });
    [...el.childNodes].filter((n) => n.nodeType === 3 || !n.matches?.('i')).forEach((n) => text.appendChild(n));
    el.append(text, Object.assign(document.createElement('span'), { className: 'sr-only', textContent: text.textContent.trim() }));
    const { chars } = SplitText.create(text, { type: 'chars', charsClass: 'mo-char', aria: 'hidden' });
    const cursor = Object.assign(document.createElement('span'), { className: 'mo-cursor' });
    cursor.setAttribute('aria-hidden', 'true');
    gsap.set(chars, { opacity: 0 });
    gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 92%', once: true } })
      .call(() => chars[0]?.before(cursor))
      .to(chars, { opacity: 1, duration: 0.01, ease: 'none', stagger: { each: 0.014, onStart() { this.targets()[0].after(cursor); } } })
      .call(() => cursor.classList.add('is-done'))
      .call(() => cursor.remove(), null, '+=0.9');
  }
}

/* [data-parallax]: media drifts from -6% to 6% of its own height while its frame crosses the viewport. */
function parallax(gsap) {
  for (const el of document.querySelectorAll('[data-parallax]')) {
    gsap.fromTo(el, { yPercent: -6 }, {
      yPercent: 6, ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }
}

/* The viewfinder: four corner brackets lock onto the link, button or [data-vf] element under the pointer (from 12 px
   out to 6 px, lock ease, 220 ms) and fade when the pointer leaves. It never replaces the system cursor. */
function viewfinder(gsap) {
  const SEL = 'a[href], button, [data-vf], .fit-seg-key, .ch07-city';
  const vf = Object.assign(document.createElement('div'), { className: 'mo-vf' });
  vf.setAttribute('aria-hidden', 'true');
  vf.innerHTML = '<i></i><i></i><i></i><i></i>';
  document.body.appendChild(vf);
  const corners = [...vf.children];
  let target = null;
  const place = (pad, duration) => {
    const r = target.getBoundingClientRect();
    const at = [[r.left - pad, r.top - pad], [r.right + pad, r.top - pad], [r.left - pad, r.bottom + pad], [r.right + pad, r.bottom + pad]];
    corners.forEach((c, i) => gsap.to(c, { x: at[i][0], y: at[i][1], duration, ease: 'lock', overwrite: true }));
  };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.(SEL);
    if (!t || t === target || t.closest('.mo-vf')) return;
    const fresh = !target;
    target = t;
    vf.classList.toggle('on-light', !!t.closest('.ch--light'));
    if (fresh) place(12, 0);
    place(6, 0.22);
    gsap.to(vf, { opacity: 1, duration: 0.12, ease: 'none', overwrite: true });
  });
  document.addEventListener('pointerout', (e) => {
    if (!target || e.relatedTarget?.closest?.(SEL)) return;
    target = null;
    gsap.to(vf, { opacity: 0, duration: 0.12, ease: 'none', overwrite: true });
  });
  addEventListener('scroll', () => { if (target) place(6, 0); }, { passive: true });
}
