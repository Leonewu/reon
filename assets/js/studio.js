/* Studio: interactive experiments. Every effect registers a stage and only runs while it is on screen. */
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effects = [];
  const fontsReady = Promise.all([
    document.fonts.load('600 100px "Instrument Sans"'),
    document.fonts.load('400 20px "Geist Mono"'),
    document.fonts.load('italic 400 60px "Instrument Serif"')
  ]).catch(() => {});

  /* ---------- shared plumbing ---------- */
  function register(stage, fx) {
    fx.stage = stage; fx.visible = false;
    effects.push(fx);
    io.observe(stage);
    if (fx.resize) new ResizeObserver(() => fx.resize()).observe(stage);
    fontsReady.then(() => fx.redraw && fx.redraw());
  }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    const fx = effects.find((f) => f.stage === e.target);
    if (fx) { fx.visible = e.isIntersecting; if (fx.visible && fx.onShow) fx.onShow(); }
  }), { rootMargin: '80px' });
  let last = performance.now();
  function loop(now) {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;
    if (!document.hidden) for (const fx of effects) if (fx.visible) fx.tick(dt, now / 1000);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function fail(stage, msg) {
    stage.insertAdjacentHTML('beforeend', `<div class="fail">${msg || 'This effect needs a browser with WebGL 2'}</div>`);
  }
  function fit(canvas, cap) {
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    const changed = canvas.width !== w || canvas.height !== h;
    if (changed) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr, changed };
  }
  function trackPointer(stage) {
    const p = { x: 0.5, y: 0.5, inside: false, lastMove: -1e9, moves: [] };
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      p.moves.push([x, y]);
      p.x = x; p.y = y; p.inside = true; p.lastMove = performance.now();
    });
    stage.addEventListener('pointerleave', () => { p.inside = false; });
    return p;
  }

  function glKit(canvas, attrs) {
    const gl = canvas.getContext('webgl2', Object.assign({ antialias: false, depth: false, stencil: false, alpha: false }, attrs));
    if (!gl) return null;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
        const name = gl.getActiveUniform(p, i).name;
        u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
      }
      return { p, u };
    };
    const draw = () => { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    const canvasTexture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const upload = (t, src) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    };
    return { gl, prog, draw, canvasTexture, upload };
  }
  const VS = '#version 300 es\nin vec2 aPos;\nout vec2 vUv;\nvoid main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  const NOISE = `
