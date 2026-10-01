/* Hero backdrop: a rainy window, written from scratch.
   Outside: a painted garden (a green morning by day; string lights, a lit window and
   fireflies by night).
   On the glass: fog and condensation beads (in the shader) and drops simulated in JS. A drop
   gathers water until gravity beats the grip of the glass, then slides in fits and starts: it
   meanders toward paths that are already wet, swallows what it runs into, leaves droplets
   behind and clears the fog. Every drop refracts the scene like a tiny fisheye: inverted and
   minified, with a dark rim and a glint. */
(function () {
  const noop = { ok: false, refresh() {} };
  const host = document.querySelector('.hero');
  const canvas = document.getElementById('bg-gl');
  if (!host || !canvas) { window.Backdrop = noop; return; }
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) { window.Backdrop = noop; return; }
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2, R = Math.random;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function gauss() { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * R()); }

  let W = 1, H = 1, time = 0, dark = 0;

  /* ---------- painting helpers ---------- */
  let PS = 1;   // scene canvas scale; shadowBlur ignores the transform
  function vgrad(c, y0, y1, stops) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    return g;
  }
  function glow(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function bulb(c, x, y, r, rgb, blur) {
    c.save(); c.shadowColor = `rgb(${rgb})`; c.shadowBlur = blur * PS; c.fillStyle = `rgb(${rgb})`;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore();
  }
  const hexCache = {};
  function tone(h, k) {
    const v = hexCache[h] || (hexCache[h] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    const f = (x) => Math.round(clamp(k >= 0 ? x + (255 - x) * k : x * (1 + k), 0, 255));
    return `rgb(${f(v[0])},${f(v[1])},${f(v[2])})`;
  }

  // groups many small shapes by fill style, so a scene paints in a handful of fill calls
  function batcher(c) {
    const groups = new Map();
    const path = (style) => { let p = groups.get(style); if (!p) groups.set(style, (p = new Path2D())); return p; };
    return {
      rect(style, x, y, w, h) { path(style).rect(x, y, w, h); },
      circle(style, x, y, r) { const p = path(style); p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); },
      ellipse(style, x, y, rx, ry, rot) { const p = path(style); p.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); p.ellipse(x, y, rx, ry, rot, 0, TAU); },
      flush() { groups.forEach((p, style) => { c.fillStyle = style; c.fill(p); }); groups.clear(); }
    };
  }
  // out-of-focus lights: soft discs that survive the fog's blur the way bright lights do in photos
  function bokeh(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.62, `rgba(${rgb},${a * 0.82})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  /* ---------- the garden outside ---------- */
  // leaves clustered in clumps; each clump is lighter toward its top
  function foliage(c, rand, L) {
    const s = H / 900, clumps = [], B = batcher(c);
    const hi = L.hi && `rgba(${[1, 3, 5].map((i) => parseInt(L.hi.slice(i, i + 2), 16)).join(',')},0.55)`;
    for (let i = 0; i < L.clumps; i++) {
      clumps.push({
        x: (-0.1 + rand() * 1.2) * W, y: (L.y[0] + rand() * (L.y[1] - L.y[0])) * H,
        r: (L.r[0] + rand() * (L.r[1] - L.r[0])) * s, col: L.cols[(rand() * L.cols.length) | 0], tilt: (rand() - 0.5) * 1.4
      });
    }
    const highlights = [];
    for (let i = 0; i < L.leaves; i++) {
      const k = clumps[(rand() * clumps.length) | 0];
      const a = rand() * TAU, dist = Math.sqrt(rand()) * k.r;
      const x = k.x + Math.cos(a) * dist, y = k.y + Math.sin(a) * dist * 0.75;
      const sz = (L.size[0] + rand() * (L.size[1] - L.size[0])) * s;
      const ang = k.tilt + (rand() - 0.5) * 1.8;
      const lift = Math.round((-(y - k.y) / (k.r * 0.75) * 0.14 + (rand() - 0.5) * 0.16) / 0.03) * 0.03;
      B.ellipse(tone(k.col, lift), x, y, sz, sz * 0.42, ang);
      if (hi && rand() < 0.16) highlights.push([x - Math.cos(ang) * sz * 0.2, y - sz * 0.12, sz * 0.5, sz * 0.16, ang]);
    }
    B.flush();
    highlights.forEach(([x, y, rx, ry, ang]) => B.ellipse(hi, x, y, rx, ry, ang));
    B.flush();
  }

  function paintGarden(c, d, rand) {
    const s = H / 900, B = batcher(c);
    c.fillStyle = vgrad(c, 0, H, d
      ? [[0, '#0a1222'], [0.55, '#0f1a22'], [1, '#070d0a']]
      : [[0, '#f2f5f0'], [0.5, '#e6ede3'], [1, '#d5e0d0']]);
    c.fillRect(0, 0, W, H);
    if (d) glow(c, W * 0.78, H * 0.08, W * 0.35, '140,160,220', 0.22);
    else glow(c, W * 0.7, H * 0.1, W * 0.5, '255,253,240', 0.85);
    if (d) {
      // a house wall with a lit window, half hidden by the leaves
      c.fillStyle = '#0c100f'; c.fillRect(W * 0.72, H * 0.28, W * 0.3, H);
      const wx = W * 0.79, wy = H * 0.38, ww = W * 0.11, wh = H * 0.2;
      glow(c, wx + ww / 2, wy + wh / 2, W * 0.22, '255,170,90', 0.35);
      c.fillStyle = vgrad(c, wy, wy + wh, [[0, '#ffcf8f'], [1, '#ff9f5a']]); c.fillRect(wx, wy, ww, wh);
      c.fillStyle = '#2a1a10'; c.fillRect(wx + ww / 2 - 2 * s, wy, 4 * s, wh); c.fillRect(wx, wy + wh / 2 - 2 * s, ww, 4 * s);
    }
    for (let i = 0; i < 5; i++) {
      const x = (0.05 + rand() * 0.9) * W, w = (8 + rand() * 16) * s;
      B.rect(d ? '#090e0c' : '#7a7466', x, H * (0.05 + rand() * 0.2), w, H);
    }
    B.flush();
    const layers = d ? [
      { y: [0, 0.62], clumps: 16, r: [90, 220], leaves: 900, size: [9, 24], cols: ['#14261f', '#18301f', '#112019'], hi: '#2b4a46' },
      { y: [0.3, 1.02], clumps: 18, r: [100, 240], leaves: 1100, size: [10, 30], cols: ['#0c1813', '#10201a', '#0a140f'], hi: '#1b3328' }
    ] : [
      { y: [-0.05, 0.6], clumps: 16, r: [90, 220], leaves: 1100, size: [8, 22], cols: ['#b8cab0', '#a9bfa2', '#c3d2b6', '#9cb398'], hi: '#dde8cc' },
      { y: [0.2, 0.92], clumps: 18, r: [100, 240], leaves: 1300, size: [10, 30], cols: ['#8aaa78', '#7c9d6c', '#97b67f', '#6e9063'], hi: '#c3d98c' },
      { y: [0.58, 1.08], clumps: 16, r: [110, 260], leaves: 1300, size: [12, 38], cols: ['#4f7552', '#406646', '#5b8358', '#37603e'], hi: '#86ad6a' }
    ];
    layers.forEach((L, i) => {
      foliage(c, rand, L);
      if (!d && i === 0) for (let k = 0; k < 34; k++) bokeh(c, rand() * W, H * rand() * 0.55, (8 + rand() * 22) * s, '252,253,246', 0.3 + rand() * 0.4);
    });
    if (d) {
      // string lights hung across the garden
      [[[-0.05, 0.16], [0.62, 0.27], 0.1], [[0.34, 0.07], [1.06, 0.19], 0.12]].forEach(([[x0, y0], [x1, y1], sag]) => {
        const X0 = x0 * W, Y0 = y0 * H, X1 = x1 * W, Y1 = y1 * H, S = sag * H;
        const pt = (t) => [X0 + (X1 - X0) * t, Y0 + (Y1 - Y0) * t + S * 4 * t * (1 - t)];
        c.strokeStyle = 'rgba(16,20,18,0.9)'; c.lineWidth = 1.2 * s; c.beginPath();
        for (let i = 0; i <= 40; i++) { const [x, y] = pt(i / 40); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
        const n = Math.round(Math.hypot(X1 - X0, Y1 - Y0) / (34 * s));
        for (let i = 1; i < n; i++) {
          const [x, y] = pt(i / n);
          bokeh(c, x, y + 4 * s, (11 + rand() * 6) * s, '255,190,110', 0.75);
          bulb(c, x, y + 4 * s, 2.6 * s, '255,214,150', 14 * s);
        }
      });
    } else {
      const petals = ['#f19ab5', '#f7f3ea', '#f3d36b', '#f2906f', '#c2aef0'];
      const centres = [];
      for (let k = 0; k < 8; k++) {
        const cx = (0.05 + rand() * 0.9) * W, cy = H * (0.72 + rand() * 0.24), col = petals[(rand() * petals.length) | 0];
        for (let i = 0; i < 26; i++) {
          const a = rand() * TAU, dist = Math.sqrt(rand()) * 70 * s;
          const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist * 0.5, r = (2.4 + rand() * 3.2) * s;
          B.circle(col, x, y, r);
          centres.push([x, y, r, col === '#f7f3ea']);
        }
      }
      B.flush();
      centres.forEach(([x, y, r, white]) => {
        B.circle('rgba(255,255,255,0.35)', x - r * 0.3, y - r * 0.3, r * 0.45);
        if (white) B.circle('#e8c04a', x, y, r * 0.35);
      });
      B.flush();
    }
  }

  /* ---------- fireflies ---------- */
  const MAXL = 16;
  const lightBuf = new Float32Array(MAXL * 4), lightCol = new Float32Array(MAXL * 3);
  let lightN = 0, lightState = {};
  function pushLight(x, y, r, k, rgb) {
    if (lightN >= MAXL || k <= 0.002) return;
    const i = lightN++;
    lightBuf[i * 4] = x; lightBuf[i * 4 + 1] = H - y; lightBuf[i * 4 + 2] = r; lightBuf[i * 4 + 3] = k;
    lightCol[i * 3] = rgb[0]; lightCol[i * 3 + 1] = rgb[1]; lightCol[i * 3 + 2] = rgb[2];
  }
  function updateLights() {
    lightN = 0;
    if (!dark) return;
    const s = H / 900, t = time, st = lightState;
    if (!st.flies) st.flies = Array.from({ length: 10 }, () => ({ x: W * (0.08 + R() * 0.88), y: H * (0.3 + R() * 0.6), a: R() * TAU, b: R() * TAU, w: 0.5 + R() * 0.9, ph: R() * TAU, f: 0.2 + R() * 0.25 }));
    for (const f of st.flies) {
      const x = f.x + Math.sin(t * f.f + f.a) * 70 * s + Math.sin(t * f.f * 2.3 + f.b) * 18 * s;
      const y = f.y + Math.cos(t * f.f * 0.8 + f.b) * 40 * s + Math.sin(t * f.f * 3.1 + f.a) * 10 * s;
      pushLight(x, y, 1.7 * s, Math.pow(Math.max(0, Math.sin(t * f.w + f.ph)), 3) * 1.6, [0.78, 1, 0.42]);
    }
  }

  /* ---------- GL ---------- */
  const MAXM = 18;
  const VS = '#version 300 es\nin vec2 a;\nvoid main() { gl_Position = vec4(a, 0.0, 1.0); }';
  const FS = `#version 300 es
precision highp float;
#define MAXM ${MAXM}
#define MAXL ${MAXL}
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uDark;
uniform float uSS;
uniform vec3 uFogTint;
uniform sampler2D uScene;
uniform sampler2D uDots;
uniform sampler2D uFog;
uniform vec4 uMov[MAXM];
uniform vec2 uMovT[MAXM];
uniform int uMovN;
uniform vec4 uLight[MAXL];
uniform vec3 uLightC[MAXL];
uniform int uLightN;
out vec4 outColor;

vec2 css;

float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// small lights outside: a sharp core plus a wide halo, both spread by the blur
vec3 lights(vec2 uv, float blur) {
  vec3 acc = vec3(0.0);
  vec2 p = uv * css;
  float b2 = blur * blur;
  for (int i = 0; i < MAXL; i++) {
    if (i >= uLightN) break;
    vec4 L = uLight[i];
    vec2 d = p - L.xy;
    float dd = dot(d, d), r2 = L.z * L.z, h2 = r2 * 90.0;
    acc += uLightC[i] * L.w * (r2 / (r2 + b2) * exp(-dd / (r2 + b2)) + 0.1 * h2 / (h2 + b2) * exp(-dd / (h2 + b2)));
  }
  return acc;
}

vec3 blurScene(vec2 uv, float lod) {
  vec2 texel = exp2(lod) / vec2(textureSize(uScene, 0));
  vec3 c = textureLod(uScene, uv, lod).rgb;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7854 + 0.4;
    c += textureLod(uScene, uv + vec2(cos(a), sin(a)) * texel * 1.3, lod).rgb;
  }
  return c / 9.0 + lights(uv, exp2(lod) / uSS * 1.2);
}

