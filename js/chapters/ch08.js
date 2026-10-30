const CLOSE_MS = 200; // the closing transition in ch08-faq.css; <details> loses [open] only once its rows reach 0fr
const STOP = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

export function init(el, { tier } = {}) {
  const items = [...el.querySelectorAll('details.ch08-item')];
  if (!items.length) return;
  const instant = tier === 'still';
  const closing = new Map();

  const set = (d, open, now = instant) => {
    clearTimeout(closing.get(d));
    closing.delete(d);
    if (open) {
      if (!d.open) d.open = true;
      if (!now) void d.offsetHeight; // commit the closed rows first, so the change runs as a transition
      d.classList.add('is-open');
      return;
    }
    d.classList.remove('is-open');
    if (now || !d.open) { d.open = false; return; }
    closing.set(d, setTimeout(() => { closing.delete(d); d.open = false; }, CLOSE_MS));
  };

  for (const d of items) {
    d.classList.toggle('is-open', d.open);
    d.querySelector('summary')?.addEventListener('click', (e) => {
      e.preventDefault();
      set(d, !d.classList.contains('is-open'));
    });
    d.addEventListener('toggle', () => {
      if (!closing.has(d) && d.open !== d.classList.contains('is-open')) d.classList.toggle('is-open', d.open);
    });
  }

  const linkedItem = () => {
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed hash: no item */ }
    return id ? items.find((d) => d.id === id) : undefined;
  };
  const first = linkedItem();
  if (first) { set(first, true, true); keepInView(first); }
  el.classList.add('is-live');

  addEventListener('hashchange', () => { const d = linkedItem(); if (d) set(d, true); });
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#pregunta-"]') : null;
    const d = a && items.find((x) => `#${x.id}` === a.getAttribute('href'));
    if (d) set(d, true);
  });
}

function keepInView(d) {
  if (!('ResizeObserver' in window)) return;
  const ro = new ResizeObserver(() => d.scrollIntoView({ block: 'start' }));
  const stop = () => { ro.disconnect(); STOP.forEach((t) => removeEventListener(t, stop)); };
  STOP.forEach((t) => addEventListener(t, stop, { passive: true }));
  ro.observe(document.body);
  setTimeout(stop, 3000);
}
