/* Hero backdrop: a slowly drifting topographic map. The cursor raises a hill under it. */
(function () {
  const noop = { ok: false, setDark() {} };
  const canvas = document.getElementById('contour');
  if (!canvas) { window.Contour = noop; return; }
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false });
  if (!gl) { canvas.remove(); window.Contour = noop; return; }

  const VS = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

  const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHill;
uniform float uDark;
uniform float uDpr;
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
float height(vec2 p) {
  float h = fbm(p * 1.15 + vec2(uTime * 0.011, -uTime * 0.007));
  h += 0.4 * fbm(p * 0.45 - vec2(uTime * 0.006, 0.0) + 7.3);
  vec2 d = p - uMouse;
  h += 0.3 * uHill * exp(-dot(d, d) * 9.0);
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float h = height(p);

  float f = h * 18.0;
  float w = max(fwidth(f), 1e-4);
  float d = abs(fract(f + 0.5) - 0.5) / w;          // distance to nearest level, in px
  float level = mod(floor(f + 0.5), 5.0);
  float major = 1.0 - step(0.5, level);              // every 5th line is an index contour
  float hw = mix(0.45, 0.95, major) * uDpr;
  float line = 1.0 - smoothstep(hw - 0.6, hw + 0.6, d);
  line *= 1.0 - smoothstep(0.3, 0.7, w);             // drop lines where they would moiré

  vec3 ink = mix(vec3(0.08, 0.08, 0.07), vec3(0.93, 0.92, 0.89), uDark);
  vec3 accent = mix(vec3(1.0, 0.3, 0.1), vec3(1.0, 0.42, 0.24), uDark);

  // keep the headline area (bottom-left) calmer
  float calm = smoothstep(0.0, 0.85, uv.y * 1.25 + uv.x * 0.55);
  float alpha = line * mix(0.2, 0.75, major) * mix(0.35, 1.0, calm);
  vec3 col = mix(ink, accent, major);

  // faint hillshade
  vec2 g = vec2(dFdx(h), dFdy(h)) * uRes.y;
  vec3 n = normalize(vec3(-g * 0.35, 1.0));
  float shade = clamp(0.62 - dot(n, normalize(vec3(-0.5, 0.6, 0.65))), 0.0, 1.0) * 0.18 * calm;

  float a = alpha + shade * (1.0 - alpha);
  vec3 c = col * alpha + ink * shade * (1.0 - alpha);
  outColor = vec4(c, a);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { canvas.remove(); window.Contour = noop; return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); window.Contour = noop; return; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ['uRes', 'uTime', 'uMouse', 'uHill', 'uDark', 'uDpr'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let time = 20, last = performance.now(), visible = true, dirty = true, frames = 0, slow = 0;
  const mouse = { x: 0.25, y: 0.05, tx: 0.25, ty: 0.05, hill: 0, thill: 0 };
  let dark = 0, tdark = 0;

  function resize() {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; dirty = true; }).observe(canvas);

  const host = canvas.parentElement;
  host.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left - r.width / 2) / r.height;
    mouse.ty = (r.height / 2 - (e.clientY - r.top)) / r.height;
    mouse.thill = 1;
    dirty = true;
  }, { passive: true });
  host.addEventListener('pointerleave', () => { mouse.thill = 0; dirty = true; });

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = Math.min(1, dt * 5);
    mouse.x += (mouse.tx - mouse.x) * k;
    mouse.y += (mouse.ty - mouse.y) * k;
    mouse.hill += (mouse.thill - mouse.hill) * Math.min(1, dt * 2.5);
    dark += (tdark - dark) * Math.min(1, dt * 5);
    const settling = Math.abs(mouse.tx - mouse.x) + Math.abs(mouse.ty - mouse.y) + Math.abs(mouse.thill - mouse.hill) + Math.abs(tdark - dark) > 0.001;

    if (visible && !document.hidden && (!reduced || dirty || settling)) {
      if (!reduced) time += dt;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, time);
      gl.uniform2f(U.uMouse, mouse.x, mouse.y);
      gl.uniform1f(U.uHill, mouse.hill);
      gl.uniform1f(U.uDark, dark);
      gl.uniform1f(U.uDpr, dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
  requestAnimationFrame(frame);

  window.Contour = {
    ok: true,
    setDark(d, instant) { tdark = d ? 1 : 0; if (instant) dark = tdark; dirty = true; }
  };
})();