// A drop is a tiny fisheye: the outside appears sharp, shrunk and upside down,
// framed by a dark rim where light reflects back inside, plus a small glint.
vec3 dropColor(vec2 uv, vec2 n, float size) {
  vec2 k = vec2(css.y / css.x, 1.0) * (0.06 + size * 0.004) * vec2(1.0, 1.6);
  vec2 q = clamp(uv - n * k, 0.002, 0.998);
  vec2 ca = n * k * 0.04;
  vec3 seen = vec3(textureLod(uScene, clamp(q + ca, 0.002, 0.998), 0.5).r,
                   textureLod(uScene, q, 0.5).g,
                   textureLod(uScene, clamp(q - ca, 0.002, 0.998), 0.5).b) + lights(q, 0.8);
  float r = length(n);
  seen *= 1.0 - smoothstep(0.55, 1.0, r) * mix(0.55, 0.7, uDark);
  seen += smoothstep(0.75, 0.15, length(n - vec2(0.0, -0.5))) * mix(0.07, 0.05, uDark);
  seen += smoothstep(0.2, 0.0, length(n - vec2(-0.32, 0.42))) * mix(0.45, 0.6, uDark);
  return seen;
}

// condensation beads on a jittered grid; they only exist where the glass is fogged
vec4 beads(vec2 px, float cell, float rMin, float rMax, float density, float seed) {
  vec2 g = px / cell, id = floor(g), f = fract(g) - 0.5;
  float h = hash(id + seed);
  if (h > density) return vec4(0.0);
  vec2 o = (vec2(hash(id + seed + 1.7), hash(id + seed + 4.1)) - 0.5) * 0.36;
  float presence = smoothstep(0.3, 0.85, texture(uFog, (id + 0.5 + o) * cell / css).r);
  if (hash(id + seed + 21.0) > presence) return vec4(0.0);
  float r = mix(rMin, rMax, pow(hash(id + seed + 9.2), 2.2)) * mix(0.55, 1.0, presence) / cell;
  vec2 d = (f - o) * vec2(1.0, 1.06);
  float wob = 1.0 + 0.16 * (noise(normalize(d + 1e-5) * 1.6 + h * 37.0) - 0.5);
  float l = length(d) / wob;
  float aa = 0.9 / cell;
  return vec4(d / r, 1.0 - smoothstep(r - aa, r, l), r * cell);
}

