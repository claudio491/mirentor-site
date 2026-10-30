import { PLATE_ZOOM, coverMap, focusOf } from './overlay.js';

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uScale;
uniform vec2 uBase;
uniform vec2 uOffset;
uniform float uRot;
uniform float uGrain;
uniform float uSeed;
void main() {
  vec2 uv = vUv * uScale + uBase;
  float far = 1.0 - texture(uDepth, uv).r;
  vec2 c = uv - 0.5;
  float a = uRot * far;
  c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
  vec3 col = texture(uColor, c + 0.5 + uOffset * far).rgb;
  float n = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
  o = vec4(col + (n - 0.5) * uGrain, 1.0);
}`;

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function createDepthRenderer(canvas, { maxShift = 0.015, grain = 0.025, onLost } = {}) {
  let gl;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' }); } catch { gl = null; }
  if (!gl) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uColor', 'uDepth', 'uScale', 'uBase', 'uOffset', 'uRot', 'uGrain', 'uSeed'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.uniform1i(u.uColor, 0);
  gl.uniform1i(u.uDepth, 1);
  gl.uniform1f(u.uGrain, grain);

  const textures = new Map();
  let current = null;
  let raf = 0;
  let running = false;
  let lost = false;
  const t0 = performance.now();

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); onLost?.(); }, { once: true });

  function texture(img) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
  }

  function addPlate(id, colorImg, depthImg) {
    if (lost || textures.has(id)) return;
    textures.set(id, { color: texture(colorImg), depth: texture(depthImg), w: colorImg.naturalWidth, h: colorImg.naturalHeight });
  }

  function show(id) { current = textures.get(id) || null; draw(performance.now()); }

  function draw(now) {
    if (!current || lost) return;
    resize();
    const W = canvas.width;
    const H = canvas.height;
    const m = coverMap(W, H, current.w, current.h, PLATE_ZOOM, focusOf(canvas.parentElement || canvas));
    gl.uniform2f(u.uScale, W / (current.w * m.s), H / (current.h * m.s));
    gl.uniform2f(u.uBase, -m.ox / (current.w * m.s), -m.oy / (current.h * m.s));
    const t = (now - t0) / 1000;
    const ox = maxShift * (0.62 * Math.sin(t * 2 * Math.PI * 0.8 * 0.5) + 0.38 * Math.sin(t * 1.31 + 1.7));
    const oy = maxShift * 0.7 * (0.6 * Math.sin(t * 2 * Math.PI * 0.8 * 0.37 + 0.4) + 0.4 * Math.sin(t * 0.93 + 2.2));
    gl.uniform2f(u.uOffset, ox, oy);
    gl.uniform1f(u.uRot, 0.007 * Math.sin(t * 0.6 + 0.3));
    gl.uniform1f(u.uSeed, (Math.floor(t * 24) % 97) * 1.37);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.color);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, current.depth);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function loop(now) { draw(now); if (running) raf = requestAnimationFrame(loop); }
  function start() { if (running || lost) return; running = true; raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function destroy() { stop(); textures.forEach((t) => { gl.deleteTexture(t.color); gl.deleteTexture(t.depth); }); textures.clear(); }

  return { addPlate, show, start, stop, destroy, resize, get lost() { return lost; } };
}
