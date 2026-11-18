// hand.js: the drawings that carry the numbers. The week is a hand: an articulated model whose 21 joints are lights,
// the wrist plus five fingers of four. Each finger is a day and each light is one habit, from the base: visit,
// conversations, follow-up, closing. A light is on when its own habit is done, so a gap shows what was missed.
// The hand is an illustration (team/art); a light is the same spot of a second image in which every joint is lit,
// so what turns on is the real thing and sits exactly on its joint. Where the joints are comes from art.js.
import { h, s, t, lock, reduce, EASE, buzz, upper, wdShort, wdLong, num, face, countTo } from './ui.js';
import { HAND } from './art.js';

const GLOW = 1.72;   // a light is shown a little wider than its joint, so its halo comes with it

/** One light: the piece of the lit image that sits on this joint. The image itself is named in the stylesheet. */
function light(j) {
  const R = j.r * GLOW, node = h('span', { class: 'jt' }), st = node.style;
  st.left = `${((j.x - R) * 100).toFixed(3)}%`; st.top = `${((j.y - R) * 100).toFixed(3)}%`;
  st.width = `${(R * 200).toFixed(3)}%`; st.height = `${(R * 200).toFixed(3)}%`;
  st.backgroundSize = `${(100 / (2 * R)).toFixed(2)}% ${(100 / (2 * R)).toFixed(2)}%`;
  st.backgroundPosition = `${(((j.x - R) / (1 - 2 * R)) * 100).toFixed(3)}% ${(((j.y - R) / (1 - 2 * R)) * 100).toFixed(3)}%`;
  return node;
}

/** Build the hand once, inside `el`. `mini` is the small one on a row: no labels, no bones, nothing to tap. */
export function buildHand(el, { mini = false } = {}) {
  el.replaceChildren();
  el.classList.add('ahand'); el.classList.toggle('mini', mini);
  const nodes = { wrist: light(HAND.wrist), joints: [], bones: [], labels: [], hits: [], ring: null };
  if (!mini) {
    // a bone runs between two lights of the same finger, from the edge of one joint to the edge of the next
    const svg = s('svg', { viewBox: '0 0 1000 1000', 'aria-hidden': 'true', focusable: 'false' });
    HAND.fingers.forEach((finger, f) => {
      nodes.bones[f] = [0, 1, 2].map((k) => {
        const a = finger[k], b = finger[k + 1], d = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        const x1 = (a.x + ux * a.r * 1.05) * 1000, y1 = (a.y + uy * a.r * 1.05) * 1000, x2 = (b.x - ux * b.r * 1.05) * 1000, y2 = (b.y - uy * b.r * 1.05) * 1000;
        const len = Math.hypot(x2 - x1, y2 - y1).toFixed(1);
        const bone = s('line', { class: 'abone', x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), 'stroke-dasharray': len, 'stroke-dashoffset': len, 'data-len': len });
        svg.append(bone);
        return bone;
      });
    });
    nodes.ring = s('circle', { class: 'nextring', r: 30 });
    svg.append(nodes.ring);
    el.append(svg);
  }
  el.append(nodes.wrist);
  HAND.fingers.forEach((finger, f) => { nodes.joints[f] = finger.map((j) => { const n = light(j); el.append(n); return n; }); });
  if (!mini) {
    HAND.fingers.forEach((finger, f) => {
      const base = finger[0], prev = finger[2], tip = finger[3], d = Math.hypot(tip.x - prev.x, tip.y - prev.y), ux = (tip.x - prev.x) / d, uy = (tip.y - prev.y) / d;
      const label = h('span', { class: 'aday flabel' });
      label.style.left = `${((tip.x + ux * 0.085) * 100).toFixed(2)}%`; label.style.top = `${((tip.y + uy * 0.075) * 100).toFixed(2)}%`;
      // The tap area lies along the finger, from its base to past its tip, so two fingers never share a target.
      const hit = h('button', { class: 'ahit', type: 'button', 'data-day': String(f) });
      hit.style.left = `${(((base.x + tip.x) / 2) * 100).toFixed(2)}%`; hit.style.top = `${(((base.y + tip.y) / 2) * 100).toFixed(2)}%`;
      hit.style.setProperty('--a', `${((Math.atan2(tip.x - base.x, -(tip.y - base.y)) * 180) / Math.PI).toFixed(1)}deg`);
      el.append(label, hit);
      nodes.labels[f] = label; nodes.hits[f] = hit;
    });
  }
  el.hand = nodes;
  return el;
}

