(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const SITE = window.SITE;
  const Sky = window.Sky || { ok: false, set() {}, setDark() {}, pointer() {} };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const page = document.body.dataset.page;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const pad = (n, l) => String(Math.max(0, Math.round(n))).padStart(l, '0');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- Chrome: HUD, grid overlay, menu ---------- */
  function buildChrome() {
    const lines = [0, 1, 2, 3].map((i) => `<i class="gv${i === 3 ? ' c3' : ''}" style="--i:${i}"></i>`).join('') +
      [1, 2].map((j) => `<i class="gh" style="--j:${j}"></i>`).join('') +
      [0, 1, 2, 3].flatMap((i) => [1, 2].map((j) => `<i class="gx${i === 3 ? ' c3' : ''}" style="--i:${i};--j:${j}"></i>`)).join('');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="grid-overlay" aria-hidden="true">${lines}</div>
      <header class="hud">
        <div class="hud-row">
          <a class="logo frame" href="index.html" aria-label="${esc(SITE.name)}, home"><span data-reveal="scramble">${esc(SITE.name.toUpperCase())}</span><span class="logo-caret" aria-hidden="true"></span></a>
          <nav class="hud-nav" aria-label="Primary">
            <a class="frame" href="index.html#work" data-reveal="scramble">Work</a>
            <a class="frame" href="index.html#contact" data-reveal="scramble">Contact</a>
            <button class="frame js-theme" type="button" data-reveal="scramble">Theme[<span class="js-theme-val">A</span>]</button>
            <button class="frame js-sound" type="button" aria-pressed="false" data-reveal="scramble">Sound[<span class="eq">OFF</span>]</button>
          </nav>
          <button class="frame menu-btn" type="button" aria-expanded="false" aria-controls="menu" data-reveal="scramble">Menu</button>
        </div>
        <div class="hud-row">
          <span class="hud-clock" data-reveal="fade"></span>
          <button class="frame hud-coords" type="button" title="Toggle grid" data-reveal="scramble">${pad(innerWidth / 2, 4)} X ${pad(innerHeight / 2, 4)} Y</button>
          <button class="frame hud-progress" type="button" aria-label="Back to top" data-reveal="scramble">000%</button>
        </div>
      </header>
      <div class="menu" id="menu" aria-hidden="true">
        <a class="menu-link display" href="index.html#work">Work</a>
        <a class="menu-link display" href="index.html#contact">Contact</a>
        <div class="menu-tools">
          <button class="frame js-theme" type="button">Theme[<span class="js-theme-val">A</span>]</button>
          <button class="frame js-sound" type="button" aria-pressed="false">Sound[<span class="eq">OFF</span>]</button>
        </div>
      </div>
      <div class="scrollbar" aria-hidden="true"><span class="scrollbar-thumb"></span></div>`);
  }

  /* ---------- Sound: a soft generative pad + UI ticks ---------- */
  const Sound = {
    ctx: null, master: null, sfx: null, on: false, eqTimer: 0, sleepTimer: 0,
    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.6; this.sfx.connect(ctx.destination);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.4; filter.connect(this.master);
      const sweep = ctx.createOscillator(), sweepAmt = ctx.createGain();
      sweep.frequency.value = 0.03; sweepAmt.gain.value = 350;
      sweep.connect(sweepAmt); sweepAmt.connect(filter.frequency); sweep.start();
      [110, 164.81, 220, 277.18, 329.63, 440].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
        o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
        g.gain.value = 0.16 / Math.sqrt(i + 1);
        lfo.frequency.value = 0.04 + Math.random() * 0.09; depth.gain.value = g.gain.value * 0.8;
        lfo.connect(depth); depth.connect(g.gain);
        o.connect(g); g.connect(filter);
        o.start(); lfo.start();
      });
      return true;
    },
    toggle() {
      if (!this.ctx && !this.init()) return;
      this.on = !this.on;
      const t = this.ctx.currentTime;
      clearTimeout(this.sleepTimer);
      this.master.gain.cancelScheduledValues(t);
      if (this.on) {
        this.ctx.resume();
        this.master.gain.setTargetAtTime(0.09, t, 0.8);
        this.blip(880);
      } else {
        this.master.gain.setTargetAtTime(0, t, 0.25);
        this.sleepTimer = setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 1600);
      }
      this.ui();
    },
    ui() {
      $$('.js-sound').forEach((b) => {
        b.setAttribute('aria-pressed', String(this.on));
        b.setAttribute('aria-label', this.on ? 'Sound on, click to mute' : 'Sound off, click to play');
      });
      clearInterval(this.eqTimer);
      const eqs = $$('.eq');
      if (!this.on) { eqs.forEach((e) => { e.textContent = 'OFF'; }); return; }
      const bars = '▁▂▃▄▅▆▇';
      const draw = () => {
        const s = Array.from({ length: 3 }, () => bars[(Math.random() * bars.length) | 0]).join('');
        eqs.forEach((e) => { e.textContent = s; });
      };
      draw();
      if (!reduced) this.eqTimer = setInterval(draw, 130);
    },
    tick() {
      if (!this.on) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = 1800 + Math.random() * 500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.025, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.05);
    },
    blip(f = 640) {
      if (!this.on) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.2);
    }
  };

  /* ---------- Theme: auto / light / dark ---------- */
  const Theme = {
    modes: ['auto', 'light', 'dark'],
    mode: root.dataset.themeMode || 'auto',
    mq: matchMedia('(prefers-color-scheme: dark)'),
    apply(instant) {
      const dark = this.mode === 'dark' || (this.mode === 'auto' && this.mq.matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      root.dataset.themeMode = this.mode;
      $$('.js-theme-val').forEach((e) => { e.textContent = this.mode[0].toUpperCase(); });
      $$('.js-theme').forEach((b) => b.setAttribute('aria-label', `Theme: ${this.mode}. Click to change.`));
      const meta = $('meta[name="theme-color"]');
      if (meta) meta.content = dark ? '#0e1010' : '#f8f7f1';
      Sky.setDark(dark, instant);
    },
    cycle() {
      this.mode = this.modes[(this.modes.indexOf(this.mode) + 1) % this.modes.length];
      store.set('reon-theme', this.mode);
      this.apply();
      Sound.blip(520);
    },
    init() {
      this.apply(true);
      this.mq.addEventListener('change', () => { if (this.mode === 'auto') this.apply(); });
    }
  };

  /* ---------- Text effects ---------- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>';
  const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

  // Decode text left-to-right. Untouched characters keep their layout via a hidden tail,
  // so lines never re-wrap while scrambling.
  function scramble(el, opts = {}) {
    el.classList.add('is-in');
    if (reduced) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest('[data-noscramble]')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    for (let n; (n = walker.nextNode());) nodes.push(n);
    let total = 0;
    const parts = nodes.map((n) => {
      const wrap = document.createElement('span'), head = document.createElement('span'), tail = document.createElement('span');
      tail.className = 'sc-hide';
      tail.textContent = n.nodeValue;
      wrap.append(head, tail);
      n.replaceWith(wrap);
      const p = { wrap, head, tail, text: n.nodeValue, off: total, done: false };
      total += p.text.length;
      return p;
    });
    const stagger = opts.stagger || Math.min(22, 1500 / Math.max(1, total));
    const dur = opts.dur || 240;
    const t0 = performance.now() + (opts.delay || 0);
    let lastNoise = 0;
    const frame = (now) => {
      const e = now - t0;
      const shown = e < 0 ? 0 : Math.floor(e / stagger) + 1;
      const fixed = e < dur ? 0 : Math.floor((e - dur) / stagger) + 1;
      const refresh = now - lastNoise > 45;
      if (refresh) lastNoise = now;
      let pending = false;
      for (const p of parts) {
        if (p.done || !p.wrap.isConnected) continue;
        const L = p.text.length, v = clamp(shown - p.off, 0, L), r = clamp(fixed - p.off, 0, L);
        if (r >= L) { p.wrap.replaceWith(document.createTextNode(p.text)); p.done = true; continue; }
        pending = true;
        if (refresh) {
          let s = p.text.slice(0, r);
          for (let i = r; i < v; i++) s += /\s/.test(p.text[i]) ? p.text[i] : glyph();
          p.head.textContent = s;
          p.tail.textContent = p.text.slice(v);
        }
      }
      if (pending) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function splitWords(el) {
    let i = 0;
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.nodeValue.split(/(\s+)/).forEach((tok) => {
            if (!tok) return;
            if (/^\s+$/.test(tok)) { frag.append(tok); return; }
            const s = document.createElement('span');
            s.className = 'w'; s.style.setProperty('--wi', i++); s.textContent = tok;
            frag.append(s);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1) {
          if (child.tagName === 'A') {
            // keep a link and the punctuation glued to it on one line
            const unit = document.createElement('span');
            unit.className = 'w'; unit.style.setProperty('--wi', i++);
            child.replaceWith(unit);
            unit.append(child);
            const next = unit.nextSibling;
            const m = next && next.nodeType === 3 && next.nodeValue.match(/^[^\s]+/);
            if (m) { unit.append(m[0]); next.nodeValue = next.nodeValue.slice(m[0].length); }
          } else walk(child);
        }
      }
    };
    walk(el);
  }

  function prepSignature(svg) {
    let delay = 0.15;
    svg.querySelectorAll('path').forEach((p) => {
      const len = p.getTotalLength();
      const dur = Math.max(0.35, len / 520);
      p.style.setProperty('--len', len.toFixed(1));
      p.style.setProperty('--dur', dur.toFixed(2) + 's');
      p.style.setProperty('--delay', delay.toFixed(2) + 's');
      delay += dur * 0.9;
    });
  }

  const Reveal = {
    io: null,
    prep() {
      $$('[data-reveal="words"]').forEach(splitWords);
      $$('[data-reveal="draw"]').forEach(prepSignature);
    },
    show(el) {
      const type = el.dataset.reveal;
      const delay = +el.dataset.delay || 0;
      if (type === 'scramble') scramble(el, { delay });
      else if (type === 'card') {
        el.classList.add('is-in');
        $$('[data-scramble]', el).forEach((s) => scramble(s, { delay: 250 }));
      } else setTimeout(() => el.classList.add('is-in'), delay);
    },
    observe(scope = document) {
      let hud = 0;
      $$('[data-reveal]', scope).forEach((el) => {
        if (el.classList.contains('is-in')) return;
        // fixed HUD labels are always on screen: reveal them in sequence instead of observing
        if (el.closest('.hud')) {
          const d = hud++ * 70;
          setTimeout(() => this.show(el), d);
          return;
        }
        if (!this.io) { this.show(el); return; }
        this.io.observe(el);
      });
    },
    init() {
      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver((entries) => entries.forEach((e) => {
          if (!e.isIntersecting) return;
          this.io.unobserve(e.target);
          this.show(e.target);
        }), { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
      }
      this.observe();
      document.addEventListener('focusin', (e) => {
        const el = e.target.closest('[data-reveal]:not(.is-in)');
        if (el) { if (this.io) this.io.unobserve(el); this.show(el); }
      });
    }
  };

  /* ---------- Generative canvases ---------- */
  const Art = {
    items: [], running: false, last: 0,
    init(scope = document) {
      const fresh = [];
      $$('canvas[data-art]', scope).forEach((c) => {
        const fn = window.ART && window.ART[c.dataset.art];
        if (!fn || c._art) return;
        const it = {
          c, fn, ctx: c.getContext('2d'),
          t: c.dataset.t ? +c.dataset.t : ((window.ART.defaults || {})[c.dataset.art] || 0),
          seed: +c.dataset.seed || 1, hover: false, visible: false, always: 'animate' in c.dataset
        };
        c._art = it;
        const host = c.closest('a') || c.parentElement;
        host.addEventListener('pointerenter', () => { it.hover = true; this.kick(); });
        host.addEventListener('pointerleave', () => { it.hover = false; });
        this.items.push(it); fresh.push(it);
      });
      if (!this.ro) {
        this.ro = new ResizeObserver((entries) => entries.forEach((e) => e.target._art && this.size(e.target._art)));
        this.io = new IntersectionObserver((entries) => entries.forEach((e) => {
          const it = e.target._art;
          if (!it) return;
          it.visible = e.isIntersecting;
          if (it.visible) this.kick();
        }));
      }
      fresh.forEach((it) => { this.ro.observe(it.c); this.io.observe(it.c); this.size(it); });
    },
    size(it) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(it.c.clientWidth * dpr)), h = Math.max(1, Math.round(it.c.clientHeight * dpr));
      if (it.c.width !== w || it.c.height !== h) { it.c.width = w; it.c.height = h; this.draw(it); }
    },
    draw(it) {
      if (it.c.width < 2) return;
      const ctx = it.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      it.fn(ctx, it.c.width, it.c.height, it.t, it.seed);
      ctx.restore();
    },
    redraw() { this.items.forEach((it) => this.draw(it)); },
    kick() {
      if (reduced || this.running) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    },
    loop: (now) => {
      const A = Art, dt = Math.min(0.05, (now - A.last) / 1000);
      A.last = now;
      let any = false;
      for (const it of A.items) {
        if (it.visible && (it.hover || it.always)) { it.t += dt; A.draw(it); any = true; }
      }
      if (any) requestAnimationFrame(A.loop); else A.running = false;
    }
  };

  /* ---------- Pixel transition ---------- */
  const Pixels = (() => {
    const c = $('.pixels');
    const ctx = c && c.getContext('2d');
    let th = null, cols = 0, rows = 0, img = null;
    const rgb = (s) => {
      s = s.trim();
      if (s[0] === '#') { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
      const m = s.match(/[\d.]+/g) || [0, 0, 0];
      return [+m[0], +m[1], +m[2]];
    };
    function setup() {
      const size = Math.max(14, Math.round(Math.min(innerWidth, innerHeight) / 32));
      cols = Math.ceil(innerWidth / size); rows = Math.ceil(innerHeight / size);
      c.width = cols; c.height = rows;
      img = ctx.createImageData(cols, rows);
      th = new Float32Array(cols * rows);
      const cx = cols / 2, cy = rows / 2, maxD = Math.hypot(cx, cy);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        th[y * cols + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxD * 0.8 + Math.random() * 0.2;
      }
    }
    // mode 'reveal': hole grows from the centre. mode 'cover': pixels close in from the edges.
    function run(mode, dur) {
      return new Promise((resolve) => {
        if (!c) { resolve(); return; }
        setup();
        const paper = rgb(getComputedStyle(document.body).backgroundColor);
        const accent = rgb(getComputedStyle(root).getPropertyValue('--accent') || '#c4ff1a');
        c.style.display = 'block';
        c.classList.add('is-live');
        const d = img.data, band = 0.06, t0 = performance.now();
        const frame = (now) => {
          const k = dur ? clamp((now - t0) / dur) : 1;
          const p = (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) * (1 + band * 2) - band;
          for (let i = 0; i < th.length; i++) {
            const v = mode === 'reveal' ? th[i] - p : p - (1 - th[i]);
            let col = null;
            if (mode === 'reveal') col = v > band ? paper : (v > 0 ? accent : null);
            else col = v > band ? paper : (v > 0 ? accent : null);
            const j = i * 4;
            if (col) { d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = 255; } else d[j + 3] = 0;
          }
          ctx.putImageData(img, 0, 0);
          if (k < 1) requestAnimationFrame(frame);
          else {
            if (mode === 'reveal') c.style.display = 'none';
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    }
    function clear() { if (c) { c.style.display = 'none'; c.classList.add('is-live'); } }
    return { run, clear };
  })();

  const Loader = (() => {
    const el = $('.loader'), bar = el && el.querySelector('i');
    let v = 0;
    return {
      set(x) { v = Math.max(v, x); if (bar) bar.style.width = (v * 100).toFixed(1) + '%'; },
      done() { if (el) el.classList.add('is-done'); }
    };
  })();

  /* ---------- HUD behaviours ---------- */
  function initClock() {
    const el = $('.hud-clock');
    if (!el) return;
    let off = 'GMT';
    try {
      off = new Intl.DateTimeFormat('en-US', { timeZone: SITE.timezone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value.toUpperCase();
    } catch (e) {}
    el.innerHTML = `<span class="clock-main"><span class="full">${esc(off)} ${esc(SITE.city)} </span><span class="hh">--</span><span class="colon">:</span><span class="mm">--</span></span><span class="clock-alt" hidden>${esc(SITE.name.toUpperCase())} (C) ${SITE.year}</span>`;
    const hh = $('.hh', el), mm = $('.mm', el), colon = $('.colon', el);
    let fmt;
    try { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: SITE.timezone, hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (e) { fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    const tick = () => {
      const parts = fmt.formatToParts(new Date());
      hh.textContent = parts.find((p) => p.type === 'hour').value;
      mm.textContent = parts.find((p) => p.type === 'minute').value;
      colon.classList.toggle('off');
    };
    tick();
    setInterval(tick, 1000);
    const contact = $('#contact');
    if (contact && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => {
        $('.clock-main', el).hidden = e.isIntersecting;
        $('.clock-alt', el).hidden = !e.isIntersecting;
      }, { threshold: 0.5 }).observe(contact);
    }
  }

  function initPointer() {
    const coords = $('.hud-coords');
    let last = null, queued = false;
    addEventListener('pointermove', (e) => {
      last = e;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (coords) coords.textContent = `${pad(last.clientX, 4)} X ${pad(last.clientY, 4)} Y`;
        Sky.pointer(last.clientX, last.clientY);
      });
    }, { passive: true });
    if (coords) coords.addEventListener('click', () => {
      root.classList.toggle('no-grid');
      store.set('reon-grid', root.classList.contains('no-grid') ? '0' : '1');
      Sound.blip(root.classList.contains('no-grid') ? 420 : 700);
    });
  }

  function initScroll() {
    const progress = $('.hud-progress'), thumb = $('.scrollbar-thumb');
    const hero = $('.hero'), contact = $('#contact'), statement = $('.statement');
    const words = statement ? $$('.statement-words span', statement) : [];
    let queued = false;
    const update = () => {
      queued = false;
      const vh = innerHeight, vw = innerWidth;
      const max = document.documentElement.scrollHeight - vh;
      const p = max > 0 ? clamp(scrollY / max) : 0;
      if (progress && progress.classList.contains('is-in')) progress.textContent = pad(p * 100, 3) + '%';
      if (thumb) thumb.style.transform = `translateY(${(p * 172).toFixed(1)}px)`;

      // sky: strong in the hero, gone in the middle, back behind the contact block
      let vis = 0, mode = 'hero';
      if (hero) vis = clamp(1 + hero.getBoundingClientRect().top / (vh * 0.85));
      if (contact) {
        const f = clamp((vh - contact.getBoundingClientRect().top) / (vh * 0.85));
        if (f > vis) { vis = f; mode = 'contact'; }
      }
      const ar = vw / vh;
      const conf = mode === 'contact'
        ? { cx: 0.5, cy: 0.5, scale: Math.min(0.42, ar * 0.42) }
        : vw < 768 ? { cx: 0.5, cy: 0.64, scale: Math.min(0.32, ar * 0.42) } : { cx: 0.64, cy: 0.52, scale: Math.min(0.34, ar * 0.34) };
      Sky.set(Object.assign({ vis }, conf));

      if (words.length) {
        const r = statement.getBoundingClientRect();
        const lead = vh * 0.4;
        const sp = clamp((lead - r.top) / Math.max(1, statement.offsetHeight - vh + lead));
        words.forEach((w, i) => {
          const k = reduced ? 1 : clamp((sp - 0.06 - i * 0.16) / 0.32);
          const e = 1 - Math.pow(1 - k, 3);
          w.style.opacity = e.toFixed(3);
          w.style.fontStretch = (62 + 63 * e).toFixed(1) + '%';
          w.style.transform = `translateY(${((1 - e) * 0.3).toFixed(3)}em)`;
        });
      }
    };
    const req = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', req, { passive: true });
    addEventListener('resize', req);
    if (progress) progress.addEventListener('click', () => scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));
    update();
    return update;
  }

  function initMenu() {
    const btn = $('.menu-btn'), menu = $('#menu');
    if (!btn || !menu) return;
    const set = (open) => {
      menu.classList.toggle('is-open', open);
      menu.setAttribute('aria-hidden', String(!open));
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Close' : 'Menu';
    };
    btn.addEventListener('click', () => { set(!menu.classList.contains('is-open')); Sound.blip(); });
    $$('a', menu).forEach((a) => a.addEventListener('click', () => set(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }

  function initRedacted() {
    $$('.redacted').forEach((b) => {
      const sealed = b.innerHTML;
      let timer = 0;
      b.addEventListener('click', () => {
        clearTimeout(timer);
        if (b.classList.contains('is-open')) { b.innerHTML = sealed; b.classList.remove('is-open'); return; }
        b.classList.add('is-open');
        b.textContent = b.dataset.secret || '';
        scramble(b, { stagger: 40, dur: 200 });
        Sound.blip(760);
        timer = setTimeout(() => { b.innerHTML = sealed; b.classList.remove('is-open'); }, 2800);
      });
    });
  }

  function initLinks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      const samePage = url.pathname === location.pathname && url.search === location.search;
      e.preventDefault();
      Sound.tick();
      if (samePage) {
        const target = url.hash ? document.getElementById(url.hash.slice(1)) : null;
        if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
        else scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        if (url.hash) history.replaceState(null, '', url.hash);
        return;
      }
      Pixels.run('cover', reduced ? 0 : 650).then(() => { location.href = url.href; });
    });
    addEventListener('pageshow', (e) => { if (e.persisted) Pixels.clear(); });
  }

  function initContact() {
    const mail = $('.js-email'), copy = $('.js-copy'), socials = $('.js-socials');
    if (mail) { mail.href = 'mailto:' + SITE.email; mail.textContent = SITE.email; }
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(SITE.email); copy.textContent = '[Copied]'; }
      catch (e) { copy.textContent = '[Press ⌘C]'; }
      scramble(copy, { stagger: 30, dur: 160 });
      Sound.blip(980);
      setTimeout(() => { copy.textContent = '[Copy]'; }, 1800);
    });
    if (socials) socials.innerHTML = SITE.socials.map((s) => {
      const ext = s.href && s.href !== '#';
      return `<a class="frame" href="${esc(s.href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''} data-reveal="scramble">${esc(s.label)}</a>`;
    }).join('');
  }

  function bindUI() {
    $$('.js-theme').forEach((b) => b.addEventListener('click', () => Theme.cycle()));
    $$('.js-sound').forEach((b) => b.addEventListener('click', () => Sound.toggle()));
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('.frame, .lead a');
      if (el && !el.contains(e.relatedTarget)) Sound.tick();
    });
  }

  /* ---------- Pages ---------- */
  function renderWork() {
    const grid = $('#work-grid');
    if (!grid) return;
    grid.innerHTML = SITE.projects.map((p, i) => `
      <article class="card" data-reveal="card">
        <a class="frame" href="project.html?p=${encodeURIComponent(p.slug)}" aria-label="${esc(p.title)}, ${esc(p.year)}">
          <div class="card-media" aria-hidden="true">
            <canvas data-art="${esc(p.art)}" data-seed="${i + 1}"></canvas>
            ${p.tag ? `<span class="card-tag">${esc(p.tag)}</span>` : ''}
          </div>
          <div class="card-meta" aria-hidden="true">
            <span class="card-title" data-scramble>${esc(p.title)}</span>
            <span class="card-info"><span data-scramble>${esc(p.year)}</span>${p.kind ? `<span class="card-kind">${esc(p.kind)}</span>` : ''}<span class="card-arrow">→</span></span>
          </div>
        </a>
      </article>`).join('');
  }

  function renderProject() {
    const main = $('#project');
    if (!main) return;
    const list = SITE.projects;
    let idx = list.findIndex((p) => p.slug === new URLSearchParams(location.search).get('p'));
    if (idx < 0) idx = 0;
    const p = list[idx], next = list[(idx + 1) % list.length];
    document.title = `${p.title} — ${SITE.name.toUpperCase()}©${SITE.year}`;
    const meta = [['Year', p.year], ['Role', p.role], ['Type', p.type], ['Status', p.status]].filter((m) => m[1]);
    main.innerHTML = `
      <section class="p-head">
        <div class="p-nav">
          <a class="frame" href="index.html#work" data-reveal="scramble">← Index</a>
          <span style="padding:8px" data-reveal="scramble">(${pad(idx + 1, 2)}/${pad(list.length, 2)})</span>
        </div>
        <h1 class="p-title display" data-reveal="lines"><span class="line"><span>${esc(p.title)}</span></span></h1>
        <dl class="p-meta">
          ${meta.map((m, i) => `<div data-reveal="scramble" data-delay="${200 + i * 80}"><dt>${esc(m[0])}</dt><dd>${esc(m[1])}</dd></div>`).join('')}
        </dl>
      </section>
      <figure class="p-cover" data-reveal="card">
        <div class="card-media">
          <canvas data-art="${esc(p.art)}" data-animate></canvas>
          ${p.tag ? `<span class="card-tag">${esc(p.tag)}</span>` : ''}
        </div>
      </figure>
      <section class="p-body">
        <p class="p-label" data-reveal="scramble">(Overview)</p>
        <div class="p-copy">
          <p class="lead" data-reveal="words">${esc(p.summary)}</p>
          ${(p.body || []).map((t) => `<p class="p-text" data-reveal="fade">${esc(t)}</p>`).join('')}
        </div>
      </section>
      <section class="p-gallery" aria-label="Gallery">
        <figure data-reveal="card"><div class="card-media"><canvas data-art="${esc(p.art)}" data-t="3.3"></canvas></div></figure>
        <figure data-reveal="card"><div class="card-media"><canvas data-art="${esc(p.art)}" data-t="7.9"></canvas></div></figure>
      </section>
      <a class="p-next frame" href="project.html?p=${encodeURIComponent(next.slug)}" data-reveal="lines">
        <span class="p-next-label">Next project →</span>
        <span class="line"><span class="p-next-title display">${esc(next.title)}</span></span>
      </a>`;
  }

  /* ---------- Boot ---------- */
  async function boot() {
    buildChrome();
    Theme.init();
    if (page === 'home') { renderWork(); initContact(); }
    if (page === 'project') renderProject();
    Reveal.prep();
    Art.init();
    bindUI();
    initClock();
    initPointer();
    initScroll();
    initMenu();
    initRedacted();
    initLinks();

    Loader.set(0.15);
    const fontsReady = document.fonts
      ? Promise.all(['800 40px Archivo', '400 40px Archivo', '400 16px "JetBrains Mono"', '400 13px "Martian Mono"'].map((f) => document.fonts.load(f).catch(() => {})))
      : Promise.resolve();
    const fonts = fontsReady.then(() => Loader.set(0.6));
    const loaded = (document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true }))).then(() => Loader.set(0.85));
    await Promise.race([Promise.all([fonts, loaded, wait(reduced ? 0 : 600)]), wait(4500)]);
    Loader.set(1);
    await wait(reduced ? 0 : 480);
    Loader.done();
    Art.redraw();
    Pixels.run('reveal', reduced ? 0 : 1100);
    await wait(reduced ? 0 : 280);
    root.classList.add('is-ready');
    Reveal.init();
    if (location.hash && page === 'home') {
      const t = document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView();
    }
  }

  boot();
})();
