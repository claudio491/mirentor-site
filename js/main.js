import { pickTier, readEnv } from './tier.js';
import { createVisor } from './hero/visor.js';
import { initReveal } from './reveal.js';

const strings = JSON.parse(document.getElementById('i18n')?.textContent || '{}');
const tier = pickTier(readEnv());
document.documentElement.classList.add(tier);

const STAGES = tier === 'full' && matchMedia('(min-width: 900px) and (min-height: 640px)').matches;
const AT_KEY = `mirentor:at:${location.pathname}`;
const navType = performance.getEntriesByType?.('navigation')[0]?.type || '';
const store = { get: () => { try { return JSON.parse(sessionStorage.getItem(AT_KEY) || 'null'); } catch { return null; } }, set: (v) => { try { sessionStorage.setItem(AT_KEY, JSON.stringify(v)); } catch { /* private mode */ } } };
const readingLine = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
try { if ('scrollRestoration' in history) history.scrollRestoration = STAGES ? 'manual' : 'auto'; } catch { /* sandboxed */ }
const returning = STAGES && (navType === 'reload' || navType === 'back_forward') ? store.get() : null;
const shown = () => document.documentElement.classList.remove('landing');
if (!returning?.id) shown();
let moved = false; // the reader scrolled before the page settled: never take the page from under them
for (const type of ['wheel', 'touchstart', 'keydown']) addEventListener(type, () => { moved = true; }, { once: true, passive: true, capture: true });
addEventListener('pagehide', () => {
  if (!STAGES) return;
  const line = readingLine();
  let at = null;
  for (const s of document.querySelectorAll('main > section[id], body > footer[id]')) {
    const top = s.getBoundingClientRect().top;
    if (top <= line + 1) at = { id: s.id, depth: Math.round(line - top) };
  }
  store.set(at);
});
function landBack() {
  const s = returning?.id && document.getElementById(returning.id);
  if (!s || moved) return false;
  const y = Math.max(0, s.getBoundingClientRect().top + scrollY - readingLine() + Math.min(returning.depth, s.offsetHeight - 1));
  const lenis = window.mirentorLenis;
  if (lenis) { lenis.resize?.(); lenis.scrollTo(y, { immediate: true, force: true }); } else scrollTo(0, y);
  return true;
}

const primaries = [...document.querySelectorAll('main .btn:not(.btn-ghost), #lista-de-espera')];
if (primaries.length && 'IntersectionObserver' in window) {
  const inView = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) inView.add(e.target); else inView.delete(e.target); }
    document.documentElement.classList.toggle('cta-out', inView.size === 0);
  });
  primaries.forEach((b) => io.observe(b));
}

initReveal();
const chapters = [...document.querySelectorAll('[data-module]')].map((el) => import(`./chapters/${el.dataset.module}.js`)
  .then((m) => m.init?.(el, { tier, strings, lang: document.documentElement.lang }))
  .catch((err) => { el.dataset.moduleError = String(err.message || err); })); // data-error is a chapter hook (ch06's message)
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1200 }) : setTimeout(r, 200)));
const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true }));
const motion = loaded.then(idle).then(() => import('./motion.js')).then((m) => m.initMotion({ tier }))
  .catch((err) => { document.documentElement.dataset.motionError = String(err.message || err); });
Promise.allSettled([...chapters, motion, document.fonts.ready]).then(() => {
  const st = window.ScrollTrigger;
  if (st) { st.sort(); st.refresh(); }
  let target = null;
  try { target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { target = null; }
  if (!landBack() && target && st) target.scrollIntoView();
  st?.update();
  shown();
  document.documentElement.dataset.settled = 'true';
});

const root = document.getElementById('visor');
if (root) {
  fetch(new URL('../assets/hero/tracking.json', import.meta.url))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`tracking ${r.status}`))))
    .then((tracking) => createVisor(root, { tier, tracking, strings }).start())
    .catch((err) => { root.dataset.error = String(err.message || err); });
}