/** Light the week on the hand. days: five entries { day?, kind: 'work'|'rest'|'future', habits: [4] }. `next` is the
 *  habit today still asks for: its joint carries a ring. Returns how long the lights take to come on, in milliseconds. */
export function paintHand(el, days, { wrist = false, today = null, animate = false, next = null, labels = true, step = 70 } = {}) {
  const nodes = el.hand, live = animate && !reduce;
  let k = 0, ringAt = null;
  const set = (node, on) => {
    if (node.classList.contains('on') === on) return;
    if (on && live) { const wait = k * step; k += 1; setTimeout(() => node.classList.add('on'), wait); } else node.classList.toggle('on', on);
  };
  set(nodes.wrist, !!wrist);
  days.slice(0, 5).forEach((d, f) => {
    const lit = d.kind === 'work' ? d.habits : [false, false, false, false], isToday = !!today && d.day === today;
    lit.forEach((on, j) => set(nodes.joints[f][j], !!on));
    (nodes.bones[f] || []).forEach((bone, j) => {
      const on = !!(lit[j] && lit[j + 1]);
      bone.style.transitionDelay = on && live ? `${k * step + 90}ms` : '0ms';
      bone.setAttribute('stroke-dashoffset', on ? '0' : bone.dataset.len);
      bone.classList.toggle('on', on);
    });
    if (isToday && d.kind === 'work' && next != null && !lit[next]) ringAt = HAND.fingers[f][next];
    const label = nodes.labels[f], hit = nodes.hits[f];
    if (label && labels && d.day) {
      label.textContent = upper(wdShort(d.day));
      label.classList.toggle('today', isToday); label.classList.toggle('rest', d.kind === 'rest'); label.classList.toggle('full', d.kind === 'work' && lit.every(Boolean) && !isToday);
    }
    if (hit) {
      hit.classList.toggle('rest', d.kind === 'rest');
      if (d.day) hit.setAttribute('aria-label', d.kind === 'rest' ? t('hand.finger.rest.aria', { day: wdLong(d.day) }) : t('hand.finger.aria', { day: wdLong(d.day), a: lit.filter(Boolean).length }));
    }
  });
  if (nodes.ring) {
    nodes.ring.classList.toggle('show', !!ringAt);
    if (ringAt) { nodes.ring.setAttribute('cx', (ringAt.x * 1000).toFixed(1)); nodes.ring.setAttribute('cy', (ringAt.y * 1000).toFixed(1)); nodes.ring.setAttribute('r', (ringAt.r * 1000).toFixed(1)); }
  }
  if (k) buzz(12);
  return k * step;
}

/** The hand puts itself together: every light that is on goes out and locks on again, the wrist first, then each
 *  finger from its base. Returns how long it takes, in milliseconds. */
export function replayHand(el, { fast = false } = {}) {
  if (reduce || !el || !el.hand) return 0;
  const step = fast ? 35 : 70, lit = [el.hand.wrist, ...el.hand.joints.flat()].filter((n) => n.classList.contains('on'));
  lit.forEach((n, i) => { n.classList.remove('on'); setTimeout(() => { if (n.isConnected) n.classList.add('on'); }, 80 + i * step); });
  return 80 + lit.length * step + 220;
}

/** The hand explains itself on the real object, in four beats: each finger is a day; each light is a habit, from the
 *  base to the tip; four lights are a finger; five fingers are the hand. `say(n)` is told which beat started,
 *  `beat(n, ms)` how long it lasts, `hot(j)` which habit is being lit (-1 for none), and `done()` runs once, when it
 *  ends or is stopped: the caller then paints what is true. Returns the function that stops it. */
