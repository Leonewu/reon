/* Hero backdrop: a fogged window. A blurred view outside, condensation beads, drops sliding
   down (each wipes a clear line), and the cursor wipes the fog like a finger.
   Colours are read from the CSS custom properties so the palette lives in one place. */
(function () {
  const noop = { ok: false, refresh() {} };
  const host = document.querySelector('.hero');
  const canvas = document.getElementById('bg-gl');
  if (!host || !canvas) { window.Backdrop = noop; return; }
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false });
  if (!gl) { window.Backdrop = noop; return; }

  const TRAIL = 40;

  /* ---------- GLSL ---------- */
  const HEAD = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHill;
uniform float uDpr;
uniform float uDark;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uTrail[${TRAIL}];
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
vec2 pos() { return (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; }
float calmZone(vec2 uv) { return smoothstep(0.0, 0.85, uv.y * 1.25 + uv.x * 0.55) * mix(0.4, 1.0, smoothstep(0.995, 0.86, uv.y)); }
`;

  const FRAG_SRC = `
vec3 outside(vec2 p, float blur) {
  vec3 top = mix(vec3(0.58, 0.72, 0.85), vec3(0.025, 0.04, 0.085), uDark);
  vec3 bot = mix(vec3(0.95, 0.9, 0.84), vec3(0.08, 0.085, 0.14), uDark);
  vec3 c = mix(bot, top, smoothstep(-0.5, 0.5, p.y));
  vec2 sun = vec2(0.5, 0.3);
  c += mix(vec3(1.0, 0.85, 0.6) * 0.35, vec3(0.9, 0.55, 0.3) * 0.1, uDark) * exp(-length(p - sun) * mix(2.6, 4.5, uDark));
  float cl = fbm(p * vec2(1.3, 2.8) + vec2(uTime * 0.008, 0.0));
  c = mix(c, mix(vec3(1.0), vec3(0.1, 0.12, 0.18), uDark), smoothstep(0.45, 0.8, cl) * 0.4 * smoothstep(-0.05, 0.4, p.y));
  float edge = 0.004 + blur * 0.08;
  float far = -0.03 + 0.09 * fbm(vec2(p.x * 1.5 + 4.0, 1.0));
  c = mix(c, mix(vec3(0.64, 0.7, 0.73), vec3(0.035, 0.045, 0.08), uDark), smoothstep(far + edge, far - edge, p.y) * 0.55);
  float near = -0.2 + 0.13 * fbm(vec2(p.x * 3.2, 3.0));
  c = mix(c, mix(vec3(0.33, 0.41, 0.37), vec3(0.012, 0.016, 0.03), uDark), smoothstep(near + edge, near - edge, p.y) * 0.75);
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float cs = mix(0.14, 0.23, fl);
    vec2 g = p / cs + vec2(fl * 7.3, fl * 3.1);
    vec2 id = floor(g);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cid = id + vec2(i, j);
        if (hash(cid + fl * 17.0) < 0.45) continue;
        vec2 cp = cid + vec2(hash(cid + 3.1), hash(cid + 7.7));
        float r = mix(0.1, 0.32, hash(cid + 11.3)) * (1.0 + blur * 1.4);
        float soft = 0.03 + blur * 0.45;
        float dd = length(g - cp);
        float m = smoothstep(r, r - soft, dd) * (0.8 + 0.2 * smoothstep(r - soft * 2.0, r - soft * 0.5, dd));
        float hue = hash(cid + 5.5);
        vec3 lc = hue < 0.35 ? uA : hue < 0.6 ? uB : mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.85, 0.6), uDark);
        float inten = mix(0.14, 0.6, uDark) * mix(0.55, 1.0, hash(cid + 2.2)) * (1.0 - blur * 0.3);
        inten *= smoothstep(0.6, -0.05, cp.y * cs);
        c += lc * m * inten;
      }
    }
  }
  return c;
}

// small static beads of condensation, one per jittered cell
vec3 beads(vec2 p) {
  float cs = 0.021;
  vec2 g = p / cs, id = floor(g), f = fract(g) - 0.5;
  vec2 o = (vec2(hash(id + 1.7), hash(id + 4.1)) - 0.5) * 0.3;
  float r = mix(0.12, 0.33, hash(id + 9.2)) * step(0.32, hash(id));
  vec2 d = (f - o) * vec2(1.0, 0.9);
  float m = r > 0.0 ? smoothstep(r, r * 0.72, length(d)) : 0.0;
  return vec3(d / max(r, 1e-3), m);
}

