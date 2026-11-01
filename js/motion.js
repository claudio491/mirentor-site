import { loadGsap, loadLenis } from './vendor.js';

const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const rootPx = (name, or) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || or;
const headerH = () => rootPx('--header-h', 64);
const topInset = () => headerH() + rootPx('--rail-bar-h', 0);

export async function initMotion({ tier }) {
  if (tier === 'still') return;
  const { gsap, ScrollTrigger, SplitText, CustomEase } = await loadGsap('SplitText');
  CustomEase.create('move', '0.65, 0, 0.35, 1'); // --ease-move: a thing travelling on screen
  if (tier === 'full' && finePointer()) await smoothScroll(gsap, ScrollTrigger);
  await document.fonts.ready;
  headlines(gsap, SplitText);
  kickers(gsap, SplitText);
  counters(gsap);
  draws(ScrollTrigger);
  waves(ScrollTrigger);
  cuts(gsap, ScrollTrigger);
  if (tier === 'full') parallax(gsap);
  if (finePointer()) viewfinder(gsap);
}

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
    const glide = e.detail > 0;
    lenis.scrollTo(target, {
      offset: -topInset(), duration: 1.2, immediate: !glide, force: true,
      onComplete: () => { land(target); if (glide) dispatchEvent(new CustomEvent('mirentor:landed', { detail: { link: a, target } })); },
    });
    history.pushState(null, '', `#${encodeURIComponent(id)}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  });
  window.mirentorLenis = lenis;
}

function headlines(gsap, SplitText) {
  for (const el of document.querySelectorAll('.ch-title')) {
    el.classList.add('mo-split');
    SplitText.create(el, {
      type: 'lines', mask: 'lines', linesClass: 'mo-line', autoSplit: true,
      onSplit: (self) => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
        self.lines.forEach((line, i) => {
          const scan = Object.assign(document.createElement('i'), { className: 'mo-scan' });
          scan.setAttribute('aria-hidden', 'true');
          line.parentElement.style.position = 'relative';
          line.parentElement.style.overflow = 'visible'; // the clip-path wipes; a mask clip would cut a hanging quote (ch05)

          line.parentElement.appendChild(scan);
          const at = i * 0.08, w = line.getBoundingClientRect().width;
          tl.fromTo(line, { clipPath: 'inset(-25% 100% -25% -1em)' }, { clipPath: 'inset(-25% 0% -25% -1em)', duration: 0.7, ease: 'track' }, at)
            .fromTo(scan, { x: 0, opacity: 1 }, { x: w, duration: 0.7, ease: 'track' }, at)
            .to(scan, { opacity: 0, duration: 0.16, ease: 'none' }, at + 0.6);
        });
        return tl;
      },
    });
  }
}

function counters(gsap) {
  const fmt = new Intl.NumberFormat(document.documentElement.lang || 'es');
  for (const el of document.querySelectorAll('[data-countup]')) {
    const to = Number(el.dataset.countup);
    if (!Number.isFinite(to)) continue;
    el.style.display = 'inline-block';
    el.style.minWidth = `${el.getBoundingClientRect().width}px`;
    el.style.textAlign = 'right';
    el.after(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: el.textContent }));
    el.setAttribute('aria-hidden', 'true');
    const n = { v: 0 };
    el.textContent = fmt.format(0);
    gsap.to(n, {
      v: to, duration: 1.2, ease: 'reveal', scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      onUpdate: () => { el.textContent = fmt.format(Math.round(n.v)); },
    });
  }
}

function kickers(gsap, SplitText) {
  for (const el of document.querySelectorAll('.ch-kicker')) {
    el.classList.add('mo-split');
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

function draws(ScrollTrigger) {
  const armed = new Map();
  let entering = [];
  const go = () => {
    const seen = entering.filter((el) => el.getBoundingClientRect().bottom >= 0);
    entering.filter((el) => !seen.includes(el)).forEach((el) => armed.get(el)());
    entering = seen;
    entering.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).forEach((el, i) => {
      el.style.setProperty('--mo-draw-d', `${i * 60}ms`);
      el.classList.add('is-drawing');
      setTimeout(armed.get(el), i * 60 + 700 + 160 + 40); // the rule, then its point going out
    });
    entering = [];
  };
  for (const el of document.querySelectorAll('[data-draw]')) {
    const side = el.dataset.draw === 'bottom' ? 'bottom' : 'top';
    const cs = getComputedStyle(el), w = parseFloat(cs.getPropertyValue(`border-${side}-width`)), r = el.getBoundingClientRect();
    const free = (p) => getComputedStyle(el, p).content === 'none';
    if (!w || cs.getPropertyValue(`border-${side}-style`) === 'none' || /^(inline|contents)$|^table/.test(cs.display) || !free('::before') || !free('::after')) continue;
    if ((side === 'top' ? r.top : r.bottom) < innerHeight) continue;
    const surface = el.closest('.ch--light, .ch--dark');
    const set = {
      [`border-${side}-color`]: 'transparent', '--mo-draw-c': cs.getPropertyValue(`border-${side}-color`), '--mo-draw-w': `${w}px`,
      '--mo-draw-l': `${-parseFloat(cs.borderLeftWidth)}px`, '--mo-draw-r': `${-parseFloat(cs.borderRightWidth)}px`, '--mo-draw-x': `${el.offsetWidth}px`,
      ...(surface?.classList.contains('ch--light') && { '--mo-draw-p': 'var(--signal-text)' }), // a signal mark on porcelain
      ...(cs.position === 'static' && { position: 'relative' }),
    };
    const own = Object.fromEntries(Object.keys(set).map((k) => [k, el.style.getPropertyValue(k)]));
    Object.entries(set).forEach(([k, v]) => el.style.setProperty(k, v));
    el.classList.add('mo-draw');
    armed.set(el, () => {
      armed.delete(el);
      el.classList.remove('mo-draw', 'is-drawing');
      Object.entries(own).forEach(([k, v]) => (v ? el.style.setProperty(k, v) : el.style.removeProperty(k)));
      el.style.removeProperty('--mo-draw-d');
    });
    ScrollTrigger.create({
      trigger: el, start: side === 'top' ? 'clamp(top 90%)' : 'clamp(bottom 90%)', once: true,
      onEnter: () => { if (!entering.length) requestAnimationFrame(go); entering.push(el); },
    });
  }
  ScrollTrigger.addEventListener('refresh', () => armed.forEach((_, el) => el.style.setProperty('--mo-draw-x', `${el.offsetWidth}px`)));
}

function waves(ScrollTrigger) {
  for (const el of document.querySelectorAll('[data-wave]')) {
    if (!el.children.length || el.getBoundingClientRect().top < innerHeight) continue;
    el.classList.add('mo-wave');
    const last = Math.min(el.children.length, 8) - 1;
    ScrollTrigger.create({
      trigger: el, start: 'clamp(top 85%)', once: true,
      onEnter: () => { el.classList.add('is-in'); setTimeout(() => el.classList.remove('mo-wave', 'is-in'), last * 60 + 480 + 40); },
    });
  }
}

function cuts(gsap, ScrollTrigger) {
  const page = getComputedStyle(document.body).backgroundColor;
  const paint = (el) => { const c = getComputedStyle(el).backgroundColor; return /^rgba\(.*,\s*0\)$|^transparent$/.test(c) ? null : c; };
  const dark = (c) => { const [r, g, b] = c.match(/[\d.]+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128; };
  const blocks = [...document.querySelectorAll('main > section, body > footer')].filter((b) => b.offsetHeight > 0);
  const inner = (b, bg) => [...b.querySelectorAll('.ch--dark, .ch--light')].filter((n) => n.offsetHeight > 0 && paint(n) && paint(n) !== bg);
  const measured = [];
  const cross = (line) => {
    const s = { head: 0, tail: 0 };
    gsap.timeline({ onUpdate: () => { line.style.clipPath = `inset(0% ${(100 - s.head * 100).toFixed(2)}% 0% ${(s.tail * 100).toFixed(2)}%)`; }, onComplete: () => line.remove() })
      .to(s, { head: 1, duration: 0.7, ease: 'track' }, 0)
      .to(s, { tail: 1, duration: 0.7, ease: 'track' }, 0.16);
  };
  const cut = (host, at, y, trigger, start) => {
    if (y < innerHeight || getComputedStyle(host).position === 'static') return;
    const line = Object.assign(document.createElement('i'), { className: 'mo-cut' });
    line.setAttribute('aria-hidden', 'true');
    if (typeof at === 'function') measured.push([line, at]); else line.style[at] = '0';
    host.appendChild(line);
    ScrollTrigger.create({ trigger, start, once: true, onEnter: () => cross(line) });
  };
  blocks.forEach((b, k) => {
    const bg = paint(b) || page, box = b.getBoundingClientRect(), off = (n, edge) => n.getBoundingClientRect()[edge] - b.getBoundingClientRect().top;
    const nested = inner(b, bg);
    for (const n of nested) {
      const q = n.getBoundingClientRect(), nd = dark(paint(n)); // a dark surface takes the line on its own edge rows
      if (q.top > box.top + 1) cut(b, () => off(n, 'top') - (nd ? 0 : 1), q.top, n, 'clamp(top 85%)');
      if (q.bottom < box.bottom - 1) cut(b, () => off(n, 'bottom') - (nd ? 1 : 0), q.bottom, n, 'clamp(bottom 85%)');
    }
    if (!k) return;
    const prev = blocks[k - 1], pbox = prev.getBoundingClientRect(), pbg = paint(prev) || page;
    const tail = inner(prev, pbg).find((n) => Math.abs(n.getBoundingClientRect().bottom - pbox.bottom) < 1);
    const head = nested.find((n) => Math.abs(n.getBoundingClientRect().top - box.top) < 1);
    const above = tail ? paint(tail) : pbg, below = head ? paint(head) : bg;
    if (above === below) return;
    if (dark(above)) cut(prev, 'bottom', box.top, b, 'clamp(top 85%)'); else cut(b, 'top', box.top, b, 'clamp(top 85%)');
  });
  const place = () => measured.forEach(([line, at]) => { line.style.top = `${at()}px`; });
  place();
  ScrollTrigger.addEventListener('refresh', place);
}

function parallax(gsap) {
  for (const el of document.querySelectorAll('[data-parallax]')) {
    gsap.fromTo(el, { yPercent: -6 }, {
      yPercent: 6, ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }
}

function viewfinder(gsap) {
  const SEL = 'a[href], button, [data-vf], .fit-seg-key, .ch07-city';
  const vf = Object.assign(document.createElement('div'), { className: 'mo-vf' });
  vf.setAttribute('aria-hidden', 'true');
  vf.innerHTML = '<i></i><i></i><i></i><i></i>';
  document.body.appendChild(vf);
  const corners = [...vf.children];
  let target = null;
  const frame = (r, pad) => [[r.left - pad, r.top - pad], [r.right + pad, r.top - pad], [r.left - pad, r.bottom + pad], [r.right + pad, r.bottom + pad]];
  const place = (pad, duration) => {
    const at = frame(target.getBoundingClientRect(), pad);
    corners.forEach((c, i) => gsap.to(c, { x: at[i][0], y: at[i][1], duration, ease: 'lock', overwrite: true }));
  };
  const show = (on) => gsap.to(vf, { opacity: on ? 1 : 0, duration: 0.12, ease: 'none', overwrite: true });
  const gone = new ResizeObserver(() => { if (target && (!target.isConnected || !target.getClientRects().length)) { target = null; show(false); } });
  let watched = null;
  const watch = (t) => { if (watched) gone.unobserve(watched); watched = t; if (t) gone.observe(t); };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.(SEL);
    if (!t || t === target || t.closest('.mo-vf')) return;
    const fresh = !target;
    target = t;
    watch(t);
    vf.classList.toggle('on-light', !!t.closest('.ch--light'));
    if (fresh) place(12, 0);
    place(6, 0.22);
    show(true);
  });
  document.addEventListener('pointerout', (e) => {
    if (!target || !target.contains(e.target) || e.relatedTarget?.closest?.(SEL)) return;
    target = null;
    show(false);
  });
  let seenY = scrollY;
  document.addEventListener('scroll', (e) => {
    if (e.target === document) {
      const moved = scrollY !== seenY;
      seenY = scrollY;
      if (!moved) return;
    } else if (!target || !e.target.contains?.(target)) return;
    if (!target) return;
    const r = target.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { target = null; show(false); } else place(6, 0);
  }, { capture: true, passive: true });

  const landOn = (link, section) => {
    if (!link?.matches('.header-cta') || (target && target !== link)) return; // the pointer has moved on: it leads
    const form = section?.querySelector('form');
    const submit = form?.querySelector('[type="submit"]'), field = form?.querySelector('input:not([type="hidden"]), select, textarea');
    const top = topInset();
    const whole = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= top && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
    const dest = submit && whole(submit) ? submit : field;
    const r = dest?.getBoundingClientRect();
    if (!r?.width || r.bottom < top || r.top > innerHeight) return;
    const from = frame(link.getBoundingClientRect(), 6), to = frame(r, 12), light = !!dest.closest('.ch--light'), head = headerH();
    target = dest;
    watch(dest);
    show(true);
    corners.forEach((c, i) => gsap.fromTo(c, { x: from[i][0], y: from[i][1] }, {
      x: to[i][0], y: to[i][1], duration: 0.36, ease: 'move', overwrite: true,
      ...(i === 0 && {
        onUpdate: () => vf.classList.toggle('on-light', light && gsap.getProperty(c, 'y') > head),
        onComplete: () => {
          vf.classList.toggle('on-light', light);
          if (target === dest) place(6, 0.22);
          section.addEventListener('transitionend', () => { if (target === dest) place(6, 0.22); }, { once: true });
        },
      }),
    }));
  };
  addEventListener('mirentor:landed', (e) => requestAnimationFrame(() => landOn(e.detail.link, e.detail.target)));
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('.header-cta');
    if (!a || window.mirentorLenis || !e.detail || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (location.hash === a.hash) landOn(a, document.getElementById(a.hash.slice(1))); }));
  });
}
