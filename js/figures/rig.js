(() => {
const {
  Cam, circ, clamp, facing, fit, hull, poly, proj, rad, ringAt, prism,
  spring, stepS, tween, tset, tval, tdone, disposer, mk, pointer, put, register, solid,
} = HL;

const W = 40, HM = 40, VZ = HM * (1 - 0.65), RB = 2.0, RJ = 4.4, JH = 2.6, LIFT = 6;
const JOINTS = [[-W / 2, 0], [-W / 2, HM], [0, VZ], [W / 2, HM], [W / 2, 0]]; // [u, z]: foot, shoulder, V, shoulder, foot
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4]];
const PR = 31, PT = 4, FRONT = -45, LEAN = 22, NAMES = ["pie izq.", "hombro izq.", "centro", "hombro der.", "pie der."];

const at = (ring, x, y) => ring.map((q) => ({ ...q, u: q.u + x, v: q.v + y }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let base = value;

  const C = Cam(45, 0.5, 3.55);
  const ext = [];
  for (let a = -90; a <= 90; a += 15) {
    const t = rad(FRONT + a);
    for (const [u, z] of JOINTS) ext.push([u * Math.cos(t), u * Math.sin(t), z + LIFT + JH]);
  }
  for (let a = 0; a < 360; a += 30) ext.push([PR * Math.cos(rad(a)), PR * Math.sin(rad(a)), -PT]);
  fit(C, ext, 200, 168);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, circ(PR, 48), circ(PR - 2, 48), -PT, 0));
  const parts = mk("g", {}, g);
  const joint = circ(RJ, 20), jinner = circ(RJ - 0.9, 20), bone = circ(RB, 12);
  const bones = BONES.map(([a, b]) => ({ a, b, el: solid(parts) }));
  const joints = JOINTS.map((_, i) => { const el = solid(parts); el.g.dataset.joint = i; return { i, el, z: tween(0) }; });

  const yaw = spring(base);
  let act = -1, drawn = null, order = "";

  const pos = (i, deg, lift = 0) => {
    const t = rad(FRONT + deg), [u, z] = JOINTS[i];
    return [u * Math.cos(t), u * Math.sin(t), z + lift];
  };

  function draw(now) {
    const deg = yaw.x, lifts = joints.map((j) => tval(j.z, now)), key = deg.toFixed(3) + lifts.map((l) => l.toFixed(2)).join();
    if (key === drawn) return;
    drawn = key;
    const W3 = JOINTS.map((_, i) => pos(i, deg, lifts[i]));
    for (const b of bones) {
      const A = W3[b.a], B = W3[b.b];
      const pts = ringAt(P, at(bone, A[0], A[1]), A[2]).concat(ringAt(P, at(bone, B[0], B[1]), B[2]));
      put(b.el, { sil: poly(hull(pts)), crease: "" });
    }
    joints.forEach((j, i) => {
      const [x, y, z] = W3[i];
      put(j.el, prism(P, front, at(joint, x, y), at(jinner, x, y), z - JH, z + JH));
    });
    const depth = [
      ...bones.map((b) => ({ el: b.el.g, d: Math.min(W3[b.a][0] + W3[b.a][1], W3[b.b][0] + W3[b.b][1]) - 0.005 })),
      ...joints.map((j, i) => ({ el: j.el.g, d: W3[i][0] + W3[i][1] + 0.01 })),
    ].sort((p, q) => p.d - q.d);
    const ord = depth.map((p) => p.el.dataset.k || (p.el.dataset.k = Math.random().toString(36).slice(2, 6))).join();
    if (ord !== order) { order = ord; depth.forEach((p) => parts.append(p.el)); }
  }

  function mark(a) {
    const lit = a < 0 ? 2 : a; // at rest the V joint holds the bright mark
    joints.forEach((j, i) => j.el.sil.classList.toggle("hi", i === lit));
  }

  const B = register(stage, (dt, now) => {
    const m = stepS(yaw, dt);
    draw(now);
    return m || joints.some((j) => !tdone(j.z, now));
  });
  bag.add(B.unregister);

  const want = (p) => (p ? base + clamp((p[0] - 200) / 170, -1, 1) * LEAN : base);

  function hit(p) {
    let best = -1, bd = 24;
    const deg = want(p);
    JOINTS.forEach((_, i) => {
      const s = P(...pos(i, deg)), d = Math.hypot(s[0] - p[0], s[1] - p[1]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function choose(a) {
    if (a === act) return;
    const now = performance.now();
    act = a;
    joints.forEach((j, i) => tset(j.z, i === a ? LIFT : 0, now, 0));
    mark(a);
    read.textContent = a < 0 ? "rest" : NAMES[a];
  }

  bag.add(pointer(stage, {
    move: (p) => { yaw.t = want(p); choose(hit(p)); B.wake(); },
    leave: () => { yaw.t = base; choose(-1); B.wake(); },
  }));
  bag.add(() => svg.replaceChildren());
  mark(-1);
  draw(performance.now());

  return {
    set: (v) => { const d = v - base; base = v; yaw.t += d; B.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "rig",
  means: "The Mirentor M as a hand rig: it turns to face the pointer and the joint nearest it locks.",
  rules: [1, 4, 5, 9],
  range: [-30, -14, 2],
  tour: [[146, 112], [204, 176], [256, 236], null],
  mount,
});

})();
