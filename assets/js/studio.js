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

  /* ---------- 01 glass type: a tube generated from a handwritten centre line ---------- */
  (function () {
    const stage = document.getElementById('fx-glass'), canvas = stage.querySelector('canvas');
    const kit = glKit(canvas);
    if (!kit) return fail(stage);
    const { gl, prog } = kit;
    if (!gl.getExtension('EXT_color_buffer_float')) return fail(stage, 'This effect needs floating-point rendering');

    // the typed text is drawn into a 1024 x 448 box; every texel stores its distance to the
    // nearest stroke, and the shader wraps a round tube of radius R around that
    const DW = 1024, DH = 600, BOX_W = 2.4;
    const CJK = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]/;
    let R = 0.085, GROW = 0.085;
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
    let font = FONTS[0];
    function edt1d(f, n, d, v, z) {
      let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    }
    const fontFor = (cjk) => cjk && !/Cherry/.test(font.css) ? `${Math.min(font.weight, 500)} 100px "Noto Sans SC", sans-serif` : `${font.weight} 100px "${font.css}", "Noto Sans SC", sans-serif`;
    function edt(f) {
      const n = Math.max(DW, DH), g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
      for (let col = 0; col < DW; col++) {
        for (let y = 0; y < DH; y++) g[y] = f[y * DW + col];
        edt1d(g, DH, d, v, z);
        for (let y = 0; y < DH; y++) f[y * DW + col] = d[y];
      }
      for (let y = 0; y < DH; y++) {
        for (let col = 0; col < DW; col++) g[col] = f[y * DW + col];
        edt1d(g, DW, d, v, z);
        for (let col = 0; col < DW; col++) f[y * DW + col] = Math.sqrt(d[col]);
      }
      return f;
    }
    // signed distance (px) to the glyph outline: negative inside the letters
    function distanceField(text) {
      const c = document.createElement('canvas'); c.width = DW; c.height = DH;
      const x = c.getContext('2d', { willReadFrequently: true });
      const f = new Float32Array(DW * DH).fill(4000);
      if (!text) return { field: f, r: 0.05, grow: 0 };
      const cjk = CJK.test(text), slant = cjk ? 0 : font.slant;
      x.font = fontFor(cjk);
      // words (and single CJK characters) are the units that can move to the next line
      const toks = [];
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { toks.push(' '); continue; }
        let buf = '';
        for (const ch of part) { if (CJK.test(ch)) { if (buf) toks.push(buf); buf = ''; toks.push(ch); } else buf += ch; }
        if (buf) toks.push(buf);
      }
      const wrap = (maxW) => {
        const lines = [];
        let cur = '';
        for (const t of toks) {
          const next = cur + t;
          if (cur.trim() && t !== ' ' && x.measureText(next.trimEnd()).width > maxW) { lines.push(cur.trimEnd()); cur = t; }
          else cur = next;
        }
        if (cur.trim()) lines.push(cur.trim());
        return lines.length ? lines.map((l) => l.trim()) : [''];
      };
      const probe = x.measureText('Hgjy国');
      const lh = (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent) * 1.06 + 12;   // at 100px, incl. the tube
      const fullW = x.measureText(text).width;
      // try 1, 2, 3… lines and keep whichever lets the letters be biggest
      let best = null;
      for (let L = 1; L <= 24; L++) {
        let lo = 0, hi = fullW;
        for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (wrap(mid).length <= L) hi = mid; else lo = mid; }
        const lines = wrap(hi);
        const wMax = Math.max(...lines.map((l) => { const m = x.measureText(l); return m.actualBoundingBoxLeft + m.actualBoundingBoxRight; }));
        const fsL = Math.min(420, DW * 0.84 / (wMax / 100 + slant * lh / 100), DH * 0.84 / (lines.length * lh / 100));
        if (!best || fsL > best.fs * 1.02) best = { lines, fs: fsL };
        if (lines.length < L) break;   // nothing left to wrap
      }
      const fs = Math.max(10, best.fs);
      x.font = fontFor(cjk).replace('100px', `${fs.toFixed(1)}px`);
      x.setTransform(1, 0, -slant, 1, slant * DH / 2, 0);
      x.fillStyle = '#fff';
      const step = lh * fs / 100;
      best.lines.forEach((line, i) => {
        const m = x.measureText(line);
        const cy = DH / 2 + (i - (best.lines.length - 1) / 2) * step;
        const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        x.fillText(line, (DW - w) / 2 + m.actualBoundingBoxLeft, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
      });
      const a = x.getImageData(0, 0, DW, DH).data;
      const outside = new Float32Array(DW * DH), inside = new Float32Array(DW * DH);
      for (let i = 0; i < f.length; i++) { const on = a[i * 4 + 3] > 127; outside[i] = on ? 0 : 1e20; inside[i] = on ? 1e20 : 0; }
      edt(outside); edt(inside);
      let sum = 0, cnt = 0;
      for (let i = 0; i < f.length; i++) {
        f[i] = Math.max(-4000, Math.min(4000, outside[i] - inside[i]));
        if (inside[i] > 0) { sum += inside[i]; cnt++; }
      }
      // stroke half-width ≈ twice the mean depth inside the letters. Thin strokes are grown
      // into round tubes; thick ones keep their outline and are puffed up like a balloon.
      const hw = cnt ? 2 * sum / cnt : 0, T = (cjk ? 0.03 : 0.058) * fs;
      const r = hw < T ? T : Math.min(hw, T * 2.1), grow = hw < T ? T - hw : 0;
      return { field: f, r: r * BOX_W / DW, grow: grow * BOX_W / DW };
    }


    const SCENE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform float uTime;