// drops that slide down a column, leaving a wiped line and a few tiny drops behind
vec3 slider(vec2 p, float seed, out float wiped) {
  float colW = 0.13;
  float cx = floor(p.x / colW) + seed * 31.0;
  float h = hash(vec2(cx, 3.3));
  float speed = mix(0.05, 0.14, hash(vec2(cx, 9.1)));
  float tt = uTime * speed + hash(vec2(cx, 1.7)) * 3.0;
  tt += 0.03 * sin(tt * 40.0 + h * 6.0);
  float y = 0.62 - mod(tt, 3.0);
  float base = (floor(p.x / colW) + 0.5 + (hash(vec2(cx, 5.5)) - 0.5) * 0.5) * colW;
  float x = base + 0.01 * sin(y * 17.0 + h * 6.0);
  float r = mix(0.016, 0.028, hash(vec2(cx, 7.7)));
  vec2 dd = (p - vec2(x, y)) * vec2(1.0, 0.82);
  float m = smoothstep(r, r * 0.8, length(dd));
  float above = p.y - y;
  float trail = step(0.0, above) * smoothstep(0.4, 0.0, above);
  float xp = base + 0.01 * sin(p.y * 17.0 + h * 6.0);
  wiped = trail * smoothstep(r * 0.95, r * 0.35, abs(p.x - xp));
  float k = floor(above / 0.032);
  vec2 tc = vec2(xp + (hash(vec2(cx, k)) - 0.5) * r * 0.5, y + (k + 0.5) * 0.032);
  float tr = r * 0.38 * smoothstep(0.4, 0.0, above) * step(0.45, hash(vec2(k, cx)));
  float tm = tr > 0.0 ? smoothstep(tr, tr * 0.6, length(p - tc)) * trail : 0.0;
  if (m >= tm) return vec3(dd / r, m);
  return vec3((p - tc) / max(tr, 1e-4), tm);
}

float fingerWipe(vec2 p) {
  float w = 0.0;
  for (int i = 0; i < ${TRAIL - 1}; i++) {
    vec3 a = uTrail[i], b = uTrail[i + 1];
    if (a.z <= 0.0 || b.z <= 0.0) continue;
    vec2 pa = p - a.xy, ba = b.xy - a.xy;
    float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float age = mix(a.z, b.z, hh);
    w = max(w, age * smoothstep(0.062, 0.045, length(pa - ba * hh)));
  }
  return w;
}