export function teachHand(el, { finger = 2, say = () => {}, beat = () => {}, hot = () => {}, done = () => {} } = {}) {
  let alive = true;
  const timers = [], labels = el.hand.labels;
  const wait = (ms) => new Promise((r) => { timers.push(setTimeout(r, reduce ? 0 : ms)); });
  const demo = [0, 1, 2, 3, 4].map(() => [false, false, false, false]);
  const show = (wrist = false, animate = false) => paintHand(el, demo.map((habits) => ({ kind: 'work', habits })), { wrist, animate, labels: false });
  const point = (f) => labels.forEach((l, i) => l.classList.toggle('point', i === f));
  const end = () => { if (!alive) return; alive = false; timers.forEach(clearTimeout); point(-1); hot(-1); done(); };
  (async () => {
    show();
    beat(0, 2300); say(1);
    for (let f = 0; f < 5 && alive; f += 1) { demo[f][0] = true; show(); point(f); await wait(340); }
    await wait(600); if (!alive) return;
    for (let f = 0; f < 5; f += 1) demo[f][0] = false;
    show(); point(finger);
    beat(1, 3000); say(2);
    for (let j = 0; j < 4 && alive; j += 1) { demo[finger][j] = true; show(); hot(j); await wait(640); }
    await wait(440); if (!alive) return;
    hot(-1); beat(2, 1700); say(3);
    await wait(1700); if (!alive) return;
    point(-1); beat(3, 2600); say(4);
    for (const f of [0, 1, 2, 3, 4].filter((x) => x !== finger)) { if (!alive) return; demo[f] = [true, true, true, true]; show(true, true); await wait(330); }
    await wait(1300);
    end();
  })();
  return end;
}

/** A small hand for a row: the same object, its lights only. */
export function miniHand(days, wrist) {
  const el = buildHand(h('span', { class: 'ahand mini', 'aria-hidden': 'true' }), { mini: true });
  paintHand(el, days, { wrist });
  return el;
}
/** A row's hand from the table payload: the wrist is lit when the count holds one light more than the joints. */
export const rowWrist = (row) => row.marks > row.hand.reduce((a, d) => a + (d.kind === 'work' ? d.habits.filter(Boolean).length : 0), 0);

// ---- lenses: a round gauge with the recording arc ----
const R = 40, C = 2 * Math.PI * R, SPAN = 0.75;
/** A person's face in a lens with the recording arc. With a `share` (0 to 1) the arc measures something: it starts at
 *  the top and ends in its joint, and setPortrait moves it. Without one it is the brand's fixed arc. */
export function portrait(person, { share = null } = {}) {
  if (share == null) {
    const start = -100, sweep = 115, end = ((start + sweep) * Math.PI) / 180;   // from just left of the top, clockwise
    return h('span', { class: 'portrait' }, face(person),
      s('svg', { viewBox: '0 0 92 92', 'aria-hidden': 'true', focusable: 'false' },
        s('circle', { class: 'arc', cx: 46, cy: 46, r: R, 'stroke-dasharray': `${((C * sweep) / 360).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(${start} 46 46)` }),
        s('circle', { class: 'tip', cx: (46 + R * Math.cos(end)).toFixed(2), cy: (46 + R * Math.sin(end)).toFixed(2), r: 4.2 })));
  }
  const tipg = s('g', { class: 'tipg', 'data-empty': 'rotate(0deg)' }, s('circle', { class: 'tip', cx: 46, cy: 46 - R, r: 4.2 }));
  const node = h('span', { class: 'portrait measured' }, face(person),
    s('svg', { viewBox: '0 0 92 92', 'aria-hidden': 'true', focusable: 'false' },
      s('circle', { class: 'track', cx: 46, cy: 46, r: R }),
      s('circle', { class: 'arc', cx: 46, cy: 46, r: R, 'stroke-dasharray': `${C.toFixed(1)} ${C.toFixed(1)}`, 'stroke-dashoffset': C.toFixed(1), 'data-empty': C.toFixed(1), transform: 'rotate(-90 46 46)' }),
      tipg));
  setPortrait(node, share);
  return node;
}
export function setPortrait(node, share) {
  const p = Math.max(0, Math.min(1, Number(share) || 0));
  // Under a sliver the arc would only smear its own joint: the joint alone says "just started".
  node.querySelector('.arc').setAttribute('stroke-dashoffset', (C * (1 - (p < 0.06 ? 0 : p))).toFixed(1));
  node.querySelector('.tipg').style.transform = `rotate(${(360 * p).toFixed(1)}deg)`;
}
/** Arcs draw themselves in from empty: for a screen that has just arrived. Each one starts `step` ms after the last. */
export function drawIn(root, delay = 0, step = 70) {
  if (reduce || !root) return;
  let i = 0;
  for (const arc of root.querySelectorAll('.arc[data-empty]')) {
    if (!arc.animate || !arc.getBoundingClientRect().width) continue;
    const opts = { duration: 780, delay: delay + i * step, easing: EASE.track, fill: 'backwards' };
    arc.animate([{ strokeDashoffset: arc.dataset.empty }, { strokeDashoffset: arc.getAttribute('stroke-dashoffset') }], opts);
    const tip = arc.parentNode.querySelector('.tipg[data-empty]');
    if (tip && tip.style.transform) tip.animate([{ transform: tip.dataset.empty }, { transform: tip.style.transform }], opts);
    i += 1;
  }
}
export function lens(id, label) {
  const dash = `${(C * SPAN).toFixed(1)} ${C.toFixed(1)}`;
  return h('button', { class: 'lens', type: 'button', 'data-lens': id },
    h('span', { class: 'g' },
      s('svg', { viewBox: '0 0 92 92', 'aria-hidden': 'true', focusable: 'false' },
        s('circle', { class: 'disc', cx: 46, cy: 46, r: 33 }),
        s('circle', { class: 'track', cx: 46, cy: 46, r: R, 'stroke-dasharray': dash, transform: 'rotate(135 46 46)' }),
        s('circle', { class: 'arc', cx: 46, cy: 46, r: R, 'stroke-dasharray': dash, 'stroke-dashoffset': (C * SPAN).toFixed(1), 'data-empty': (C * SPAN).toFixed(1), transform: 'rotate(135 46 46)' }),
        s('g', { class: 'tipg', 'data-empty': 'rotate(135deg)' }, s('circle', { class: 'tip', cx: 46 + R, cy: 46, r: 4.2 }))),
      h('span', { class: 'v num' })),
    h('span', { class: 'l', text: label }));
}
/** value / max fills the arc; with no max the arc is full and the lens just holds the number. */
export function setLens(node, value, max, unit = '') {
  const p = max ? Math.min(value / max, 1) : value > 0 ? 1 : 0;
  node.querySelector('.arc').setAttribute('stroke-dashoffset', (C * SPAN * (1 - p)).toFixed(1));
  node.querySelector('.tipg').style.transform = `rotate(${135 + 270 * p}deg)`;
  const tail = max ? `/${num(max)}` : unit, v = node.querySelector('.v');
  if (!v.firstChild) v.append(h('span', { class: 'vn' }), h('small'));
  countTo(v.firstChild, value); v.lastChild.textContent = tail; v.lastChild.hidden = !tail;
  node.setAttribute('aria-label', t('lens.aria', { label: node.querySelector('.l').textContent, value: `${num(value)}${max ? ` / ${num(max)}` : ` ${unit}`}`.trim() }));
}

