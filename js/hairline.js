const root = new URL('../', import.meta.url);
const figures = new Map();
const scripts = new Map();
window.hairline = (figure) => { figures.set(figure.name, figure); };

const load = (href) => {
  if (!scripts.has(href)) {
    scripts.set(href, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = href; s.async = false; s.onload = resolve; s.onerror = () => reject(new Error(`hairline: ${href}`));
      document.head.appendChild(s);
    }));
  }
  return scripts.get(href);
};

export function mountNear(el) {
  if (!('IntersectionObserver' in window)) return mountFigure(el);
  return new Promise((resolve, reject) => {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      mountFigure(el).then(resolve, reject);
    }, { rootMargin: '100% 0px' });
    io.observe(el);
  });
}

export async function mountFigure(el, { value } = {}) {
  const name = el.dataset.hairline;
  await load(new URL('vendor/hairline-kernel.js', root).href);
  if (!figures.has(name)) await load(new URL(`js/figures/${name}.js`, root).href);
  const figure = figures.get(name);
  if (!figure) throw new Error(`hairline: no figure "${name}"`);
  const { HL } = window;
  HL.inject(document);
  if (el.getAttribute('aria-hidden') !== 'true') { // a decorative figure stays out of the reading order
    el.setAttribute('role', 'img');
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', figure.means);
  }
  el.replaceChildren();
  const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, el);
  let text = 'rest';
  const read = { get textContent() { return text; }, set textContent(v) { text = String(v ?? ''); el.dataset.read = text; } };
  const handle = figure.mount({ stage: el, svg, read }, value ?? figure.range[1]);
  el.dataset.mounted = 'true';
  return { set: handle.set, destroy: handle.destroy, range: figure.range };
}