void main() {
  vec2 p = pos();
  vec2 uv = gl_FragCoord.xy / uRes;
  float w1, w2;
  vec3 s1 = slider(p, 0.0, w1);
  vec3 s2 = slider(p + vec2(0.065, 0.0), 1.0, w2);
  float clear = clamp(max(fingerWipe(p), max(w1, w2)), 0.0, 1.0);
  vec3 b = beads(p);
  b.z *= (1.0 - clear) * mix(0.6, 1.0, calmZone(uv));
  vec3 drop = s1;
  if (s2.z > drop.z) drop = s2;
  if (b.z > drop.z) drop = b;

  vec3 fogTint = mix(vec3(0.95, 0.96, 0.97), vec3(0.13, 0.15, 0.2), uDark);
  vec3 fogged = mix(outside(p, 1.0), fogTint, mix(0.5, 0.26, uDark));
  vec3 col = clear > 0.001 ? mix(fogged, outside(p, 0.06), clear * 0.95) : fogged;

  if (drop.z > 0.001) {
    vec2 n = drop.xy;
    vec3 seen = outside(p - n * 0.13, 0.1);
    float rr = length(n);
    seen *= 1.0 - smoothstep(0.55, 1.0, rr) * 0.3 * (0.6 + 0.4 * smoothstep(-0.2, 0.6, -n.y));
    seen += smoothstep(0.32, 0.0, length(n - vec2(-0.32, 0.38))) * mix(0.28, 0.4, uDark);
    col = mix(col, seen, drop.z);
  }
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.012;
  outColor = vec4(col, 1.0);
}`;

  /* ---------- Program ---------- */
  let prog;
  function program() {
    if (prog !== undefined) return prog;
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = make(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a;\nvoid main() { gl_Position = vec4(a, 0.0, 1.0); }');
    const fs = make(gl.FRAGMENT_SHADER, HEAD + FRAG_SRC);
    if (!vs || !fs) return (prog = null);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return (prog = null);
    const U = {};
    ['uRes', 'uTime', 'uMouse', 'uHill', 'uDpr', 'uDark', 'uPaper', 'uInk', 'uA', 'uB', 'uTrail'].forEach((n) => { U[n] = gl.getUniformLocation(p, n); });
    return (prog = { p, U });
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  /* ---------- State ---------- */
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let time = 20, last = performance.now(), visible = true, dirty = true, frames = 0, slow = 0;
  const mouse = { x: 0.25, y: 0.05, tx: 0.25, ty: 0.05, hill: 0, thill: 0 };
  const trail = [];                       // recent pointer positions for the finger wipe
  const trailData = new Float32Array(TRAIL * 3);
  const col = { paper: [1, 1, 1], ink: [0, 0, 0], A: [1, 0, 0], B: [0, 0, 1], dark: 0 };
  const target = { paper: [1, 1, 1], ink: [0, 0, 0], A: [1, 0, 0], B: [0, 0, 1], dark: 0 };

  function parse(str) {
    const s = (str || '').trim();
    if (s[0] === '#') {
      const h = s.length === 4 ? s.slice(1).split('').map((c) => c + c).join('') : s.slice(1);
      const n = parseInt(h, 16);
      return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    }
    const m = s.match(/[\d.]+/g) || [0, 0, 0];
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  }

  function readColors(instant) {
    const cs = getComputedStyle(root);
    target.paper = parse(cs.getPropertyValue('--paper-rgb'));
    target.ink = parse(cs.getPropertyValue('--ink-rgb'));
    target.A = parse(cs.getPropertyValue('--accent'));
    target.B = parse(cs.getPropertyValue('--accent-2') || cs.getPropertyValue('--accent'));
    target.dark = root.dataset.theme === 'dark' ? 1 : 0;
    if (instant) {
      ['paper', 'ink', 'A', 'B'].forEach((k) => { col[k] = target[k].slice(); });
      col.dark = target.dark;
    }
    dirty = true;
  }

  function resize() {
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    dirty = true;
  }
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; dirty = true; }).observe(host);

  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left - r.width / 2) / r.height;
    mouse.ty = (r.height / 2 - (e.clientY - r.top)) / r.height;
    mouse.thill = 1;
    const lastPt = trail[0];
    if (!lastPt || Math.hypot(lastPt.x - mouse.tx, lastPt.y - mouse.ty) > 0.02) {
      trail.unshift({ x: mouse.tx, y: mouse.ty, t: performance.now() });
      if (trail.length > TRAIL) trail.pop();
    }
    dirty = true;
  }, { passive: true });
  host.addEventListener('pointerleave', () => { mouse.thill = 0; dirty = true; });

  function draw(now) {
    const pr = program();
    if (!pr) return;
    gl.useProgram(pr.p);
    const U = pr.U;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.uHill, mouse.hill);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uDark, col.dark);
    gl.uniform3fv(U.uPaper, col.paper);
    gl.uniform3fv(U.uInk, col.ink);
    gl.uniform3fv(U.uA, col.A);
    gl.uniform3fv(U.uB, col.B);
    if (U.uTrail) {
      trailData.fill(0);
      trail.forEach((pt, i) => {
        trailData[i * 3] = pt.x;
        trailData[i * 3 + 1] = pt.y;
        trailData[i * 3 + 2] = Math.min(1, Math.max(0, 1 - (now - pt.t - 1500) / 3000));   // clear for a moment, then the fog creeps back
      });
      gl.uniform3fv(U.uTrail, trailData);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = Math.min(1, dt * 5);
    mouse.x += (mouse.tx - mouse.x) * k;
    mouse.y += (mouse.ty - mouse.y) * k;
    mouse.hill += (mouse.thill - mouse.hill) * Math.min(1, dt * 2.5);
    let settling = Math.abs(mouse.tx - mouse.x) + Math.abs(mouse.ty - mouse.y) + Math.abs(mouse.thill - mouse.hill);
    const ck = Math.min(1, dt * 6);
    ['paper', 'ink', 'A', 'B'].forEach((key) => {
      for (let i = 0; i < 3; i++) { const d = target[key][i] - col[key][i]; col[key][i] += d * ck; settling += Math.abs(d); }
    });
    col.dark += (target.dark - col.dark) * ck;
    settling += Math.abs(target.dark - col.dark);
    if (trail.length && now - trail[trail.length - 1].t > 4500) trail.pop();
    if (trail.length) settling += 1;
    if (!reduced) time += dt;

    if (visible && !document.hidden && (!reduced || dirty || settling > 0.002)) {
      draw(now);
      dirty = false;
      frames++;
      if (dt > 0.03) slow++;
      if (frames === 90) {
        if (slow > 45 && dpr > 1) { dpr = Math.max(1, dpr * 0.75); resize(); }
        frames = 0; slow = 0;
      }
    }
    requestAnimationFrame(frame);
  }

  window.Backdrop = { ok: true, refresh(instant) { readColors(instant); } };

  resize();
  readColors(true);
  requestAnimationFrame(frame);
})();
