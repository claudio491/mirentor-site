// hand.js: the drawings that carry the numbers. The week is a tracked hand of 21 keypoints: the wrist plus five fingers
// of four joints. Each finger is a day and each joint is one habit, from the base: visit, conversations, follow-up, closing.
// A joint lights when its own habit is done, and a bone lights only between two lit points, so a gap shows what was missed.
import { h, s, t, lock, reduce, EASE, buzz, upper, wdShort, wdLong, num, face, countTo } from './ui.js';

const VIEW = [320, 346];   // the hand's drawing area

const WRIST = [160, 322];
const FINGERS = [
  [[118, 286], [86, 250], [62, 212], [46, 176]],
  [[122, 196], [112, 146], [106, 106], [102, 70]],
  [[158, 186], [158, 130], [158, 86], [158, 46]],
  [[194, 196], [204, 146], [210, 108], [214, 74]],
  [[228, 220], [246, 180], [258, 148], [268, 120]],
];
const LABELS = [[30, 156], [96, 50], [158, 26], [220, 54], [282, 104]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Build the hand once. `mini` is the small one on a table row: no labels, nothing to tap. */
export function buildHand(svg, { mini = false } = {}) {
  svg.replaceChildren();
  const bones = s('g', { class: 'bones' }), joints = s('g', { class: 'joints' });
  for (let i = 1; i < 4; i += 1) { const a = FINGERS[i][0], b = FINGERS[i + 1][0]; bones.append(s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'bone base palm' })); }
  FINGERS.forEach((finger, i) => {
    const group = s('g', { class: 'finger', 'data-f': i });
    let prev = WRIST;
    finger.forEach((pt, j) => {
      const len = dist(prev, pt).toFixed(1);
      bones.append(s('line', { x1: prev[0], y1: prev[1], x2: pt[0], y2: pt[1], class: 'bone base', 'data-f': i, 'data-j': j }));
      bones.append(s('line', { x1: prev[0], y1: prev[1], x2: pt[0], y2: pt[1], class: 'bone on', 'data-f': i, 'data-j': j, 'stroke-dasharray': len, 'stroke-dashoffset': len, 'data-len': len }));
      prev = pt;
    });
    finger.forEach((pt, j) => group.append(s('circle', { cx: pt[0], cy: pt[1], r: mini ? 12 : 5.6, class: 'joint', 'data-j': j })));
    if (!mini) {
      group.append(s('text', { x: LABELS[i][0], y: LABELS[i][1], class: 'flabel' }));
      // The tap area follows the finger from its first joint to past the tip, so two fingers never share a target.
      const tip = finger[3], before = finger[2], k = 16 / dist(before, tip), far = [tip[0] + (tip[0] - before[0]) * k, tip[1] + (tip[1] - before[1]) * k];
      group.append(s('path', { d: `M${[...finger, far].map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L')}`, class: 'hit', tabindex: 0, role: 'button', 'data-day': i }));
    }
    joints.append(group);
  });
  joints.append(s('circle', { cx: WRIST[0], cy: WRIST[1], r: mini ? 13 : 6.6, class: 'joint wrist' }));
  svg.append(bones, joints);
  if (!mini) {
    const hot = (e, on) => { const hit = e.target.closest && e.target.closest('.hit'); if (!hit) return;
      hit.parentNode.classList.toggle('hot', on); for (const b of svg.querySelectorAll(`.bone.base[data-f="${hit.dataset.day}"]`)) b.classList.toggle('hot', on); };
    svg.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') hot(e, true); });
    svg.addEventListener('pointerout', (e) => hot(e, false));
  }
  return svg;
}

