const NS = 'http://www.w3.org/2000/svg';
const r1 = (n) => Math.round(n * 10) / 10;

export function route(points, r = 12) {
  const p = points.reduce((acc, q) => {
    const last = acc[acc.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.5) acc.push(q);
    return acc;
  }, []);
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, ay] = p[i - 1];
    const [bx, by] = p[i];
    const [cx, cy] = p[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay);
    const l2 = Math.hypot(cx - bx, cy - by);
    const k = Math.min(r, l1 / 2, l2 / 2);
    d += `L${r1(bx - ((bx - ax) / l1) * k)} ${r1(by - ((by - ay) / l1) * k)}`;
    d += `Q${r1(bx)} ${r1(by)} ${r1(bx + ((cx - bx) / l2) * k)} ${r1(by + ((cy - by) / l2) * k)}`;
  }
  const z = p[p.length - 1];
  return `${d}L${r1(z[0])} ${r1(z[1])}`;
}

export function chevron([x, y], [dx, dy], s = 6) {
  return `M${r1(x - dx * s - dy * s)} ${r1(y - dy * s + dx * s)}L${r1(x)} ${r1(y)}L${r1(x - dx * s + dy * s)} ${r1(y - dy * s - dx * s)}`;
}

function box(el, o) {
  const b = el.getBoundingClientRect();
  return { l: b.left - o.left, r: b.right - o.left, t: b.top - o.top, b: b.bottom - o.top, cx: (b.left + b.right) / 2 - o.left, cy: (b.top + b.bottom) / 2 - o.top };
}

function shapes(svg, n, tag, cls) {
  return Array.from({ length: n }, (_, i) => {
    const s = document.createElementNS(NS, tag);
    s.setAttribute('class', cls);
    if (cls === 'ln') s.setAttribute('pathLength', '1');
    if (tag === 'circle') s.setAttribute('r', '4.5');
    s.style.setProperty('--k', String(i));
    svg.appendChild(s);
    return s;
  });
}

function fit(svg, host) {
  svg.setAttribute('viewBox', `0 0 ${host.clientWidth} ${host.clientHeight}`);
}

function drawStreams(split, lines, joints) {
  fit(split.querySelector('.ch04-streams'), split);
  const o = split.getBoundingClientRect();
  const hour = box(split.querySelector('.ch04-hour'), o);
  const slots = [...split.querySelectorAll('.ch04-share .slot')].map((s) => box(s, o));
  if (slots.length !== lines.length) return;
  const across = hour.r < slots[0].l;
  const sy = Math.abs(hour.cy - slots[1].cy) <= 8 ? slots[1].cy : hour.cy;
  const xm = (hour.r + slots[0].l) / 2;
  slots.forEach((s, i) => {
    const pts = across
      ? [[hour.r, sy], [xm, sy], [xm, s.cy], [s.l, s.cy]]
      : [[s.l - 28, hour.b], [s.l - 28, s.cy], [s.l, s.cy]];
    lines[i].setAttribute('d', route(pts, across ? 16 : 10));
    joints[i].setAttribute('cx', r1(s.l));
    joints[i].setAttribute('cy', r1(s.cy));
  });
}

function drawLoop(loop, lines, heads) {
  fit(loop.querySelector('.ch04-loop-lines'), loop);
  const o = loop.getBoundingClientRect();
  const items = [...loop.querySelectorAll('.ch04-loop-list li')];
  if (items.length !== 3) return;
  const pt = items.map((li) => box(li.querySelector('.ch04-pt'), o));
  const tx = items.map((li) => box(li.querySelector('.ch04-loop-text'), o));
  const gap = 16; // from a dot centre to where a line stops
  const across = Math.abs(pt[1].cy - pt[0].cy) < 4;
  const segs = [];
  if (across) {
    for (let i = 0; i < 2; i++) segs.push([[tx[i].r + 16, pt[i].cy], [pt[i + 1].cx - gap, pt[i + 1].cy]]);
    const y = Math.max(...tx.map((t) => t.b)) + 32;
    segs.push([[pt[2].cx, pt[2].cy + gap], [pt[2].cx, y], [pt[0].cx, y], [pt[0].cx, pt[0].cy + gap]]);
  } else {
    for (let i = 0; i < 2; i++) segs.push([[pt[i].cx, pt[i].cy + gap], [pt[i + 1].cx, pt[i + 1].cy - gap]]);
    const x = 8;
    segs.push([[pt[2].cx - gap, pt[2].cy], [x, pt[2].cy], [x, pt[0].cy], [pt[0].cx - gap, pt[0].cy]]);
  }
  segs.forEach((s, i) => {
    lines[i].setAttribute('d', route(s, 12));
    const [a, b] = s.slice(-2);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    heads[i].setAttribute('d', chevron(b, [(b[0] - a[0]) / len, (b[1] - a[1]) / len]));
  });
}

export function init(el, { tier } = {}) {
  const split = el.querySelector('.ch04-split');
  const band = el.querySelector('.ch04-band');
  const loop = el.querySelector('.ch04-loop');
  if (!split || !band || !loop) return;

  const sSvg = split.querySelector('.ch04-streams');
  const lSvg = loop.querySelector('.ch04-loop-lines');
  const streams = shapes(sSvg, 3, 'path', 'ln');
  const joints = shapes(sSvg, 3, 'circle', 'jt');
  const ring = shapes(lSvg, 3, 'path', 'ln');
  const heads = shapes(lSvg, 3, 'path', 'hd');
  const layout = () => { drawStreams(split, streams, joints); drawLoop(loop, ring, heads); };
  layout();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(layout);
    ro.observe(split);
    ro.observe(loop);
  } else {
    addEventListener('resize', layout);
  }
  document.fonts?.ready.then(layout);

  const still = tier === 'still' || !('IntersectionObserver' in window);
  for (const [target, cls, line] of [[split, 'is-drawn', '-40%'], [band, 'is-on', '-20%'], [loop, 'is-on', '-20%']]) {
    if (still || target.getBoundingClientRect().top < innerHeight) { target.classList.add(cls); continue; }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      target.classList.add(cls);
    }, { rootMargin: `0px 0px ${line} 0px` });
    io.observe(target);
    target.classList.add('is-armed');
  }
  el.dataset.ready = 'true';
}
