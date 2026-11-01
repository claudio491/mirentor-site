(() => {
const {
  Cam, circ, clamp, facing, fillet, fit, hull, open, poly, proj, prism, rad, ringAt, seg,
  tween, tset, tval, tdone, disposer, mk, pointer, put, register, solid,
} = HL;

const S = 3.2, PR = 44, PT = 4, TOP = 50;
const HAT = [-18.5, -18.5, 15], BX = 15.6, BY = 13.8, PK = 4.6, BT = 1.4, DO = 1.2, RX = 14, RY = 12, HH = 14.5, RIB = 1.4;
const HAND = [[0, -8.8], [7.4, -8.8], [9.4, -6.8], [22, -7.6], [22, 7.6], [9.4, 6.8], [7.4, 8.8], [0, 8.8]];
const ROUND = [1.6, 1, 2.2, 2.6, 2.6, 2.2, 1, 1.6], TK = 2.8, WRIST = 8.2, THUMB = [[12.4, 6.4], [19.4, 12.2]];
const KA = 22.4, FR = 1.85, FT = 2.8, FB = [5.7, 1.9, -1.9, -5.7], FL = [11.6, 13, 12.3, 9.8], SPLAY = [12, 4, -4, -12], BEND = 1.9;
const OPEN = [6, 8, 11, 15], HALF = [34, 40, 46, 52], SHUT = [80, 84, 86, 88];
const GLOVES = [[-11.4, 5, 62, 1], [5, -11.4, 26, -1]], NAMES = ["guante izq.", "guante der."], MARK = 1, REACH = 62;

const at = (ring, x, y) => ring.map((q) => ({ ...q, u: q.u + x, v: q.v + y }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, S), ext = [[0, 0, TOP]];
  for (let a = 0; a < 360; a += 15) for (const z of [-PT, 0]) ext.push([PR * Math.cos(rad(a)), PR * Math.sin(rad(a)), z]);
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C), V = [0.612, 0.612, 0.5];
  const dot = (p) => p[0] * V[0] + p[1] * V[1] + p[2] * V[2];

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, circ(PR, 48), circ(PR - 2, 48), -PT, 0));

  const [hx, hy, hd] = HAT, hc = Math.cos(rad(hd)), hs = Math.sin(rad(hd));
  const H = (f, s, z) => P(hx + f * hc - s * hs, hy + f * hs + s * hc, z);
  const brim = [];
  for (let k = 0; k < 48; k++) {
    const t = (k / 48) * 2 * Math.PI, c = Math.cos(t);
    brim.push([(BX + PK * Math.max(0, c) ** 2.5) * c, BY * Math.sin(t)]);
  }
  mk("path", { d: poly(brim.map(([f, s]) => H(f, s, 0))), class: "lo" }, g);
  mk("path", { d: poly(brim.map(([f, s]) => H(f, s, BT))), class: "sil" }, g);
  const shell = [H(-DO, 0, BT + HH)];
  for (let k = 0; k <= 7; k++) {
    const p = rad(k * 12.5), z = BT + HH * Math.sin(p);
    for (let j = 0; j < 32; j++) { const t = (j / 32) * 2 * Math.PI; shell.push(H(-DO + RX * Math.cos(p) * Math.cos(t), RY * Math.cos(p) * Math.sin(t), z)); }
  }
  mk("path", { d: poly(hull(shell)), class: "sil" }, g);
  let rib = "";
  for (const w of [-RIB, RIB]) {
    const k = Math.sqrt(1 - (w / RY) ** 2), run = [];
    for (let j = 0; j <= 30; j++) {
      const p = rad(j * 6), f = RX * k * Math.cos(p), z = HH * k * Math.sin(p);
      const n = [f / RX ** 2, w / RY ** 2, z / HH ** 2];
      if (dot([n[0] * hc - n[1] * hs, n[0] * hs + n[1] * hc, n[2]]) > 0.002) run.push(H(f - DO, w, BT + z));
    }
    rib += open(run);
  }
  mk("path", { d: rib, class: "nf" }, g);

  const ring = circ(FR, 14);
  const rod = (...joints) => {
    const pts = [];
    for (const [x, y, z] of joints) for (const dz of [-FT / 2, FT / 2]) pts.push(...ringAt(P, at(ring, x, y), z + dz));
    return { sil: poly(hull(pts)), crease: "" };
  };

  const shape = fillet(HAND, ROUND);
  const gloves = GLOVES.map(([x, y, dir, side], gi) => {
    const c = Math.cos(rad(dir)), s = Math.sin(rad(dir));
    const Wg = (a, b, z) => [x + a * c - b * side * s, y + a * s + b * side * c, z];
    const grp = mk("g", {}, g);
    mk("path", { d: poly(shape.map(([a, b]) => P(...Wg(a, b, 0)))), class: "lo" }, grp);
    mk("path", { d: poly(shape.map(([a, b]) => P(...Wg(a, b, TK)))), class: "sil" }, grp);
    mk("path", { d: seg(P(...Wg(WRIST, -7.6, TK)), P(...Wg(WRIST, 7.6, TK))), class: "nf lo" }, grp);
    const thumb = solid(grp);
    put(thumb, rod(Wg(...THUMB[0], FT / 2), Wg(...THUMB[1], FT / 2)));
    const parts = mk("g", {}, grp);
    const fingers = FB.map((b, i) => ({
      i, b, el: solid(parts), th: tween(gi === MARK ? HALF[i] : OPEN[i]), drawn: NaN,
      knuckle: P(...Wg(KA, b, FT / 2)),
    }));
    return { gi, Wg, parts, fingers, centre: P(...Wg(18.5, 0, TK)), order: "" };
  });

  function drawGlove(gl, now) {
    const list = [];
    let moved = false;
    for (const f of gl.fingers) {
      const deg = tval(f.th, now), th = rad(deg), sp = rad(SPLAY[f.i] * (1 - deg / 90)), len = FL[f.i];
      const dir = (t) => [Math.cos(t) * Math.cos(sp), Math.cos(t) * Math.sin(sp), Math.sin(t)];
      const d1 = dir(th), d2 = dir(th * BEND), K = [KA, f.b, FT / 2];
      const M = K.map((k, j) => k + d1[j] * len * 0.56), T = M.map((m, j) => m + d2[j] * len * 0.44);
      const w = (p) => gl.Wg(p[0], p[1], p[2]);
      if (deg !== f.drawn) { f.drawn = deg; moved = true; put(f.el, rod(w(K), w(M), w(T))); }
      list.push({ el: f.el.g, d: dot(w(M)) });
    }
    if (!moved && gl.order) return;
    list.sort((p, q) => p.d - q.d);
    const ord = list.map((p) => p.el.dataset.k || (p.el.dataset.k = Math.random().toString(36).slice(2, 6))).join();
    if (ord !== gl.order) { gl.order = ord; list.forEach((p) => gl.parts.append(p.el)); }
  }

  const sils = (gl) => gl.fingers.map((f) => f.el.sil);
  function mark(a) {
    const lit = a < 0 ? MARK : a;
    gloves.forEach((gl) => sils(gl).forEach((el) => el.classList.toggle("hi", gl.gi === lit)));
  }

  const B = register(stage, (_dt, now) => {
    gloves.forEach((gl) => drawGlove(gl, now));
    return gloves.some((gl) => gl.fingers.some((f) => !tdone(f.th, now)));
  });
  bag.add(B.unregister);

  const near = (pts, [x, y], reach) => {
    let best = -1, bd = reach;
    pts.forEach(([sx, sy], i) => { const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  let act = -1, last = null;
  function choose(a) {
    if (a === act) return;
    const now = performance.now();
    act = a;
    gloves.forEach((gl) => {
      const n = last ? near(gl.fingers.map((f) => f.knuckle), last, Infinity) : 0;
      gl.fingers.forEach((f, i) => {
        const to = gl.gi === a ? SHUT[i] : a < 0 && gl.gi === MARK ? HALF[i] : OPEN[i];
        tset(f.th, to, now, Math.abs(i - n) * stag);
      });
    });
    mark(a);
    read.textContent = a < 0 ? "rest" : NAMES[a];
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => { last = p; choose(near(gloves.map((gl) => gl.centre), p, REACH)); },
    leave: () => choose(-1),
  }));
  bag.add(() => svg.replaceChildren());
  mark(-1);
  gloves.forEach((gl) => drawGlove(gl, performance.now()));

  return {
    set: (v) => { stag = clamp(v, 0, 120); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "equipo",
  means: "A hard hat and a pair of work gloves: the glove nearest the pointer closes its grip, finger by finger.",
  rules: [1, 2, 4, 5],
  range: [0, 45, 90],
  tour: [[158, 223], [280, 217], [123, 218], null],
  mount,
});

})();