uniform sampler2D uVel; uniform sampler2D uDist;
uniform vec4 uBox; uniform float uPx; uniform float uR; uniform float uGrow;
uniform mat3 uRot; uniform vec3 uLight;
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
float map(vec3 p) { p = uRot * p; return length(vec2(max(d2(p.xy) - uGrow + uR, 0.0), p.z)) - uR; }
vec3 nrm(vec3 p) {
  vec2 e = vec2(0.0025, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = pushed(vUv);
  vec3 ro = vec3(0.0, 0.0, 3.2), rd = normalize(vec3(p * 0.62, -1.0));
  float t = 2.5, dmin = 1e9, tmin = 2.5;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float d = map(ro + rd * t);
    if (d < dmin) { dmin = d; tmin = t; }
    if (d < 0.0006) { hit = true; break; }
    t += d * 0.85;
    if (t > 4.0) break;
  }
  float pxw = 3.2 * 0.62 / uRes.y;
  float a = hit ? 1.0 : 1.0 - smoothstep(0.0, pxw * 1.5, dmin);
  if (a > 0.0) {
    vec3 pos = ro + rd * tmin, n = nrm(pos), v = -rd;
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
    col = mix(col, body + vec3(1.0, 0.98, 0.94) * (s1 + s2 + sparkle), a);
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

    const distTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, distTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, DW, DH, 0, gl.RED, gl.FLOAT, new Float32Array(DW * DH).fill(4000));

    let buildId = 0;
    async function setText(raw) {
      const text = raw.trim(), id = ++buildId;
      if (text) {
        try { await document.fonts.load(fontFor(CJK.test(text)), text); } catch (e) {}
      }
      if (id !== buildId) return;   // a newer keystroke won
      const { field, r, grow } = distanceField(text);
      gl.bindTexture(gl.TEXTURE_2D, distTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, DW, DH, 0, gl.RED, gl.FLOAT, field);
      R = r; GROW = grow;
    }
    const card = stage.closest('.fx');
    const input = card.querySelector('.glass-input input');
    const chips = card.querySelector('.font-chips');
    chips.innerHTML = FONTS.map((f, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-k="${f.key}"><b style="font-family:'${f.css}';font-weight:${f.weight}">${f.name}</b><small>${f.note}</small></button>`).join('');
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      font = FONTS.find((f) => f.key === b.dataset.k);
      chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      setText(input.value);
    });
    let typing = 0;
    input.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => setText(input.value), 160); });
    setText(input.value);

    let hdr = null;
    const allocHdr = () => { if (hdr) hdr.free(); hdr = makeTarget(gl, canvas.width, canvas.height, gl.RGBA16F, gl.RGBA, true); };
    allocHdr();

    const st = stirrer(stage);
    const tilt = { x: 0, y: 0 };
    const rot = new Float32Array(9);
    function setRot(ax, ay, az) {
      const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
      // Rz * Rx * Ry, column-major
      const m = [
        cy * cz - sx * sy * sz, cy * sz + sx * sy * cz, -cx * sy,
        -cx * sz, cx * cz, sx,
        sy * cz + sx * cy * sz, sy * sz - sx * cy * cz, cx * cy
      ];
      rot.set(m);
    }
    const PAL = { top: [0.71, 0.83, 0.93], bot: [0.82, 0.9, 0.95], beam: [1.0, 0.97, 0.88] };
    register(stage, {
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

        let u = (gl.useProgram(PS.p), PS.u);
        gl.uniform2f(u.uRes, hdr.w, hdr.h);
        gl.uniform1f(u.uTime, time);
        gl.uniform3fv(u.uSkyTop, PAL.top); gl.uniform3fv(u.uSkyBot, PAL.bot); gl.uniform3fv(u.uBeam, PAL.beam);
        gl.uniform1i(u.uVel, bindTex(gl, 0, fluid.vel));
        gl.uniform1i(u.uDist, bindTex(gl, 1, distTex));
        gl.uniform4f(u.uBox, -BOX_W / 2, -BOX_W * DH / DW / 2, BOX_W, BOX_W * DH / DW);
        gl.uniform1f(u.uPx, BOX_W / DW);
        gl.uniform1f(u.uR, R);
        gl.uniform1f(u.uGrow, GROW);
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
