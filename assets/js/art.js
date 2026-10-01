/* Generative thumbnails. Each art fn draws a full frame: fn(ctx, w, h, t, seed). */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const DISPLAY = 'Archivo, "Helvetica Neue", Arial, sans-serif';
  const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';

  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64);

  const buffers = new Map();
  function buffer(w, h) {
    const key = w + 'x' + h;
    let b = buffers.get(key);
    if (!b) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      b = { c, ctx: c.getContext('2d'), img: null };
      b.img = b.ctx.createImageData(w, h);
      buffers.set(key, b);
    }
    return b;
  }

  // Ordered (Bayer) dithering of a scalar field into two colors.
  function dither(ctx, w, h, cells, a, b, field) {
    const gw = cells, gh = Math.max(1, Math.round(cells * h / w));
    const buf = buffer(gw, gh);
    const d = buf.img.data;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const v = field((x + 0.5) / gw, (y + 0.5) / gh);
        const c = v > BAYER[(y & 7) * 8 + (x & 7)] ? b : a;
        const i = (y * gw + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    buf.ctx.putImageData(buf.img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf.c, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fill(ctx, w, h, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, w, h); }
  const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

  const ART = {};

  /* Fieldnote: dark app window with a grid of notes */
  ART.fieldnote = (ctx, w, h, t) => {
    fill(ctx, w, h, '#d9d4cb');
    const u = w / 100;
    const wx = 9 * u, wy = 17 * u;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 6 * u; ctx.shadowOffsetY = 2 * u;
    rr(ctx, wx, wy, 100 * u, 100 * u, 2.2 * u); ctx.fillStyle = '#111'; ctx.fill();
    ctx.restore();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.beginPath(); ctx.arc(wx + 3.6 * u + i * 2.6 * u, wy + 3.2 * u, 0.75 * u, 0, TAU);
      ctx.fillStyle = '#383838'; ctx.fill();
    });
    ctx.fillStyle = '#161616'; ctx.fillRect(wx, wy + 6.5 * u, 18 * u, 94 * u);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i === 2 ? '#e9e9e9' : '#3a3a3a';
      rr(ctx, wx + 3 * u, wy + 10 * u + i * 4.2 * u, (i % 3 ? 9 : 12) * u, 1.1 * u, 0.5 * u); ctx.fill();
    }
    rr(ctx, wx + 25 * u, wy + 1.6 * u, 34 * u, 3.4 * u, 1.7 * u); ctx.fillStyle = '#1f1f1f'; ctx.fill();
    ctx.fillStyle = '#4a4a4a'; ctx.fillRect(wx + 27.5 * u, wy + 3 * u, 12 * u, 0.6 * u);

    const k = Math.floor(t * 0.9) % 9;
    const fills = ['#ff4d1a', '#2f6bff', '#9ad1ff', '#efe9dc', '#7d5cff', '#18a058', '#ffd23f', '#e6e6e6', '#ff8fb1'];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const x = wx + 24 * u + c * 22 * u, y = wy + 10 * u + r * 24 * u;
      rr(ctx, x, y, 20 * u, 21 * u, 1.4 * u); ctx.fillStyle = '#1b1b1b'; ctx.fill();
      ctx.save(); rr(ctx, x + 1.2 * u, y + 1.2 * u, 17.6 * u, 11 * u, 0.9 * u); ctx.clip();
      ctx.fillStyle = '#262626'; ctx.fillRect(x, y, 20 * u, 13 * u);
      ctx.fillStyle = fills[i];
      if (i % 3 === 0) { ctx.beginPath(); ctx.arc(x + 10 * u, y + 7 * u, 4 * u, 0, TAU); ctx.fill(); }
      else if (i % 3 === 1) { for (let b = 0; b < 6; b++) { const bh = (2 + ((b * 7 + i * 3) % 6)) * u; ctx.fillRect(x + 3 * u + b * 2.4 * u, y + 11 * u - bh, 1.6 * u, bh); } }
      else { ctx.fillRect(x + 1.2 * u, y + 6 * u, 17.6 * u, 6 * u); }
      ctx.restore();
      ctx.fillStyle = '#5a5a5a'; ctx.fillRect(x + 1.6 * u, y + 15 * u, 11 * u, 0.9 * u);
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x + 1.6 * u, y + 17.5 * u, 7 * u, 0.9 * u);
      if (i === k) { rr(ctx, x, y, 20 * u, 21 * u, 1.4 * u); ctx.lineWidth = 0.45 * u; ctx.strokeStyle = '#ff4d1a'; ctx.stroke(); }
    }
    const kc = k % 3, kr = Math.floor(k / 3);
    const px = wx + 24 * u + kc * 22 * u + 15 * u, py = wy + 10 * u + kr * 24 * u + 15 * u;
    ctx.save(); ctx.translate(px, py); ctx.scale(u, u);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 6.4); ctx.lineTo(1.7, 4.8); ctx.lineTo(3, 7.6); ctx.lineTo(4, 7.1); ctx.lineTo(2.8, 4.4); ctx.lineTo(5, 4.4); ctx.closePath();
    ctx.fillStyle = '#ff4d1a'; ctx.fill(); ctx.lineWidth = 0.4; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.restore();
  };

  /* Kiln Display: type specimen with metric guides */
  ART.kiln = (ctx, w, h, t) => {
    fill(ctx, w, h, '#ece6da');
    const pairs = ['Kk', 'Ag', 'Rn', 'Qa', '&?'];
    const g = pairs[Math.floor(t * 0.7) % pairs.length];
    const size = h * 0.5;
    ctx.font = `800 ${size}px ${DISPLAY}`;
    try { ctx.fontStretch = 'expanded'; } catch (e) {}
    const base = h * 0.66;
    const cap = ctx.measureText('H').actualBoundingBoxAscent || size * 0.7;
    const xh = ctx.measureText('x').actualBoundingBoxAscent || size * 0.52;
    const desc = ctx.measureText('g').actualBoundingBoxDescent || size * 0.2;
    const lines = [[base - cap, 'CAP'], [base - xh, 'X-HT'], [base, 'BASE'], [base + desc, 'DESC']];
    ctx.strokeStyle = '#ff4d1a'; ctx.lineWidth = Math.max(1, w / 500);
    ctx.fillStyle = '#ff4d1a'; ctx.font = `500 ${w * 0.022}px ${MONO}`;
    lines.forEach(([y, l]) => {
      ctx.beginPath(); ctx.moveTo(w * 0.05, y); ctx.lineTo(w * 0.95, y); ctx.stroke();
      ctx.fillText(l, w * 0.05, y - w * 0.01);
    });
    ctx.fillStyle = '#1a1714';
    ctx.font = `800 ${size}px ${DISPLAY}`;
    try { ctx.fontStretch = 'expanded'; } catch (e) {}
    ctx.textAlign = 'center';
    ctx.fillText(g, w * 0.5, base);
    ctx.textAlign = 'left';
    try { ctx.fontStretch = 'normal'; } catch (e) {}
    ctx.font = `500 ${w * 0.024}px ${MONO}`;
    ctx.fillText('KILN DISPLAY — VF', w * 0.05, h * 0.08);
    ctx.textAlign = 'right'; ctx.fillText('wdth 62–125', w * 0.95, h * 0.08); ctx.textAlign = 'left';
    ctx.font = `600 ${w * 0.036}px ${DISPLAY}`;
    ctx.fillText('ABCDEFGHIJKLMNOPQRSTUVWXYZ', w * 0.05, h * 0.9);
    ctx.font = `400 ${w * 0.036}px ${DISPLAY}`;
    ctx.fillText('abcdefghijklmnopqrstuvwxyz 0123456789', w * 0.05, h * 0.955);
  };

  /* Halftone Lab: Bayer-dithered sphere over moving bands */
  ART.halftone = (ctx, w, h, t) => {
    const cx = 0.56 + Math.sin(t * 0.6) * 0.05, cy = 0.46 + Math.cos(t * 0.5) * 0.03, R = 0.3;
    const lx = -0.55 + Math.sin(t * 0.4) * 0.2, ly = -0.6;
    dither(ctx, w, h, 110, [14, 14, 13], [255, 77, 26], (x, y) => {
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const r2 = dx * dx + dy * dy;
      if (r2 < 1) {
        const z = Math.sqrt(1 - r2);
        return clamp(0.06 + 0.95 * Math.max(0, dx * lx + dy * ly + z * 0.6));
      }
      let v = 0.5 + 0.5 * Math.sin((x * 6 + y * 2.5) * 3.2 - t * 1.3 + Math.sin(y * 5 + t * 0.6) * 1.4);
      v *= 0.42 * (1.05 - y * 0.45);
      const sx = (x - cx - 0.06) / 0.34, sy = (y - (cy + R + 0.05)) / 0.06;
      return v * (1 - 0.85 * Math.exp(-(sx * sx + sy * sy)));
    });
  };

  /* Palette Forge: OKLCH-ish ramps with a contrast tooltip */
  ART.palette = (ctx, w, h, t) => {
    fill(ctx, w, h, '#e4ecff');
    const hues = [255, 160, 30, 340, 80];
    const cols = 9, rows = hues.length;
    const m = w * 0.1, gap = w * 0.014;
    const cw = (w - m * 2 - gap * (cols - 1)) / cols;
    const top = h * 0.2;
    const sel = Math.floor(t * 1.2) % (cols * rows);
    let sx = 0, sy = 0, sc = '', sl = 0;
    hues.forEach((hue, r) => {
      for (let c = 0; c < cols; c++) {
        const L = 94 - c * 9;
        const S = 62 + Math.sin(c / (cols - 1) * Math.PI) * 30;
        const x = m + c * (cw + gap), y = top + r * (cw * 1.25 + gap);
        rr(ctx, x, y, cw, cw * 1.25, cw * 0.18);
        ctx.fillStyle = `hsl(${hue} ${S}% ${L}%)`; ctx.fill();
        if (r * cols + c === sel) { sx = x; sy = y; sc = `hsl(${hue} ${S}% ${L}%)`; sl = L; }
      }
    });
    ctx.lineWidth = Math.max(2, w * 0.006); ctx.strokeStyle = '#0d0d0d';
    rr(ctx, sx - gap * 0.45, sy - gap * 0.45, cw + gap * 0.9, cw * 1.25 + gap * 0.9, cw * 0.24); ctx.stroke();
    const names = ['blue', 'green', 'orange', 'rose', 'yellow'];
    const label = `${names[Math.floor(sel / cols)]}/${(sel % cols + 1) * 100}`;
    const ratio = (sl > 55 ? (21 / (1 + (100 - sl) / 9)) : (1.2 + (100 - sl) / 9)).toFixed(1) + ':1';
    ctx.font = `500 ${w * 0.026}px ${MONO}`;
    const tw = Math.max(ctx.measureText(label).width, ctx.measureText(ratio).width) + w * 0.09;
    let tx = sx + cw / 2 - tw / 2; tx = clamp(tx, w * 0.03, w * 0.97 - tw);
    const ty = sy - w * 0.13;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = w * 0.03; ctx.shadowOffsetY = w * 0.008;
    rr(ctx, tx, ty, tw, w * 0.1, w * 0.016); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    rr(ctx, tx + w * 0.02, ty + w * 0.025, w * 0.05, w * 0.05, w * 0.01); ctx.fillStyle = sc; ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillText(label, tx + w * 0.085, ty + w * 0.043);
    ctx.fillStyle = '#777'; ctx.fillText(ratio, tx + w * 0.085, ty + w * 0.078);
  };

  /* Motion Kit: easing curves with traveling dots */
  ART.motion = (ctx, w, h, t) => {
    fill(ctx, w, h, '#f0eee8');
    const m = w * 0.14, pw = w - m * 2, ph = h - m * 2.2;
    const ox = m, oy = h - m;
    const yMin = -0.2, yMax = 1.3;
    const Y = (v) => oy - (v - yMin) / (yMax - yMin) * ph;
    ctx.strokeStyle = '#dcd8cd'; ctx.lineWidth = Math.max(1, w / 600);
    for (let i = 0; i <= 10; i++) {
      const x = ox + pw * i / 10;
      ctx.beginPath(); ctx.moveTo(x, oy - ph); ctx.lineTo(x, oy); ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      const y = oy - ph * i / 6;
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + pw, y); ctx.stroke();
    }
    ctx.strokeStyle = '#b5b0a3';
    [0, 1].forEach((v) => { ctx.setLineDash([w * 0.01, w * 0.01]); ctx.beginPath(); ctx.moveTo(ox, Y(v)); ctx.lineTo(ox + pw, Y(v)); ctx.stroke(); });
    ctx.setLineDash([]);
    const c1 = 1.70158, c3 = c1 + 1;
    const curves = [
      ['cubic', '#111', ease],
      ['back', '#ff4d1a', (x) => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)],
      ['spring', '#2f6bff', (x) => 1 - Math.exp(-6 * x) * Math.cos(12 * x)],
      ['expo', '#18a058', (x) => x === 1 ? 1 : 1 - Math.pow(2, -10 * x)]
    ];
    const at = clamp((t * 0.4) % 1.3);
    curves.forEach(([name, col, f], i) => {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w * 0.006);
      ctx.beginPath();
      for (let s = 0; s <= 120; s++) { const x = s / 120; const px = ox + x * pw, py = Y(f(x)); s ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(ox + at * pw, Y(f(at)), w * 0.014, 0, TAU); ctx.fillStyle = col; ctx.fill();
      ctx.font = `500 ${w * 0.024}px ${MONO}`;
      ctx.fillRect(m + i * w * 0.18, m * 0.45, w * 0.022, w * 0.022);
      ctx.fillStyle = '#222'; ctx.fillText(name, m + i * w * 0.18 + w * 0.032, m * 0.45 + w * 0.02);
    });
    ctx.fillStyle = '#8b8678'; ctx.font = `500 ${w * 0.022}px ${MONO}`;
    ctx.fillText('t →', ox + pw - w * 0.06, oy + w * 0.045);
  };

  /* Lowtide Radio: player card with album art and waveform */
  ART.tidal = (ctx, w, h, t) => {
    fill(ctx, w, h, '#d9e4dd');
    const u = w / 100;
    const x = 16 * u, y = 12 * u, cw = 68 * u, ch = 100 * u;
    ctx.save(); ctx.shadowColor = 'rgba(20,50,30,.25)'; ctx.shadowBlur = 8 * u; ctx.shadowOffsetY = 3 * u;
    rr(ctx, x, y, cw, ch, 5 * u); ctx.fillStyle = '#121110'; ctx.fill(); ctx.restore();
    const ax = x + 6 * u, ay = y + 6 * u, as = cw - 12 * u;
    ctx.save(); rr(ctx, ax, ay, as, as * 0.78, 3 * u); ctx.clip();
    const gr = ctx.createLinearGradient(0, ay, 0, ay + as * 0.78);
    gr.addColorStop(0, '#ff9a5a'); gr.addColorStop(0.55, '#ff4d1a'); gr.addColorStop(1, '#5a1e8c');
    ctx.fillStyle = gr; ctx.fillRect(ax, ay, as, as);
    ctx.beginPath(); ctx.arc(ax + as * 0.5, ay + as * 0.52, as * 0.2, 0, TAU); ctx.fillStyle = '#ffe2a8'; ctx.fill();
    ctx.fillStyle = '#3a145e';
    for (let i = 0; i < 7; i++) ctx.fillRect(ax, ay + as * (0.56 + i * 0.035), as, as * (0.008 + i * 0.003));
    ctx.restore();
    const ty = ay + as * 0.78 + 7 * u;
    ctx.fillStyle = '#f2f2f2'; rr(ctx, ax, ty, 30 * u, 2.4 * u, 1.2 * u); ctx.fill();
    ctx.fillStyle = '#6b6b6b'; rr(ctx, ax, ty + 4.5 * u, 19 * u, 1.8 * u, 0.9 * u); ctx.fill();
    ctx.beginPath(); ctx.arc(ax + as - 4 * u, ty + 2 * u, 4.2 * u, 0, TAU); ctx.fillStyle = '#ff4d1a'; ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(ax + as - 5.2 * u, ty + 0.2 * u); ctx.lineTo(ax + as - 2.2 * u, ty + 2 * u); ctx.lineTo(ax + as - 5.2 * u, ty + 3.8 * u); ctx.fill();
    const wy = ty + 14 * u, n = 46, bw = as / n;
    const prog = 0.38 + (t * 0.03) % 0.6;
    for (let i = 0; i < n; i++) {
      const v = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55 + t * 3) * 0.6 + Math.sin(i * 0.17 + 1.3) * 0.4);
      const bh = v * 9 * u;
      ctx.fillStyle = i / n < prog ? '#ff4d1a' : '#3b3b3b';
      ctx.fillRect(ax + i * bw, wy - bh / 2, bw * 0.55, bh);
    }
  };

  /* Pictogram 64: icon grid on black */
  const ICONS = [
    (c) => { c.arc(12, 12, 8.5, 0, TAU); c.moveTo(8.2, 13.6); c.quadraticCurveTo(12, 17.4, 15.8, 13.6); c.moveTo(9.4, 9.6); c.arc(9, 9.6, 0.4, 0, TAU); c.moveTo(15.4, 9.6); c.arc(15, 9.6, 0.4, 0, TAU); },
    (c) => { c.arc(12, 12, 3.8, 0, TAU); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.moveTo(12 + Math.cos(a) * 6.2, 12 + Math.sin(a) * 6.2); c.lineTo(12 + Math.cos(a) * 8.6, 12 + Math.sin(a) * 8.6); } },
    (c) => { c.moveTo(16.5, 15.5); c.arc(11, 12, 7.5, 0.45, TAU - 0.45, false); c.arc(15.8, 9.6, 5.4, 4.0, 2.2, true); },
    (c) => { c.moveTo(4, 11.5); c.lineTo(12, 4.5); c.lineTo(20, 11.5); c.moveTo(6.5, 10); c.lineTo(6.5, 19.5); c.lineTo(17.5, 19.5); c.lineTo(17.5, 10); c.moveTo(10.2, 19.5); c.lineTo(10.2, 14.5); c.lineTo(13.8, 14.5); c.lineTo(13.8, 19.5); },
    (c) => { c.arc(10.5, 10.5, 6, 0, TAU); c.moveTo(15, 15); c.lineTo(20, 20); },
    (c) => { c.moveTo(5.5, 17); c.lineTo(18.5, 17); c.lineTo(17, 15); c.lineTo(17, 11); c.arc(12, 11, 5, 0, Math.PI, true); c.lineTo(7, 15); c.closePath(); c.moveTo(10, 19.5); c.lineTo(14, 19.5); },
    (c) => { c.moveTo(12, 19.5); c.bezierCurveTo(4, 14, 3.5, 9, 6.5, 6.6); c.bezierCurveTo(9, 4.8, 11.2, 6.2, 12, 8); c.bezierCurveTo(12.8, 6.2, 15, 4.8, 17.5, 6.6); c.bezierCurveTo(20.5, 9, 20, 14, 12, 19.5); },
    (c) => { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? 3.8 : 8.6; i ? c.lineTo(12 + Math.cos(a) * r, 12.6 + Math.sin(a) * r) : c.moveTo(12 + Math.cos(a) * r, 12.6 + Math.sin(a) * r); } c.closePath(); },
    (c) => { c.arc(12, 12, 8.5, 0, TAU); c.moveTo(8.2, 12.4); c.lineTo(11, 15.2); c.lineTo(16.2, 9.6); },
    (c) => { c.moveTo(12, 4); c.lineTo(12, 15); c.moveTo(7.5, 10.5); c.lineTo(12, 15); c.lineTo(16.5, 10.5); c.moveTo(5, 19.5); c.lineTo(19, 19.5); },
    (c) => { c.moveTo(3.5, 7); c.lineTo(9.5, 7); c.lineTo(11.5, 9); c.lineTo(20.5, 9); c.lineTo(20.5, 18.5); c.lineTo(3.5, 18.5); c.closePath(); },
    (c) => { c.arc(12, 12, 8.5, 0, TAU); c.moveTo(10, 8.6); c.lineTo(15.6, 12); c.lineTo(10, 15.4); c.closePath(); },
    (c) => { c.rect(6, 11, 12, 9); c.moveTo(8.5, 11); c.lineTo(8.5, 8); c.arc(12, 8, 3.5, Math.PI, 0); c.lineTo(15.5, 11); },
    (c) => { [7, 12, 17].forEach((y, i) => { const k = [15, 8, 13][i]; c.moveTo(4, y); c.lineTo(20, y); c.moveTo(k + 1.6, y); c.arc(k, y, 1.6, 0, TAU); }); },
    (c) => { c.moveTo(5.5, 7.5); c.lineTo(8, 7.5); c.lineTo(9.5, 5); c.lineTo(14.5, 5); c.lineTo(16, 7.5); c.lineTo(18.5, 7.5); c.quadraticCurveTo(20.5, 7.5, 20.5, 9.5); c.lineTo(20.5, 17); c.quadraticCurveTo(20.5, 19, 18.5, 19); c.lineTo(5.5, 19); c.quadraticCurveTo(3.5, 19, 3.5, 17); c.lineTo(3.5, 9.5); c.quadraticCurveTo(3.5, 7.5, 5.5, 7.5); c.moveTo(15.6, 13); c.arc(12, 13, 3.6, 0, TAU); },
    (c) => { c.moveTo(6.5, 4.5); c.lineTo(17.5, 4.5); c.quadraticCurveTo(20.5, 4.5, 20.5, 7.5); c.lineTo(20.5, 13.5); c.quadraticCurveTo(20.5, 16.5, 17.5, 16.5); c.lineTo(12.5, 16.5); c.lineTo(8, 20.5); c.lineTo(8, 16.5); c.lineTo(6.5, 16.5); c.quadraticCurveTo(3.5, 16.5, 3.5, 13.5); c.lineTo(3.5, 7.5); c.quadraticCurveTo(3.5, 4.5, 6.5, 4.5); }
  ];
  ART.pictogram = (ctx, w, h, t) => {
    fill(ctx, w, h, '#0b0b0b');
    const m = w * 0.16, cell = (w - m * 2) / 4, s = cell * 0.52 / 24;
    const hi = Math.floor(t * 1.6) % 16;
    ICONS.forEach((draw, i) => {
      const cx = m + (i % 4) * cell + cell / 2, cy = m + Math.floor(i / 4) * cell * (h / w) + cell / 2;
      ctx.save();
      ctx.translate(cx - 12 * s, cy - 12 * s); ctx.scale(s, s);
      ctx.beginPath(); draw(ctx);
      ctx.lineWidth = 1.75; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = i === hi ? '#ff4d1a' : '#f2f2f2'; ctx.stroke();
      ctx.restore();
    });
  };

  /* Orbit Workspace: glossy planet with an orbiting moon */
  ART.orbit = (ctx, w, h, t) => {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#2c78f4'); bg.addColorStop(1, '#a6ccff');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.52, R = w * 0.18;
    const rx = w * 0.36, ry = w * 0.1, rot = -0.32;
    const a = 0.9 + t * 0.7;
    const mx = Math.cos(a) * rx, my = Math.sin(a) * ry;
    const moonFront = Math.sin(a) > 0;
    const moon = () => {
      const px = cx + mx * Math.cos(rot) - my * Math.sin(rot), py = cy + mx * Math.sin(rot) + my * Math.cos(rot);
      const r = w * (0.045 + (moonFront ? 0.012 : 0));
      const g = ctx.createRadialGradient(px - r * 0.4, py - r * 0.4, r * 0.1, px, py, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ff4d1a');
      ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
    };
    const ring = (from, to) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, from, to);
      ctx.lineWidth = w * 0.035; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
      ctx.lineWidth = w * 0.012; ctx.strokeStyle = 'rgba(30,90,220,.35)'; ctx.stroke();
      ctx.restore();
    };
    ctx.beginPath(); ctx.ellipse(cx + w * 0.04, h * 0.88, w * 0.26, w * 0.035, 0, 0, TAU); ctx.fillStyle = 'rgba(10,40,120,.22)'; ctx.fill();
    ring(Math.PI, TAU);
    if (!moonFront) moon();
    const g = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, R * 0.05, cx, cy, R * 1.05);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, '#9cc6ff'); g.addColorStop(0.7, '#2a68e8'); g.addColorStop(1, '#0c3aa8');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ring(0, Math.PI);
    if (moonFront) moon();
  };

  /* Talk poster: stacked wide type */
  ART.talk = (ctx, w, h, t) => {
    fill(ctx, w, h, '#ff5a1f');
    const stretches = ['condensed', 'semi-condensed', 'normal', 'semi-expanded', 'expanded', 'semi-expanded', 'normal'];
    const size = h * 0.13;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < 7; i++) {
      ctx.font = `900 ${size}px ${DISPLAY}`;
      try { ctx.fontStretch = stretches[i]; } catch (e) {}
      const word = 'MOTION ';
      const ww = ctx.measureText(word).width;
      const off = ((i % 2 ? 1 : -1) * t * w * 0.06 + i * ww * 0.37) % ww;
      const y = h * 0.16 + i * size * 0.98;
      for (let x = -ww - off; x < w + ww; x += ww) {
        if (i % 2) { ctx.lineWidth = Math.max(1.5, w * 0.004); ctx.strokeStyle = '#111'; ctx.strokeText(word, x, y); }
        else { ctx.fillStyle = '#111'; ctx.fillText(word, x, y); }
      }
    }
    try { ctx.fontStretch = 'normal'; } catch (e) {}
    ctx.fillStyle = '#ff5a1f'; ctx.fillRect(0, h * 0.86, w, h * 0.14);
    ctx.fillStyle = '#111'; ctx.font = `500 ${w * 0.026}px ${MONO}`;
    ctx.fillText('MOTION AS MATERIAL', w * 0.05, h * 0.92);
    ctx.fillText('TALK — 2022', w * 0.05, h * 0.955);
    ctx.textAlign = 'right'; ctx.fillText('REON', w * 0.95, h * 0.955); ctx.textAlign = 'left';
  };

  /* Grid Systems zine: swiss composition */
  ART.zine = (ctx, w, h, t) => {
    fill(ctx, w, h, '#efe8da');
    const m = w * 0.08, cols = 6, gw = (w - m * 2) / cols;
    ctx.strokeStyle = 'rgba(229,50,45,.35)'; ctx.lineWidth = Math.max(1, w / 700);
    for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(m + i * gw, 0); ctx.lineTo(m + i * gw, h); ctx.stroke(); }
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 8); ctx.lineTo(w, h * i / 8); ctx.stroke(); }
    const s = Math.sin(t * 0.8) * 0.5 + 0.5;
    ctx.beginPath(); ctx.arc(m + gw * (4 + s), h * 0.34, gw * 2.1, 0, TAU); ctx.fillStyle = '#e5322d'; ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(m, h * 0.5, gw * (3 + s), h * 0.035);
    ctx.fillRect(m + gw, h * 0.56, gw * 0.35, h * 0.3);
    ctx.fillRect(m + gw * 2, h * 0.625, gw * 4, h * 0.012);
    ctx.font = `900 ${h * 0.34}px ${DISPLAY}`;
    try { ctx.fontStretch = 'condensed'; } catch (e) {}
    ctx.fillText('12', m - w * 0.01, h * 0.38);
    try { ctx.fontStretch = 'normal'; } catch (e) {}
    ctx.fillStyle = 'rgba(17,17,17,.55)';
    for (let i = 0; i < 9; i++) ctx.fillRect(m + gw * 2, h * (0.69 + i * 0.024), gw * (i === 8 ? 1.4 : 2.6 - (i % 3) * 0.3), h * 0.009);
    ctx.fillStyle = '#111'; ctx.font = `500 ${w * 0.024}px ${MONO}`;
    ctx.fillText('GRID SYSTEMS', m + gw * 2, h * 0.66 - h * 0.01);
    ctx.fillText('VOL. 01', m + gw * 5, h * 0.95);
  };


  // starting time per art, picked so the static frame looks composed
  ART.defaults = { motion: 1.55, pictogram: 3.2, palette: 18.4, zine: 4.3, orbit: 0.4 };

  window.ART = ART;
})();
