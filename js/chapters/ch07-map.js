
const TAU = Math.PI * 2;
const DOT = { 192: 0.19, 112: 0.21 }; // dot radius in cells
const DIM = 0.25; // light of a dot the wave has not reached yet
const REST = 0.42; // light of the rest of the world (Latin America is 1)
const WAVE_MS = 1100;
const BAND = 1.5; // cells of signal at the wave's front
const LENS = { r: 64, grow: 1.2, lift: 0.6, in: 160, out: 240 };

const files = new Map();
function lattice(cols) {
  if (!files.has(cols)) {
    files.set(cols, fetch(new URL(`../../static/ch07/world-${cols}.svg`, import.meta.url))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`ch07 map ${r.status}`))))
      .then(parse));
  }
  return files.get(cols);
}

export function parse(svg) {
  const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  const cols = Number(svg.match(/data-cols="(\d+)"/)[1]);
  const rows = Number(svg.match(/data-rows="(\d+)"/)[1]);
  const kind = new Uint8Array(cols * rows);
  let step = 0;
  for (const [tag] of svg.matchAll(/<path\b[^>]*>/g)) {
    const k = /class="la"/.test(tag) ? 2 : 1;
    step = Number(tag.match(/stroke-dasharray="0 ([\d.]+)"/)[1]);
    let x = 0, y = 0;
    for (const [, cmd, a, b, len] of tag.match(/\sd="([^"]+)"/)[1].matchAll(/([Mm])([-\d.]+) ([-\d.]+)h([\d.]+)/g)) {
      if (cmd === 'M') { x = +a; y = +b; } else { x += +a; y += +b; }
      const j = Math.round(y / step);
      for (let i = Math.round(x / step), end = Math.round((x + +len) / step); i <= end; i++) kind[j * cols + i] = k;
      x += +len;
    }
  }
  return { cols, rows, kind, x: (i) => (i * step - vx) / vw, y: (j) => (j * step - vy) / vh, cell: step / vw };
}

