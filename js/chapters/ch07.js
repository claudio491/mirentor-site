
export const CITIES = {
  panama: { tz: 'America/Panama', code: 'PA' },
  medellin: { tz: 'America/Bogota', code: 'CO' },
  lima: { tz: 'America/Lima', code: 'PE' },
  cdmx: { tz: 'America/Mexico_City', code: 'MX' },
};
const ROUTES = [['panama', 'medellin'], ['medellin', 'lima'], ['panama', 'cdmx']];
const JOINT_MS = 160;
const RING_MS = 320;
const RING_LAG = 60;
const BONE_MS = 320;
const BONE_GAP = 80;
const LEAD_MS = 240;
const CARD_MS = 240;
const HOVER_MS = 90;
const PICK_PX = 18;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_LOCK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const EASE_TRACK = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function pickDefault(visitorTz, ids = Object.keys(CITIES)) {
  return ids.find((id) => CITIES[id]?.tz === visitorTz) || ids[0];
}

export function localTime(date, tz, lang = 'es') {
  const opts = lang === 'en' ? { timeZone: tz, hour: 'numeric', minute: '2-digit' } : { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-419', opts).format(date).replace(/\s/g, '\u00a0');
}

export function utcOffset(date, tz) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
  const v = (part?.value || 'GMT').replace('GMT', 'UTC').replace('−', '-');
  return v === 'UTC' ? 'UTC+0' : v;
}

export function entrance(routes = ROUTES) {
  const lock = { [routes[0][0]]: 0 };
  let last = 0;
  const bones = routes.map(([from, to]) => {
    const start = last + BONE_GAP;
    lock[to] = last = start + BONE_MS;
    return { from, to, start };
  });
  return { lock, bones };
}

export function init(el, { tier = 'full', lang = document.documentElement.lang } = {}) {
  const stage = el.querySelector('[data-stage]');
  const map = el.querySelector('.ch07-map');
  const links = [...el.querySelectorAll('a[data-city]')];
  const cards = new Map([...el.querySelectorAll('[data-card]')].map((c) => [c.dataset.card, c]));
  const marks = new Map([...el.querySelectorAll('[data-mk]')].map((m) => [m.dataset.mk, m]));
  const leads = new Map([...el.querySelectorAll('[data-lead]')].map((l) => [l.dataset.lead, l]));
  if (!stage || !links.length || !cards.size) return;
  const motion = tier !== 'still';
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const text = (node) => (node ? node.textContent.trim() : '');
  let current = '';

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
    for (const [k, l] of leads) l.classList.toggle('is-sel', k === id);
    for (const [k, c] of cards) c.classList.toggle('is-on', k === id);
    if (!animate || !motion) return;
    cards.get(id).animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: CARD_MS, easing: EASE_OUT });
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

  if (fine) {
    let intent = 0, aimed = '';
    const rest = (id) => {
      if (id === aimed) return;
      aimed = id;
      clearTimeout(intent);
      if (id) intent = setTimeout(() => select(id, { animate: true }), HOVER_MS);
    };
    const near = (e) => {
      let best = '', d = PICK_PX;
      for (const [id, m] of marks) {
        const r = m.getBoundingClientRect();
        const k = Math.hypot(e.clientX - r.left, e.clientY - r.top);
        if (k <= d) { d = k; best = id; }
      }
      return best;
    };
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const label = e.target.closest?.('a[data-city]');
      const id = label ? label.dataset.city : near(e);
      map.style.cursor = !label && id ? 'pointer' : '';
      rest(id);
    });
    stage.addEventListener('pointerleave', () => rest(''));
    map.addEventListener('click', (e) => { const id = near(e); if (id) select(id, { animate: true }); });
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

  if (!('IntersectionObserver' in window) || !map) return;
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { rootMargin: '200px 0px' }).observe(el);

  const origin = (() => { const m = marks.get('panama'); return [parseFloat(m?.style.getPropertyValue('--x')) / 100 || 0.28, parseFloat(m?.style.getPropertyValue('--y')) / 100 || 0.48]; })();
  let mount;
  const drawn = new Promise((r) => { mount = r; });
  const soon = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    soon.disconnect();
    mount(import('./ch07-map.js').then((m) => m.mountMap(map, { tier, origin, pointer: stage }))
      .catch((err) => { map.dataset.error = String(err.message || err); return null; }));
  }, { rootMargin: '100% 0px' });
  soon.observe(map);
  if (!motion) return;

  el.classList.add('is-armed');
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    Promise.race([drawn, new Promise((r) => setTimeout(r, 700))]).then(() => {
      play();
      drawn.then((api) => api?.wave());
    });
  }, { threshold: 0.4 });
  io.observe(map);

  function play() {
    el.classList.remove('is-armed'); // the final state underneath; each animation holds its first frame until it starts
    const { lock, bones } = entrance();
    for (const [id, m] of marks) {
      const at = lock[id] ?? 0;
      leads.get(id)?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: LEAD_MS, delay: at + RING_LAG, easing: EASE_TRACK, fill: 'backwards' });
      m.querySelector('b')?.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: JOINT_MS, delay: at, easing: EASE_LOCK, fill: 'backwards' });
      m.querySelector('i')?.animate([{ offset: 0, transform: 'scale(1.8)', opacity: 0 }], { duration: RING_MS, delay: at + RING_LAG, easing: EASE_LOCK, fill: 'backwards' });
    }
    for (const { from, to, start: at } of bones) {
      for (const line of el.querySelectorAll(`.ch07-net [data-from="${from}"][data-to="${to}"]`)) {
        line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: BONE_MS, delay: at, easing: EASE_TRACK, fill: 'backwards' });
      }
    }
  }
}
