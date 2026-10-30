// ch07.js: "Una ciudad a la vez". Four cities on a dot map of Latin America (Natural Earth 110m, built offline).
// Choosing a city shows its card: coordinates, local time (Intl, refreshed on each minute while the chapter is near
// the screen), the country's consent rule with its source, and "Join the <city> waitlist".
//
// Without this module every card shows and each city link jumps to its card. With it, the links act as buttons
// (aria-expanded, aria-controls) and one card shows at a time: the visitor's own city when their time zone matches
// one of the four, otherwise Ciudad de Panamá.
//
// Motion: the four markers pulse once when the map enters (ring 1 to 2.4 in 900 ms, 120 ms apart, north to south);
// a new card rises 8 px in 240 ms; the scale pins slide to the city in 360 ms (CSS). Tier "still": none of it, and a
// map already on screen at load does not pulse. Nothing loops.
//
// "Join" dispatches window "mirentor:prefill", then scrolls to #lista-de-espera, with
//   detail { city, country, cityId, countryCode, source: 'ch07' }
//   city, country: display names in the page language; cityId: panama | medellin | lima | cdmx; countryCode: PA | CO | PE | MX
// A prefill from another chapter (ch06) that names one of the four cityId values selects that city here too.

export const CITIES = {
  panama: { tz: 'America/Panama', code: 'PA' },
  medellin: { tz: 'America/Bogota', code: 'CO' },
  lima: { tz: 'America/Lima', code: 'PE' },
  cdmx: { tz: 'America/Mexico_City', code: 'MX' },
};
const PULSE_MS = 900;
const PULSE_GAP = 120;
const CARD_MS = 240;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Pure: the city whose time zone the visitor shares, otherwise the first one. */
export function pickDefault(visitorTz, ids = Object.keys(CITIES)) {
  return ids.find((id) => CITIES[id]?.tz === visitorTz) || ids[0];
}

/** Pure: wall time in a city, "14:05" (es) or "2:05 PM" (en). Any space (ICU may use a narrow one, which the font
 *  subset lacks) becomes a no-break space, so the time never wraps or falls back to a system font. */
export function localTime(date, tz, lang = 'es') {
  const opts = lang === 'en' ? { timeZone: tz, hour: 'numeric', minute: '2-digit' } : { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-419', opts).format(date).replace(/\s/g, ' ');
}

/** Pure: offset from UTC, "UTC-5". */
export function utcOffset(date, tz) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
  const v = (part?.value || 'GMT').replace('GMT', 'UTC').replace('−', '-');
  return v === 'UTC' ? 'UTC+0' : v;
}

export function init(el, { tier = 'full', lang = document.documentElement.lang } = {}) {
  const stage = el.querySelector('[data-stage]');
  const links = [...el.querySelectorAll('a[data-city]')];
  const cards = new Map([...el.querySelectorAll('[data-card]')].map((c) => [c.dataset.card, c]));
  const marks = new Map([...el.querySelectorAll('[data-mk]')].map((m) => [m.dataset.mk, m]));
  if (!stage || !links.length || !cards.size) return;
  const motion = tier !== 'still';
  const text = (node) => (node ? node.textContent.trim() : '');
  let current = '';

  // Local time: every card's clock, so a switch never shows a stale one.
  const clocks = [...cards.values()].map((c) => ({ tz: c.dataset.tz, row: c.querySelector('[data-time]'), time: c.querySelector('[data-clock]'), off: c.querySelector('[data-offset]') }));
  function tick() {
    const now = new Date();
    for (const k of clocks) {
      if (!k.time || !k.tz) continue;
      k.time.textContent = localTime(now, k.tz, lang);
      if (k.off) k.off.textContent = utcOffset(now, k.tz);
      k.row.hidden = false;
    }
  }
  let timer = 0;
  const stop = () => { clearTimeout(timer); clearInterval(timer); timer = 0; };
  const start = () => {
    stop();
    tick();
    timer = setTimeout(() => { tick(); timer = setInterval(tick, 60000); }, 60000 - (Date.now() % 60000) + 50);
  };

  function select(id, { animate = false } = {}) {
    if (!cards.has(id) || id === current) return;
    current = id;
    for (const a of links) a.setAttribute('aria-expanded', String(a.dataset.city === id));
    for (const [k, m] of marks) m.classList.toggle('is-sel', k === id);
    for (const [k, c] of cards) c.classList.toggle('is-on', k === id);
    const m = marks.get(id);
    if (m) {
      stage.style.setProperty('--sx', m.style.getPropertyValue('--x'));
      stage.style.setProperty('--sy', m.style.getPropertyValue('--y'));
    }
    const card = cards.get(id);
    if (animate && motion && card.animate) {
      card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: CARD_MS, easing: EASE_OUT });
    }
  }

  for (const a of links) {
    const card = cards.get(a.dataset.city);
    if (!card) continue;
    a.setAttribute('role', 'button');
    a.setAttribute('aria-controls', card.id);
    a.setAttribute('aria-expanded', 'false');
    a.addEventListener('click', (e) => { e.preventDefault(); select(a.dataset.city, { animate: true }); });
    a.addEventListener('keydown', (e) => {
      if (e.key !== ' ') return;
      e.preventDefault();
      select(a.dataset.city);
    });
  }

  for (const [id, card] of cards) {
    card.querySelector('[data-join]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const detail = { city: text(card.querySelector('.ch07-card-city')), country: text(card.querySelector('.ch07-card-country')), cityId: id, countryCode: CITIES[id]?.code || '', source: 'ch07' };
      window.dispatchEvent(new CustomEvent('mirentor:prefill', { detail }));
      const target = document.getElementById('lista-de-espera');
      if (!target) return;
      target.scrollIntoView({ behavior: motion && e.detail > 0 ? 'smooth' : 'auto', block: 'start' });
      if (!target.contains(document.activeElement)) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  }

  window.addEventListener('mirentor:prefill', (e) => {
    const d = e.detail || {};
    if (d.source !== 'ch07' && cards.has(d.cityId)) select(d.cityId);
  });

  let visitorTz = '';
  try { visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { visitorTz = ''; }
  select(pickDefault(visitorTz, [...cards.keys()]));
  tick();
  el.classList.add('is-live');

  if (!('IntersectionObserver' in window)) return;
  // The clock runs only while the chapter is near the screen.
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { rootMargin: '200px 0px' }).observe(el);

  // One pulse per marker, the first time the map comes into view (not when it is already there at load).
  const map = el.querySelector('.ch07-map');
  if (!motion || !map) return;
  let first = true;
  const io = new IntersectionObserver(([e]) => {
    const wasFirst = first;
    first = false;
    if (!e.isIntersecting) return;
    io.disconnect();
    if (wasFirst) return;
    [...marks.values()].forEach((m, i) => m.querySelector('b')?.animate?.(
      [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.4)' }],
      { duration: PULSE_MS, delay: 200 + i * PULSE_GAP, easing: EASE_OUT },
    ));
  }, { threshold: 0.5 });
  io.observe(map);
}
