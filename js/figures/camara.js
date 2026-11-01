(() => {
const {
  Cam, circ, clamp, facing, fit, hull, open, poly, proj, prism, rad, rings, rrect, ringAt, run,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const S = 3.2, PR = 44, PT = 4, TOP = 50;
const RB = 25, BH = 7, BW = 1.6, HS = 23, SW = 3;
const HO = 2.6, HZ = 2.4, MW = 19, MH = 13.5, MD = 11, MR = 3, LR = 5.2, LB = 2.4, LG = 2.9, LX = -1.6;
const FACE = -6, PAN = [10, 52], TILT = [14, 34];

const LR2 = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let base = value;

  const C = Cam(45, 0.5, S), ext = [[0, 0, TOP]];
  for (let a = 0; a < 360; a += 15) for (const z of [-PT, 0]) ext.push([PR * Math.cos(rad(a)), PR * Math.sin(rad(a)), z]);
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C), V = [0.612, 0.612, 0.5];
  const dot = (p) => p[0] * V[0] + p[1] * V[1] + p[2] * V[2];

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, circ(PR, 48), circ(PR - 2, 48), -PT, 0));

  const c = Math.cos(rad(FACE)), s = Math.sin(rad(FACE));
  const Wb = ([f, l, z]) => [f * c - l * s, f * s + l * c, z], Q = (p) => P(...Wb(p));
  const turn = (ring) => ring.map((q) => { const [x, y] = Wb([q.u, q.v, 0]); return { ...q, u: x, v: y, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c }; });

  const outer = circ(RB, 64), inner = circ(RB - BW, 64);
  mk("path", { d: poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, BH)))), class: "sil" }, g);
  mk("path", { d: poly(ringAt(P, inner, BH)), class: "nf" }, g);
  mk("path", { d: open(ringAt(P, run(inner, (q) => !front(q)), 0)), class: "nf lo" }, g);
  const RF = Math.sqrt((RB - BW - 0.4) ** 2 - SW ** 2), TAB = 2.6, ribbon = [];
  const tab = (f, down) => { for (let k = 0; k <= 6; k++) { const a = (Math.PI * (down ? k : 6 - k)) / 6; ribbon.push(Q([f, SW * Math.cos(a), BH - TAB - SW * Math.sin(a)])); } };
  for (const l of [SW, -SW]) {
    for (let k = 0; k <= 24; k++) { const t = (Math.PI * (l > 0 ? k : 24 - k)) / 24; ribbon.push(Q([RF * Math.cos(t), l, BH + HS * Math.sin(t)])); }
    tab(l > 0 ? -RF : RF, l > 0);
  }
  mk("path", { d: poly(ribbon), class: "sil" }, g);
  const iF = LR2(ringAt(P, run(inner, front), BH)), oT = LR2(ringAt(P, run(outer, front), BH)), oB = LR2(ringAt(P, run(outer, front), 0));
  mk("path", { d: poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), class: "fo" }, g);
  mk("path", { d: open(oT), class: "nf lo" }, g);
  mk("path", { d: open(iF), class: "nf" }, g);
  mk("path", { d: open([oT[0], ...oB, oT[oT.length - 1]]), class: "nf sil" }, g);
  const [mr, mi] = rings(RB - 0.4, -4.6, RB + 1.3, 4.6, 1.2, 0.5);
  put(solid(g), prism(P, front, turn(mr), turn(mi), 1.2, BH + HZ + 1.4));

  const hinge = solid(g), body = solid(g), lens = solid(g), glass = mk("path", { class: "nf" }, g);
  lens.sil.classList.add("hi");
  const face = rrect(-MW / 2, -MH / 2, MW / 2, MH / 2, MR, 6), crease = rrect(-MW / 2 + 1, -MH / 2 + 1, MW / 2 - 1, MH / 2 - 1, MR - 1, 6);
  const H0 = [RB + HO, 0, BH + HZ];

  const pan = spring(0), tilt = spring(base);
  let shown = "";
  function draw() {
    const key = pan.x.toFixed(3) + tilt.x.toFixed(3);
    if (key === shown) return;
    shown = key;
    const cd = Math.cos(rad(pan.x)), sd = Math.sin(rad(pan.x)), ct = Math.cos(rad(tilt.x)), st = Math.sin(rad(tilt.x));
    const lat = [-sd, cd, 0], up = [st * cd, st * sd, ct], ax = [ct * cd, ct * sd, -st];
    const barrel = [];
    for (const l of [-4.4, 4.4]) for (let k = 0; k < 12; k++) {
      const t = (k / 12) * 2 * Math.PI;
      barrel.push(Q([H0[0] + 1.7 * Math.cos(t) * cd + l * lat[0], 1.7 * Math.cos(t) * sd + l * lat[1], H0[2] + 1.7 * Math.sin(t)]));
    }
    put(hinge, { sil: poly(hull(barrel)), crease: "" });
    const c0 = H0.map((k, j) => k + ax[j] * (MD / 2 + 0.8) + up[j] * (MH / 2 - 1.8));
    const at = (u, v, w) => c0.map((k, j) => k + lat[j] * u + up[j] * v + ax[j] * w);
    const back = face.map((q) => Q(at(q.u, q.v, -MD / 2))), fore = face.map((q) => Q(at(q.u, q.v, MD / 2)));
    const seen = (q) => dot(Wb(lat.map((k, j) => k * q.nu + up[j] * q.nv))) > 0;
    put(body, { sil: poly(hull(back.concat(fore))), crease: open(run(crease, seen).map((q) => Q(at(q.u, q.v, MD / 2)))) });
    const disc = (r, w) => { const pts = []; for (let k = 0; k < 24; k++) { const t = (k / 24) * 2 * Math.PI; pts.push(Q(at(LX + r * Math.cos(t), 0.4 + r * Math.sin(t), w))); } return pts; };
    put(lens, { sil: poly(hull(disc(LR, MD / 2).concat(disc(LR, MD / 2 + LB)))), crease: "" });
    glass.setAttribute("d", poly(disc(LG, MD / 2 + LB)));
  }

  const B = register(stage, (dt) => {
    const m = stepS(pan, dt) | stepS(tilt, dt);
    draw();
    return Boolean(m);
  });
  bag.add(B.unregister);

  const aim = (p) => {
    const dx = clamp((200 - p[0]) / 120, -1, 1);
    return [dx * PAN[dx < 0 ? 0 : 1], clamp(base + ((p[1] - 196) / 70) * 12, TILT[0], TILT[1])];
  };
  let over = false;
  bag.add(pointer(stage, {
    move: (p) => { over = true; [pan.t, tilt.t] = aim(p); read.textContent = `lente ${Math.round(tilt.t)}°`; B.wake(); },
    leave: () => { over = false; pan.t = 0; tilt.t = base; read.textContent = "rest"; B.wake(); },
  }));
  bag.add(() => svg.replaceChildren());
  draw();

  return {
    set: (v) => { base = clamp(v, TILT[0], TILT[1]); if (!over) tilt.t = base; B.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "camara",
  means: "The Mirentor head camera on its band: the camera turns and tilts to look at the pointer, its lens ring bright.",
  rules: [1, 3, 5, 8],
  range: [14, 24, 34],
  tour: [[80, 240], [330, 270], [200, 80], null],
  mount,
});

})();
