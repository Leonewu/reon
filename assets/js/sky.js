/* Sky backdrop: soft light streaks + a glassy metaball cluster that leans toward the cursor. */
(function () {
  const noop = { ok: false, set() {}, setDark() {}, pointer() {} };
  const canvas = document.getElementById('sky');
  if (!canvas) { window.Sky = noop; return; }
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) { canvas.classList.add('sky--fallback'); window.Sky = noop; return; }

  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uDark;
uniform vec2 uCenter;
uniform float uScale;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(3.1, 1.7); a *= 0.5; }
  return v;
}

vec3 sky(vec2 uv){
  vec2 p = vec2(uv.x * uRes.x / uRes.y, uv.y);
  vec3 light = mix(vec3(0.87, 0.93, 0.975), vec3(0.66, 0.82, 0.95), uv.y);
  vec3 dark = mix(vec3(0.055, 0.085, 0.145), vec3(0.016, 0.03, 0.07), uv.y);
  vec3 col = mix(light, dark, uDark);
  vec2 dir = normalize(vec2(1.0, 0.6));
  vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
  float band = fbm(vec2(q.x * 1.1 - uTime * 0.035, q.y * 6.0 + uTime * 0.04));
  float mask = fbm(vec2(q.x * 0.7 + 4.0, q.y * 1.6 - uTime * 0.02));
  float s = smoothstep(0.5, 0.82, band) * smoothstep(0.32, 0.72, mask);
  vec3 warm = mix(vec3(1.0, 0.975, 0.88), vec3(0.3, 0.42, 0.85), uDark);
  return mix(col, warm, s * mix(0.8, 0.45, uDark));
}

