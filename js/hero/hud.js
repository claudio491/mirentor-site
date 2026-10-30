// hud.js: REC, the visitor's real timecode, the task card and the shift ruler with its two true counters. The counted
// time is marked live (data-live) once written: until then hero.css shows 00:00:00 over the no-JS value.
import { duration, timecode } from './clock.js';

export function createHud(root, { shots, shotMs, strings }) {
  const q = (s) => root.querySelector(s);
  const tc = q('.timecode');
  const task = q('.status-task');
  const chip = q('.status-chip');
  const chipText = q('.status-chip-text');
  const counted = q('[data-counter="counted"] b');
  const segs = [...root.querySelectorAll('.track s')];
  const head = q('.track .head');
  const cycleMs = shots.length * shotMs;
  let lastShot = -1;
  let lastCounted = '';

  function setShot(index) {
    if (index === lastShot) return;
    lastShot = index;
    const shot = shots[index];
    // Each separator stays with the word before it (a wrapped chip never starts a line with the dot); same text
    const parts = String(strings[shot.key] ?? '').split(' · ');
    const line = document.createElement('span'); // one flex item: the chip's gap never opens between the words
    line.append(...parts.flatMap((p, i) => (i < parts.length - 1
      ? [Object.assign(document.createElement('span'), { className: 'nb', textContent: `${p} ·` }), ' '] : [p])));
    task.replaceChildren(line);
    chip.dataset.counts = String(shot.hands);
    chipText.textContent = strings.chip_counts;
    root.dataset.shot = String(index);
  }

  function update({ recordedMs, countedMs, index }, now = new Date()) {
    tc.textContent = timecode(now);
    setShot(index);
    const c = duration(countedMs);
    if (c !== lastCounted) { counted.textContent = c; counted.dataset.live = ''; lastCounted = c; }
    const inCycle = recordedMs % cycleMs;
    segs.forEach((s, i) => {
      if (!shots[i].hands) return;
      const f = Math.min(1, Math.max(0, (inCycle - i * shotMs) / shotMs));
      s.style.setProperty('--fill', f.toFixed(4));
    });
    head.style.setProperty('--head', `${((inCycle / cycleMs) * 100).toFixed(3)}%`);
  }

  /** Final state for reduced motion: the full loop drawn, the totals of one loop. */
  function final() {
    setShot(0);
    tc.textContent = timecode(new Date());
    segs.forEach((s, i) => { if (shots[i].hands) s.style.setProperty('--fill', '1'); });
    head.style.setProperty('--head', '100%');
    counted.textContent = duration(shots.filter((s) => s.hands).length * shotMs);
    counted.dataset.live = '';
  }

  return { update, setShot, final };
}