// ---- the level, drawn as a bone: one joint per step, and the next level's first joint at the end ----
export function levelBone(level, steps, nextFloor) {
  // steps: the three floors of the current level. nextFloor: where the next level starts, or null at the top.
  const xs = [18, 112, 206, 302], y = 16, points = [...steps, nextFloor];
  const svg = s('svg', { class: 'lbone', viewBox: '0 0 320 46', role: 'img', 'aria-label': t('profile.bone.aria', { a: level.step, b: steps.length, level: t(`level.${level.name}`) }) });
  svg.append(s('line', { x1: xs[0], y1: y, x2: xs[3], y2: y, class: 'bone base' }));
  const span = level.next == null ? 0 : (level.xp - level.floor) / (level.next - level.floor);
  const reach = level.next == null ? xs[level.step - 1] : xs[level.step - 1] + (xs[level.step] - xs[level.step - 1]) * Math.min(1, Math.max(0, span));
  const lit = s('line', { x1: xs[0], y1: y, x2: xs[3], y2: y, class: 'bone on', pathLength: 100, 'stroke-dasharray': '100 100', 'stroke-dashoffset': (100 - 100 * (reach - xs[0]) / (xs[3] - xs[0])).toFixed(2) });
  svg.append(lit);
  points.forEach((floor, i) => {
    if (floor == null) return;
    svg.append(s('circle', { cx: xs[i], cy: y, r: i === 3 ? 4.6 : 5.6, class: `joint${i < level.step ? ' on' : ''}${i === 3 ? ' far' : ''}` }));
    svg.append(s('text', { x: xs[i], y: 40, class: 'flabel num', 'text-anchor': i === 0 ? 'start' : i === 3 ? 'end' : 'middle' }, num(floor)));
  });
  return svg;
}