vec3 ball(int i){
  float f = float(i);
  return vec3(sin(uTime * 0.31 * (1.0 + f * 0.17) + f * 1.9) * 0.6,
              cos(uTime * 0.27 * (1.0 + f * 0.13) + f * 2.7) * 0.34,
              sin(uTime * 0.21 * (1.0 + f * 0.11) + f * 0.7) * 0.32);
}
float radius(int i){ return 0.25 + 0.07 * sin(uTime * 0.5 + float(i) * 1.37); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

float map(vec3 p){
  float d = length(p - vec3(uMouse, 0.0)) - 0.2;
  for (int i = 0; i < 5; i++) d = smin(d, length(p - ball(i)) - radius(i), 0.34);
  return d;
}
vec3 normal(vec3 p){
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - uCenter * uRes) / (uRes.y * uScale);
  vec3 col = sky(uv);

  // contact shadow on the sky
  vec2 so = p - vec2(0.1, -0.2);
  float sd = length(so - uMouse) - 0.2;
  for (int i = 0; i < 5; i++) sd = smin(sd, length(so - ball(i).xy) - radius(i), 0.3);
  col *= 1.0 - 0.09 * smoothstep(0.45, -0.25, sd) * (1.0 - 0.6 * uDark);

  if (length(p) < 1.5) {
    vec3 ro = vec3(p, -1.5), rd = vec3(0.0, 0.0, 1.0);
    float t = 0.0, md = 1e5, tm = 0.0;
    for (int i = 0; i < 48; i++) {
      float d = map(ro + rd * t);
      if (d < md) { md = d; tm = t; }
      if (d < 0.0008) break;
      t += d;
      if (t > 3.0) break;
    }
    float px = 1.5 / (uRes.y * uScale);
    float aa = 1.0 - smoothstep(0.0, px, md);
    if (aa > 0.0) {
      vec3 pos = ro + rd * tm;
      vec3 n = normal(pos);
      vec3 v = -rd;
      float ndv = clamp(dot(n, v), 0.0, 1.0);
      float fres = pow(1.0 - ndv, 3.0);
      vec3 L = normalize(vec3(-0.45, 0.75, -0.55));
      float diff = clamp(dot(n, L), 0.0, 1.0);
      float spec = pow(clamp(dot(n, normalize(L + v)), 0.0, 1.0), 90.0);
      float spec2 = pow(clamp(dot(n, normalize(normalize(vec3(0.7, -0.35, -0.6)) + v)), 0.0, 1.0), 36.0);

      vec3 refr = sky(uv - n.xy * 0.07 * (1.0 + fres));
      vec3 tint = mix(vec3(0.3, 0.52, 1.0), vec3(0.26, 0.4, 0.95), uDark);
      vec3 c = mix(refr, refr * tint * 1.3, 0.7 * ndv);
      c *= 0.8 + 0.28 * (n.y * 0.5 + 0.5);
      vec3 R = reflect(-v, n);
      vec3 refl = sky(clamp(vec2(0.5) + R.xy * vec2(0.35, 0.45), 0.0, 1.0));
      c = mix(c, refl * 1.1, fres * 0.7);
      vec3 irid = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + fres * 1.6 + n.y * 0.4));
      c += irid * fres * 0.22;
      c += diff * 0.06 + spec * 1.15 + spec2 * 0.22 * vec3(0.95, 1.0, 0.8);
      float g = hash(floor(pos.xy * 150.0) + floor(uTime * 2.0));
      c += step(0.996, g) * ndv * 0.7;
      col = mix(col, c, aa);
    }
  }

  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.035;
  gl_FragColor = vec4(col, 1.0);
}`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
  const prog = gl.createProgram();
  if (!vs || !fs) { canvas.classList.add('sky--fallback'); window.Sky = noop; return; }
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('sky--fallback'); window.Sky = noop; return; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ['uRes', 'uTime', 'uMouse', 'uDark', 'uCenter', 'uScale'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let quality = Math.min(window.devicePixelRatio || 1, 2) * 0.55;
  const st = { vis: 1, cx: 0.62, cy: 0.5, scale: 0.34, dark: 0 };
  const tg = { vis: 1, cx: 0.62, cy: 0.5, scale: 0.34, dark: 0 };
  const ptr = { x: 0, y: 0, tx: 0.55, ty: 0.15, has: false };
  let time = 8, last = performance.now(), dirty = true, frames = 0, slow = 0;

  function resize() {
    const w = Math.max(1, Math.round(canvas.clientWidth * quality));
    const h = Math.max(1, Math.round(canvas.clientHeight * quality));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.pow(0.001, dt);
    st.dark += (tg.dark - st.dark) * Math.min(1, dt * 4);
    st.cx += (tg.cx - st.cx) * k; st.cy += (tg.cy - st.cy) * k; st.scale += (tg.scale - st.scale) * k;
    st.vis = tg.vis;
    // pointer in blob space, clamped so the cursor ball stays attached
    let mx = ptr.tx, my = ptr.ty;
    const len = Math.hypot(mx, my), lim = 0.95;
    if (len > lim) { mx *= lim / len; my *= lim / len; }
    ptr.x += (mx - ptr.x) * Math.min(1, dt * 3);
    ptr.y += (my - ptr.y) * Math.min(1, dt * 3);
    canvas.style.opacity = st.vis.toFixed(3);

    const visible = st.vis > 0.002 && !document.hidden;
    if (visible && (!reduced || dirty)) {
      if (!reduced) time += dt;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, time);
      gl.uniform2f(U.uMouse, ptr.x, ptr.y);
      gl.uniform1f(U.uDark, st.dark);
      gl.uniform2f(U.uCenter, st.cx, st.cy);
      gl.uniform1f(U.uScale, st.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      dirty = false;
      // adaptive resolution on slow GPUs
      frames++;
      if (dt > 0.03) slow++;
      if (frames === 90) {
        if (slow > 45 && quality > 0.35) { quality = Math.max(0.35, quality * 0.75); resize(); }
        frames = 0; slow = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.Sky = {
    ok: true,
    set(o) { Object.assign(tg, o); dirty = true; },
    setDark(d, instant) { tg.dark = d ? 1 : 0; if (instant) st.dark = tg.dark; dirty = true; },
    pointer(clientX, clientY) {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const x = clientX / W, y = 1 - clientY / H;
      ptr.tx = (x - st.cx) * W / (H * st.scale);
      ptr.ty = (y - st.cy) / st.scale;
      dirty = true;
    }
  };
})();