// a sliding drop: a round head with a tail that tapers back along its path
vec4 teardrop(vec2 p, vec4 m, vec2 t) {
  vec2 q = p - m.xy;
  float r1 = m.z, h = m.w, ext = r1 + h + 2.0;
  if (dot(q, q) > ext * ext) return vec4(0.0);
  vec2 ax = vec2(t.y, -t.x);
  vec2 lp = vec2(dot(q, ax), dot(q, t));
  float r2 = r1 * 0.3, d, w;
  vec2 g;
  if (h <= (r1 - r2) * 1.05) {
    float l = length(lp); d = l - r1; g = lp / max(l, 1e-4); w = r1;
  } else {
    float sx = lp.x < 0.0 ? -1.0 : 1.0;
    lp.x = abs(lp.x);
    float b = (r1 - r2) / h, a = sqrt(1.0 - b * b);
    float k = dot(lp, vec2(-b, a));
    if (k < 0.0) { float l = length(lp); d = l - r1; g = lp / max(l, 1e-4); w = r1; }
    else if (k > a * h) { vec2 e = lp - vec2(0.0, h); float l = length(e); d = l - r2; g = e / max(l, 1e-4); w = r2; }
    else { d = dot(lp, vec2(a, b)) - r1; g = vec2(a, b); w = mix(r1, r2, clamp(lp.y / h, 0.0, 1.0)); }
    g.x *= sx;
  }
  float cov = clamp(0.5 - d / 1.1, 0.0, 1.0);
  if (cov <= 0.0) return vec4(0.0);
  float rho = clamp(1.0 + d / w, 0.0, 1.0);
  return vec4((g.x * ax + g.y * t) * rho, cov, r1);
}