// ---- badges: a small constellation per badge; its joints light as the levels are reached ----
const SIDES = { first_log: 3, first_meeting: 4, streak: 5, full_hand: 6, visits: 7, first_site_live: 8 };
export function badgeGlyph(code, level, levels) {
  const k = SIDES[code] || 5, Rr = 21, pts = Array.from({ length: k }, (_, j) => { const a = -Math.PI / 2 + j * 2 * Math.PI / k; return [36 + Rr * Math.cos(a), 36 + Rr * Math.sin(a)]; });
  const step = k % 2 ? 2 : k % 3 === 0 ? 1 : 3;   // a single stroke that visits every joint
  const path = `${pts.map((_, j) => pts[(j * step) % k]).map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')}Z`;
  const share = levels > 0 ? level / levels : 0, litCount = Math.round(k * share);
  return s('svg', { viewBox: '0 0 72 72', 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { class: 'disc', cx: 36, cy: 36, r: 34 }), s('path', { class: 'bn', d: path }),
    pts.map((p, j) => s('circle', { class: `bj${j < litCount ? ' on' : ''}`, cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3 })));
}

// ---- drawings for a moment: a finger that fills, and the whole hand ----
/** One finger, upright: the wrist and its four joints lock from the base, each bone drawing after its joint. */
export function fingerGlyph() {
  const ys = [132, 104, 76, 48, 20], svg = s('svg', { viewBox: '0 0 150 150', 'aria-hidden': 'true', focusable: 'false' });
  const bones = ys.slice(1).map((y, i) => s('line', { class: 'fg-bone', x1: 75, y1: ys[i], x2: 75, y2: y, pathLength: 1, 'stroke-dasharray': '1 1' }));
  const joints = ys.map((y, i) => s('circle', { class: 'fg-j', cx: 75, cy: y, r: i ? 8 : 9.5 }));
  svg.append(...bones, ...joints);
  if (!reduce && svg.animate) {
    joints.forEach((j, i) => j.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 200, delay: 260 + i * 130, easing: EASE.lock, fill: 'backwards' }));
    bones.forEach((b, i) => b.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 240, delay: 330 + i * 130, easing: EASE.track, fill: 'backwards' }));
  }
  return svg;
}
/** The week's hand as it stands, large, putting itself together. */
export function handGlyph(days, wrist) {
  const el = buildHand(h('span', { class: 'ahand mini big', 'aria-hidden': 'true' }), { mini: true });
  paintHand(el, days, { wrist });
  setTimeout(() => replayHand(el), 240);
  return el;
}
/** The steps of a level as a row of joints: the ones reached lock from the left and their bones draw; the rest wait. */
export function stepsGlyph(lit, total) {
  const gap = 46, x0 = 75 - (gap * (total - 1)) / 2, svg = s('svg', { viewBox: '0 0 150 150', 'aria-hidden': 'true', focusable: 'false' });
  const xs = Array.from({ length: total }, (_, i) => x0 + i * gap);
  const rails = xs.slice(1).map((x, i) => s('line', { class: 'fg-rail', x1: xs[i], y1: 75, x2: x, y2: 75 }));
  const bones = xs.slice(1, lit).map((x, i) => s('line', { class: 'fg-bone', x1: xs[i], y1: 75, x2: x, y2: 75, pathLength: 1, 'stroke-dasharray': '1 1' }));
  const joints = xs.map((x, i) => s('circle', { class: i < lit ? 'fg-j' : 'fg-j off', cx: x, cy: 75, r: 10 }));
  svg.append(...rails, ...bones, ...joints);
  if (!reduce && svg.animate) {
    joints.slice(0, lit).forEach((j, i) => j.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, delay: 280 + i * 170, easing: EASE.lock, fill: 'backwards' }));
    bones.forEach((b, i) => b.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 260, delay: 360 + i * 170, easing: EASE.track, fill: 'backwards' }));
  }
  return svg;
}
/** A new rep's first days as a row of joints: the days gone by are filled, today carries the signal ring. */
export function daysBone(day, of, label) {
  const x0 = 9, gap = (300 - 2 * x0) / (of - 1), y = 11, xs = Array.from({ length: of }, (_, i) => x0 + i * gap);
  const svg = s('svg', { class: 'dbone', viewBox: '0 0 300 22', role: 'img', 'aria-label': label });
  svg.append(s('line', { class: 'rail', x1: xs[0], y1: y, x2: xs[of - 1], y2: y }), s('line', { class: 'gone', x1: xs[0], y1: y, x2: xs[day - 1], y2: y }),
    ...xs.map((x, i) => s('circle', { class: `dj${i < day - 1 ? ' on' : i === day - 1 ? ' now' : ''}`, cx: x.toFixed(1), cy: y, r: i === day - 1 ? 5.4 : 4.2 })));
  return svg;
}
