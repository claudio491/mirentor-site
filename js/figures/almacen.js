(() => {
const {
  Cam, circ, clamp, fit, hull, open, poly, proj, prism, rad, rings, seg,
  spring, stepS, disposer, facing, mk, pointer, put, register, solid,
} = HL;

const S = 3.2, PR = 44, PT = 4, TOP = 50;
const L = 64, D = 46, HW = 20.5, HR = 29.5, RC = 2.5, YAW = 26;
const DW = 16.5, DH = 16, DB = 3.2, DD = 2.8, SL = 2.5, RAIL = 1.2;
const STOCK = [[8.5, 19.5, 9], [21.5, 31, 7]], IN = 1.2, BD = 8;

const cs = Math.cos(rad(YAW)), sn = Math.sin(rad(YAW));
const W = (u, v, z) => [(u - L / 2) * cs - (v - D / 2) * sn, (u - L / 2) * sn + (v - D / 2) * cs, z];
const turn = (ring) => ring.map((q) => {
  const [x, y] = W(q.u, q.v, 0);
  return { ...q, u: x, v: y, nu: q.nu * cs - q.nv * sn, nv: q.nu * sn + q.nv * cs };
});

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let rest = (value / 100) * DH;

  const C = Cam(45, 0.5, S), ext = [[0, 0, TOP]];
  for (let a = 0; a < 360; a += 15) for (const z of [-PT, 0]) ext.push([PR * Math.cos(rad(a)), PR * Math.sin(rad(a)), z]);
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C), Q = (u, v, z) => P(...W(u, v, z));

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, circ(PR, 48), circ(PR - 2, 48), -PT, 0));

  const [foot] = rings(0, 0, L, D, RC, 1), base = turn(foot);
  const pitch = Math.atan2(HR - HW, D / 2), RA = 3, zc = HR - RA / Math.cos(pitch);
  const apex = (u) => [0, 1, 2, 3, 4].map((k) => { const f = Math.PI / 2 - pitch + (k / 2) * pitch; return Q(u, D / 2 + RA * Math.cos(f), zc + RA * Math.sin(f)); });
  mk("path", { d: poly(hull(base.map((q) => P(q.u, q.v, 0)).concat(base.map((q) => P(q.u, q.v, HW)), apex(0), apex(L)))), class: "sil" }, g);
  const corner = [];
  for (let k = 0; k <= 4; k++) { const t = rad(90 - 22.5 * k); corner.push(Q(L - RC + RC * Math.cos(t), D - RC + RC * Math.sin(t), HW)); }
  mk("path", { d: open([Q(RC, D, HW), ...corner, ...apex(L), Q(L, RC, HW)]), class: "nf lo" }, g);
  mk("path", { d: seg(Q(L, D / 2, zc + RA), Q(0, D / 2, zc + RA)), class: "nf lo" }, g);

  for (const [a, b, h] of STOCK) {
    const [sr, si] = rings(L - IN - BD, a, L - IN, b, 1.2, 0.7);
    put(solid(g), prism(P, front, turn(sr), turn(si), 0, h));
  }
  const v0 = D / 2 - DW, v1 = D / 2 + DW;
  const plate = mk("path", { class: "fo" }, g), slats = mk("path", { class: "nf lo" }, g), edge = mk("path", { class: "nf hi" }, g);
  mk("path", { d: seg(Q(L, v0, 0), Q(L, v0, DH)) + seg(Q(L, v1, 0), Q(L, v1, DH)), class: "nf" }, g);
  const [dr, di] = rings(L - 0.6, v0 - 1.4, L + DD, v1 + 1.4, 1.3, 0.6);
  put(solid(g), prism(P, front, turn(dr), turn(di), DH, DH + DB));

  const sp = spring(rest);
  let shown = NaN, over = false;
  function draw() {
    const zb = clamp(sp.x, 0, DH);
    if (zb === shown) return;
    shown = zb;
    let d = seg(Q(L, v0, zb + RAIL), Q(L, v1, zb + RAIL));
    for (let z = zb + RAIL + SL; z < DH - 0.3; z += SL) d += seg(Q(L, v0, z), Q(L, v1, z));
    slats.setAttribute("d", zb + RAIL < DH ? d : "");
    plate.setAttribute("d", poly([Q(L, v0, zb), Q(L, v1, zb), Q(L, v1, DH), Q(L, v0, DH)]));
    edge.setAttribute("d", seg(Q(L, v0, zb), Q(L, v1, zb)));
  }

  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    draw();
    return m;
  });
  bag.add(B.unregister);

  const O = Q(L, 0, 0), ev = Q(L, 1, 0).map((c, i) => c - O[i]), ez = Q(L, 0, 1).map((c, i) => c - O[i]);
  const det = ev[0] * ez[1] - ev[1] * ez[0];
  const height = ([x, y]) => clamp((ev[0] * (y - O[1]) - ev[1] * (x - O[0])) / det, 0, DH);

  bag.add(pointer(stage, {
    move: (p) => { over = true; sp.t = height(p); read.textContent = `portón ${Math.round((sp.t / DH) * 100)}%`; B.wake(); },
    leave: () => { over = false; sp.t = rest; read.textContent = "rest"; B.wake(); },
  }));
  bag.add(() => svg.replaceChildren());
  draw();

  return {
    set: (v) => { rest = (v / 100) * DH; if (!over) sp.t = rest; B.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "almacen",
  means: "A warehouse with a roll-up door: the door follows the pointer's height, its slats riding up into the drum.",
  rules: [1, 3, 5, 9],
  range: [20, 45, 70],
  tour: [[218, 176], [255, 260], [248, 210], null],
  mount,
});

})();
