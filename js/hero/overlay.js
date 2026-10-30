
const NS = 'http://www.w3.org/2000/svg';
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_LOCK = 'cubic-bezier(0.34, 1.56, 0.64, 1)'; // --ease-lock
const EASE_TRACK = 'cubic-bezier(0.2, 0.8, 0.2, 1)'; // --ease-track
const D_JOINT = 160; // --d-joint
const D_BONE = 320; // --d-bone
const D_RING = 60; // --d-stagger
const JOINTS_AT = 80; // after the box corners start
const ring = (i) => (i === 0 ? 0 : ((i - 1) % 4) + 1);
export const PLATE_ZOOM = 1.03; // plates sit 3% zoomed so head-bob and parallax never reveal an edge
const TAG_H = 20; // a hand tag is a 20 px chip that sits 2 px off its box
const TAG_TOP = 66; // and never higher in the frame than this (16 px under a single HUD row)
const TOUCH = 4; // a tag leaves its spot above its box only when it comes this close to a chip or the other tag
const CLEAR = 8; // the HUD's own gap: the room a moved tag keeps from a chip, the other tag and the other hand
const HUD = '.hud, .hud .chip'; // the HUD row and its chips (hero.css)
const FLOOR = ['.ruler', '.hero-copy']; // what a tag stays above when it drops under its box: the ruler, the copy

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const TIPS = new Set([4, 8, 12, 16, 20]);

export function coverMap(width, height, w, h, zoom = PLATE_ZOOM, fy = 0.5) {
  const s0 = Math.max(width / w, height / h);
  const ox0 = (width - w * s0) / 2;
  const oy0 = (height - h * s0) * fy;
  return { s: s0 * zoom, ox: width / 2 + (ox0 - width / 2) * zoom, oy: height / 2 + (oy0 - height / 2) * zoom };
}

