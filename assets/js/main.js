(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const SITE = window.SITE;
  const Contour = window.Contour || { setDark() {} };
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

  /* ---------- Header + mobile menu ---------- */
  const THEME_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="half" d="M10 3a7 7 0 0 0 0 14z" fill="currentColor"/><circle class="full" cx="10" cy="10" r="7" fill="currentColor"/></svg>';

  function buildHeader() {
    const themeBtn = `<button class="theme-btn js-theme" type="button">${THEME_ICON}<span class="theme-label js-theme-label">Auto</span></button>`;
    document.body.insertAdjacentHTML('beforeend', `
      <header class="site-header">
        <span class="progress" aria-hidden="true"><i></i></span>
        <a class="brand" href="index.html" aria-label="${esc(SITE.name)}, home"><span class="brand-name">${esc(SITE.name)}<i>.</i></span><span class="brand-role">${esc(SITE.role)}</span></a>
        <nav class="nav" aria-label="Primary">
          <a class="nav-link" href="index.html#about" data-section="about"><span class="u">About</span></a>
          <a class="nav-link" href="index.html#work" data-section="work"><span class="u">Work</span></a>
          <a class="nav-link" href="index.html#contact" data-section="contact"><span class="u">Contact</span></a>
          ${themeBtn}
        </nav>
        <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu"><span class="u">Menu</span></button>
      </header>
      <div class="menu" id="menu" aria-hidden="true">
        <nav class="menu-nav" aria-label="Mobile">
          <a href="index.html#about"><span class="label">01</span>About</a>
          <a href="index.html#work"><span class="label">02</span>Work</a>
          <a href="index.html#contact"><span class="label">03</span>Contact</a>
        </nav>
        <div class="menu-foot">${themeBtn}<a class="js-email-plain"></a></div>
      </div>`);
  }

  function initMenu() {
    const btn = $('.menu-btn'), menu = $('#menu');
    if (!btn || !menu) return;
    const set = (open) => {
      menu.classList.toggle('is-open', open);
      menu.setAttribute('aria-hidden', String(!open));
      btn.setAttribute('aria-expanded', String(open));
      btn.firstElementChild.textContent = open ? 'Close' : 'Menu';
    };
    btn.addEventListener('click', () => set(!menu.classList.contains('is-open')));
    $$('a', menu).forEach((a) => a.addEventListener('click', () => set(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }

  /* ---------- Theme: auto / light / dark ---------- */
  const Theme = {
    modes: ['auto', 'light', 'dark'],
    labels: { auto: 'Auto', light: 'Light', dark: 'Dark' },
    mode: root.dataset.themeMode || 'auto',
    mq: matchMedia('(prefers-color-scheme: dark)'),
    apply(instant) {
      const dark = this.mode === 'dark' || (this.mode === 'auto' && this.mq.matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      root.dataset.themeMode = this.mode;
      $$('.js-theme').forEach((b) => {
        b.dataset.mode = this.mode;
        b.setAttribute('aria-label', `Color theme: ${this.labels[this.mode]}. Click to change.`);
      });
      $$('.js-theme-label').forEach((e) => { e.textContent = this.labels[this.mode]; });
      const meta = $('meta[name="theme-color"]');
      if (meta) meta.content = dark ? '#121210' : '#f3f0e8';
      Contour.setDark(dark, instant);
    },
    cycle() {
      this.mode = this.modes[(this.modes.indexOf(this.mode) + 1) % this.modes.length];
      store.set('reon-theme', this.mode);
      this.apply();
    },
    init() {
      this.apply(true);
      this.mq.addEventListener('change', () => { if (this.mode === 'auto') this.apply(); });
      $$('.js-theme').forEach((b) => b.addEventListener('click', () => this.cycle()));
    }
  };

  /* ---------- Reveal on scroll ---------- */
  const Reveal = {
    io: null,
    init() {
      if (!('IntersectionObserver' in window)) { $$('[data-reveal]').forEach((el) => el.classList.add('is-in')); return; }
      this.io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        this.io.unobserve(e.target);
        e.target.classList.add('is-in');
      }), { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
      $$('[data-reveal]').forEach((el) => {
        // first-screen content animates in straight away, regardless of where it sits
        if (el.closest('.hero, .p-head')) el.classList.add('is-in');
        else this.io.observe(el);
      });
      // anything reached by keyboard shows immediately
      document.addEventListener('focusin', (e) => {
        const el = e.target.closest('[data-reveal]:not(.is-in)');
        if (el) { this.io.unobserve(el); el.classList.add('is-in'); }
      });
    }
  };

  /* ---------- Generative canvases ---------- */
  const Art = {
    items: [], running: false, last: 0, ro: null, io: null,
    init(scope = document) {
      const fresh = [];
      $$('canvas[data-art]', scope).forEach((c) => {
        const fn = window.ART && window.ART[c.dataset.art];
        if (!fn || c._art) return;
        const it = {
          c, fn, ctx: c.getContext('2d'),
          t: c.dataset.t ? +c.dataset.t : ((window.ART.defaults || {})[c.dataset.art] || 0),
          hover: false, visible: false, always: 'animate' in c.dataset, manual: 'manual' in c.dataset
        };
        c._art = it;
        if (it.manual) it.visible = true;
        else {
          const host = c.closest('a') || c.closest('.media') || c.parentElement;
          host.addEventListener('pointerenter', () => { it.hover = true; this.kick(); });
          host.addEventListener('pointerleave', () => { it.hover = false; });
        }
        this.items.push(it);
        fresh.push(it);
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
      fresh.forEach((it) => {
        this.ro.observe(it.c);
        if (!it.manual) this.io.observe(it.c);
        this.size(it);
      });
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
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      it.fn(ctx, it.c.width, it.c.height, it.t);
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

  /* ---------- Curtain: intro counter + page transitions ---------- */
  const Curtain = (() => {
    const el = $('.curtain'), count = el && $('.curtain-count', el);
    let shown = 0, target = 0, raf = 0;
    const step = () => {
      shown = Math.min(target, shown + Math.max(0.8, (target - shown) * 0.12));
      if (count) count.textContent = pad(shown, 3);
      raf = shown < target ? requestAnimationFrame(step) : 0;
    };
    return {
      progress(v) { target = Math.max(target, Math.round(v * 100)); if (!raf) raf = requestAnimationFrame(step); },
      settled() { return new Promise((r) => { const check = () => (shown >= target ? r() : setTimeout(check, 30)); check(); }); },
      lift() { if (el) el.classList.add('is-up'); return wait(reduced ? 0 : 950); },
      cover() {
        if (!el) return Promise.resolve();
        if (count) count.textContent = '';
        el.style.transition = 'none';
        el.classList.remove('is-up');
        el.style.transform = 'translateY(100%)';
        void el.offsetHeight;
        el.style.transition = '';
        el.style.transform = '';
        return wait(reduced ? 0 : 800);
      },
      hide() {
        if (!el) return;
        el.style.transition = 'none';
        el.classList.add('is-up');
        void el.offsetHeight;
        el.style.transition = '';
      }
    };
  })();

  /* ---------- Small behaviours ---------- */
  function initScroll() {
    const header = $('.site-header'), bar = $('.progress i');
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? clamp(scrollY / max) : 0;
      if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
      if (header) header.classList.toggle('is-solid', scrollY > 24);
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
  }

  function initActiveNav() {
    const links = $$('.nav-link[data-section]');
    const sections = links.map((l) => document.getElementById(l.dataset.section)).filter(Boolean);
    if (!sections.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const l = links.find((x) => x.dataset.section === e.target.id);
      if (l) l.classList.toggle('is-active', e.isIntersecting);
    }), { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => io.observe(s));
  }

  // Capabilities band: drifts on its own, speeds up and follows the scroll direction.
  function initMarquee() {
    const m = $('.marquee'), track = m && $('.marquee-track', m);
    if (!track || reduced) return;
    track.innerHTML += track.innerHTML;
    let x = 0, last = 0, lastY = scrollY, boost = 0, dir = 1, raf = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dy = scrollY - lastY;
      lastY = scrollY;
      if (dy) dir = dy > 0 ? 1 : -1;
      boost += (Math.min(1400, Math.abs(dy) * 40) - boost) * 0.08;
      x -= (60 + boost) * dt * dir;
      const half = track.scrollWidth / 2;
      if (x <= -half) x += half;
      if (x > 0) x -= half;
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      raf = requestAnimationFrame(frame);
    };
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !raf) { last = performance.now(); lastY = scrollY; raf = requestAnimationFrame(frame); }
      else if (!e.isIntersecting && raf) { cancelAnimationFrame(raf); raf = 0; }
    }).observe(m);
  }

  function initContact() {
    $$('.js-email').forEach((a) => { a.href = 'mailto:' + SITE.email; a.textContent = SITE.email; });
    $$('.js-email-plain').forEach((a) => { a.href = 'mailto:' + SITE.email; a.textContent = SITE.email; });
    $$('.js-copy').forEach((btn) => btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(SITE.email); btn.textContent = 'Copied'; }
      catch (e) { btn.textContent = 'Press ⌘C'; }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
    }));
    $$('.js-socials').forEach((el) => {
      el.innerHTML = SITE.socials.map((s) => {
        const ext = s.href && s.href !== '#';
        return `<a class="u" href="${esc(s.href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(s.label)}</a>`;
      }).join('');
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
      e.preventDefault();
      const samePage = url.pathname === location.pathname && url.search === location.search;
      if (samePage) {
        const target = url.hash ? document.getElementById(url.hash.slice(1)) : null;
        if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
        else scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        if (url.hash) history.replaceState(null, '', url.hash);
        return;
      }
      Curtain.cover().then(() => { location.href = url.href; });
    });
    addEventListener('pageshow', (e) => { if (e.persisted) Curtain.hide(); });
  }

  /* ---------- Home: work index with cursor preview ---------- */
  function renderWork() {
    const list = $('#work-list'), preview = $('.preview-inner');
    if (!list) return;
    const P = SITE.projects;
    list.innerHTML = P.map((p, i) => `
      <li class="work-row" data-reveal style="--d:${(i % 4) * 60}ms">
        <a href="project.html?p=${encodeURIComponent(p.slug)}" data-index="${i}">
          <span class="w-media" aria-hidden="true"><canvas data-art="${esc(p.art)}"></canvas></span>
          <span class="w-no">${pad(i + 1, 2)}</span>
          <span class="w-title">${esc(p.title)}</span>
          <span class="w-type">${esc(p.type)}</span>
          <span class="w-year">${esc(p.year)}</span>
          <span class="w-arrow" aria-hidden="true">→</span>
        </a>
      </li>`).join('');
    const count = $('.js-count');
    if (count) count.textContent = `${P.length} projects`;
    if (preview) preview.innerHTML = P.map((p, i) => `<div class="preview-item" data-i="${i}"><canvas data-art="${esc(p.art)}" data-manual></canvas></div>`).join('');
  }

  function initPreview() {
    const pv = $('.preview'), list = $('#work-list');
    if (!pv || !list) return;
    const fine = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)');
    const items = $$('.preview-item', pv);
    let x = 0, y = 0, cx = 0, cy = 0, rot = 0, on = false, active = -1, raf = 0;
    const loop = () => {
      const nx = cx + (x - cx) * 0.18;
      rot += (clamp((nx - cx) * 0.35, -9, 9) - rot) * 0.2;
      cx = nx;
      cy += (y - cy) * 0.18;
      pv.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
      const moving = Math.abs(x - cx) + Math.abs(y - cy) + Math.abs(rot) > 0.2;
      raf = (on || moving) ? requestAnimationFrame(loop) : 0;
    };
    const setActive = (i) => {
      if (i === active) return;
      active = i;
      items.forEach((el, k) => {
        el.classList.toggle('is-active', k === i);
        const art = el.firstElementChild && el.firstElementChild._art;
        if (art) art.hover = k === i;
      });
      Art.kick();
    };
    list.addEventListener('pointermove', (e) => {
      if (!fine.matches) return;
      x = e.clientX; y = e.clientY;
      if (!on) { cx = x; cy = y; }
      if (!raf) raf = requestAnimationFrame(loop);
    });
    list.addEventListener('pointerover', (e) => {
      if (!fine.matches) return;
      const a = e.target.closest('a[data-index]');
      if (!a) return;
      if (!on) { cx = x = e.clientX; cy = y = e.clientY; }
      setActive(+a.dataset.index);
      on = true;
      pv.classList.add('is-on');
      if (!raf) raf = requestAnimationFrame(loop);
    });
    list.addEventListener('pointerleave', () => {
      on = false;
      pv.classList.remove('is-on');
      setActive(-1);
    });
  }

  /* ---------- Project page ---------- */
  function renderProject() {
    const main = $('#project');
    if (!main) return;
    const list = SITE.projects;
    let idx = list.findIndex((p) => p.slug === new URLSearchParams(location.search).get('p'));
    if (idx < 0) idx = 0;
    const p = list[idx], next = list[(idx + 1) % list.length];
    document.title = `${p.title} — ${SITE.name}`;
    const meta = [['Year', p.year], ['Role', p.role], ['Type', p.type], ['Status', p.status]].filter((m) => m[1]);
    main.innerHTML = `
      <section class="p-head">
        <div class="p-crumbs label"><a class="u" href="index.html#work">← All work</a><span>${pad(idx + 1, 2)} / ${pad(list.length, 2)}</span></div>
        <h1 class="p-title" data-reveal="lines"><span class="line"><span>${esc(p.title)}</span></span></h1>
        <p class="p-summary" data-reveal style="--d:150ms">${esc(p.summary)}</p>
        <dl class="p-meta" data-reveal style="--d:250ms">
          ${meta.map((m) => `<div><dt class="label">${esc(m[0])}</dt><dd>${esc(m[1])}</dd></div>`).join('')}
        </dl>
      </section>
      <figure class="p-cover" data-reveal><div class="media"><canvas data-art="${esc(p.art)}" data-animate></canvas></div></figure>
      <section class="section p-body">
        <header class="section-head"><span class="label">(01)</span><span class="label">Overview</span></header>
        <div class="grid12"><div class="p-text">${(p.body || []).map((t) => `<p data-reveal>${esc(t)}</p>`).join('')}</div></div>
      </section>
      <section class="p-gallery" aria-label="Gallery">
        <figure data-reveal><div class="media"><canvas data-art="${esc(p.art)}" data-t="3.3"></canvas></div></figure>
        <figure data-reveal style="--d:120ms"><div class="media"><canvas data-art="${esc(p.art)}" data-t="7.9"></canvas></div></figure>
      </section>
      <a class="p-next" href="project.html?p=${encodeURIComponent(next.slug)}">
        <span class="label">Next project</span>
        <span class="p-next-title">${esc(next.title)} <span class="arrow">→</span></span>
      </a>`;
  }

  /* ---------- Boot ---------- */
  async function boot() {
    buildHeader();
    Theme.init();
    if (page === 'home') { renderWork(); initPreview(); initMarquee(); initActiveNav(); }
    if (page === 'project') renderProject();
    initContact();
    Art.init();
    initScroll();
    initMenu();
    initLinks();

    Curtain.progress(0.2);
    const fontList = ['500 40px Geist', '400 16px "Geist Mono"', 'italic 400 40px "Instrument Serif"', '800 40px Archivo'];
    const fonts = (document.fonts ? Promise.all(fontList.map((f) => document.fonts.load(f).catch(() => {}))) : Promise.resolve())
      .then(() => Curtain.progress(0.7));
    const loaded = (document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true })))
      .then(() => Curtain.progress(0.9));
    await Promise.race([Promise.all([fonts, loaded, wait(reduced ? 0 : 500)]), wait(4500)]);
    Curtain.progress(1);
    await Curtain.settled();
    Art.redraw();
    Curtain.lift();
    await wait(reduced ? 0 : 380);
    root.classList.add('is-ready');
    Reveal.init();
    if (location.hash) {
      const t = document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView();
    }
  }

  boot();
})();