/** Paint the week on the hand. days: five entries { day?, kind: 'work'|'rest'|'future', habits: [4] }. */
export function paintHand(svg, days, { wrist = false, today = null, animate = false, next = null, target = null } = {}) {
  const live = animate && !reduce;
  svg.classList.toggle('live', live);
  const wristNode = svg.querySelector('.joint.wrist'), wristWas = wristNode.classList.contains('on');
  wristNode.classList.toggle('on', wrist);
  if (live && wrist && !wristWas) ping(svg, wristNode);
  let locked = 0;
  days.slice(0, 5).forEach((d, i) => {
    const group = svg.querySelector(`.finger[data-f="${i}"]`);
    group.classList.toggle('future', d.kind === 'future'); group.classList.toggle('rest', d.kind === 'rest'); group.classList.toggle('today', !!today && d.day === today);
    const lit = d.kind === 'work' ? d.habits : [false, false, false, false];
    const isNext = next != null && !!today && d.day === today && d.kind === 'work';
    group.querySelectorAll('.joint').forEach((joint, j) => {
      const was = joint.classList.contains('on');
      joint.classList.toggle('on', !!lit[j]);
      joint.classList.toggle('next', isNext && j === next && !lit[j]);
      if (live && lit[j] && !was) { ping(svg, joint); locked += 1; }
    });
    for (let j = 0; j < 4; j += 1) {
      const bone = svg.querySelector(`.bone.on[data-f="${i}"][data-j="${j}"]`), on = (j === 0 ? wrist : lit[j - 1]) && lit[j];
      bone.setAttribute('stroke-dashoffset', on ? 0 : bone.dataset.len);
    }
    for (const base of svg.querySelectorAll(`.bone.base[data-f="${i}"]`)) { base.classList.toggle('rest', d.kind === 'rest'); base.classList.toggle('now', !!today && d.day === today && d.kind === 'work'); }
    const label = group.querySelector('.flabel'), hit = group.querySelector('.hit');
    if (label && d.day) label.textContent = upper(wdShort(d.day));
    if (hit && d.day) hit.setAttribute('aria-label', d.kind === 'rest' ? t('hand.finger.rest.aria', { day: wdLong(d.day) }) : t('hand.finger.aria', { day: wdLong(d.day), a: lit.filter(Boolean).length }));
  });
  if (locked) buzz(12);
  // The ring over the next joint is drawn outside the SVG, so it costs nothing while it loops.
  if (target) {
    const joint = svg.querySelector('.joint.next');
    target.hidden = !joint;
    if (joint) { target.style.left = `${(100 * joint.getAttribute('cx')) / VIEW[0]}%`; target.style.top = `${(100 * joint.getAttribute('cy')) / VIEW[1]}%`; }
  }
}

/** The hand puts itself together: the wrist, then each finger from the base, lit joints locking and their bones drawing.
 *  Returns how long it takes, in milliseconds. */
export function replayHand(svg, { fast = false } = {}) {
  if (reduce || !svg.animate || !svg.querySelector('.joint')) return 0;
  const k = fast ? 0.5 : 1, at = (i, j) => (80 + i * 68 + j * 44) * k;
  const fade = (node, delay) => node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 * k, delay: Math.max(0, delay), easing: 'linear', fill: 'backwards' });
  const pop = (joint, delay) => joint.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 190, delay: Math.max(0, delay), easing: EASE.lock, fill: 'backwards' });
  pop(svg.querySelector('.joint.wrist'), 0);
  for (const palm of svg.querySelectorAll('.bone.palm')) fade(palm, 150 * k);
  for (const base of svg.querySelectorAll('.bone.base:not(.palm)')) fade(base, at(Number(base.dataset.f), Number(base.dataset.j)) - 50 * k);
  for (const group of svg.querySelectorAll('.finger')) {
    const i = Number(group.dataset.f);
    group.querySelectorAll('.joint').forEach((joint, j) => {
      pop(joint, at(i, j));
      if (joint.classList.contains('on') && !svg.classList.contains('mini')) setTimeout(() => { if (joint.isConnected) ring(svg, joint); }, at(i, j));
    });
    const label = group.querySelector('.flabel');
    if (label) fade(label, at(i, 3) + 60 * k);
  }
  for (const bone of svg.querySelectorAll('.bone.on')) {
    if (Number(bone.getAttribute('stroke-dashoffset')) !== 0) continue;
    bone.animate([{ strokeDashoffset: bone.dataset.len }, { strokeDashoffset: 0 }], { duration: 320 * k, delay: at(Number(bone.dataset.f), Number(bone.dataset.j)) + 110 * k, easing: EASE.track, fill: 'backwards' });
  }
  return (80 + 4 * 68 + 3 * 44 + 430) * k;
}

/** A joint locks on: it snaps in with a small overshoot and a ring leaves it. */
function ping(svg, joint) { lock(joint); ring(svg, joint); }
function ring(svg, joint) {
  const node = s('circle', { cx: joint.getAttribute('cx'), cy: joint.getAttribute('cy'), r: 6, class: 'ping' });
  svg.append(node);
  node.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(3.4)', opacity: 0 }], { duration: 560, easing: EASE.track }).onfinish = () => node.remove();
}

export function miniHand(days, wrist) {
  const svg = buildHand(s('svg', { viewBox: '0 0 320 346', class: 'hand mini', 'aria-hidden': 'true', focusable: 'false' }), { mini: true });
  paintHand(svg, days, { wrist });
  return svg;
}
/** A row's hand from the table payload: the wrist is lit when the count holds one mark more than the joints. */
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
  node.querySelector('.arc').setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(1));
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
  const svg = buildHand(s('svg', { viewBox: '0 0 320 346', class: 'hand mini big', 'aria-hidden': 'true', focusable: 'false' }), { mini: true });
  paintHand(svg, days, { wrist });
  setTimeout(() => replayHand(svg), 240);
  return svg;
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
