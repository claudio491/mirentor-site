// next.js: the words of the "what comes next" page, in the reader's language, and its ES/EN switch. The page is
// sketches only: nothing here reads the team's data. The language starts as the reader's own (from api/me) and the
// switch changes it on this page only. The page stays blank until its words are in, then plays its arrival once
// (next.css); with reduced motion it simply appears in its final state.
import { LANGS, makeT } from './i18n.js';

const fill = (lang) => {
  const t = makeT(lang);
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-t]')) {
    const text = t(n.dataset.t);
    // giant type ends in a signal full stop, like the brand's headlines
    if (n.classList.contains('giant') && text.endsWith('.')) { const em = document.createElement('em'); em.textContent = '.'; n.replaceChildren(text.slice(0, -1), em); } else n.textContent = text;
  }
  for (const n of document.querySelectorAll('[data-t-aria]')) n.setAttribute('aria-label', t(n.dataset.tAria));
  for (const b of document.querySelectorAll('#nxLang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  document.title = `${t('next.open')} · cancha`;
};

const WAIT_MS = 1500;   // a slow answer must not keep the page blank: past this, it opens in Spanish
async function readerLang() {
  try {
    const ask = fetch('api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    const r = await Promise.race([ask, new Promise((resolve) => { setTimeout(() => resolve(null), WAIT_MS); })]);
    if (!r) return 'es';
    const lang = r.ok ? (await r.json()).viewer?.lang : null;
    return LANGS.includes(lang) ? lang : 'es';
  } catch { return 'es'; }
}

/** Each order's rail runs from the centre of its first number to the centre of its last, whatever the words' length. */
const fitRails = () => {
  for (const w of document.querySelectorAll('.nx-orderw')) {
    const keys = w.querySelectorAll('.nx-k'), rail = w.querySelector('.nx-rail');
    if (keys.length < 2 || !rail) continue;
    const box = w.getBoundingClientRect(), a = keys[0].getBoundingClientRect(), b = keys[keys.length - 1].getBoundingClientRect();
    rail.style.top = `${a.top + a.height / 2 - box.top}px`;
    rail.style.height = `${b.top + b.height / 2 - (a.top + a.height / 2)}px`;
  }
};
const fillAll = (lang) => { fill(lang); fitRails(); };
addEventListener('resize', fitRails);
if (document.fonts) document.fonts.ready.then(fitRails);   // the words take their final size once the font is in

fill('es');
document.querySelector('#nxLang').addEventListener('click', (e) => { const b = e.target.closest('button[data-lang]'); if (b) fillAll(b.dataset.lang); });
const lang = await readerLang();
if (lang !== 'es') fill(lang);
fitRails();
document.body.classList.add('nx-in');
// Each part marked data-nx-seen plays its own arrival when it comes into view, so on a phone the edition fills in its
// order when the reader reaches it, not while it is still below the fold.
const parts = document.querySelectorAll('[data-nx-seen]');
if ('IntersectionObserver' in window) {
  document.body.classList.add('nx-io');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('nx-seen'); io.unobserve(e.target); }
  }, { threshold: 0.2 });
  parts.forEach((n) => io.observe(n));
} else parts.forEach((n) => n.classList.add('nx-seen'));