function curve(css) {
  const [x1, y1, x2, y2] = (css.match(/-?\d*\.?\d+/g) || [0.65, 0, 0.35, 1]).map(Number); // the numbers, not the hyphen in the name
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (p) => {
    let t = p;
    for (let i = 0; i < 8; i++) {
      const e = ((ax * t + bx) * t + cx) * t - p;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}

export async function mountMap(map, { tier = 'full', origin = [0.28, 0.48], pointer = map } = {}) {
  const motion = tier !== 'still';
  const css = getComputedStyle(map);
  const color = { la: css.getPropertyValue('--porcelain').trim(), rest: css.getPropertyValue('--mist').trim(), hot: css.getPropertyValue('--signal').trim() };
  const ease = curve(getComputedStyle(document.documentElement).getPropertyValue('--ease-move'));
  const canvas = document.createElement('canvas');
  canvas.className = 'ch07-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  map.prepend(canvas);
  const ctx = canvas.getContext('2d');
  map.dataset.map = 'loading';
  map.dataset.wave = motion ? 'idle' : 'still';

  let grid = null, W = 0, H = 0, dpr = 1, layers = null;
  const wave = { state: motion ? 'idle' : 'still', r: 0, max: 0 };
  const lens = { x: 0, y: 0, k: 0, from: 0, to: 0, t0: 0, box: null };

  function layer(fill, alpha) {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = DOT[grid.cols] * grid.cell * W;
    for (const k of [1, 2]) {
      g.beginPath();
      for (let j = 0; j < grid.rows; j++) {
        const y = grid.y(j) * H;
        for (let i = 0; i < grid.cols; i++) {
          if (grid.kind[j * grid.cols + i] !== k) continue;
          const x = grid.x(i) * W;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, TAU);
        }
      }
      g.fillStyle = typeof fill === 'string' ? fill : fill[k];
      g.globalAlpha = typeof alpha === 'number' ? alpha : alpha[k];
      g.fill();
    }
    return c;
  }

  async function layout() {
    const box = map.getBoundingClientRect();
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (!box.width || (layers && box.width === W && box.height === H && ratio === dpr)) return;
    const next = await lattice(box.width >= 690 ? 192 : 112);
    W = box.width; H = box.height; dpr = ratio;
    grid = next;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fill = { 1: color.rest, 2: color.la };
    layers = { lit: layer(fill, { 1: REST, 2: 1 }), dim: layer(fill, { 1: REST * DIM, 2: DIM }), hot: layer(color.hot, 1) };
    const [ox, oy] = [origin[0] * W, origin[1] * H];
    let max = 0;
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) if (grid.kind[j * grid.cols + i]) max = Math.max(max, Math.hypot(grid.x(i) * W - ox, grid.y(j) * H - oy));
    wave.max = max + BAND * grid.cell * W;
    paint();
  }

  function paint() {
    if (!layers) return;
    ctx.clearRect(0, 0, W, H);
    if (wave.state === 'idle') { ctx.drawImage(layers.dim, 0, 0, W, H); return; }
    if (wave.state !== 'run') { ctx.drawImage(layers.lit, 0, 0, W, H); lens.box = null; if (lens.k > 0) drawLens(); return; }
    const [ox, oy] = [origin[0] * W, origin[1] * H];
    const band = BAND * grid.cell * W;
    ctx.drawImage(layers.dim, 0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(ox, oy, wave.r, 0, TAU); ctx.clip();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(layers.lit, 0, 0, W, H);
    ctx.beginPath(); ctx.arc(ox, oy, wave.r, 0, TAU); ctx.arc(ox, oy, Math.max(0, wave.r - band), 0, TAU, true); ctx.clip('evenodd');
    ctx.drawImage(layers.hot, 0, 0, W, H);
    ctx.restore();
    ctx.beginPath(); ctx.arc(ox, oy, wave.r, 0, TAU);
    ctx.globalAlpha = 0.85 * (1 - wave.r / wave.max);
    ctx.strokeStyle = color.hot; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawLens() {
    const pad = 2 * grid.cell * W;
    const R = LENS.r;
    const box = lens.k > 0 ? [lens.x - R - pad, lens.y - R - pad, lens.x + R + pad, lens.y + R + pad] : null;
    const dirty = [box, lens.box].filter(Boolean).reduce((a, b) => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b), null);
    lens.box = box;
    if (!dirty) return;
    const [x0, y0] = [Math.max(0, Math.floor(dirty[0])), Math.max(0, Math.floor(dirty[1]))];
    const [x1, y1] = [Math.min(W, Math.ceil(dirty[2])), Math.min(H, Math.ceil(dirty[3]))];
    if (x1 <= x0 || y1 <= y0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(layers.lit, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr, x0, y0, x1 - x0, y1 - y0);
    if (box) {
      ctx.beginPath(); ctx.arc(lens.x, lens.y, R + pad, 0, TAU); ctx.clip();
      ctx.clearRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      const r0 = DOT[grid.cols] * grid.cell * W;
      const i0 = Math.max(0, Math.floor(((box[0] / W) - grid.x(0)) / grid.cell)), i1 = Math.min(grid.cols - 1, Math.ceil(((box[2] / W) - grid.x(0)) / grid.cell));
      const cellY = grid.y(1) - grid.y(0);
      const j0 = Math.max(0, Math.floor(((box[1] / H) - grid.y(0)) / cellY)), j1 = Math.min(grid.rows - 1, Math.ceil(((box[3] / H) - grid.y(0)) / cellY));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = grid.kind[j * grid.cols + i];
          if (!k) continue;
          const x = grid.x(i) * W, y = grid.y(j) * H;
          const u = Math.hypot(x - lens.x, y - lens.y) / R;
          const f = u < 1 ? (1 - u * u) ** 2 * lens.k : 0;
          const base = k === 2 ? 1 : REST;
          ctx.globalAlpha = base + (1 - base) * LENS.lift * f;
          ctx.fillStyle = k === 2 ? color.la : color.rest;
          ctx.beginPath(); ctx.arc(x, y, r0 * (1 + LENS.grow * f), 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  let lensFrame = 0;
  function lensTick(now) {
    lensFrame = 0;
    const t = Math.min(1, (now - lens.t0) / (lens.to > lens.from ? LENS.in : LENS.out));
    lens.k = lens.from + (lens.to - lens.from) * (1 - (1 - t) ** 3);
    drawLens();
    if (t < 1) lensFrame = requestAnimationFrame(lensTick);
  }
  function aim(to, now = performance.now()) {
    if (to !== lens.to) { lens.from = lens.k; lens.to = to; lens.t0 = now; }
    if (!lensFrame) lensFrame = requestAnimationFrame(lensTick);
  }
  if (motion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    pointer.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || wave.state !== 'done' || !layers) return;
      const box = canvas.getBoundingClientRect();
      lens.x = e.clientX - box.left; lens.y = e.clientY - box.top;
      aim(lens.x >= 0 && lens.y >= 0 && lens.x <= W && lens.y <= H ? 1 : 0);
    });
    pointer.addEventListener('pointerleave', () => { if (layers) aim(0); });
  }

  let resizing = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(() => layout().catch((err) => { map.dataset.error = String(err.message || err); }));
  }).observe(map);
  await layout();
  map.dataset.map = 'ready';

  return {
    wave() {
      if (wave.state !== 'idle') return Promise.resolve();
      wave.state = 'run';
      map.dataset.wave = 'run';
      return new Promise((resolve) => {
        const t0 = performance.now();
        const frame = (now) => {
          const p = Math.min(1, (now - t0) / WAVE_MS);
          wave.r = ease(p) * wave.max;
          if (p >= 1) { wave.state = 'done'; map.dataset.wave = 'done'; }
          paint();
          if (p < 1) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
    },
  };
}