export function focusOf(el) {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--fy'));
  return Number.isFinite(v) ? v : 0.5;
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function bracketPaths(g, x, y, w, h, arm) {
  const corners = [
    { d: `M${x} ${y + arm}V${y}H${x + arm}`, dx: -1, dy: -1 },
    { d: `M${x + w - arm} ${y}H${x + w}V${y + arm}`, dx: 1, dy: -1 },
    { d: `M${x + w} ${y + h - arm}V${y + h}H${x + w - arm}`, dx: 1, dy: 1 },
    { d: `M${x + arm} ${y + h}H${x}V${y + h - arm}`, dx: -1, dy: 1 },
  ];
  return corners.map((c) => { const p = el('path', { d: c.d, class: 'trk-corner' }, g); p.dataset.dx = c.dx; p.dataset.dy = c.dy; return p; });
}

function tag(g, text) {
  const t = el('g', { class: 'trk-tag' }, g);
  el('rect', { height: TAG_H, rx: 1 }, t);
  el('text', {}, t).textContent = text;
  t.dataset.text = text;
  return t;
}

function tagWidth(t) {
  const label = t.lastElementChild;
  const len = label.getComputedTextLength ? label.getComputedTextLength() : 0;
  return Math.ceil(len || t.dataset.text.length * 8) + 14;
}

function moveTag(t, { x, y, width, side }) {
  const [bg, label] = t.children;
  bg.setAttribute('x', x.toFixed(1));
  bg.setAttribute('y', y.toFixed(1));
  bg.setAttribute('width', width);
  label.setAttribute('x', (x + 7).toFixed(1));
  label.setAttribute('y', (y + 14).toFixed(1));
  t.dataset.side = side;
}

export function placeTags(items, { width, chips, floor }) {
  const near = (a, b, pad) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
  const spots = [];
  for (const { box, width: w } of items) {
    const at = (y, side) => ({ x: Math.min(Math.max(box.x, 28), width - 140), y, width: w, height: TAG_H, side });
    const hit = (r, pad) => chips.find((c) => near(r, c, pad)) || spots.find((s) => near(r, s, pad));
    let spot = at(Math.max(box.y - TAG_H - 2, TAG_TOP), 'above');
    if (hit(spot, TOUCH)) {
      const below = at(box.y + box.height + 2, 'below');
      const others = items.filter((o) => o.box !== box).map((o) => o.box);
      for (const b of others) if (near(below, b, CLEAR)) below.x = b.x + b.width / 2 < box.x + box.width / 2 ? b.x + b.width + CLEAR : b.x - CLEAR - w;
      const hangs = below.x >= 28 && below.x + w <= width - 28 && below.x < box.x + box.width && below.x + w > box.x;
      if (hangs && below.y + TAG_H + CLEAR <= floor && !hit(below, CLEAR) && !others.some((b) => near(below, b, CLEAR))) spot = below;
      else for (let o = hit(spot, CLEAR), n = 0; o && n < 16; o = hit(spot, CLEAR), n++) spot = at(o.y + o.height + CLEAR, 'down');
    }
    spots.push(spot);
  }
  return spots;
}

const watchers = new WeakMap(); // svg: the observer that places its tags again when the HUD changes size

export function drawShot(svg, shot, orient, strings) {
  const src = shot[orient];
  const { width, height } = svg.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${Math.round(width)} ${Math.round(height)}`);
  svg.replaceChildren();
  watchers.get(svg)?.disconnect();
  watchers.delete(svg);
  if (!src || !shot.hands) return { lock: () => Promise.resolve(), release: () => Promise.resolve(), parts: [] };

  const { s, ox, oy } = coverMap(width, height, src.w, src.h, PLATE_ZOOM, focusOf(svg.parentElement));
  const map = ([x, y]) => [ox + x * s, oy + y * s];
  const root = el('g', { class: 'trk' }, svg);
  const corners = [];
  const labeled = [];
  const joints = [];
  const bones = [];


  for (const hand of src.hands) {
    const pts = hand.points.map(map);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 14;
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const g = el('g', { class: 'trk-hand' }, root);
    corners.push(...bracketPaths(g, x, y, w, h, 16));
    for (const [a, b] of BONES) {
      const [x1, y1] = pts[a].map((v) => v.toFixed(1));
      const line = el('line', { x1, y1, x2: pts[b][0].toFixed(1), y2: pts[b][1].toFixed(1), class: 'trk-bone' }, g);
      line.style.transformOrigin = `${x1}px ${y1}px`; // grows out of its first joint (view-box units are CSS px here)
      line.dataset.ring = String(ring(a));
      bones.push(line);
    }
    pts.forEach(([px, py], i) => {
      const j = el('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: i === 0 ? 3.5 : TIPS.has(i) ? 3 : 2.25, class: 'trk-joint' }, g);
      j.dataset.ring = String(ring(i));
      joints.push(j);
    });
    const label = hand.side === 'L' ? strings.hand_l : strings.hand_r;
    if (label) labeled.push({ box: { x, y, width: w, height: h }, tag: tag(g, label.toLocaleUpperCase()) });
  }
  const tags = labeled.map((l) => l.tag);

  const frame = svg.parentElement;
  const scope = frame.closest('.hero') || frame;
  const shown = (n) => !!n && n.getClientRects().length > 0;
  function place() {
    if (!svg.isConnected) return;
    const f = svg.getBoundingClientRect();
    const rel = (n) => { const b = n.getBoundingClientRect(); return { x: b.left - f.left, y: b.top - f.top, width: b.width, height: b.height }; };
    const chips = [...frame.querySelectorAll('.hud .chip')].filter(shown).map(rel);
    const floor = Math.min(height, ...FLOOR.map((s) => scope.querySelector(s)).filter(shown).map((n) => rel(n).y));
    const spots = placeTags(labeled.map((l) => ({ box: l.box, width: tagWidth(l.tag) })), { width, chips, floor });
    labeled.forEach((l, i) => moveTag(l.tag, spots[i]));
  }
  if (labeled.length) {
    place();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(place);
      frame.querySelectorAll(HUD).forEach((n) => ro.observe(n));
      watchers.set(svg, ro);
    }
  }

  const canAnimate = typeof root.animate === 'function';

  function lock() {
    if (!canAnimate) return Promise.resolve();
    const anims = [];
    corners.forEach((c, i) => {
      const dx = c.dataset.dx * 16;
      const dy = c.dataset.dy * 16;
      anims.push(c.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }, { transform: 'translate(0, 0)', opacity: 1 }],
        { duration: 240, delay: Math.floor(i / 4) * 60, easing: EASE_OUT, fill: 'backwards' }));
    });
    joints.forEach((j) => anims.push(j.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: D_JOINT, delay: JOINTS_AT + j.dataset.ring * D_RING, easing: EASE_LOCK, fill: 'backwards' })));
    bones.forEach((b) => anims.push(b.animate([{ transform: 'scale(0.02)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: D_BONE, delay: JOINTS_AT + b.dataset.ring * D_RING + D_JOINT, easing: EASE_TRACK, fill: 'backwards' })));
    const tagsAt = JOINTS_AT + 4 * D_RING + D_JOINT + D_BONE / 2;
    tags.forEach((t, i) => anims.push(t.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 240, delay: tagsAt + i * D_RING, easing: EASE_OUT, fill: 'backwards' })));
    return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {});
  }

  function release() {
    if (!canAnimate) { svg.replaceChildren(); return Promise.resolve(); }
    const a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: EASE_OUT, fill: 'forwards' });
    return a.finished.catch(() => {}).then(() => {});
  }

  return { lock, release, parts: { corners, joints, bones, tags } };
}
