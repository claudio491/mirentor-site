(() => {
const {
  Cam, facing, fillet, fit, open, poly, proj, prism, rad, rings, seg,
  spring, stepS, tween, tset, tval, tdone, disposer, mk, place, pointer, put, register, solid,
} = HL;

const L = 88, D = 62, H = 52, R = 4, CB = 1.6, YAW = -10, TW = 5, TAB = 15, FT = 1.3;
const G0 = 7, G1 = 13, EXT = 4, GAP = 2.5, TK = 2.6, STEP = 8, TICK = 3.4, STAG = 40;
const PT = 4, REACH = 90, S = 1.75;
const GUIDES = [
  [[0, 0, H], [L, 0, H], [0, -1, 0], "largo"],
  [[0, D, 0], [0, D, H], [-1, 0, 0], "alto"],
  [[L, D, 0], [L, 0, 0], [1, 0, 0], "ancho"],
];
const CORNERS = GUIDES.flatMap(([a, b], k) => [[a, k], [b, k]]), MARK = 3; // the corner that holds the mark at rest
const X0 = -G1 - EXT - 7, X1 = L + G1 + EXT + 7, Y0 = -7, Y1 = D + 9; // the plate, square to the box

const cs = Math.cos(rad(YAW)), sn = Math.sin(rad(YAW));
const W = ([u, v, z]) => [(u - L / 2) * cs - (v - D / 2) * sn, (u - L / 2) * sn + (v - D / 2) * cs, z];
const turn = (ring) => ring.map((q) => {
  const [x, y] = W([q.u, q.v, 0]);
  return { ...q, u: x, v: y, nu: q.nu * cs - q.nv * sn, nv: q.nu * sn + q.nv * cs };
});
const ax = (p, d, s) => p.map((c, i) => c + d[i] * s);
const along = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const flapAt = (u, s, th, under = 0) => {
  const c = Math.cos(rad(th)), n = Math.sin(rad(th));
  return [u, s * c + under * n, H + s * n - under * c];
};
const onLid = (Q, pts, radii) => fillet(pts, radii).map(([u, v]) => Q([u, v, H]));

function guide(Q, k, g, gr) {
  const [a, b, o] = GUIDES[k], n = Math.hypot(...b.map((c, i) => c - a[i]));
  const t = b.map((c, i) => ((c - a[i]) / n + o[i]) * TK * Math.SQRT1_2), A = ax(a, o, g), B = ax(b, o, g);
  let ticks = "";
  gr.forEach((x, i) => {
    if (x < 0.02) return;
    const p = along(A, B, (i + 1) / (gr.length + 1));
    ticks += seg(Q(p), Q(ax(p, o, -TICK * x)));
  });
  return {
    line: seg(Q(A), Q(B)) + seg(Q(ax(A, t, -1)), Q(ax(A, t, 1))) + seg(Q(ax(B, t, -1)), Q(ax(B, t, 1))),
    ext: seg(Q(ax(a, o, GAP)), Q(ax(a, o, g + EXT))) + seg(Q(ax(b, o, GAP)), Q(ax(b, o, g + EXT))),
    ticks,
  };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();

  const C = Cam(45, 0.5, S), ext = [];
  for (const [a, b, o] of GUIDES) for (const p of [a, b]) ext.push(W(ax(p, o, G1 + EXT)));
  for (const u of [0, L]) ext.push(W(flapAt(u, D / 2, 40)));
  for (const u of [X0, X1]) for (const v of [Y0, Y1]) ext.push(W([u, v, -PT]));
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C), Q = (p) => P(...W(p));

  const g = mk("g", {}, svg);
  const [pr, pi] = rings(X0, Y0, X1, Y1, 10, 2);
  put(solid(g), prism(P, front, turn(pr), turn(pi), -PT, 0));

  const guides = GUIDES.map(([a, b]) => ({
    ext: mk("path", { class: "nf dash" }, g), line: mk("path", { class: "nf lo" }, g), ticks: mk("path", { class: "nf lo" }, g),
    off: tween(G0), gr: Array.from({ length: Math.round(Math.hypot(...b.map((c, i) => c - a[i])) / STEP) - 1 }, () => tween(0)), drawn: "",
  }));
  const [br, bi] = rings(0, 0, L, D, R, CB);
  put(solid(g), prism(P, front, turn(br), turn(bi), 0, H));

  const WT = 1.4;
  mk("path", { d: open(onLid(Q, [[WT, D / 2], [WT, WT], [L - WT, WT], [L - WT, D / 2]], [0, 2, 2, 0])), class: "nf lo" }, g);
  mk("path", { d: poly(onLid(Q, [[0.8, D / 2], [L - CB - 0.8, D / 2], [L - CB - 0.8, D - CB - 0.8], [0.8, D - CB - 0.8]], [0, 0, R, R])), class: "fo" }, g);
  mk("path", { d: seg(Q([0, D / 2, H]), Q([L, D / 2, H])), class: "nf" }, g);
  mk("path", { d: seg(Q([0, D / 2 + TW, H]), Q([L, D / 2 + TW, H])), class: "nf lo" }, g);
  const tab = fillet([[D / 2 - TW, H], [D / 2 - TW, H - TAB], [D / 2 + TW, H - TAB], [D / 2 + TW, H]], [0, 1.6, 1.6, 0]);
  mk("path", { d: open(tab.map(([v, z]) => Q([L, v, z]))), class: "nf lo" }, g);
  const SHAPE = fillet([[0, 0], [L, 0], [L, D / 2], [0, D / 2]], [R, R, 2.4, 2.4]);
  const flap = mk("path", { class: "sil" }, g), fedge = mk("path", { class: "nf lo" }, g);

  const dots = CORNERS.map(([p], i) => {
    const el = mk("circle", { r: 2.3, class: i === MARK ? "dot" : "dot m" }, g);
    place(el, Q(p));
    return el;
  });

  const fl = spring(value);
  let act = -1, shown = NaN;

  function drawFlap(th) {
    if (th === shown) return;
    shown = th;
    flap.setAttribute("d", poly(SHAPE.map(([u, s]) => Q(flapAt(u, s, th)))));
    fedge.setAttribute("d", seg(Q(flapAt(2.4, D / 2, th, FT)), Q(flapAt(L - 2.4, D / 2, th, FT))));
  }
  function drawGuide(q, k, now) {
    const off = tval(q.off, now), gr = q.gr.map((tw) => tval(tw, now)), key = [off, ...gr].map((x) => x.toFixed(3)).join();
    if (key === q.drawn) return;
    q.drawn = key;
    const d = guide(Q, k, off, gr);
    q.line.setAttribute("d", d.line);
    q.ext.setAttribute("d", d.ext);
    q.ticks.setAttribute("d", d.ticks);
  }
  function draw(now) {
    drawFlap(fl.x);
    guides.forEach((q, k) => drawGuide(q, k, now));
  }

  const B = register(stage, (dt, now) => {
    const m = stepS(fl, dt);
    draw(now);
    return m || guides.some((q) => !tdone(q.off, now) || q.gr.some((tw) => !tdone(tw, now)));
  });
  bag.add(B.unregister);

  const at = CORNERS.map(([p]) => Q(p));
  function hit([x, y]) {
    let best = -1, bd = REACH;
    at.forEach(([sx, sy], i) => {
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function choose(a) {
    if (a === act) return;
    const now = performance.now(), lit = a < 0 ? -1 : CORNERS[a][1], mark = a < 0 ? MARK : a;
    act = a;
    guides.forEach((q, k) => {
      const on = k === lit, from = a % 2 ? q.gr.length + 1 : 0; // the graduations start at the locked end
      tset(q.off, on ? G1 : G0, now, 0);
      q.gr.forEach((tw, i) => tset(tw, on ? 1 : 0, now, on ? Math.abs(i + 1 - from) * STAG : 0));
      for (const el of [q.line, q.ticks]) { el.classList.toggle("hi", on); el.classList.toggle("lo", !on); }
    });
    dots.forEach((el, i) => el.classList.toggle("m", i !== mark));
    read.textContent = a < 0 ? "rest" : GUIDES[lit][3];
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(-1) }));
  bag.add(() => svg.replaceChildren());
  draw(performance.now());

  return {
    set: (v) => { fl.t = v; B.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "caja",
  means: "A taped carton, measured as it is tracked: the corner nearest the pointer locks, and a rule runs out along its edge.",
  rules: [1, 2, 4, 6],
  range: [8, 22, 40],
  tour: [[300, 115], [236, 250], [100, 205], null],
  mount,
});

})();