float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }`;

  /* ---------- shared: a small stable-fluids solver (velocity, optional dye) ---------- */
  const SVS = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 uTexel;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0); vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y); vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;
  const FH = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
out vec4 o;
`;
  // soft light beams slanting through a pale sky (palette comes from uniforms)
  const BEAMS = `
uniform vec3 uSkyTop; uniform vec3 uSkyBot; uniform vec3 uBeam;
vec3 beams(vec2 uv) {
  vec2 q = vec2(uv.x * uRes.x / uRes.y, uv.y);
  vec3 c = mix(uSkyBot, uSkyTop, smoothstep(0.0, 1.0, uv.y));
  vec2 dir = normalize(vec2(0.62, 0.78));
  float across = dot(q, vec2(-dir.y, dir.x)), along = dot(q, dir);
  float n = fbm(vec2(across * 4.2, along * 0.3 + uTime * 0.018));
  float s = smoothstep(0.5, 0.68, n) * (0.55 + 0.45 * noise(vec2(across * 9.0, along * 0.6 - uTime * 0.025)));
  float fine = smoothstep(0.62, 0.7, noise(vec2(across * 16.0, along * 0.25 + 3.0))) * 0.35;
  return mix(c, uBeam, clamp(s + fine, 0.0, 1.0) * 0.95);
}`;

  function makeTarget(gl, w, h, ifmt, fmt, mip) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.HALF_FLOAT, null);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, f, w, h, free() { gl.deleteTexture(t); gl.deleteFramebuffer(f); } };
  }
  function makePair(gl, w, h, ifmt, fmt, mip) {
    let a = makeTarget(gl, w, h, ifmt, fmt, mip), b = makeTarget(gl, w, h, ifmt, fmt, mip);
    return { get read() { return a; }, get write() { return b; }, swap() { const x = a; a = b; b = x; }, free() { a.free(); b.free(); } };
  }
  const bindTex = (gl, unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); return unit; };
  function blitTo(kit, canvas, to) {
    const gl = kit.gl;
    if (to) { gl.bindFramebuffer(gl.FRAMEBUFFER, to.f); gl.viewport(0, 0, to.w, to.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); }
    kit.draw();
  }

  function createFluid(kit, canvas, opt) {
    const { gl, prog } = kit;
    const o = Object.assign({ dye: true, simRes: 128, dyeRes: 512, curl: 24, velDiss: 0.3, dyeDiss: 0.85, iterations: 20, radius: 0.0022 }, opt);
    const P = {
      splat: prog(SVS, FH + `uniform sampler2D uTarget; uniform float uAspect; uniform vec3 uColor; uniform vec2 uPoint; uniform float uRadius;
void main() { vec2 p = vUv - uPoint; p.x *= uAspect; o = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / uRadius) * uColor, 1.0); }`),
      advect: prog(SVS, FH + `uniform sampler2D uVel; uniform sampler2D uSrc; uniform vec2 uSimTexel; uniform float uDt; uniform float uDiss;
void main() { vec2 c = vUv - uDt * texture(uVel, vUv).xy * uSimTexel; o = texture(uSrc, c) / (1.0 + uDiss * uDt); }`),
      div: prog(SVS, FH + `uniform sampler2D uVel;
void main() {
  float L = texture(uVel, vL).x, R = texture(uVel, vR).x, T = texture(uVel, vT).y, B = texture(uVel, vB).y;
  vec2 C = texture(uVel, vUv).xy;
  if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`),
      curl: prog(SVS, FH + `uniform sampler2D uVel;
void main() { o = vec4(0.5 * (texture(uVel, vR).y - texture(uVel, vL).y - texture(uVel, vT).x + texture(uVel, vB).x), 0.0, 0.0, 1.0); }`),
      vort: prog(SVS, FH + `uniform sampler2D uVel; uniform sampler2D uCurl; uniform float uK; uniform float uDt;
void main() {
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f = f / (length(f) + 1e-4) * uK * C; f.y = -f.y;
  o = vec4(clamp(texture(uVel, vUv).xy + f * uDt, -1000.0, 1000.0), 0.0, 1.0);
}`),
      press: prog(SVS, FH + `uniform sampler2D uP; uniform sampler2D uDiv;
void main() { o = vec4((texture(uP, vL).x + texture(uP, vR).x + texture(uP, vT).x + texture(uP, vB).x - texture(uDiv, vUv).x) * 0.25, 0.0, 0.0, 1.0); }`),
      grad: prog(SVS, FH + `uniform sampler2D uP; uniform sampler2D uVel;
void main() { vec2 g = 0.5 * vec2(texture(uP, vR).x - texture(uP, vL).x, texture(uP, vT).x - texture(uP, vB).x); o = vec4(texture(uVel, vUv).xy - g, 0.0, 1.0); }`),
      scale: prog(SVS, FH + `uniform sampler2D uT; uniform float uK; void main() { o = uK * texture(uT, vUv); }`)
    };
    let simW = 2, simH = 2, dyeW = 2, dyeH = 2, aspect = 1.6, vel, dye, pres, divT, curlT;
    const use = (p) => { gl.useProgram(p.p); return p.u; };
    const B = (unit, t) => bindTex(gl, unit, t);
    const to = (target) => blitTo(kit, canvas, target);
    function alloc() {
      [vel, dye, pres, divT, curlT].forEach((x) => x && x.free());
      aspect = canvas.width / canvas.height;
      simH = o.simRes; simW = Math.max(2, Math.round(simH * aspect));
      vel = makePair(gl, simW, simH, gl.RG16F, gl.RG, false);
      pres = makePair(gl, simW, simH, gl.R16F, gl.RED, false);
      divT = makeTarget(gl, simW, simH, gl.R16F, gl.RED, false);
      curlT = makeTarget(gl, simW, simH, gl.R16F, gl.RED, false);
      if (o.dye) { dyeH = o.dyeRes; dyeW = Math.round(dyeH * aspect); dye = makePair(gl, dyeW, dyeH, gl.RGBA16F, gl.RGBA, true); }
      else dye = null;
    }
    function splat(x, y, dx, dy, rgb) {
      const u = use(P.splat);
      gl.uniform2f(u.uTexel, 1 / simW, 1 / simH);
      gl.uniform1f(u.uAspect, aspect);
      gl.uniform2f(u.uPoint, x, y);
      gl.uniform1f(u.uRadius, o.radius * Math.max(aspect, 1));
      gl.uniform1i(u.uTarget, B(0, vel.read.t)); gl.uniform3f(u.uColor, dx, dy, 0); to(vel.write); vel.swap();
      if (dye && rgb) { gl.uniform1i(u.uTarget, B(0, dye.read.t)); gl.uniform3f(u.uColor, rgb[0], rgb[1], rgb[2]); to(dye.write); dye.swap(); }
    }
    function step(dt) {
      let u = use(P.curl); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform1i(u.uVel, B(0, vel.read.t)); to(curlT);
      u = use(P.vort); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform1i(u.uVel, B(0, vel.read.t)); gl.uniform1i(u.uCurl, B(1, curlT.t));
      gl.uniform1f(u.uK, o.curl); gl.uniform1f(u.uDt, dt); to(vel.write); vel.swap();
      u = use(P.div); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform1i(u.uVel, B(0, vel.read.t)); to(divT);
      u = use(P.scale); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform1i(u.uT, B(0, pres.read.t)); gl.uniform1f(u.uK, 0.8); to(pres.write); pres.swap();
      u = use(P.press); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform1i(u.uDiv, B(1, divT.t));
      for (let i = 0; i < o.iterations; i++) { gl.uniform1i(u.uP, B(0, pres.read.t)); to(pres.write); pres.swap(); }
      u = use(P.grad); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform1i(u.uP, B(0, pres.read.t)); gl.uniform1i(u.uVel, B(1, vel.read.t)); to(vel.write); vel.swap();
      u = use(P.advect); gl.uniform2f(u.uTexel, 1 / simW, 1 / simH); gl.uniform2f(u.uSimTexel, 1 / simW, 1 / simH); gl.uniform1f(u.uDt, dt);
      gl.uniform1i(u.uVel, B(0, vel.read.t)); gl.uniform1i(u.uSrc, B(1, vel.read.t)); gl.uniform1f(u.uDiss, o.velDiss); to(vel.write); vel.swap();
      if (dye) {
        gl.uniform2f(u.uTexel, 1 / dyeW, 1 / dyeH);
        gl.uniform1i(u.uVel, B(0, vel.read.t)); gl.uniform1i(u.uSrc, B(1, dye.read.t)); gl.uniform1f(u.uDiss, o.dyeDiss); to(dye.write); dye.swap();
        B(0, dye.read.t); gl.generateMipmap(gl.TEXTURE_2D);
      }
    }
    alloc();
    return {
      alloc, splat, step,
      get vel() { return vel.read.t; },
      get dye() { return dye ? dye.read.t : null; },
      get aspect() { return aspect; }
    };
  }

  // feeds pointer movement into a fluid as velocity splats (x, y in 0..1 with y up)
  function stirrer(stage) {
    const p = trackPointer(stage);
    let prev = null;
    return {
      ptr: p,
      each(fn) {
        for (const [x, y] of p.moves.splice(0)) {
          const u = x, v = 1 - y;
          if (prev) { const dx = u - prev[0], dy = v - prev[1]; if (Math.abs(dx) + Math.abs(dy) > 0.0004) fn(u, v, dx, dy); }
          prev = [u, v];
        }
        if (!p.inside) prev = null;
      }
    };
  }

  /* ---------- 01 glass type, with three write-on animations ---------- */
  (function () {
    const stage = document.getElementById('fx-glass'), canvas = stage.querySelector('canvas');
    const kit = glKit(canvas);
    if (!kit) return fail(stage);
    const { gl, prog } = kit;
    if (!gl.getExtension('EXT_color_buffer_float')) return fail(stage, 'This effect needs floating-point rendering');

    // Text is laid out into a DW x DH field. Every texel keeps its signed distance to the
    // letters and the shader wraps glass around that. For the write-on animations a second
    // field keeps, per texel, the moment the pen (or the letter) reaches it.
    const DW = 1024, DH = 600, N = DW * DH, BOX_W = 2.4, BOX_H = BOX_W * DH / DW, PX = BOX_W / DW;
    const CJK = /[⺀-鿿豈-﫿぀-ヿ가-힯＀-￯]/;
    // all free (OFL) fonts from Google Fonts; weight picked so each reads well as glass
    const FONTS = [
      { key: 'fredoka', name: 'Fredoka', note: 'round', css: 'Fredoka', weight: 600, slant: 0.06 },
      { key: 'pacifico', name: 'Pacifico', note: 'retro script', css: 'Pacifico', weight: 400, slant: 0 },
      { key: 'borel', name: 'Borel', note: 'cursive', css: 'Borel', weight: 400, slant: 0 },
      { key: 'playpen', name: 'Playpen Sans', note: 'ballpoint', css: 'Playpen Sans', weight: 500, slant: 0.03 },
      { key: 'gummy', name: 'Sour Gummy', note: 'gummy', css: 'Sour Gummy', weight: 700, slant: 0.05 },
      { key: 'titan', name: 'Titan One', note: 'bubbly', css: 'Titan One', weight: 400, slant: 0.05 },
      { key: 'cherry', name: 'Cherry Bomb', note: 'bubblegum', css: 'Cherry Bomb One', weight: 400, slant: 0.03 },
      { key: 'grand', name: 'Grandstander', note: 'playful', css: 'Grandstander', weight: 600, slant: 0.02 },
      { key: 'comfortaa', name: 'Comfortaa', note: 'thin round', css: 'Comfortaa', weight: 500, slant: 0.1 },
      { key: 'quicksand', name: 'Quicksand', note: 'light', css: 'Quicksand', weight: 300, slant: 0.14 }
    ];
    const MODES = [
      { key: 'pop', name: 'A · Letter by letter', note: 'letters inflate in turn' },
      { key: 'trace', name: 'B · Traced strokes', note: 'strokes worked out from the font' },
      { key: 'order', name: 'C · Stroke order', note: 'single-line hand, real Chinese order' },
      { key: 'script', name: 'D · Script', note: 'stroke templates for four script fonts' }
    ];
    // D: stroke templates from Vara.js (MIT), drawn for these open-source script fonts.
    // Each character is a list of pen paths in writing order.
    const SCRIPTS = [
      { key: 'v-pacifico', name: 'Pacifico', note: 'retro script', css: 'Pacifico', file: 'Pacifico/PacificoSLO.json', gap: 0 },
      { key: 'v-parisienne', name: 'Parisienne', note: 'elegant', css: 'Parisienne', file: 'Parisienne/Parisienne.json', gap: 0 },
      { key: 'v-satisfy', name: 'Satisfy', note: 'casual', css: 'Satisfy', file: 'Satisfy/SatisfySL.json', gap: 0 },
      { key: 'v-shadows', name: 'Shadows Into Light', note: 'marker', css: 'Shadows Into Light', file: 'Shadows-Into-Light/shadows-into-light.json', gap: 0.3 }
    ];
    let script = SCRIPTS[0];
    let font = FONTS[0], mode = MODES[1];
    let R = 0.085, GROW = 0.085, geo = null, anim = null;

    /* ---- distance transforms (Felzenszwalb & Huttenlocher), with the nearest source ---- */
    const M = Math.max(DW, DH);
    const S = { f: new Float64Array(M), d: new Float64Array(M), v: new Int32Array(M), z: new Float64Array(M + 1), a: new Int32Array(M) };
    function edt1d(n) {
      const { f, d, v, z, a } = S;
      let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; a[q] = v[k]; }
    }
    // distance (px) from every texel to the nearest seed; optionally which seed that is
    function transform(seed, wantSource) {
      const dist = new Float64Array(N), colSrc = wantSource ? new Int32Array(N) : null, src = wantSource ? new Int32Array(N) : null;
      for (let x = 0; x < DW; x++) {
        for (let y = 0; y < DH; y++) S.f[y] = seed[y * DW + x] ? 0 : 1e20;
        edt1d(DH);
        for (let y = 0; y < DH; y++) { dist[y * DW + x] = S.d[y]; if (colSrc) colSrc[y * DW + x] = S.a[y]; }
      }
      for (let y = 0, row = 0; y < DH; y++, row += DW) {
        for (let x = 0; x < DW; x++) S.f[x] = dist[row + x];
        edt1d(DW);
        for (let x = 0; x < DW; x++) {
          dist[row + x] = Math.sqrt(S.d[x]);
          if (src) { const sx = S.a[x]; src[row + x] = colSrc[row + sx] * DW + sx; }
        }
      }
      return { dist, src };
    }
    // spread per-seed values to every texel (each texel takes its nearest seed's value)
    function spread(seed, value) {
      let any = false;
      for (let i = 0; i < N; i++) if (seed[i]) { any = true; break; }
      const out = new Float32Array(N);
      if (!any) return out.fill(1e6);
      const { src } = transform(seed, true);
      for (let i = 0; i < N; i++) out[i] = value[src[i]];
      return out;
    }

    /* ---- layout ---- */
    function tokens(text) {
      // words (and single CJK characters) are the units that can move to the next line
      const toks = [];
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { toks.push(' '); continue; }
        let buf = '';
        for (const ch of part) { if (CJK.test(ch)) { if (buf) toks.push(buf); buf = ''; toks.push(ch); } else buf += ch; }
        if (buf) toks.push(buf);
      }
      return toks;
    }
    // try 1, 2, 3… lines and keep whichever lets the letters be biggest (sizes at 100px)
    function fitLines(text, advance, ink, lh, slant) {
      const toks = tokens(text);
      const wrap = (maxW) => {
        const lines = [];
        let cur = '';
        for (const t of toks) {
          const next = cur + t;
          if (cur.trim() && t !== ' ' && advance(next.trimEnd()) > maxW) { lines.push(cur.trim()); cur = t; }
          else cur = next;
        }
        if (cur.trim()) lines.push(cur.trim());
        return lines.length ? lines : [''];
      };
      const fullW = advance(text);
      let best = null;
      for (let L = 1; L <= 30; L++) {
        let lo = 0, hi = fullW;
        for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (wrap(mid).length <= L) hi = mid; else lo = mid; }
        const lines = wrap(hi);
        const wMax = Math.max(1, ...lines.map(ink));
        const fs = Math.min(420, DW * 0.84 / (wMax / 100 + slant * lh / 100), DH * 0.84 / (lines.length * lh / 100));
        if (!best || fs > best.fs * 1.02) best = { lines, fs };
        if (lines.length < L) break;
      }
      return best;
    }

    const cv = document.createElement('canvas'); cv.width = DW; cv.height = DH;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    function readMask() {
      const a = cx.getImageData(0, 0, DW, DH).data, m = new Uint8Array(N);
      for (let i = 0; i < N; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
      return m;
    }
    const emptyGeo = (kind) => ({ kind, mask: new Uint8Array(N), fs: 100, cjk: false, slant: 0, lines: [], T: 5.8, strokes: [] });

    /* ---- letters from a font ---- */
    const fontFor = (cjk, px = 100) => (cjk && !/Cherry/.test(font.css)
      ? `${Math.min(font.weight, 500)} ${px}px "Noto Sans SC", sans-serif`
      : `${font.weight} ${px}px "${font.css}", "Noto Sans SC", sans-serif`);
    function layoutFont(text) {
      if (!text) return emptyGeo('font');
      const cjk = CJK.test(text), slant = cjk ? 0 : font.slant;
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, DW, DH);
      cx.font = fontFor(cjk);
      const probe = cx.measureText('Hgjy国');
      const lh = (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent) * 1.06 + 12;   // incl. room for the tube
      const ink = (l) => { const m = cx.measureText(l); return m.actualBoundingBoxLeft + m.actualBoundingBoxRight; };
      const best = fitLines(text, (s) => cx.measureText(s).width, ink, lh, slant);
      const fs = Math.max(10, best.fs);
      cx.font = fontFor(cjk, fs.toFixed(1));
      cx.setTransform(1, 0, -slant, 1, slant * DH / 2, 0);
      cx.fillStyle = '#fff';
      const step = lh * fs / 100, lines = [];
      best.lines.forEach((line, i) => {
        const m = cx.measureText(line), w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const cy = DH / 2 + (i - (best.lines.length - 1) / 2) * step;
        const x0 = (DW - w) / 2 + m.actualBoundingBoxLeft;
        cx.fillText(line, x0, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
        const chars = Array.from(line), edges = [];
        let acc = '';
        for (const ch of chars) { edges.push(x0 + cx.measureText(acc).width); acc += ch; }
        lines.push({ cy, chars, edges });
      });
      return { kind: 'font', mask: readMask(), fs, cjk, slant, lines, T: (cjk ? 0.03 : 0.058) * fs, strokes: null };
    }

    /* ---- letters from pen paths: a single-line hand drawn for this page ----
       Units: 1000 per em, y down, baseline 0, x-height -480, caps -700, descenders +230.
       Each entry is [advance, strokes]; strokes are listed in writing order and direction. */
    const HAND = {
      a: [460, ['M 380 -380 C 350 -450 300 -480 230 -480 C 120 -480 50 -380 50 -240 C 50 -100 120 0 220 0 C 310 0 370 -80 380 -170', 'M 390 -480 L 390 0']],
      b: [460, ['M 70 -720 L 70 0', 'M 72 -250 C 85 -400 160 -480 250 -480 C 350 -480 410 -380 410 -240 C 410 -100 350 0 250 0 C 160 0 85 -80 72 -200']],
      c: [420, ['M 370 -390 C 340 -450 290 -480 230 -480 C 120 -480 50 -380 50 -240 C 50 -100 120 0 230 0 C 290 0 340 -30 370 -90']],
      d: [460, ['M 375 -380 C 345 -450 295 -480 225 -480 C 115 -480 50 -380 50 -240 C 50 -100 115 0 215 0 C 305 0 365 -80 375 -170', 'M 390 -720 L 390 0']],
      e: [430, ['M 60 -250 L 380 -250 C 380 -390 310 -480 220 -480 C 110 -480 50 -380 50 -240 C 50 -100 120 0 230 0 C 300 0 350 -30 380 -90']],
      f: [300, ['M 270 -690 C 245 -712 215 -720 185 -720 C 125 -720 100 -675 100 -600 L 100 0', 'M 30 -470 L 250 -470']],
      g: [460, ['M 380 -380 C 350 -450 300 -480 230 -480 C 120 -480 50 -390 50 -260 C 50 -130 120 -40 220 -40 C 310 -40 370 -110 380 -200', 'M 390 -480 L 390 60 C 390 170 320 230 220 230 C 150 230 100 200 70 150']],
      h: [450, ['M 70 -720 L 70 0', 'M 72 -300 C 90 -420 160 -480 240 -480 C 340 -480 380 -410 380 -310 L 380 0']],
      i: [160, ['M 80 -480 L 80 0', 'M 80 -645 L 80 -635']],
      j: [210, ['M 140 -480 L 140 90 C 140 180 100 230 30 230', 'M 140 -645 L 140 -635']],
      k: [410, ['M 70 -720 L 70 0', 'M 360 -480 L 75 -200', 'M 175 -295 L 380 0']],
      l: [180, ['M 80 -720 L 80 -90 C 80 -30 105 0 150 0']],
      m: [660, ['M 70 -480 L 70 0', 'M 72 -330 C 90 -430 150 -480 220 -480 C 300 -480 330 -420 330 -330 L 330 0', 'M 332 -330 C 350 -430 410 -480 480 -480 C 560 -480 590 -420 590 -330 L 590 0']],
      n: [450, ['M 70 -480 L 70 0', 'M 72 -300 C 90 -420 160 -480 240 -480 C 340 -480 380 -410 380 -310 L 380 0']],
      o: [460, ['M 230 -480 C 120 -480 50 -380 50 -240 C 50 -100 120 0 230 0 C 340 0 410 -100 410 -240 C 410 -380 340 -480 230 -480 Z']],
      p: [460, ['M 70 -480 L 70 230', 'M 72 -250 C 85 -400 160 -480 250 -480 C 350 -480 410 -380 410 -240 C 410 -100 350 0 250 0 C 160 0 85 -80 72 -200']],
      q: [460, ['M 375 -380 C 345 -450 295 -480 225 -480 C 115 -480 50 -380 50 -240 C 50 -100 115 0 215 0 C 305 0 365 -80 375 -170', 'M 390 -480 L 390 230']],
      r: [310, ['M 70 -480 L 70 0', 'M 72 -300 C 90 -420 160 -480 270 -470']],
      s: [380, ['M 330 -420 C 300 -460 250 -480 190 -480 C 110 -480 60 -440 60 -370 C 60 -300 120 -270 190 -250 C 270 -230 330 -190 330 -120 C 330 -40 270 0 190 0 C 120 0 70 -30 40 -80']],
      t: [300, ['M 120 -640 L 120 -90 C 120 -30 150 0 200 0 C 230 0 250 -10 270 -20', 'M 30 -470 L 260 -470']],
      u: [450, ['M 70 -480 L 70 -170 C 70 -60 120 0 210 0 C 300 0 360 -60 378 -180', 'M 380 -480 L 380 0']],
      v: [420, ['M 40 -480 L 210 0 L 380 -480']],
      w: [620, ['M 40 -480 L 170 0 L 310 -380 L 450 0 L 580 -480']],
      x: [400, ['M 50 -480 L 350 0', 'M 350 -480 L 50 0']],
      y: [420, ['M 40 -480 L 210 -20', 'M 380 -480 L 180 70 C 150 160 110 220 40 220']],
      z: [400, ['M 60 -480 L 350 -480 L 50 0 L 350 0']],
      A: [560, ['M 40 0 L 280 -700 L 520 0', 'M 120 -230 L 440 -230']],
      B: [500, ['M 80 -700 L 80 0', 'M 80 -700 L 260 -700 C 360 -700 410 -650 410 -540 C 410 -430 350 -380 250 -380 L 80 -380', 'M 250 -380 C 380 -380 440 -310 440 -190 C 440 -70 370 0 260 0 L 80 0']],
      C: [560, ['M 500 -580 C 450 -660 380 -710 290 -710 C 140 -710 50 -560 50 -350 C 50 -140 140 10 290 10 C 380 10 450 -40 500 -120']],
      D: [560, ['M 80 -700 L 80 0', 'M 80 -700 L 230 -700 C 410 -700 500 -560 500 -350 C 500 -140 410 0 230 0 L 80 0']],
      E: [460, ['M 400 -700 L 80 -700 L 80 0 L 400 0', 'M 80 -360 L 340 -360']],
      F: [440, ['M 400 -700 L 80 -700 L 80 0', 'M 80 -360 L 340 -360']],
      G: [580, ['M 500 -580 C 450 -660 380 -710 290 -710 C 140 -710 50 -560 50 -350 C 50 -140 140 10 290 10 C 420 10 510 -80 520 -260 L 330 -260']],
      H: [560, ['M 80 -700 L 80 0', 'M 480 -700 L 480 0', 'M 80 -360 L 480 -360']],
      I: [180, ['M 90 -700 L 90 0']],
      J: [380, ['M 300 -700 L 300 -190 C 300 -60 240 10 160 10 C 90 10 50 -30 30 -100']],
      K: [500, ['M 80 -700 L 80 0', 'M 440 -700 L 90 -290', 'M 210 -440 L 470 0']],
      L: [420, ['M 80 -700 L 80 0 L 390 0']],
      M: [680, ['M 70 0 L 110 -700 L 340 -180 L 570 -700 L 610 0']],
      N: [580, ['M 80 0 L 80 -700 L 500 0 L 500 -700']],
      O: [620, ['M 310 -710 C 150 -710 50 -560 50 -350 C 50 -140 150 10 310 10 C 470 10 570 -140 570 -350 C 570 -560 470 -710 310 -710 Z']],
      P: [480, ['M 80 -700 L 80 0', 'M 80 -700 L 260 -700 C 370 -700 430 -630 430 -520 C 430 -410 370 -340 260 -340 L 80 -340']],
      Q: [620, ['M 310 -710 C 150 -710 50 -560 50 -350 C 50 -140 150 10 310 10 C 470 10 570 -140 570 -350 C 570 -560 470 -710 310 -710 Z', 'M 360 -150 L 560 40']],
      R: [500, ['M 80 -700 L 80 0', 'M 80 -700 L 260 -700 C 370 -700 430 -630 430 -520 C 430 -410 370 -340 260 -340 L 80 -340', 'M 250 -340 L 460 0']],
      S: [480, ['M 420 -600 C 380 -670 320 -710 240 -710 C 140 -710 70 -650 70 -550 C 70 -450 150 -410 250 -380 C 360 -350 430 -290 430 -190 C 430 -60 350 10 240 10 C 150 10 80 -30 40 -110']],
      T: [500, ['M 30 -700 L 470 -700', 'M 250 -700 L 250 0']],
      U: [560, ['M 80 -700 L 80 -250 C 80 -80 160 10 280 10 C 400 10 480 -80 480 -250 L 480 -700']],
      V: [540, ['M 30 -700 L 270 0 L 510 -700']],
      W: [780, ['M 30 -700 L 200 0 L 390 -560 L 580 0 L 750 -700']],
      X: [520, ['M 50 -700 L 470 0', 'M 470 -700 L 50 0']],
      Y: [520, ['M 40 -700 L 260 -360 L 480 -700', 'M 260 -360 L 260 0']],
      Z: [500, ['M 60 -700 L 440 -700 L 50 0 L 450 0']],
      0: [460, ['M 230 -710 C 110 -710 50 -560 50 -350 C 50 -140 110 10 230 10 C 350 10 410 -140 410 -350 C 410 -560 350 -710 230 -710 Z']],
      1: [380, ['M 110 -560 L 260 -700 L 260 0']],
      2: [460, ['M 70 -560 C 100 -650 160 -710 240 -710 C 340 -710 400 -640 400 -550 C 400 -450 340 -380 60 0 L 410 0']],
      3: [460, ['M 70 -620 C 110 -680 170 -710 240 -710 C 340 -710 400 -650 400 -560 C 400 -460 330 -400 220 -400 C 340 -400 420 -330 420 -210 C 420 -80 340 10 230 10 C 150 10 90 -30 50 -100']],
      4: [480, ['M 300 -700 L 40 -220 L 440 -220', 'M 340 -480 L 340 0']],
      5: [460, ['M 400 -700 L 110 -700 L 80 -390 C 130 -430 190 -450 250 -450 C 360 -450 420 -360 420 -230 C 420 -90 340 10 230 10 C 150 10 90 -30 50 -100']],
      6: [470, ['M 360 -690 C 330 -705 300 -710 270 -710 C 140 -710 60 -560 60 -330 C 60 -110 130 10 240 10 C 350 10 420 -80 420 -210 C 420 -340 350 -420 250 -420 C 160 -420 90 -360 60 -280']],
      7: [450, ['M 50 -700 L 420 -700 L 180 0']],
      8: [460, ['M 230 -390 C 130 -390 80 -450 80 -550 C 80 -650 140 -710 230 -710 C 320 -710 380 -650 380 -550 C 380 -450 330 -390 230 -390 C 120 -390 50 -320 50 -200 C 50 -70 130 10 230 10 C 330 10 410 -70 410 -200 C 410 -320 340 -390 230 -390 Z']],
      9: [460, ['M 400 -420 C 370 -340 310 -290 220 -290 C 120 -290 50 -370 50 -500 C 50 -630 130 -710 230 -710 C 340 -710 400 -620 400 -480 L 400 -250 C 400 -80 330 10 220 10 C 160 10 110 -10 80 -50']],
      '.': [150, ['M 70 -15 L 70 -5']],
      ',': [150, ['M 75 -20 L 45 90']],
      '!': [160, ['M 75 -700 L 75 -200', 'M 75 -15 L 75 -5']],
      '?': [430, ['M 60 -580 C 90 -670 150 -710 220 -710 C 320 -710 380 -650 380 -560 C 380 -470 320 -420 240 -380 C 210 -360 200 -330 200 -220', 'M 200 -15 L 200 -5']],
      "'": [140, ['M 70 -720 L 60 -560']],
      '’': [140, ['M 70 -720 L 60 -560']],
      '"': [230, ['M 70 -720 L 60 -560', 'M 160 -720 L 150 -560']],
      '-': [330, ['M 50 -260 L 280 -260']],
      ':': [150, ['M 70 -415 L 70 -405', 'M 70 -15 L 70 -5']],
      ';': [160, ['M 75 -415 L 75 -405', 'M 80 -20 L 50 90']],
      '/': [340, ['M 300 -740 L 40 160']],
      '(': [240, ['M 200 -740 C 110 -620 70 -480 70 -260 C 70 -40 110 100 200 220']],
      ')': [240, ['M 40 -740 C 130 -620 170 -480 170 -260 C 170 -40 130 100 40 220']],
      '+': [420, ['M 60 -260 L 360 -260', 'M 210 -410 L 210 -110']],
      '&': [500, ['M 450 0 L 160 -400 C 110 -470 100 -520 100 -570 C 100 -660 160 -710 230 -710 C 300 -710 350 -660 350 -590 C 350 -510 290 -460 180 -400 C 100 -350 50 -290 50 -200 C 50 -70 140 10 250 10 C 340 10 400 -40 450 -150']]
    };
    const handCache = new Map();
    let svgPath = null;
    function handGlyph(ch) {
      if (handCache.has(ch)) return handCache.get(ch);
      const g = HAND[ch];
      if (!g) return null;
      if (!svgPath) {
        const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        svgPath = document.createElementNS(NS, 'path');
        svg.appendChild(svgPath); document.body.appendChild(svg);
      }
      const strokes = g[1].map((d) => {
        svgPath.setAttribute('d', d);
        const L = svgPath.getTotalLength(), n = Math.max(2, Math.ceil(L / 6)), pts = [];
        for (let i = 0; i <= n; i++) { const p = svgPath.getPointAtLength(L * i / n); pts.push([p.x, p.y]); }
        return pts;
      });
      const out = { adv: g[0], strokes };
      handCache.set(ch, out);
      return out;
    }
    // Chinese stroke order: Hanzi Writer's open data (from Make Me a Hanzi, Arphic Public License).
    // Each character has a centre line ("median") per stroke, in writing order.
    const hanziCache = new Map();
    function hanziGlyph(ch) {
      if (!hanziCache.has(ch)) {
        hanziCache.set(ch, fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && d.medians ? { adv: 950, strokes: d.medians.map(smoothMedian) } : null)
          .catch(() => null));
      }
      return hanziCache.get(ch);
    }
    function smoothMedian(m) {
      // 1024 box with y up → our units; Catmull-Rom through the few given points
      const P = m.map(([x, y]) => [x * 0.928, 230 - (y + 124) * 0.928]), out = [];
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
        const seg = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 6));
        for (let s = 0; s < seg; s++) {
          const t = s / seg, t2 = t * t, t3 = t2 * t;
          out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
        }
      }
      out.push(P[P.length - 1]);
      return out;
    }
    const varaCache = new Map();
    function loadVara(file) {
      if (!varaCache.has(file)) varaCache.set(file, fetch(`https://cdn.jsdelivr.net/npm/vara@1.4.0/fonts/${file}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
      return varaCache.get(file);
    }
    function sampler() {
      if (!svgPath) {
        const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        svgPath = document.createElementNS(NS, 'path');
        svg.appendChild(svgPath); document.body.appendChild(svg);
      }
      return svgPath;
    }
    // one character of a Vara font → strokes in font units (y down, baseline 0), ink starting at x = 0
    function varaGlyph(data, ch, cacheKey) {
      const k = cacheKey + ch;
      if (handCache.has(k)) return handCache.get(k);
      const c = data.c[ch.codePointAt(0)];
      let out = null;
      if (c && c.paths && c.paths.length) {
        const el = sampler();
        const strokes = c.paths.map((pth) => {
          el.setAttribute('d', pth.d);
          const L = el.getTotalLength(), n = Math.max(1, Math.ceil(L / 0.3)), pts = [];
          for (let i = 0; i <= n; i++) { const q = el.getPointAtLength(L * i / n); pts.push([q.x + pth.mx, q.y - pth.my]); }
          return pts;
        });
        let x0 = Infinity, x1 = -Infinity;
        for (const st of strokes) for (const [x] of st) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
        out = { adv: x1 - x0, strokes: strokes.map((st) => st.map(([x, y]) => [x - x0, y])) };
      }
      handCache.set(k, out);
      return out;
    }
    async function layoutScript(text) {
      if (!text) return emptyGeo('script');
      const data = await loadVara(script.file);
      if (!data) return emptyGeo('script');
      const P = data.p, gap = P.space * script.gap;
      const glyphs = new Map();
      await Promise.all([...new Set(Array.from(text))].map(async (ch) => {
        if (CJK.test(ch)) {
          // Chinese has no script templates: borrow the real stroke order, scaled to fit
          const h = await hanziGlyph(ch), k = P.tf / 760;
          glyphs.set(ch, h && { adv: h.adv * k, strokes: h.strokes.map((st) => st.map(([x, y]) => [x * k, y * k])) });
        } else glyphs.set(ch, varaGlyph(data, ch, script.key));
      }));
      const adv = (ch) => (ch === ' ' ? P.space : glyphs.get(ch) ? glyphs.get(ch).adv + gap : P.space * 0.5);
      const advance = (str) => Array.from(str).reduce((w, ch) => w + adv(ch), 0) * 100 / P.lh;
      const lh = 118;
      const best = fitLines(text, advance, advance, lh, 0);
      const F = Math.max(10, best.fs), sc = F / P.lh, step = lh * F / 100;
      const strokes = [], lines = [];
      best.lines.forEach((line, i) => {
        const cy = DH / 2 + (i - (best.lines.length - 1) / 2) * step, mine = [];
        let pen = (DW - advance(line) * F / 100) / 2;
        for (const ch of Array.from(line)) {
          const g = glyphs.get(ch);
          if (g) for (const st of g.strokes) mine.push(st.map(([x, y]) => [pen + x * sc, y * sc]));
          pen += adv(ch) * sc;
        }
        // centre each line's ink on its slot
        let y0 = Infinity, y1 = -Infinity;
        for (const st of mine) for (const [, y] of st) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const dy = cy - (y0 + y1) / 2;
        for (const st of mine) strokes.push(st.map(([x, y]) => [x, y + dy]));
        lines.push({ cy });
      });
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, DW, DH);
      cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round';
      for (const st of strokes) { cx.beginPath(); st.forEach(([x, y], k) => (k ? cx.lineTo(x, y) : cx.moveTo(x, y))); cx.stroke(); }
      return { kind: 'script', mask: readMask(), fs: F, cjk: false, slant: 0, lines, T: 0.042 * F, strokes };
    }

    async function layoutHand(text) {
      if (!text) return emptyGeo('hand');
      const glyphs = new Map();
      await Promise.all([...new Set(Array.from(text))].map(async (ch) => glyphs.set(ch, CJK.test(ch) ? await hanziGlyph(ch) : handGlyph(ch))));
      const adv = (ch) => (ch === ' ' ? 260 : glyphs.get(ch) ? glyphs.get(ch).adv : 300);
      const advance = (s) => Array.from(s).reduce((w, ch) => w + adv(ch), 0) * 0.1;
      const cjk = CJK.test(text), slant = cjk ? 0 : 0.1, lh = 115;
      const best = fitLines(text, advance, advance, lh, slant);
      const fs = Math.max(10, best.fs), s = fs / 1000, step = lh * fs / 100;
      const strokes = [], lines = [];
      best.lines.forEach((line, i) => {
        const cy = DH / 2 + (i - (best.lines.length - 1) / 2) * step, base = cy + 245 * s;
        let pen = (DW - advance(line) * fs / 100) / 2;
        for (const ch of Array.from(line)) {
          const g = glyphs.get(ch);
          if (g) for (const st of g.strokes) strokes.push(st.map(([gx, gy]) => { const X = pen + gx * s, Y = base + gy * s; return [X - slant * (Y - DH / 2), Y]; }));
          pen += adv(ch) * s;
        }
        lines.push({ cy });
      });
      // the letters are the pen paths drawn thin; the shader grows them into tubes
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, DW, DH);
      cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round';
      for (const st of strokes) {
        cx.beginPath();
        st.forEach(([x, y], k) => (k ? cx.lineTo(x, y) : cx.moveTo(x, y)));
        cx.stroke();
      }
      return { kind: 'hand', mask: readMask(), fs, cjk, slant, lines, T: (cjk ? 0.03 : 0.05) * fs, strokes };
    }

    /* ---- signed distance field + how puffy the glass should be ---- */
    function buildField(g) {
      const inn = new Uint8Array(N);
      for (let i = 0; i < N; i++) inn[i] = g.mask[i] ? 0 : 1;
      const out = transform(g.mask, false).dist, ins = transform(inn, false).dist;
      const field = new Float32Array(N);
      let sum = 0, cnt = 0;
      for (let i = 0; i < N; i++) {
        field[i] = Math.max(-4000, Math.min(4000, out[i] - ins[i]));
        if (g.mask[i]) { sum += ins[i]; cnt++; }
      }
      // stroke half-width ≈ twice the mean depth inside the letters. Thin strokes are grown
      // into round tubes; thick ones keep their outline and are puffed up like a balloon.
      const hw = cnt ? 2 * sum / cnt : 0, T = g.T;
      g.rPx = hw < T ? T : Math.min(hw, T * 2.1);
      g.growPx = hw < T ? T - hw : 0;
      g.hw = hw; g.field = field; g.inside = ins;
      return g;
    }

    /* ---- A: letters inflate one after another ---- */
    function letterTimes(g) {
      const order = [];
      let k = 0;
      g.lines.forEach((ln) => ln.chars.forEach((ch) => order.push(/\s/.test(ch) ? -1 : k++)));
      const n = Math.max(1, k), stagger = clamp(1.8 / n, 0.045, 0.13), dur = 0.62;
      const starts = [];
      let base = 0;
      g.lines.forEach((ln) => { starts.push(base); base += ln.chars.length; });
      const seed = new Uint8Array(N), val = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (!g.mask[i]) continue;
        const y = (i / DW) | 0, x = i - y * DW;
        let li = 0, bd = Infinity;
        for (let j = 0; j < g.lines.length; j++) { const d = Math.abs(g.lines[j].cy - y); if (d < bd) { bd = d; li = j; } }
        const ln = g.lines[li], xu = x + g.slant * (y - DH / 2);
        let j = 0;
        while (j + 1 < ln.edges.length && ln.edges[j + 1] <= xu) j++;
        let idx = order[starts[li] + j];
        for (let back = j; idx < 0 && back > 0; back--) idx = order[starts[li] + back - 1];
        seed[i] = 1; val[i] = Math.max(0, idx) * stagger;
      }
      return { kind: 'pop', time: spread(seed, val), total: (n - 1) * stagger + dur + 0.1, dur, hwW: (g.hw * 1.6 + g.growPx) * PX + 0.004 };
    }

    /* ---- B: strokes worked out from the letter shapes ----
       Thin the letters to a one-pixel skeleton, cut it into branches at junctions, then order
       the branches the way a hand would: letter by letter, starting top-left at a free end,
       carrying straight on through junctions. */
    const OFF8 = (W) => [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];
    function thin(img, W, H) {
      const O = OFF8(W);
      let fg = [];
      for (let i = 0; i < W * H; i++) if (img[i]) fg.push(i);
      for (let changed = true; changed;) {
        changed = false;
        for (let pass = 0; pass < 2; pass++) {
          const del = [];
          for (const i of fg) {
            if (!img[i]) continue;
            const p = O.map((o) => img[i + o]);
            const B = p.reduce((a, b) => a + b, 0);
            if (B < 2 || B > 6) continue;
            let A = 0;
            for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
            if (A !== 1) continue;
            if (pass === 0 ? (p[0] && p[2] && p[4]) || (p[2] && p[4] && p[6]) : (p[0] && p[2] && p[6]) || (p[0] && p[4] && p[6])) continue;
            del.push(i);
          }
          for (const i of del) img[i] = 0;
          if (del.length) changed = true;
        }
        fg = fg.filter((i) => img[i]);
      }
      return fg;
    }
    function traceStrokes(g) {
      const W = DW >> 1, H = DH >> 1, img = new Uint8Array(W * H), O = OFF8(W);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = 2 * y * DW + 2 * x;
        img[y * W + x] = g.mask[i] + g.mask[i + 1] + g.mask[i + DW] + g.mask[i + DW + 1] >= 2 ? 1 : 0;
      }
      const sk = thin(img, W, H);
      const nb = (i) => O.map((o) => i + o).filter((j) => img[j]);
      const cn = new Int8Array(W * H);
      for (const i of sk) { let A = 0; for (let k = 0; k < 8; k++) if (!img[i + O[k]] && img[i + O[(k + 1) % 8]]) A++; cn[i] = A; }
      const isNode = (i) => cn[i] !== 2;
      // junction pixels that touch form one junction
      const cluster = new Int32Array(W * H).fill(-1);
      let nc = 0;
      for (const i of sk) {
        if (!isNode(i) || cluster[i] >= 0) continue;
        const q = [i]; cluster[i] = nc;
        while (q.length) { const c = q.pop(); for (const j of nb(c)) if (cn[j] >= 3 && cn[c] >= 3 && cluster[j] < 0) { cluster[j] = nc; q.push(j); } }
        nc++;
      }
      const visited = new Uint8Array(W * H), seen = new Set(), branches = [];
      const xy = (i) => [i % W, (i / W) | 0];
      const far = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return (ax - bx) ** 2 + (ay - by) ** 2; };
      for (const n of sk) {
        if (!isNode(n)) continue;
        if (!nb(n).length) { branches.push({ px: [n], dot: true }); continue; }
        for (const m of nb(n)) {
          if (isNode(m)) {
            if (cluster[m] === cluster[n]) continue;
            const key = Math.min(n, m) + ':' + Math.max(n, m);
            if (!seen.has(key)) { seen.add(key); branches.push({ px: [n, m] }); }
            continue;
          }
          if (visited[m]) continue;
          const px = [n];
          let prev = n, cur = m;
          for (;;) {
            px.push(cur);
            if (isNode(cur)) break;
            visited[cur] = 1;
            let next = -1, bd = -1;
            for (const j of nb(cur)) {
              if (j === prev || (visited[j] && !isNode(j)) || (isNode(j) && j === n && px.length < 4)) continue;
              const d = far(j, prev);
              if (d > bd) { bd = d; next = j; }
            }
            if (next < 0) break;
            prev = cur; cur = next;
          }
          if (px.length >= 4 || isNode(px[px.length - 1])) branches.push({ px });
        }
      }
      // closed loops with no junction (o, 0, D…): start at the top
      for (const i of sk) {
        if (visited[i] || isNode(i)) continue;
        const px = [i];
        visited[i] = 1;
        let prev = -1, cur = i;
        for (;;) {
          let next = -1, bd = -1;
          for (const j of nb(cur)) { if (visited[j]) continue; const d = prev < 0 ? 1 : far(j, prev); if (d > bd) { bd = d; next = j; } }
          if (next < 0) break;
          visited[next] = 1; px.push(next); prev = cur; cur = next;
        }
        if (px.length > 6) branches.push({ px, closed: true });
      }
      // to full resolution, lightly smoothed; drop short spurs left by thinning
      const spur = Math.max(4, g.hw * 0.9);
      const strokes = [];
      for (const b of branches) {
        const raw = b.px.map((i) => { const [x, y] = xy(i); return [x * 2 + 1, y * 2 + 1]; });
        const pts = raw.map((p, k) => {
          if (k === 0 || k === raw.length - 1) return p;
          const a = raw[Math.max(0, k - 2)], c = raw[Math.min(raw.length - 1, k + 2)];
          return [(a[0] + p[0] * 2 + c[0]) / 4, (a[1] + p[1] * 2 + c[1]) / 4];
        });
        if (b.closed) pts.push(pts[0].slice());
        const len = polyLen(pts);
        const endA = cluster[b.px[0]], endB = cluster[b.px[b.px.length - 1]];
        const freeA = cn[b.px[0]] <= 1, freeB = cn[b.px[b.px.length - 1]] <= 1;
        if (!b.dot && !b.closed && (freeA !== freeB) && len < spur * 2.4) continue;   // thinning leaves short whiskers at round corners
        strokes.push({ pts, len, ends: [endA, endB], free: [freeA, freeB], closed: !!b.closed, dot: !!b.dot });
      }
      return orderLikeAHand(g, strokes, nc);
    }

    // Turn skeleton branches into strokes the way a hand writes them:
    //  · letters are written one after another, left to right, line by line;
    //  · branches are cut at sharp corners, so E becomes a stem and three arms;
    //  · each stroke runs top-to-bottom / left-to-right; closed loops start at the top, anticlockwise;
    //  · inside a letter, the leftmost stroke goes first (higher first on ties), dots go last;
    //  · the pen carries straight on through junctions, and always through corners (L, V, Z, N).
    function orderLikeAHand(g, strokes, nextNode) {
      const xu = (x, y) => x + g.slant * (y - DH / 2);
      const pieces = [];
      const endInfo = (s, k) => (s.free[k] ? { node: -1, kind: 'free' } : s.ends[k] >= 0 ? { node: s.ends[k], kind: 'junction' } : { node: -1, kind: 'dead' });
      for (const s of strokes) {
        if (s.dot) { pieces.push({ pts: s.pts, a: { node: -1, kind: 'free' }, b: { node: -1, kind: 'free' }, dot: true }); continue; }
        const span = Math.max(6, g.hw * 0.7);
        let pts = s.pts, cuts = corners(pts, span);
        if (s.closed) {
          if (!cuts.length) { pieces.push({ pts, a: { node: -1, kind: 'free' }, b: { node: -1, kind: 'free' }, closed: true }); continue; }
          const ring = pts.slice(0, -1), k0 = cuts[0];
          pts = ring.slice(k0).concat(ring.slice(0, k0));
          pts.push(pts[0].slice());
          cuts = cuts.map((c) => (c - k0 + ring.length) % ring.length).filter((c) => c > 0).sort((x, y) => x - y);
          const ids = [nextNode++, ...cuts.map(() => nextNode++)];
          const bounds = [0, ...cuts, pts.length - 1];
          for (let i = 0; i < bounds.length - 1; i++) {
            pieces.push({ pts: pts.slice(bounds[i], bounds[i + 1] + 1), a: { node: ids[i], kind: 'corner' }, b: { node: i + 1 < ids.length ? ids[i + 1] : ids[0], kind: 'corner' } });
          }
          continue;
        }
        const bounds = [0, ...cuts, pts.length - 1];
        let prevEnd = endInfo(s, 0);
        for (let i = 0; i < bounds.length - 1; i++) {
          const last = i === bounds.length - 2;
          const end = last ? endInfo(s, 1) : { node: nextNode++, kind: 'corner' };
          pieces.push({ pts: pts.slice(bounds[i], bounds[i + 1] + 1), a: prevEnd, b: end });
          prevEnd = end;
        }
      }
      // Thinning can leave the pieces that meet at one spot a pixel or two apart (a walk that
      // stopped next to its junction, a corner cut beside one). Ends that close are one node.
      {
        const ends = [];
        for (const p of pieces) if (!p.dot && !p.closed) { ends.push({ e: p.a, pt: p.pts[0] }, { e: p.b, pt: p.pts[p.pts.length - 1] }); }
        const up = ends.map((_, i) => i), root = (i) => (up[i] === i ? i : (up[i] = root(up[i])));
        const near = Math.max(4, g.hw * 0.6), nearTip = Math.max(4, g.hw * 0.45);
        for (let i = 0; i < ends.length; i++) {
          for (let j = i + 1; j < ends.length; j++) {
            const fi = ends[i].e.kind === 'free', fj = ends[j].e.kind === 'free';
            if (fi && fj) continue;
            const same = ends[i].e.node >= 0 && ends[i].e.node === ends[j].e.node;
            // a real tip only joins a node right next to it (the point of a V)
            if (same || Math.hypot(ends[i].pt[0] - ends[j].pt[0], ends[i].pt[1] - ends[j].pt[1]) < (fi || fj ? nearTip : near)) up[root(i)] = root(j);
          }
        }
        const groups = new Map();
        ends.forEach((x, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); });
        for (const list of groups.values()) {
          if (list.length < 2) {
            const e = list[0].e;
            if (e.kind === 'free') continue;
            // a junction end that found no partner: it probably meets a stroke that walks
            // straight past it (a T). Cut that stroke there and share the node.
            let best = null;
            for (const q of pieces) {
              if (q.dot || q.closed || q.a === e || q.b === e) continue;
              for (let k = 2; k < q.pts.length - 2; k++) {
                const d = Math.hypot(q.pts[k][0] - list[0].pt[0], q.pts[k][1] - list[0].pt[1]);
                if (d < near && (!best || d < best.d)) best = { q, k, d };
              }
            }
            if (best) {
              const id = nextNode++, { q, k } = best;
              e.node = id; e.kind = 'junction';
              const tail = { pts: q.pts.slice(k), a: { node: id, kind: 'junction' }, b: q.b };
              q.pts = q.pts.slice(0, k + 1); q.b = { node: id, kind: 'junction' };
              pieces.push(tail);
            } else if (e.kind === 'dead') { e.kind = 'free'; e.node = -1; }
            continue;
          }
          const id = nextNode++, kind = list.some((x) => x.e.kind === 'junction' || x.e.kind === 'free') ? 'junction' : 'corner';
          for (const x of list) { x.e.node = id; x.e.kind = kind; }
        }
      }
      // crumbs left between junction pixels are not strokes
      for (let i = pieces.length - 1; i >= 0; i--) if (!pieces[i].dot && !pieces[i].closed && polyLen(pieces[i].pts) < Math.max(4, g.hw * 0.5)) pieces.splice(i, 1);
      // which letter each piece belongs to
      const lineOf = (y) => { let li = 0, bd = Infinity; g.lines.forEach((l, j) => { const d = Math.abs(l.cy - y); if (d < bd) { bd = d; li = j; } }); return li; };
      const before = [];
      let acc = 0;
      g.lines.forEach((l) => { before.push(acc); acc += l.chars ? l.chars.length : 0; });
      for (const p of pieces) {
        let sx = 0, sy = 0;
        for (const [x, y] of p.pts) { sx += x; sy += y; }
        p.cx = sx / p.pts.length; p.cy = sy / p.pts.length;
        const li = lineOf(p.cy), ln = g.lines[li], X = xu(p.cx, p.cy);
        let j = 0;
        if (ln && ln.edges) while (j + 1 < ln.edges.length && ln.edges[j + 1] <= X) j++;
        p.letter = (before[li] || 0) + j;
        // natural direction: start at the end that is further up-left
        if (p.closed) p.pts = loopFrom(p.pts, topStart(p.pts));
        else if (!p.dot) {
          const s0 = p.pts[0], s1 = p.pts[p.pts.length - 1];
          if (xu(s1[0], s1[1]) + s1[1] < xu(s0[0], s0[1]) + s0[1] - 1) flip(p);
        }
      }
      const degree = new Map();
      for (const p of pieces) for (const e of [p.a, p.b]) if (e.node >= 0) degree.set(e.node, (degree.get(e.node) || 0) + 1);
      const letters = new Map();
      for (const p of pieces) { if (!letters.has(p.letter)) letters.set(p.letter, []); letters.get(p.letter).push(p); }
      const ordered = [];
      for (const idx of [...letters.keys()].sort((a, b) => a - b)) {
        const rem = letters.get(idx);
        let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of rem) for (const [x, y] of p.pts) { x0 = Math.min(x0, xu(x, y)); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const h = Math.max(1, y1 - y0);
        // leftmost first, higher first; a stroke is rarely started from the middle of a junction
        const key = (p) => (p.dot ? 100 : 0) + (xu(p.cx, p.cy) - x0) / h + 0.8 * (p.pts[0][1] - y0) / h + (p.a.kind === 'junction' ? 0.25 : 0);
        let at = null, dir = null;
        while (rem.length) {
          let pick = null;
          if (at && (at.kind === 'corner' || degree.get(at.node) === 2)) {
            pick = rem.find((p) => p.a.node === at.node || p.b.node === at.node);
            if (pick && pick.a.node !== at.node) flip(pick);
          } else if (at && at.kind === 'junction' && dir) {
            // carry straight on (turning less than ~50°): into a stroke that starts here, or
            // backwards into one whose far end is a free tail (the hook of g, the tail of y)
            let best = 0.64, flipIt = false;
            for (const p of rem) {
              let d = null, rev = false;
              if (p.a.node === at.node) d = headDir(p.pts, Math.max(6, g.hw * 0.7));
              else if (p.b.node === at.node && p.a.kind === 'free') { d = headDir(p.pts.slice().reverse(), Math.max(6, g.hw * 0.7)); rev = true; }
              if (!d) continue;
              const cos = d[0] * dir[0] + d[1] * dir[1];
              if (cos > best) { best = cos; pick = p; flipIt = rev; }
            }
            if (pick && flipIt) flip(pick);
          }
          if (!pick) pick = rem.reduce((m, p) => (key(p) < key(m) ? p : m), rem[0]);
          rem.splice(rem.indexOf(pick), 1);
          ordered.push(pick.pts);
          at = pick.closed || pick.dot ? null : pick.b;
          dir = pick.dot ? null : tailDir(pick.pts, Math.max(6, g.hw * 0.7));
        }
      }
      return ordered;
    }
    const flip = (p) => { p.pts = p.pts.slice().reverse(); const t = p.a; p.a = p.b; p.b = t; };
    // direction of travel over the first / last `span` px of a polyline
    function headDir(pts, span) { let k = 1, L = 0; while (k < pts.length - 1 && L < span) { L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); k++; } return norm([pts[Math.min(k, pts.length - 1)][0] - pts[0][0], pts[Math.min(k, pts.length - 1)][1] - pts[0][1]]); }
    function tailDir(pts, span) { const r = pts.slice().reverse(), d = headDir(r, span); return [-d[0], -d[1]]; }
    // indices where a polyline turns sharply (more than ~55°), measured over `span` px
    function corners(pts, span) {
      const n = pts.length, cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[n - 1], ang = new Float32Array(n);
      let lo = 0, hi = 0;
      for (let i = 0; i < n; i++) {
        if (cum[i] < span || total - cum[i] < span) continue;
        while (cum[lo] < cum[i] - span) lo++;
        while (hi < n - 1 && cum[hi] < cum[i] + span) hi++;
        const a = norm([pts[i][0] - pts[lo][0], pts[i][1] - pts[lo][1]]), b = norm([pts[hi][0] - pts[i][0], pts[hi][1] - pts[i][1]]);
        ang[i] = Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1));
      }
      const out = [];
      for (let i = 0; i < n; i++) {
        if (ang[i] < 0.96) continue;
        let j = i;
        while (j + 1 < n && ang[j + 1] >= 0.96) j++;
        let m = i;
        for (let k = i; k <= j; k++) if (ang[k] > ang[m]) m = k;
        out.push(m);
        i = j;
      }
      return out;
    }
    const polyLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
    const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const topStart = (pts) => { let k = 0; for (let i = 1; i < pts.length - 1; i++) if (pts[i][1] < pts[k][1]) k = i; return k; };
    // start a closed loop at index k and run it anticlockwise on screen (top, then left)
    function loopFrom(pts, k) {
      const ring = pts.slice(0, -1), n = ring.length;
      let out = ring.slice(k).concat(ring.slice(0, k));
      if (out[Math.min(4, n - 1)][0] > out[0][0]) out = [out[0]].concat(out.slice(1).reverse());
      out.push(out[0].slice());
      return out;
    }

    /* ---- B and C: walk the pen along the strokes ---- */
    function penTimes(g, strokes) {
      strokes = strokes.filter((s) => s.length);
      const L = strokes.reduce((a, s) => a + polyLen(s), 0);
      if (!L && !strokes.length) return null;
      const v = Math.max(1, L) / clamp(L / 950, 1.1, 7.5);    // px per second
      const seed = new Uint8Array(N), val = new Float32Array(N).fill(1e6), track = [];
      const hwAt = (x, y) => { const xi = clamp(Math.round(x), 0, DW - 1), yi = clamp(Math.round(y), 0, DH - 1); return g.inside[yi * DW + xi] + g.growPx; };
      // a spot counts as written the first time the pen's footprint passes over it, so junctions
      // fill in with the first stroke that reaches them instead of waiting for a later one
      const stamp = (x, y, time) => {
        const r = Math.max(hwAt(x, y), 1.5) + 1.5, r2 = r * r;
        const xa = Math.max(0, Math.floor(x - r)), xb = Math.min(DW - 1, Math.ceil(x + r));
        const ya = Math.max(0, Math.floor(y - r)), yb = Math.min(DH - 1, Math.ceil(y + r));
        for (let yy = ya; yy <= yb; yy++) {
          const dy = yy - y, row = yy * DW;
          for (let xx = xa; xx <= xb; xx++) {
            const dx = xx - x;
            if (dx * dx + dy * dy > r2) continue;
            const i = row + xx;
            if (!seed[i] || val[i] > time) { seed[i] = 1; val[i] = time; }
          }
        }
        return r;
      };
      let t = 0.12, last = null;
      for (const s of strokes) {
        if (last) { const gap = Math.hypot(s[0][0] - last[0], s[0][1] - last[1]); if (gap > 6) t += 0.08 + gap / (v * 3); }
        const pts = [], t0 = t;
        let r = stamp(s[0][0], s[0][1], t);
        pts.push([s[0][0], s[0][1], t]);
        for (let k = 1; k < s.length; k++) {
          const [ax, ay] = s[k - 1], [bx, by] = s[k], d = Math.hypot(bx - ax, by - ay);
          const n = Math.max(1, Math.ceil(d / Math.max(1, r * 0.3)));
          for (let j = 1; j <= n; j++) r = stamp(ax + (bx - ax) * j / n, ay + (by - ay) * j / n, t + d * j / n / v);
          t += d / v;
          pts.push([bx, by, t]);
        }
        if (s.length === 1) t += 0.06;
        track.push({ t0, t1: t, pts });
        last = s[s.length - 1];
      }
      const total = t + 0.15;
      const time = spread(seed, val);
      // where the pen tip is at time `now` (null while it is lifted)
      const tipAt = (now) => {
        let lo = 0, hi = track.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (track[mid].t0 <= now) lo = mid; else hi = mid - 1; }
        const tr = track[lo];
        if (!tr || now < tr.t0 || now > tr.t1 + 0.02) return null;
        const P = tr.pts;
        let a = 0, b = P.length - 1;
        while (a < b - 1) { const m = (a + b) >> 1; if (P[m][2] <= now) a = m; else b = m; }
        const u = P[b][2] > P[a][2] ? clamp((now - P[a][2]) / (P[b][2] - P[a][2]), 0, 1) : 1;
        const x = P[a][0] + (P[b][0] - P[a][0]) * u, y = P[a][1] + (P[b][1] - P[a][1]) * u;
        return [-BOX_W / 2 + x / DW * BOX_W, -BOX_H / 2 + (1 - y / DH) * BOX_H, Math.max(hwAt(x, y), g.rPx * 0.6) * PX, 1];
      };
      return { kind: 'pen', time, total, tipAt };
    }

    /* ---- GPU ---- */
    const SCENE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uVel; uniform sampler2D uDist; uniform sampler2D uWhen;
uniform vec4 uBox; uniform float uPx; uniform float uR; uniform float uGrow;
uniform mat3 uRot; uniform vec3 uLight;
uniform int uMode; uniform float uProg; uniform float uDur; uniform float uHw; uniform vec4 uTip;
${NOISE}
${BEAMS}
vec3 pushed(vec2 uv) {
  vec2 off = texture(uVel, uv).xy * 0.00025;
  float m = length(off); if (m > 0.07) off *= 0.07 / m;
  vec2 ca = off * 0.4;
  return vec3(beams(uv - off + ca).r, beams(uv - off).g, beams(uv - off - ca).b);
}
float d2(vec2 xy) {
  vec2 t = (xy - uBox.xy) / uBox.zw, c = clamp(t, 0.0, 1.0);
  return texture(uDist, vec2(c.x, 1.0 - c.y)).r * uPx + length((t - c) * uBox.zw);
}
// when the pen (or the letter's turn) reaches this spot, in seconds
float when(vec2 xy) {
  vec2 t = clamp((xy - uBox.xy) / uBox.zw, 0.0, 1.0);
  return texture(uWhen, vec2(t.x, 1.0 - t.y)).r;
}
float backOut(float x) { float c1 = 1.70158, c3 = c1 + 1.0; return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0); }
// the whole word; while letters pop in, each one is scaled by its own progress
float mapFull(vec3 p) {
  p = uRot * p;
  float k = 1.0;
  if (uMode == 1) { float s = clamp((uProg - when(p.xy)) / uDur, 0.0, 1.0); k = s <= 0.0 ? 0.0 : backOut(s); }
  float dd = d2(p.xy) - uGrow * k + uR * k + (1.0 - k) * uHw;
  return length(vec2(max(dd, 0.0), p.z)) - uR * k + max(1.0 - k, 0.0) * 0.02;   // fully gone before its turn
}
// the rounded nib at the end of the stroke being written
float mapCap(vec3 p) {
  if (uTip.w < 0.5) return 1e3;
  p = uRot * p;
  vec2 q = (p.xy - uTip.xy) * (uR / uTip.z);
  return (length(vec3(q, p.z)) - uR) * min(uTip.z / uR, 1.0);
}
bool written(vec3 p) { if (uMode != 2) return true; p = uRot * p; return when(p.xy) <= uProg; }
vec3 nrmFull(vec3 p) {
  vec2 e = vec2(0.0025, 0.0);
  return normalize(vec3(mapFull(p + e.xyy) - mapFull(p - e.xyy), mapFull(p + e.yxy) - mapFull(p - e.yxy), mapFull(p + e.yyx) - mapFull(p - e.yyx)));
}
vec3 nrmCap(vec3 p) {
  vec2 e = vec2(0.0025, 0.0);
  return normalize(vec3(mapCap(p + e.xyy) - mapCap(p - e.xyy), mapCap(p + e.yxy) - mapCap(p - e.yxy), mapCap(p + e.yyx) - mapCap(p - e.yyx)));
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = pushed(vUv);
  vec3 ro = vec3(0.0, 0.0, 3.2), rd = normalize(vec3(p * 0.62, -1.0));
  float t = 2.5, dmin = 1e9, tmin = 2.5;
  bool hit = false, onCap = false;
  for (int i = 0; i < 128; i++) {
    vec3 pos = ro + rd * t;
    float d = mapFull(pos), dc = mapCap(pos);
    bool vis = written(pos);
    float dv = vis ? d : 1e3, dh = min(dv, dc);
    if (dh < dmin) { dmin = dh; tmin = t; onCap = dc < dv; }
    if (dh < 0.0006) { hit = true; break; }
    // not written yet: keep going (slowly while inside the unwritten glass)
    float stepLen = vis ? d : max(d, 0.006);
    t += min(stepLen, dc) * 0.85;
    if (t > 4.0) break;
  }
  float pxw = 3.2 * 0.62 / uRes.y;
  float a = hit ? 1.0 : 1.0 - smoothstep(0.0, pxw * 1.5, dmin);
  if (a > 0.0) {
    vec3 pos = ro + rd * tmin, n = onCap ? nrmCap(pos) : nrmFull(pos), v = -rd;
    float ndv = clamp(dot(n, v), 0.0, 1.0), fres = pow(1.0 - ndv, 3.0);
    vec3 op = uRot * pos;
    vec3 tint = mix(vec3(0.97, 0.47, 0.36), vec3(1.0, 0.76, 0.42), smoothstep(-0.38, 0.32, op.y));
    // light through the glass: the sky behind, bent by the surface and split into colour
    vec2 ruv = vUv + n.xy * (0.045 + 0.05 * (1.0 - ndv)), e = n.xy * 0.008;
    vec3 trans = vec3(beams(ruv + e).r, beams(ruv).g, beams(ruv - e).b);
    vec3 body = mix(trans, tint, 0.46) * (0.82 + 0.28 * n.y);
    body += tint * pow(1.0 - ndv, 2.0) * 0.3;
    vec3 rf = reflect(-v, n);
    body = mix(body, mix(vec3(0.74, 0.84, 0.93), vec3(1.0, 0.98, 0.94), smoothstep(-0.2, 0.8, rf.y)), fres * 0.6);
    float s1 = pow(max(dot(reflect(-normalize(uLight), n), v), 0.0), 120.0) * 3.4;
    float s2 = pow(max(dot(reflect(-normalize(vec3(0.7, -0.5, 0.6)), n), v), 0.0), 30.0) * 0.35;
    float sparkle = step(0.994, hash(floor(op.xy * 420.0) + floor(uTime * 3.0))) * pow(ndv, 4.0) * 0.9;
    // the nib glows while it writes
    float nib = onCap ? 0.35 + 2.6 * pow(ndv, 6.0) : 0.0;
    col = mix(col, body + vec3(1.0, 0.98, 0.94) * (s1 + s2 + sparkle + nib), a);
  }
  o = vec4(col, 1.0);
}`;
    // bright spots grow star rays and a little bloom, like a camera lens
    const POST = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uHdr; uniform vec2 uTexel;
vec3 bright(vec2 uv) { vec3 c = textureLod(uHdr, uv, 0.0).rgb; return c * smoothstep(2.0, 3.6, max(c.r, max(c.g, c.b))); }
vec3 softclip(vec3 c) { return mix(c, 1.0 - 0.15 * exp(-(c - 0.85) / 0.15), step(0.85, c)); }
void main() {
  vec3 c = textureLod(uHdr, vUv, 0.0).rgb, star = vec3(0.0);
  for (int i = 1; i <= 16; i++) {
    float fi = float(i), w = exp(-fi * 0.2);
    vec2 d = uTexel * fi * 2.4;
    star += (bright(vUv + vec2(d.x, 0.0)) + bright(vUv - vec2(d.x, 0.0)) + bright(vUv + vec2(0.0, d.y)) + bright(vUv - vec2(0.0, d.y))) * w;
    if (i <= 8) star += (bright(vUv + d * 0.7) + bright(vUv - d * 0.7) + bright(vUv + vec2(d.x, -d.y) * 0.7) + bright(vUv - vec2(d.x, -d.y) * 0.7)) * w * 0.35;
  }
  vec3 bloom = max(textureLod(uHdr, vUv, 2.0).rgb - 0.98, 0.0) * 1.4 + max(textureLod(uHdr, vUv, 4.0).rgb - 0.96, 0.0) * 1.2;
  o = vec4(softclip(c + star * 0.16 + bloom), 1.0);
}`;
    let fluid, PS, PP;
    try {
      fit(canvas, 1.25);
      fluid = createFluid(kit, canvas, { dye: false, simRes: 96, velDiss: 0.9, radius: 0.003 });
      PS = prog(VS, SCENE); PP = prog(VS, POST);
    } catch (e) { console.warn(e); return fail(stage); }

    function floatTexture(filter) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    const distTex = floatTexture(gl.LINEAR), whenTex = floatTexture(gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, distTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, DW, DH, 0, gl.RED, gl.FLOAT, new Float32Array(N).fill(4000));
    gl.bindTexture(gl.TEXTURE_2D, whenTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, DW, DH, 0, gl.RED, gl.FLOAT, new Float32Array(N));

    /* ---- building and playing ---- */
    const card = stage.closest('.fx');
    const input = card.querySelector('.glass-input input');
    const note = card.querySelector('.glass-note');
    const playBtn = card.querySelector('.play-btn');
    let buildId = 0;
    async function rebuild() {
      const text = input.value.trim(), id = ++buildId;
      anim = null;
      let g;
      if (mode.key === 'order') g = await layoutHand(text);
      else if (mode.key === 'script') g = await layoutScript(text);
      else {
        if (text) { try { await document.fonts.load(fontFor(CJK.test(text)), text); } catch (e) {} }
        if (id !== buildId) return false;
        g = layoutFont(text);
      }
      if (id !== buildId) return false;   // a newer edit won
      buildField(g);
      gl.bindTexture(gl.TEXTURE_2D, distTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, DW, DH, 0, gl.RED, gl.FLOAT, g.field);
      R = g.rPx * PX; GROW = g.growPx * PX;
      g.anims = {};
      g.font = g.kind === 'script' ? script.key : font.key;
      geo = g;
      return true;
    }
    let ready = rebuild();
    async function play() {
      await ready;
      const want = mode.key === 'order' ? 'hand' : mode.key === 'script' ? 'script' : 'font';
      if (geo && geo.kind === want && want === 'script' && geo.font !== script.key) { ready = rebuild(); if (!(await ready)) return; }
      if (!geo || geo.kind !== want) { ready = rebuild(); if (!(await ready)) return; }
      const g = geo;
      if (!(mode.key in g.anims)) {
        g.anims[mode.key] = mode.key === 'pop' ? letterTimes(g) : penTimes(g, mode.key === 'trace' ? traceStrokes(g) : g.strokes);
      }
      const a = g.anims[mode.key];
      if (!a || g !== geo) return;
      gl.bindTexture(gl.TEXTURE_2D, whenTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, DW, DH, 0, gl.RED, gl.FLOAT, a.time);
      anim = { a, start: performance.now() / 1000 };
    }

    /* ---- controls: two dropdowns and a play button ---- */
    function dropdown(root, label, items, value, onChange) {
      const id = root.dataset.dd;
      root.innerHTML = `<button class="dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="label">${label}</span><span class="dd-val"></span><svg class="dd-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
        + `<ul class="dd-list" role="listbox" tabindex="-1" aria-label="${label}" hidden></ul>`;
      const btn = root.querySelector('.dd-btn'), list = root.querySelector('.dd-list'), val = root.querySelector('.dd-val');
      let opts = [], cur = 0, active = 0, override = '';
      const fill = (next, v) => {
        items = next;
        list.innerHTML = items.map((it) => `<li role="option" id="${id}-${it.key}" data-k="${it.key}"><b style="${it.style || ''}">${it.name}</b><small>${it.note}</small></li>`).join('');
        opts = [...list.children];
        cur = active = Math.max(0, items.findIndex((it) => it.key === v));
      };
      fill(items, value);
      const render = () => {
        const it = items[cur];
        val.innerHTML = override ? `<b>${override}</b>` : `<b style="${it.style || ''}">${it.name}</b>`;
        opts.forEach((o, i) => { o.setAttribute('aria-selected', String(i === cur)); o.classList.toggle('is-active', i === active); });
        list.setAttribute('aria-activedescendant', opts[active].id);
      };
      const open = () => { if (btn.disabled) return; active = cur; render(); list.hidden = false; btn.setAttribute('aria-expanded', 'true'); list.focus(); opts[active].scrollIntoView({ block: 'nearest' }); };
      const close = (focus) => { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focus) btn.focus(); };
      const choose = (i) => { const changed = i !== cur; cur = i; render(); close(true); if (changed) onChange(items[i].key); };
      btn.addEventListener('click', () => (list.hidden ? open() : close(false)));
      btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } });
      list.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') active = Math.min(items.length - 1, active + 1);
        else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
        else if (e.key === 'Home') active = 0;
        else if (e.key === 'End') active = items.length - 1;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); return; }
        else if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
        else if (e.key === 'Tab') { close(false); return; }
        else return;
        e.preventDefault(); render(); opts[active].scrollIntoView({ block: 'nearest' });
      });
      list.addEventListener('click', (e) => { const o = e.target.closest('[role="option"]'); if (o) choose(opts.indexOf(o)); });
      list.addEventListener('pointermove', (e) => { const o = e.target.closest('[role="option"]'); if (o && opts.indexOf(o) !== active) { active = opts.indexOf(o); render(); } });
      document.addEventListener('pointerdown', (e) => { if (!list.hidden && !root.contains(e.target)) close(false); });
      render();
      return {
        setDisabled(d, text) { btn.disabled = d; override = d ? text : ''; if (d) close(false); render(); },
        setItems(next, v) { close(false); fill(next, v); btn.disabled = false; override = ''; render(); }
      };
    }
    const fontItems = FONTS.map((f) => ({ key: f.key, name: f.name, note: f.note, style: `font-family:'${f.css}';font-weight:${f.weight}` }));
    const scriptItems = SCRIPTS.map((f) => ({ key: f.key, name: f.name, note: f.note, style: `font-family:'${f.css}';font-weight:400` }));
    const NOTES = {
      order: 'C writes with a single-line hand drawn for this page; Chinese stroke order comes from Hanzi Writer’s open data (Make Me a Hanzi, Arphic Public License).',
      script: 'D uses the stroke templates from Vara.js (MIT) for four open-source script fonts (Pacifico, Parisienne and Shadows Into Light under OFL, Satisfy under Apache 2.0). Latin letters only; Chinese borrows real stroke order.'
    };
    const kindOf = (m) => (m === 'order' ? 'hand' : m === 'script' ? 'script' : 'font');
    const fontDD = dropdown(card.querySelector('[data-dd="font"]'), 'Font', fontItems, font.key, (k) => {
      if (mode.key === 'script') { script = SCRIPTS.find((f) => f.key === k); ready = rebuild(); play(); }
      else { font = FONTS.find((f) => f.key === k); ready = rebuild(); }
    });
    dropdown(card.querySelector('[data-dd="mode"]'), 'Write-on', MODES, mode.key, (k) => {
      const was = kindOf(mode.key);
      mode = MODES.find((m) => m.key === k);
      const now = kindOf(mode.key);
      if (now === 'hand') fontDD.setDisabled(true, 'Single-line hand');
      else if (now === 'script') fontDD.setItems(scriptItems, script.key);
      else fontDD.setItems(fontItems, font.key);
      note.textContent = NOTES[mode.key] || '';
      note.hidden = !NOTES[mode.key];
      if (was !== now) ready = rebuild();
      play();
    });
    playBtn.addEventListener('click', () => play());
    let typing = 0;
    input.addEventListener('input', () => { clearTimeout(typing); anim = null; typing = setTimeout(() => { ready = rebuild(); }, 180); });

    let hdr = null;
    const allocHdr = () => { if (hdr) hdr.free(); hdr = makeTarget(gl, canvas.width, canvas.height, gl.RGBA16F, gl.RGBA, true); };
    allocHdr();

    const st = stirrer(stage);
    const tilt = { x: 0, y: 0 };
    const rot = new Float32Array(9);
    function setRot(ax, ay, az) {
      const cxr = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
      // Rz * Rx * Ry, column-major
      rot.set([
        cy * cz - sx * sy * sz, cy * sz + sx * sy * cz, -cxr * sy,
        -cxr * sz, cxr * cz, sx,
        sy * cz + sx * cy * sz, sy * sz - sx * cy * cz, cxr * cy
      ]);
    }
    const PAL = { top: [0.71, 0.83, 0.93], bot: [0.82, 0.9, 0.95], beam: [1.0, 0.97, 0.88] };
    let shown = false;
    register(stage, {
      onShow() { if (!shown) { shown = true; play(); } },
      resize() { if (fit(canvas, 1.25).changed) { fluid.alloc(); allocHdr(); } },
      tick(dt, time) {
        st.each((x, y, dx, dy) => fluid.splat(x, y, dx * fluid.aspect * 5200, dy * 5200, null));
        fluid.step(dt);
        const active = performance.now() - st.ptr.lastMove < 2500;
        const tx = active ? (st.ptr.x - 0.5) : Math.sin(time * 0.4) * 0.25;
        const ty = active ? (st.ptr.y - 0.5) : Math.sin(time * 0.53) * 0.2;
        const k = 1 - Math.exp(-dt * 4);
        tilt.x += (tx - tilt.x) * k; tilt.y += (ty - tilt.y) * k;
        setRot(tilt.y * 0.5 + Math.sin(time * 0.7) * 0.03, -tilt.x * 0.7, Math.sin(time * 0.5) * 0.02);

        let modeU = 0, progU = 0, durU = 0.6, hwU = 0, tip = null;
        if (anim) {
          const el = performance.now() / 1000 - anim.start, a = anim.a;
          if (el > a.total) anim = null;
          else if (a.kind === 'pop') { modeU = 1; progU = el; durU = a.dur; hwU = a.hwW; }
          else { modeU = 2; progU = el; tip = a.tipAt(el); }
        }
        playBtn.classList.toggle('is-playing', !!anim);

        let u = (gl.useProgram(PS.p), PS.u);
        gl.uniform2f(u.uRes, hdr.w, hdr.h);
        gl.uniform1f(u.uTime, time);
        gl.uniform3fv(u.uSkyTop, PAL.top); gl.uniform3fv(u.uSkyBot, PAL.bot); gl.uniform3fv(u.uBeam, PAL.beam);
        gl.uniform1i(u.uVel, bindTex(gl, 0, fluid.vel));
        gl.uniform1i(u.uDist, bindTex(gl, 1, distTex));
        gl.uniform1i(u.uWhen, bindTex(gl, 2, whenTex));
        gl.uniform4f(u.uBox, -BOX_W / 2, -BOX_H / 2, BOX_W, BOX_H);
        gl.uniform1f(u.uPx, PX);
        gl.uniform1f(u.uR, R);
        gl.uniform1f(u.uGrow, GROW);
        gl.uniform1i(u.uMode, modeU);
        gl.uniform1f(u.uProg, progU);
        gl.uniform1f(u.uDur, durU);
        gl.uniform1f(u.uHw, hwU);
        gl.uniform4f(u.uTip, tip ? tip[0] : 0, tip ? tip[1] : 0, tip ? tip[2] : 1, tip ? 1 : 0);
        gl.uniformMatrix3fv(u.uRot, false, rot);
        gl.uniform3f(u.uLight, -0.45 + tilt.x * 1.2, 0.75 - tilt.y * 0.8, 0.55);
        blitTo(kit, canvas, hdr);
        bindTex(gl, 0, hdr.t); gl.generateMipmap(gl.TEXTURE_2D);
        u = (gl.useProgram(PP.p), PP.u);
        gl.uniform1i(u.uHdr, 0);
        gl.uniform2f(u.uTexel, 1 / hdr.w, 1 / hdr.h);
        blitTo(kit, canvas, null);
      }
    });
  })();

  /* ---------- 02 light push: the fluid bends light beams instead of drawing smoke ---------- */
  (function () {
    const stage = document.getElementById('fx-beams'), canvas = stage.querySelector('canvas');
    const kit = glKit(canvas);
    if (!kit) return fail(stage);
    const { gl, prog } = kit;
    if (!gl.getExtension('EXT_color_buffer_float')) return fail(stage, 'This effect needs floating-point rendering');
    let fluid, P;
    try {
      fit(canvas, 1.5);
      fluid = createFluid(kit, canvas, { dye: true, simRes: 112, dyeRes: 384, velDiss: 0.7, dyeDiss: 1.6, curl: 18, radius: 0.0035 });
      P = prog(VS, `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uVel; uniform sampler2D uDye;
${NOISE}
${BEAMS}
void main() {
  vec2 off = texture(uVel, vUv).xy * 0.0009;
  float m = length(off); if (m > 0.16) off *= 0.16 / m;
  vec2 ca = off * 0.6;
  vec3 col = vec3(beams(vUv - off + ca).r, beams(vUv - off).g, beams(vUv - off - ca).b);
  vec3 d = texture(uDye, vUv).rgb;
  vec3 g = textureLod(uDye, vUv, 3.0).rgb * 0.8 + textureLod(uDye, vUv, 5.0).rgb * 0.7;
  vec3 light = (1.0 - exp(-(d * 0.9 + g * 1.4) * 1.6)) * vec3(1.0, 0.96, 0.88);
  col = 1.0 - (1.0 - col) * (1.0 - light);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`);
    } catch (e) { console.warn(e); return fail(stage); }
    const st = stirrer(stage);
    const PAL = { top: [0.86, 0.58, 0.5], bot: [0.95, 0.77, 0.66], beam: [1.0, 0.96, 0.84] };
    let idle = 0;
    register(stage, {
      resize() { if (fit(canvas, 1.5).changed) fluid.alloc(); },
      tick(dt, time) {
        st.each((x, y, dx, dy) => fluid.splat(x, y, dx * fluid.aspect * 6000, dy * 6000, [0.14, 0.13, 0.11]));
        if (performance.now() - st.ptr.lastMove > 1800 && !reduced) {
          idle += dt;
          const x = 0.5 + 0.32 * Math.sin(idle * 0.8), y = 0.5 + 0.22 * Math.sin(idle * 1.6);
          fluid.splat(x, y, 0.32 * Math.cos(idle * 0.8) * fluid.aspect * 120, 0.44 * Math.cos(idle * 1.6) * 120, [0.03, 0.028, 0.025]);
        }
        fluid.step(dt);
        gl.useProgram(P.p);
        gl.uniform2f(P.u.uRes, canvas.width, canvas.height);
        gl.uniform1f(P.u.uTime, time);
        gl.uniform3fv(P.u.uSkyTop, PAL.top); gl.uniform3fv(P.u.uSkyBot, PAL.bot); gl.uniform3fv(P.u.uBeam, PAL.beam);
        gl.uniform1i(P.u.uVel, bindTex(gl, 0, fluid.vel));
        gl.uniform1i(P.u.uDye, bindTex(gl, 1, fluid.dye));
        blitTo(kit, canvas, null);
      }
    });
  })();

  /* ---------- 04 coloured smoke ---------- */
  (function () {
    const stage = document.getElementById('fx-smoke'), canvas = stage.querySelector('canvas');
    const kit = glKit(canvas);
    if (!kit) return fail(stage);
    const { gl, prog, canvasTexture, upload } = kit;
    if (!gl.getExtension('EXT_color_buffer_float')) return fail(stage, 'This effect needs floating-point rendering');
    let fluid, P;
    try {
      fit(canvas, 1.5);
      fluid = createFluid(kit, canvas, { dye: true });
      P = prog(VS, `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uDye; uniform sampler2D uVel; uniform sampler2D uBg;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 off = texture(uVel, vUv).xy * 0.00025;
  float m = length(off); if (m > 0.08) off *= 0.08 / m;
  vec2 ca = off * 0.35;
  vec3 bg = vec3(texture(uBg, vUv - off + ca).r, texture(uBg, vUv - off).g, texture(uBg, vUv - off - ca).b);
  vec3 c = texture(uDye, vUv).rgb;
  vec3 g = textureLod(uDye, vUv, 2.5).rgb * 0.6 + textureLod(uDye, vUv, 4.5).rgb * 0.7;
  o = vec4(bg + (1.0 - exp(-(c * 1.1 + g) * 1.4)) + (h(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`);
    } catch (e) { console.warn(e); return fail(stage); }
    const bgTex = canvasTexture(), bg = document.createElement('canvas');
    function paintBg() {
      const W = canvas.width, Hh = canvas.height, s = Hh / 500;
      bg.width = W; bg.height = Hh;
      const c = bg.getContext('2d');
      c.fillStyle = '#0a0c0f'; c.fillRect(0, 0, W, Hh);
      c.strokeStyle = 'rgba(255,255,255,0.055)'; c.lineWidth = 1;
      for (let x = 0; x < W; x += 36 * s) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, Hh); c.stroke(); }
      for (let y = 0; y < Hh; y += 36 * s) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }
      c.fillStyle = '#e9ecef'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `600 ${190 * s}px "Instrument Sans", sans-serif`;
      try { c.letterSpacing = `${-12 * s}px`; } catch (e) {}
      c.fillText('flow.', W / 2, Hh * 0.5);
      try { c.letterSpacing = '0px'; } catch (e) {}
      c.font = `400 ${12 * s}px "Geist Mono", monospace`; c.fillStyle = 'rgba(233,236,239,0.5)';
      c.textAlign = 'left'; c.fillText('FLUID / STABLE FLUIDS', 20 * s, 26 * s);
      c.textAlign = 'right'; c.fillText('128 × SIM', W - 20 * s, 26 * s);
      upload(bgTex, bg);
    }
    paintBg();
    const PALETTE = [[1, 0.55, 0.15], [0.15, 0.85, 0.8], [1, 0.3, 0.6], [0.55, 0.45, 1], [0.75, 1, 0.3]];
    const colorAt = (t, k = 0.16) => {
      const f = (t * 0.25) % PALETTE.length, i = Math.floor(f), w = f - i;
      const a = PALETTE[i], b = PALETTE[(i + 1) % PALETTE.length];
      return [0, 1, 2].map((j) => (a[j] + (b[j] - a[j]) * w) * k);
    };
    const st = stirrer(stage);
    let idle = 0;
    register(stage, {
      resize() { if (fit(canvas, 1.5).changed) { fluid.alloc(); paintBg(); } },
      redraw: paintBg,
      tick(dt, t) {
        st.each((x, y, dx, dy) => fluid.splat(x, y, dx * fluid.aspect * 6000, dy * 6000, colorAt(t)));
        if (performance.now() - st.ptr.lastMove > 1800 && !reduced) {
          idle += dt;
          const x = 0.5 + 0.3 * Math.sin(idle * 0.9), y = 0.5 + 0.22 * Math.sin(idle * 1.8);
          fluid.splat(x, y, 0.27 * Math.cos(idle * 0.9) * fluid.aspect * 140, 0.4 * Math.cos(idle * 1.8) * 140, colorAt(t, 0.08));
        }
        fluid.step(dt);
        gl.useProgram(P.p);
        gl.uniform1i(P.u.uDye, bindTex(gl, 0, fluid.dye));
        gl.uniform1i(P.u.uVel, bindTex(gl, 1, fluid.vel));
        gl.uniform1i(P.u.uBg, bindTex(gl, 2, bgTex));
        blitTo(kit, canvas, null);
      }
    });
  })();

  /* ---------- 03 text scramble ---------- */
  (function () {
    const stage = document.getElementById('fx-scramble');
    const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/\\|';
    const COLORS = ['#ffb347', '#3fd1c7', '#ff6aa2', '#c6f36b', '#9b8cff'];
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const runs = [...stage.querySelectorAll('.sl')].map((el) => ({ el, text: el.dataset.text, t0: -1, done: false, glyphs: [], glyphAt: 0 }));
    runs.forEach((r) => { r.el.innerHTML = `<span class="h">${esc(r.text)}</span>`; });
    const STEP = 42, WIN = 6;
    const start = (r, delay) => { r.t0 = performance.now() + delay; r.done = false; };
    const playAll = () => runs.forEach((r, i) => start(r, i * 220));
    let played = false;
    stage.addEventListener('click', playAll);
    runs.forEach((r) => r.el.addEventListener('pointerenter', () => { if (r.done) start(r, 0); }));
    register(stage, {
      onShow() { if (!played) { played = true; playAll(); } },
      tick() {
        const now = performance.now();
        for (const r of runs) {
          if (r.t0 < 0 || r.done) continue;
          const e = now - r.t0, T = r.text;
          if (e < 0) continue;
          const fixed = Math.floor(e / STEP);
          if (fixed > T.length) { r.el.textContent = T; r.done = true; continue; }
          if (now - r.glyphAt > 55) {
            r.glyphAt = now;
            r.glyphs = Array.from({ length: WIN }, () => [GLYPHS[(Math.random() * GLYPHS.length) | 0], COLORS[(Math.random() * COLORS.length) | 0]]);
          }
          let html = esc(T.slice(0, fixed));
          const end = Math.min(T.length, fixed + WIN);
          for (let i = fixed; i < end; i++) {
            if (T[i] === ' ') { html += ' '; continue; }
            const [g, c] = r.glyphs[i - fixed];
            html += `<span class="g" style="color:${c}">${esc(g)}</span>`;
          }
          html += `<span class="h">${esc(T.slice(end))}</span>`;
          r.el.innerHTML = html;
        }
      }
    });
  })();

  /* ---------- 05 lens flare ---------- */
  (function () {
    const stage = document.getElementById('fx-flare'), canvas = stage.querySelector('canvas');
    const kit = glKit(canvas);
    if (!kit) return fail(stage);
    const { gl, prog, draw } = kit;
    let P;
    try {
      P = prog(VS, `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform vec2 uLight; uniform float uTime;
${NOISE}
float skyline(float x) {
  float col = floor(x * 9.0);
  float h = (0.1 + 0.27 * hash(vec2(col, 3.1))) * step(0.22, hash(vec2(col, 9.7)));
  return max(h, 0.08 + 0.05 * noise(vec2(x * 5.0, 1.0)));
}
vec3 scene(vec2 uv) {
  vec3 sky = mix(vec3(0.16, 0.09, 0.18), vec3(0.015, 0.02, 0.055), smoothstep(0.1, 0.95, uv.y));
  sky += step(0.9975, hash(floor(gl_FragCoord.xy / 2.0))) * smoothstep(0.35, 0.9, uv.y) * 0.7;
  float x = gl_FragCoord.x / uRes.y;
  float far = 0.2 + 0.08 * noise(vec2(x * 7.0, 4.0));
  vec3 c = sky;
  if (uv.y < far) c = vec3(0.05, 0.045, 0.085);
  float h = skyline(x);
  if (uv.y < h) {
    c = vec3(0.012, 0.012, 0.022);
    vec2 g = vec2(x * 80.0, uv.y * 64.0), wi = floor(g), wf = fract(g);
    float lit = step(0.84, hash(wi + floor(x * 9.0) * 7.0)) * step(0.3, wf.x) * step(wf.x, 0.72) * step(0.28, wf.y) * step(wf.y, 0.7);
    c += lit * vec3(1.0, 0.72, 0.38) * 0.55;
  }
  return c;
}
float hexd(vec2 q) { q = abs(q); return max(q.x * 0.866025 + q.y * 0.5, q.y); }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = scene(vUv);
  vec2 L = uLight;
  float lx = L.x + 0.5 * uRes.x / uRes.y, ly = L.y + 0.5;
  float vis = mix(0.1, 1.0, smoothstep(-0.005, 0.03, ly - skyline(lx)));
  vec2 d = p - L;
  float r = length(d), a = atan(d.y, d.x);
  vec3 warm = vec3(1.0, 0.82, 0.6);
  float core = exp(-r * r * 2200.0) * 3.0 + exp(-r * 9.0) * 0.45 + exp(-r * 2.4) * 0.12;
  float rays = pow(abs(cos(a * 3.0 + 0.35)), 260.0) * 0.8 + pow(abs(cos(a * 4.0 + 1.1)), 500.0) * 0.35;
  rays *= exp(-r * 6.5);
  float fine = pow(noise(vec2(cos(a), sin(a)) * 14.0 + uTime * 0.05), 8.0) * exp(-r * 6.0) * 1.1;
  float streak = exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 1.5) * 0.9;
  float dirt = smoothstep(0.45, 0.9, fbm(p * 5.0 + 3.0)) * exp(-r * 2.0);
  vec3 fl = warm * (core + rays + fine) * (1.0 + dirt * 1.4) + vec3(0.45, 0.65, 1.0) * streak;
  vec3 ghosts = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float s = -0.3 - fi * 0.32 + (i == 4 ? 1.9 : 0.0);
    float rad = 0.025 + 0.045 * hash(vec2(fi, 2.0)) + (i == 3 ? 0.09 : 0.0);
    vec3 tint = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fi * 0.17));
    float gd = hexd(p - L * s) / rad;
    ghosts += tint * smoothstep(1.0, 0.86, gd) * (0.5 + 0.5 * smoothstep(0.2, 1.0, gd)) * 0.11;
  }
  vec3 halo = vec3(exp(-pow((r - 0.31) * 80.0, 2.0)), exp(-pow((r - 0.318) * 80.0, 2.0)), exp(-pow((r - 0.326) * 80.0, 2.0))) * 0.13;
  col += (fl + ghosts + halo) * vis;
  col *= 1.0 - 0.35 * dot(vUv - 0.5, vUv - 0.5);
  col = 1.0 - exp(-col * 1.35);
  o = vec4(col, 1.0);
}`);
    } catch (e) { console.warn(e); return fail(stage); }
    const ptr = trackPointer(stage);
    const L = { x: 0.2, y: 0.15 };
    let idle = 0;
    register(stage, {
      resize() { fit(canvas, 1.5); },
      tick(dt, t) {
        const asp = canvas.width / canvas.height;
        let tx, ty;
        if (performance.now() - ptr.lastMove < 2000) { tx = (ptr.x - 0.5) * asp; ty = 0.5 - ptr.y; }
        else { idle += dt; tx = Math.cos(idle * 0.35) * 0.45 * asp; ty = 0.12 + Math.sin(idle * 0.5) * 0.2; }
        const k = 1 - Math.exp(-dt * 10);
        L.x += (tx - L.x) * k; L.y += (ty - L.y) * k;
        gl.useProgram(P.p);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(P.u.uRes, canvas.width, canvas.height);
        gl.uniform2f(P.u.uLight, L.x, L.y);
        gl.uniform1f(P.u.uTime, t);
        draw();
      }
    });
  })();

  /* ---------- 06 variable type that breathes toward the cursor ---------- */
  (function () {
    const stage = document.getElementById('fx-vf');
    const letters = [];
    stage.querySelectorAll('.vl').forEach((line) => {
      const text = line.textContent;
      line.textContent = '';
      for (const ch of text) {
        const s = document.createElement('span');
        s.textContent = ch === ' ' ? ' ' : ch;
        line.appendChild(s);
        letters.push({ el: s, k: 0 });
      }
    });
    const ptr = trackPointer(stage);
    let idle = 0;
    register(stage, {
      tick(dt) {
        const r = stage.getBoundingClientRect();
        const active = performance.now() - ptr.lastMove < 1800;
        if (!active) idle += dt;
        const mx = ptr.x * r.width, my = ptr.y * r.height, sig = r.width * 0.16;
        const centres = letters.map((l) => { const b = l.el.getBoundingClientRect(); return [b.left - r.left + b.width / 2, b.top - r.top + b.height / 2]; });
        letters.forEach((l, i) => {
          let target;
          if (active) { const dx = centres[i][0] - mx, dy = (centres[i][1] - my) * 1.4; target = Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); }
          else target = Math.pow(0.5 + 0.5 * Math.sin(idle * 2.2 - i * 0.42), 3);
          l.k += (target - l.k) * (1 - Math.exp(-dt * 10));
          const k = l.k;
          l.el.style.fontVariationSettings = `"wght" ${(400 + 300 * k).toFixed(0)}, "wdth" ${(75 + 25 * k).toFixed(1)}`;
          l.el.style.color = k > 0.55 ? `rgb(255,${Math.round(214 - 35 * k)},${Math.round(150 - 79 * k)})` : `rgba(238,240,242,${(0.45 + 0.55 * k / 0.55).toFixed(2)})`;
        });
      }
    });
  })();

  /* ---------- 07 ASCII light ---------- */
  (function () {
    const stage = document.getElementById('fx-ascii'), canvas = stage.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const RAMP = ' .:-=+*#%@', LEVELS = RAMP.length, TINTS = 6;
    const CW = 7, CH = 12;
    let dpr = 1, cols = 0, rows = 0, atlas = null;
    function build() {
      dpr = fit(canvas, 2).dpr;
      cols = Math.ceil(canvas.width / dpr / CW); rows = Math.ceil(canvas.height / dpr / CH);
      atlas = document.createElement('canvas');
      atlas.width = Math.ceil(LEVELS * CW * dpr); atlas.height = Math.ceil(TINTS * CH * dpr);
      const a = atlas.getContext('2d');
      a.scale(dpr, dpr);
      a.font = '500 11px "Geist Mono", monospace'; a.textBaseline = 'middle'; a.textAlign = 'center';
      const tints = ['#2f4436', '#4f6f57', '#7fa486', '#b8d8bd', '#ffd28a', '#ffb347'];
      for (let t = 0; t < TINTS; t++) {
        a.fillStyle = tints[t];
        for (let l = 0; l < LEVELS; l++) a.fillText(RAMP[l], l * CW + CW / 2, t * CH + CH / 2 + 0.5);
      }
    }
    build();
    const ptr = trackPointer(stage);
    const rings = [];
    stage.addEventListener('pointerdown', (e) => { const r = stage.getBoundingClientRect(); rings.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: 0 }); });
    let mx = -1e4, my = -1e4, glow = 0, time = 0;
    register(stage, {
      resize: build, redraw: build,
      tick(dt) {
        time += dt;
        const W = canvas.width / dpr, H = canvas.height / dpr;
        const active = ptr.inside;
        if (active) { mx = ptr.x * W; my = ptr.y * H; }
        glow += ((active ? 1 : 0) - glow) * (1 - Math.exp(-dt * 5));
        for (const r of rings) r.t += dt;
        while (rings.length && rings[0].t > 1.6) rings.shift();
        const blobs = [0, 1, 2].map((i) => [W * (0.5 + 0.34 * Math.sin(time * (0.31 + i * 0.07) + i * 2.1)), H * (0.5 + 0.32 * Math.sin(time * (0.43 + i * 0.05) + i * 1.3)), H * (0.2 + i * 0.04)]);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0b0e0c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const sig2 = 2 * Math.pow(H * 0.16, 2);
        for (let j = 0; j < rows; j++) {
          const y = (j + 0.5) * CH;
          for (let i = 0; i < cols; i++) {
            const x = (i + 0.5) * CW;
            let v = 0;
            for (const [bx, by, br] of blobs) { const d2 = (x - bx) ** 2 + (y - by) ** 2; v += br * br / (d2 + br * br); }
            v = v * 0.42 + 0.06 * Math.sin(x * 0.045 + time * 1.3) * Math.sin(y * 0.06 - time);
            const dm = (x - mx) ** 2 + (y - my) ** 2, lamp = Math.exp(-dm / sig2) * glow;
            v += lamp * 0.9;
            for (const r of rings) { const d = Math.sqrt((x - r.x) ** 2 + (y - r.y) ** 2); v += Math.exp(-Math.pow((d - r.t * 420) / 16, 2)) * (1 - r.t / 1.6) * 0.8; }
            const l = Math.max(0, Math.min(LEVELS - 1, Math.floor(v * LEVELS)));
            if (!l) continue;
            const tint = Math.min(TINTS - 1, Math.floor(v * 3.2) + (lamp > 0.35 ? 2 : 0));
            ctx.drawImage(atlas, l * CW * dpr, tint * CH * dpr, CW * dpr, CH * dpr, i * CW * dpr, j * CH * dpr, CW * dpr, CH * dpr);
          }
        }
      }
    });
  })();

  /* ---------- 08 cards that tilt toward the cursor ---------- */
  (function () {
    const stage = document.getElementById('fx-tilt');
    const cards = [...stage.querySelectorAll('.tcard')].map((el, i) => ({ el, i, hover: false, x: 0.5, y: 0.5, cx: 0.5, cy: 0.5, lift: 0 }));
    cards.forEach((c) => {
      c.el.addEventListener('pointermove', (e) => { const r = c.el.getBoundingClientRect(); c.x = (e.clientX - r.left) / r.width; c.y = (e.clientY - r.top) / r.height; c.hover = true; });
      c.el.addEventListener('pointerleave', () => { c.hover = false; });
    });
    let time = 0;
    register(stage, {
      tick(dt) {
        time += dt;
        const k = 1 - Math.exp(-dt * 9);
        for (const c of cards) {
          const tx = c.hover ? c.x : 0.5 + 0.18 * Math.sin(time * 0.8 + c.i * 1.7), ty = c.hover ? c.y : 0.5 + 0.14 * Math.cos(time * 0.65 + c.i);
          c.cx += (tx - c.cx) * k; c.cy += (ty - c.cy) * k;
          c.lift += ((c.hover ? 1 : 0) - c.lift) * k;
          const s = c.el.style;
          s.setProperty('--rx', `${((0.5 - c.cy) * 22).toFixed(2)}deg`);
          s.setProperty('--ry', `${((c.cx - 0.5) * 26).toFixed(2)}deg`);
          s.setProperty('--gx', `${(c.cx * 100).toFixed(1)}%`);
          s.setProperty('--gy', `${(c.cy * 100).toFixed(1)}%`);
          s.setProperty('--lift', c.lift.toFixed(3));
        }
      }
    });
  })();

  /* ---------- 09 magnetic dots ---------- */
  (function () {
    const stage = document.getElementById('fx-dots'), canvas = stage.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const ptr = trackPointer(stage);
    let W = 1, H = 1, dpr = 1, n = 0, ox, oy, x, y, vx, vy;
    const rings = [];
    function build() {
      const r = fit(canvas, 2); dpr = r.dpr; W = canvas.width / dpr; H = canvas.height / dpr;
      const S = 22, cols = Math.ceil(W / S) + 1, rows = Math.ceil(H / S) + 1;
      n = cols * rows;
      ox = new Float32Array(n); oy = new Float32Array(n); x = new Float32Array(n); y = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
      const offX = (W - (cols - 1) * S) / 2, offY = (H - (rows - 1) * S) / 2;
      for (let j = 0, i = 0; j < rows; j++) for (let c = 0; c < cols; c++, i++) { ox[i] = x[i] = offX + c * S; oy[i] = y[i] = offY + j * S; }
    }
    build();
    stage.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect();
      rings.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: 0 });
    });
    const levels = 6, paths = new Array(levels);
    let mx = -999, my = -999, glow = 0, idle = 0;
    register(stage, {
      resize() { build(); },
      tick(dt) {
        let tx, ty, active = true;
        if (ptr.inside) { tx = ptr.x * W; ty = ptr.y * H; }
        else if (performance.now() - ptr.lastMove > 1500) { idle += dt; tx = W * (0.5 + 0.32 * Math.sin(idle * 0.7)); ty = H * (0.5 + 0.25 * Math.sin(idle * 1.1)); }
        else { tx = mx; ty = my; active = false; }
        if (mx < -900) { mx = tx; my = ty; }
        mx += (tx - mx) * (1 - Math.exp(-dt * 14)); my += (ty - my) * (1 - Math.exp(-dt * 14));
        glow += ((active ? 1 : 0) - glow) * (1 - Math.exp(-dt * 4));
        for (const r of rings) r.t += dt;
        while (rings.length && rings[0].t > 1.6) rings.shift();
        const R = 150, damp = Math.exp(-dt * 9);
        for (let i = 0; i < n; i++) {
          let ax = (ox[i] - x[i]) * 90, ay = (oy[i] - y[i]) * 90;
          const dx = ox[i] - mx, dy = oy[i] - my, d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
          if (d < R) { const f = Math.pow(1 - d / R, 2) * 5200 * glow; ax += dx / d * f; ay += dy / d * f; }
          for (const r of rings) {
            const rx = ox[i] - r.x, ry = oy[i] - r.y, rd = Math.sqrt(rx * rx + ry * ry) + 1e-3, front = r.t * 520;
            const band = Math.exp(-Math.pow((rd - front) / 26, 2)) * (1 - r.t / 1.6);
            ax += rx / rd * band * 9000; ay += ry / rd * band * 9000;
          }
          vx[i] = (vx[i] + ax * dt) * damp; vy[i] = (vy[i] + ay * dt) * damp;
          x[i] += vx[i] * dt; y[i] += vy[i] * dt;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0c0f12'; ctx.fillRect(0, 0, W, H);
        if (glow > 0.01) {
          const g = ctx.createRadialGradient(mx, my, 0, mx, my, 260);
          g.addColorStop(0, `rgba(255,179,71,${0.2 * glow})`); g.addColorStop(1, 'rgba(255,179,71,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        for (let l = 0; l < levels; l++) paths[l] = new Path2D();
        for (let i = 0; i < n; i++) {
          const dx = x[i] - mx, dy = y[i] - my, d = Math.sqrt(dx * dx + dy * dy);
          const disp = Math.min(1, Math.hypot(x[i] - ox[i], y[i] - oy[i]) / 14);
          const near = Math.max(Math.max(0, 1 - d / 190) * glow, disp);
          const l = Math.min(levels - 1, Math.floor(near * levels));
          const rad = 1.1 + l * 0.55;
          paths[l].moveTo(x[i] + rad, y[i]); paths[l].arc(x[i], y[i], rad, 0, TAU);
        }
        for (let l = 0; l < levels; l++) {
          const k = l / (levels - 1);
          ctx.fillStyle = `rgb(${Math.round(70 + 185 * k)},${Math.round(76 + 103 * k)},${Math.round(84 - 13 * k)})`;
          ctx.fill(paths[l]);
        }
      }
    });
  })();

  /* ---------- 10 pixel dissolve ---------- */
  (function () {
    const stage = document.getElementById('fx-pixels'), canvas = stage.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const pages = [document.createElement('canvas'), document.createElement('canvas')];
    let cur = 0, anim = null, cell = 16, cols = 0, rows = 0, th = null;
    function paint() {
      fit(canvas, 2);
      const W = canvas.width, H = canvas.height, s = H / 500;
      pages.forEach((pg, i) => {
        pg.width = W; pg.height = H;
        const c = pg.getContext('2d');
        c.fillStyle = i ? '#10251a' : '#e4e9ec'; c.fillRect(0, 0, W, H);
        const ink = i ? '#e9f2ea' : '#10161a', mute = i ? 'rgba(233,242,234,0.55)' : 'rgba(16,22,26,0.5)';
        c.fillStyle = mute; c.font = `400 ${12 * s}px "Geist Mono", monospace`; c.textBaseline = 'alphabetic';
        c.fillText(i ? '(01) PROJECT · 2024–2026' : '(02) SELECTED WORK', 32 * s, 46 * s);
        c.fillStyle = ink; c.font = `600 ${(i ? 108 : 150) * s}px "Instrument Sans", sans-serif`;
        try { c.letterSpacing = `${-7 * s}px`; } catch (e) {}
        c.fillText(i ? 'Fieldnote' : 'Index', 26 * s, H - 70 * s);
        try { c.letterSpacing = '0px'; } catch (e) {}
        if (i) { c.fillStyle = '#ffb347'; c.beginPath(); c.arc(W - 70 * s, 70 * s, 22 * s, 0, TAU); c.fill(); }
        else {
          c.strokeStyle = 'rgba(16,22,26,0.15)'; c.lineWidth = Math.max(1, s);
          ['Fieldnote', 'Kiln Display', 'Halftone Lab'].forEach((t, k) => {
            const yy = 90 * s + k * 52 * s;
            c.beginPath(); c.moveTo(32 * s, yy + 16 * s); c.lineTo(W - 32 * s, yy + 16 * s); c.stroke();
            c.fillStyle = ink; c.font = `550 ${26 * s}px "Instrument Sans", sans-serif`; c.fillText(t, 32 * s, yy);
            c.fillStyle = mute; c.font = `400 ${12 * s}px "Geist Mono", monospace`; c.textAlign = 'right'; c.fillText(`0${k + 1}`, W - 32 * s, yy); c.textAlign = 'left';
          });
        }
      });
      cell = Math.max(10, Math.round(18 * (window.devicePixelRatio > 1 ? 1.5 : 1)));
      cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
      if (!anim) render();
    }
    function render(p) {
      const W = canvas.width, H = canvas.height;
      ctx.drawImage(pages[anim ? anim.from : cur], 0, 0);
      if (!anim) return;
      const to = pages[anim.to], band = 0.07;
      ctx.fillStyle = '#ffb347';
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const v = th[j * cols + i] - p;
        const x = i * cell, y = j * cell;
        if (v < 0) ctx.drawImage(to, x, y, cell, cell, x, y, cell, cell);
        else if (v < band) ctx.fillRect(x, y, cell, cell);
      }
    }
    stage.addEventListener('pointerdown', (e) => {
      if (anim) return;
      const r = stage.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * cols, cy = (e.clientY - r.top) / r.height * rows;
      const maxD = Math.hypot(Math.max(cx, cols - cx), Math.max(cy, rows - cy));
      th = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) th[j * cols + i] = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / maxD * 0.78 + Math.random() * 0.22;
      anim = { from: cur, to: 1 - cur, t: 0 };
    });
    paint();
    register(stage, {
      resize: paint, redraw: paint,
      tick(dt) {
        if (!anim) return;
        anim.t += dt / 1.0;
        const k = Math.min(1, anim.t), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        render(e * 1.07);
        if (k >= 1) { cur = anim.to; anim = null; render(); }
      }
    });
  })();
})();