void main() {
  css = uRes / uDpr;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = uv * css;
  float fogAmt = texture(uFog, uv).r;
  float fogMix = mix(0.24, 0.22, uDark);
  vec3 col;
  if (fogAmt > 0.995) col = mix(blurScene(uv, 3.7), uFogTint, fogMix);
  else if (fogAmt < 0.005) col = blurScene(uv, 1.1);
  else col = mix(blurScene(uv, 1.1), mix(blurScene(uv, 3.7), uFogTint, fogMix), fogAmt);

  vec4 b1 = beads(px, 6.5, 0.5, 2.1, 0.6, 0.0);
  vec4 b2 = beads(px, 17.0, 1.8, 5.2, 0.42, 13.0);
  vec4 drop = b2.z > b1.z ? b2 : b1;
  vec4 t = texture(uDots, uv);
  if (t.a > 0.02 && t.a > drop.z) {
    vec2 n = t.rg * 2.0 - 1.0;
    drop = vec4(n.x, -n.y, t.a, 3.5);
  }
  for (int i = 0; i < MAXM; i++) {
    if (i >= uMovN) break;
    vec4 m = teardrop(px, uMov[i], uMovT[i]);
    if (m.z > drop.z) drop = m;
  }
  if (drop.z > 0.001) col = mix(col, dropColor(uv, drop.xy, drop.w), drop.z);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.012;
  outColor = vec4(col, 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { window.Backdrop = noop; return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { window.Backdrop = noop; return; }
  gl.useProgram(prog);
  const U = {};
  ['uRes', 'uDpr', 'uTime', 'uDark', 'uSS', 'uFogTint', 'uScene', 'uDots', 'uFog', 'uMov', 'uMovT', 'uMovN', 'uLight', 'uLightC', 'uLightN']
    .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function makeTexture(unit, mip) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const texScene = makeTexture(0, true), texDots = makeTexture(1, false), texFog = makeTexture(2, false);
  gl.uniform1i(U.uScene, 0); gl.uniform1i(U.uDots, 1); gl.uniform1i(U.uFog, 2);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  function upload(unit, tex, src, mip) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  }

  /* ---------- the scene texture ---------- */
  const sceneCanvas = document.createElement('canvas');
  let SS = 1, fogTint = [0.9, 0.92, 0.93];
  function paintScene() {
    dark = root.dataset.theme === 'dark' ? 1 : 0;
    SS = 1;
    PS = SS;
    sceneCanvas.width = Math.max(2, Math.round(W * SS)); sceneCanvas.height = Math.max(2, Math.round(H * SS));
    // painted on the CPU: thousands of small shapes and one read-back are much cheaper there
    const c = sceneCanvas.getContext('2d', { willReadFrequently: true });
    c.setTransform(SS, 0, 0, SS, 0, 0);
    paintGarden(c, !!dark, rng(5875));   // fixed seed: the same garden on every visit
    lightState = {};
    // the fog takes on the scene's average colour
    const probe = document.createElement('canvas'); probe.width = 16; probe.height = 9;
    const pc = probe.getContext('2d', { willReadFrequently: true });
    pc.drawImage(sceneCanvas, 0, 0, 16, 9);
    const px = pc.getImageData(0, 0, 16, 9).data, avg = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) { avg[0] += px[i]; avg[1] += px[i + 1]; avg[2] += px[i + 2]; }
    const n = px.length / 4;
    const a = avg.map((v) => v / n / 255);
    fogTint = dark ? a.map((v, i) => v * 0.55 + [0.13, 0.14, 0.17][i] * 0.45) : a.map((v) => v * 0.55 + 0.95 * 0.45);
    upload(0, texScene, sceneCanvas, true);
    updateLights();
  }

  /* ---------- the glass: fog, wet paths, grip ---------- */
  const fog = document.createElement('canvas'), fctx = fog.getContext('2d');
  const FOG_SCALE = 0.25;
  let fogDirty = true, fogClock = 0;
  function resetFog() {
    fog.width = Math.max(2, Math.ceil(W * FOG_SCALE)); fog.height = Math.max(2, Math.ceil(H * FOG_SCALE));
    fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, fog.width, fog.height);
    fogDirty = true;
  }
  function wipeFog(x0, y0, x1, y1, w) {
    fctx.strokeStyle = '#000'; fctx.lineCap = 'round';
    fctx.lineWidth = Math.max(0.8, w * FOG_SCALE);
    fctx.beginPath(); fctx.moveTo(x0 * FOG_SCALE, y0 * FOG_SCALE); fctx.lineTo(x1 * FOG_SCALE + 0.01, y1 * FOG_SCALE); fctx.stroke();
    fogDirty = true;
  }
  function regrowFog(dt) {
    fogClock += dt;
    if (fogClock < 0.5) return;
    fogClock = 0;
    fctx.globalAlpha = 0.035; fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, fog.width, fog.height); fctx.globalAlpha = 1;
    // a small linear step as well, so the last few percent come back too
    fctx.globalCompositeOperation = 'lighter'; fctx.fillStyle = 'rgb(1,1,1)'; fctx.fillRect(0, 0, fog.width, fog.height);
    fctx.globalCompositeOperation = 'source-over';
    fogDirty = true;
  }

  // where drops have run recently the glass is wet: less grip, and later drops follow
  const WET_CELL = 6, WET_TAU = 14;
  let wetW = 1, wetH = 1, wetT = new Float32Array(1);
  function resetWet() {
    wetW = Math.ceil(W / WET_CELL) + 1; wetH = Math.ceil(H / WET_CELL) + 1;
    wetT = new Float32Array(wetW * wetH).fill(-1e4);
  }
  function wetAt(x, y) {
    const i = Math.floor(x / WET_CELL), j = Math.floor(y / WET_CELL);
    if (i < 0 || j < 0 || i >= wetW || j >= wetH) return 0;
    return Math.exp(-(time - wetT[j * wetW + i]) / WET_TAU);
  }
  function markWet(x, y, r) {
    const j = Math.floor(y / WET_CELL);
    if (j < 0 || j >= wetH) return;
    const i0 = Math.max(0, Math.floor((x - r * 0.8) / WET_CELL)), i1 = Math.min(wetW - 1, Math.floor((x + r * 0.8) / WET_CELL));
    for (let i = i0; i <= i1; i++) wetT[j * wetW + i] = time;
  }

  // grip varies across the glass (dust, grease, scratches): drops stall on the sticky patches
  const PG = 64, pinGrid = new Float32Array(PG * PG);
  { const pr = rng(77); for (let i = 0; i < pinGrid.length; i++) pinGrid[i] = pr(); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const i0 = ((xi % PG) + PG) % PG, j0 = ((yi % PG) + PG) % PG, i1 = (i0 + 1) % PG, j1 = (j0 + 1) % PG;
    const a = pinGrid[j0 * PG + i0], b = pinGrid[j0 * PG + i1], c = pinGrid[j1 * PG + i0], d = pinGrid[j1 * PG + i1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function gripAt(x, y) {
    const n = vnoise(x / 34, y / 34) * 0.65 + vnoise(x / 13 + 17.3, y / 13 + 5.1) * 0.35;
    const t = clamp((n - 0.3) / 0.5, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* ---------- drops ---------- */
  const RC = 5.4;          // radius (css px) at which gravity starts to beat the grip
  const G = 320, DRAG = 2.4, VMAX = 420, SWEEP = 0.022, FEED = 0.55;
  let dots = [], movers = [], dotsDirty = true, rainAcc = 0, seedClock = 0;
  const areaK = () => clamp((W * H) / (1440 * 900), 0.3, 1.6);

  function addDot(x, y, r, seed) {
    for (const o of dots) {
      if (o.dead) continue;
      const dx = o.x - x, dy = o.y - y, rr = o.r + r * 0.8;
      if (dx * dx + dy * dy < rr * rr) {
        o.r = Math.sqrt(o.r * o.r + r * r);
        if (!o.seed && o.r > RC * 0.75) { o.seed = true; o.grow = 0.02 + R() * 0.05; }
        dotsDirty = true;
        return;
      }
    }
    if (dots.length > 800) return;
    dots.push({ x, y, r, sp: (R() * 6) | 0, ax: 0.9 + R() * 0.2, seed: !!seed, grow: seed ? 0.012 + R() * R() * 0.08 : 0, dead: false, drawnR: 0 });
    dotsDirty = true;
  }

  function addMover(x, y, r, v) {
    if (movers.length >= MAXM) { addDot(x, y, Math.min(r, RC * 0.95), false); return; }
    movers.push({ x, y, r, v: v || 0, s: gauss() * 0.12, stall: 0, L: r * 0.12, tx: 0, ty: -1, trav: 0, nextDep: r * (1 + R() * 2), dead: false });
  }

  function moveDrop(m, dt) {
    const ahead = m.r * 1.1;
    const wet = wetAt(m.x, m.y + ahead);
    const drive = (m.r * m.r) / (RC * RC) - 1;
    const grip = (0.3 + gripAt(m.x, m.y + ahead)) * (1 - 0.65 * wet);
    if (m.v <= 0) {
      // pinned: it keeps gathering condensation until it breaks free
      m.v = 0;
      m.stall += dt;
      m.r += FEED * dt * (1 - wet * 0.7);
      if (drive > grip || R() < dt * 0.04) {
        m.v = 12 + R() * 28;
        m.s = clamp(m.s + gauss() * 0.22, -0.6, 0.6);
        m.stall = 0;
      } else if (m.stall > 8) { m.dead = true; addDot(m.x, m.y, m.r, false); return; }
    } else {
      m.v += (G * (drive - grip * 0.5) - DRAG * m.v) * dt;
      // the contact line snags on a dry patch: a sudden brake, then it gathers speed again
      if (R() < dt * m.v * 0.01 * (1 - wet) / (1 + drive)) m.v *= 0.15 + R() * 0.3;
      if (m.v < 3) m.v = 0;
      m.v = Math.min(m.v, VMAX);
    }
    // wander: a random walk in direction, pulled away from sticky spots and into wet paths
    const look = m.r * 1.6;
    const steer = (gripAt(m.x - look, m.y + look) - gripAt(m.x + look, m.y + look)) * 0.9
      + (wetAt(m.x + look, m.y + look) - wetAt(m.x - look, m.y + look)) * 1.5;
    const k = Math.min(1, m.v / 50);
    m.s = clamp(m.s + ((steer - m.s * 0.8) * 2.4 * dt + gauss() * 0.5 * Math.sqrt(dt)) * k, -0.65, 0.65);
    if (m.v > 0) {
      const inv = 1 / Math.sqrt(1 + m.s * m.s), ds = m.v * dt;
      const x0 = m.x, y0 = m.y;
      m.x += ds * m.s * inv; m.y += ds * inv;
      wipeFog(x0, y0, m.x, m.y, m.r * 1.7);
      markWet(m.x, m.y, m.r);
      m.r = Math.sqrt(m.r * m.r + SWEEP * m.r * ds * (1 - wet));
      m.trav += ds;
      if (m.trav >= m.nextDep) {
        // a little water stays behind
        m.trav = 0;
        const rd = m.r * (0.12 + R() * 0.2) * (m.v < 60 ? 1.3 : 1);
        const back = m.r + rd + 1.5 + R() * m.r * 0.5;
        addDot(m.x + m.tx * back + (R() - 0.5) * m.r * 0.5, m.y + m.ty * back, rd, false);
        m.r = Math.sqrt(Math.max(1, m.r * m.r - rd * rd * 1.3));
        m.nextDep = m.r * (0.8 - Math.log(1 - R()) * 2.0);
      }
    }
    // the tail stretches with speed and trails back along the path
    const Lt = m.r * clamp(0.12 + m.v / 85, 0.12, 2.6);
    m.L += (Lt - m.L) * (1 - Math.exp(-dt * (Lt > m.L ? 6 : 3)));
    const inv2 = 1 / Math.sqrt(1 + m.s * m.s), a = 1 - Math.exp(-dt * 6);
    m.tx += (-m.s * inv2 - m.tx) * a; m.ty += (-inv2 - m.ty) * a;
    const tl = Math.hypot(m.tx, m.ty) || 1; m.tx /= tl; m.ty /= tl;
    if (m.y - m.r - m.L > H + 4) m.dead = true;
  }

  function collide() {
    for (const m of movers) {
      if (m.dead) continue;
      const fx = -m.tx, fy = -m.ty;
      for (const d of dots) {
        if (d.dead) continue;
        const dx = d.x - m.x, dy = d.y - m.y, reach = m.r + d.r * 0.7;
        if (dx * dx + dy * dy > reach * reach || dx * fx + dy * fy < -m.r * 0.3) continue;
        // swallow it, and lurch toward where it was
        const A = m.r * m.r, B = d.r * d.r, w = B / (A + B);
        m.x += dx * w; m.y += Math.max(0, dy) * w;
        m.r = Math.sqrt(A + B);
        if (m.v > 0) { m.v += 30 * w; m.s = clamp(m.s + clamp(dx / (2 * m.r), -0.3, 0.3), -0.65, 0.65); }
        d.dead = true; dotsDirty = true;
      }
    }
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      if (a.dead) continue;
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.85;
        if (dx * dx + dy * dy > rr * rr) continue;
        const big = a.r >= b.r ? a : b, small = big === a ? b : a;
        const A = big.r * big.r, B = small.r * small.r, w = B / (A + B);
        big.x += (small.x - big.x) * w; big.y += Math.max(0, small.y - big.y) * w;
        big.r = Math.sqrt(A + B); big.v = Math.max(big.v, small.v) + 20 * w;
        small.dead = true;
      }
    }
  }

  function stepSim(dt) {
    time += dt;
    const ak = areaK();
    // a light rain: droplets land now and then
    rainAcc += 2.2 * ak * dt;
    while (rainAcc >= 1) { rainAcc -= 1; addDot(R() * W, R() * H, 0.9 + Math.pow(R(), 2.5) * 2.8, false); }
    // keep a population of drops slowly gathering water; one by one they get heavy enough to go
    seedClock += dt;
    if (seedClock > 0.4) {
      seedClock = 0;
      let n = 0;
      for (const d of dots) if (d.seed && !d.dead) n++;
      for (let i = n; i < Math.round(46 * ak); i++) {
        const x = R() * W, y = R() * H * 0.92;
        if (wetAt(x, y) < 0.3) addDot(x, y, 2 + R() * 2.6, true);
      }
    }
    for (const d of dots) {
      if (d.dead || !d.seed) continue;
      d.r += d.grow * dt;
      if (Math.abs(d.r - d.drawnR) > 0.3) dotsDirty = true;
      if (d.r >= RC) { d.dead = true; dotsDirty = true; addMover(d.x, d.y, d.r, 0); }
    }
    for (const m of movers) if (!m.dead) moveDrop(m, dt);
    collide();
    if (movers.some((m) => m.dead)) movers = movers.filter((m) => !m.dead);
    if (dots.length > 60 && dots.some((d) => d.dead)) dots = dots.filter((d) => !d.dead);
    regrowFog(dt);
  }

  /* ---------- the finger ---------- */
  const finger = { x: 0, y: 0, px: 0, py: 0, inside: false, moved: false, still: 0 };
  let water = 0;
  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy;
    const t = l ? clamp(((px - ax) * vx + (py - ay) * vy) / l, 0, 1) : 0;
    return Math.hypot(px - ax - vx * t, py - ay - vy * t);
  }
  function releaseWater() {
    // the water a wipe gathers runs down from the bottom edge of the stroke
    if (water >= 18) addMover(finger.x + (R() - 0.5) * 10, finger.y + 22 + R() * 4, Math.sqrt(Math.min(water, 140)), 0);
    water = 0;
  }
  function fingerStep(dt) {
    if (!finger.inside) { if (water) releaseWater(); return; }
    if (!finger.moved) { finger.still += dt; if (finger.still > 0.25 && water) releaseWater(); return; }
    finger.moved = false; finger.still = 0;
    const x0 = finger.px, y0 = finger.py, x1 = finger.x, y1 = finger.y;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) return;
    const RAD = 22;
    wipeFog(x0, y0, x1, y1, RAD * 2);
    const n = Math.ceil(len / WET_CELL);
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (let oy = -RAD; oy <= RAD; oy += WET_CELL) markWet(x, y + oy, RAD);
    }
    for (const d of dots) if (!d.dead && segDist(d.x, d.y, x0, y0, x1, y1) < RAD + d.r * 0.3) { d.dead = true; water += d.r * d.r; dotsDirty = true; }
    for (const m of movers) if (!m.dead && segDist(m.x, m.y, x0, y0, x1, y1) < RAD + m.r * 0.3) { m.dead = true; water += m.r * m.r; }
    water += len * 0.4;
    if (water > 64) releaseWater();
  }

  /* ---------- static droplets → normal map ---------- */
  // each sprite is slightly irregular and heavier at the bottom; RG = normal, A = coverage
  function makeSheet(S) {
    const cv = document.createElement('canvas'); cv.width = S * 6; cv.height = S;
    const cx = cv.getContext('2d'), img = cx.createImageData(S * 6, S), rr = rng(4242);
    for (let k = 0; k < 6; k++) {
      const ph = [rr() * TAU, rr() * TAU, rr() * TAU], am = [0.05 + rr() * 0.05, 0.03 + rr() * 0.03, 0.015 + rr() * 0.02];
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, th = Math.atan2(v, u);
          const edge = 0.9 + am[0] * Math.sin(2 * th + ph[0]) + am[1] * Math.sin(3 * th + ph[1]) + am[2] * Math.sin(5 * th + ph[2]);
          const dd = Math.hypot(u, v) / edge;
          if (dd >= 1) continue;
          let nx = u / edge, ny = (v - 0.14 * (1 - dd * dd)) / edge;
          const l = Math.hypot(nx, ny);
          if (l > 1) { nx /= l; ny /= l; }
          const i = (y * S * 6 + k * S + x) * 4;
          img.data[i] = 128 + 127 * nx; img.data[i + 1] = 128 + 127 * ny; img.data[i + 2] = 0;
          img.data[i + 3] = 255 * clamp((1 - dd) * S * 0.45, 0, 1);
        }
      }
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }
  const sheetBig = makeSheet(64), sheetSmall = makeSheet(16);
  const dotCanvas = document.createElement('canvas'), dctx = dotCanvas.getContext('2d');
  let dotClock = 0;
  function renderDots() {
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, dotCanvas.width, dotCanvas.height);
    for (const d of dots) {
      if (d.dead) continue;
      const big = d.r > 3, S = big ? 64 : 16;
      const w = d.r * 2 * d.ax, h = d.r * 2 / d.ax;
      dctx.drawImage(big ? sheetBig : sheetSmall, d.sp * S, 0, S, S, d.x - w / 2, d.y - h / 2, w, h);
      d.drawnR = d.r;
    }
    dotsDirty = false;
  }

  /* ---------- sizing, input, loop ---------- */
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  function sizeCanvas() { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); }
  function reset() {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    sizeCanvas();
    resetWet(); resetFog();
    dotCanvas.width = Math.ceil(W); dotCanvas.height = Math.ceil(H);
    dots = []; movers = []; water = 0;
    const ak = areaK();
    for (let i = 0; i < 46 * ak; i++) addDot(R() * W, R() * H, 2 + R() * 3.3, true);
    for (let i = 0; i < 160 * ak; i++) addDot(R() * W, R() * H, 0.8 + R() * R() * 2.4, false);
    paintScene();
    // let it rain for a while before anyone looks, so the glass already has a history
    for (let i = 0; i < 16 * 30; i++) stepSim(1 / 30);
    renderDots(); upload(1, texDots, dotCanvas, false);
    upload(2, texFog, fog, false); fogDirty = false;
  }
  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(host.clientWidth - W) > 1 || Math.abs(host.clientHeight - H) > 1) reset();
    }, 150);
  }).observe(host);
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);

  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!finger.inside) { finger.px = x; finger.py = y; } else if (!finger.moved) { finger.px = finger.x; finger.py = finger.y; }
    finger.x = x; finger.y = y; finger.inside = true; finger.moved = true;
  }, { passive: true });
  host.addEventListener('pointerleave', () => { finger.inside = false; });

  const movBuf = new Float32Array(MAXM * 4), movT = new Float32Array(MAXM * 2);
  function draw() {
    let n = 0;
    for (const m of movers) {
      if (m.dead || n >= MAXM) continue;
      movBuf[n * 4] = m.x; movBuf[n * 4 + 1] = H - m.y; movBuf[n * 4 + 2] = m.r; movBuf[n * 4 + 3] = m.L;
      movT[n * 2] = m.tx; movT[n * 2 + 1] = -m.ty;
      n++;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uDpr, canvas.width / W);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uDark, dark);
    gl.uniform1f(U.uSS, SS);
    gl.uniform3fv(U.uFogTint, fogTint);
    gl.uniform4fv(U.uMov, movBuf); gl.uniform2fv(U.uMovT, movT); gl.uniform1i(U.uMovN, n);
    gl.uniform4fv(U.uLight, lightBuf); gl.uniform3fv(U.uLightC, lightCol); gl.uniform1i(U.uLightN, lightN);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let last = performance.now(), frames = 0, slow = 0;
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = Math.max(last, now);
    if (visible && !document.hidden) {
      if (!reduced && dt > 0) {
        const n = Math.max(1, Math.ceil(dt * 60 - 0.01));
        for (let i = 0; i < n; i++) stepSim(dt / n);
        fingerStep(dt);
        updateLights();
      }
      dotClock += dt;
      if (dotsDirty && dotClock > 0.08) { renderDots(); upload(1, texDots, dotCanvas, false); dotClock = 0; }
      if (fogDirty) { upload(2, texFog, fog, false); fogDirty = false; }
      draw();
      frames++;
      if (dt > 0.03) slow++;
      if (frames === 120) {
        if (slow > 60 && dpr > 1) { dpr = Math.max(1, dpr * 0.75); sizeCanvas(); }
        frames = 0; slow = 0;
      }
    }
    requestAnimationFrame(frame);
  }

  window.Backdrop = {
    ok: true,
    refresh() { if ((root.dataset.theme === 'dark' ? 1 : 0) !== dark) paintScene(); }
  };
  reset();
  requestAnimationFrame(frame);
})();
