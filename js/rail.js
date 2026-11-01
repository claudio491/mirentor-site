import { loadGsap } from './vendor.js';
import { mountFigure } from './hairline.js';

const WIDE = '(min-width: 1280px)';

export async function initRail({ tier }) {
  const rail = document.querySelector('.rail'), bar = document.querySelector('.rail-bar');
  const first = document.getElementById('experiencia');
  if ((!rail && !bar) || !first) return;
  const { ScrollTrigger } = await loadGsap();
  const root = document.documentElement;
  const px = (name, or) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || or;
  const showAt = () => `top ${px('--header-h', 64) + px('--rail-bar-h', 0) + 1}px`;
  const toEnd = () => ScrollTrigger.maxScroll(window) + 1;
  ScrollTrigger.create({ trigger: first, start: showAt, end: toEnd, refreshPriority: -1, onToggle: (s) => root.classList.toggle('rail-on', s.isActive) });

  const column = rail ? [...rail.querySelectorAll('.rail-list a')] : [];
  const strip = bar ? [...bar.querySelectorAll('.rail-bar-list a')] : [];
  const ids = (column.length ? column : strip).map((a) => a.hash.slice(1));
  const rows = ids.map((id) => [...column, ...strip].filter((a) => a.hash === `#${id}`));
  const vf = rail?.querySelector('.rail-vf'), list = bar?.querySelector('.rail-bar-list'), mq = matchMedia(WIDE);
  let active = -1;
  const place = () => { if (vf && active >= 0 && column[active]) vf.style.transform = `translateY(${column[active].parentElement.offsetTop}px)`; };
  const inSight = () => {
    const a = strip[active];
    if (!list || !a || getComputedStyle(bar).display === 'none') return;
    const left = list.scrollLeft + a.getBoundingClientRect().left - list.getBoundingClientRect().left - parseFloat(getComputedStyle(list).paddingLeft);
    list.scrollTo({ left, behavior: tier === 'still' ? 'auto' : 'smooth' });
  };
  const setActive = (i) => {
    if (i === active) return;
    active = i;
    rows.forEach((links, j) => links.forEach((a) => (j === i ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'))));
    vf?.classList.toggle('is-on', i >= 0);
    place();
    inSight();
  };
  ScrollTrigger.addEventListener('refresh', place);
  mq.addEventListener('change', inSight); // a window narrowed past 1280 px shows the bar where it should be
  ids.forEach((id, i) => {
    const section = document.getElementById(id), bones = rows[i].map((a) => a.querySelector('.rail-bone b'));
    if (!section) return;
    ScrollTrigger.create({
      trigger: section, start: 'top center', end: 'bottom center',
      onToggle: (s) => { if (s.isActive) setActive(i); else if (active === i) setActive(-1); },
      onUpdate: (s) => {
        bones.forEach((b) => { b.style.transform = `scaleX(${s.progress.toFixed(4)})`; });
        rows[i].forEach((a) => a.toggleAttribute('data-done', s.progress > 0.98));
      },
    });
  });
  ScrollTrigger.refresh();

  if (!rail) return;
  const mount = () => mountFigure(rail.querySelector('.rail-fig')).then((fig) => {
    if (tier === 'still') return; // reduced motion: the figure keeps its rest pose, the pointer still turns it
    const [lo, , hi] = fig.range;
    ScrollTrigger.create({ trigger: first, start: showAt, end: () => ScrollTrigger.maxScroll(window), refreshPriority: -1, onUpdate: (s) => fig.set(lo + (hi - lo) * s.progress) });
  }).catch((err) => { rail.dataset.figureError = String(err.message || err); });
  if (mq.matches) { mount(); return; }
  const later = (e) => { if (e.matches) { mq.removeEventListener('change', later); mount(); } };
  mq.addEventListener('change', later);
}
