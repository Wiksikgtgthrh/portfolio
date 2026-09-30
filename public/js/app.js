(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const paragraphs = (t) => String(t || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const safeUrl = (u) => (/^(https?:|mailto:|tel:|\/|#)/i.test(String(u || '').trim()) ? String(u).trim() : '#');
  const isVideo = (u) => /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(u || '');
  const youTubeId = (u) => (String(u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/) || [])[1];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CAT_ICONS = { web: '🌐', backend: '⚙️', apps: '📱', bots: '🤖', scripts: '🧩', parsers: '🕷️' };

  let C = {}; let PROJECTS = [];
  const state = { cat: 'all', sort: 'new', q: '' };

  /* ---------------- загрузка ---------------- */
  async function init() {
    try {
      const r = await fetch('/api/content', { cache: 'no-store' });
      const data = await r.json();
      C = data.content || {}; PROJECTS = data.projects || [];
    } catch (e) { console.error(e); }
    render();
    setTimeout(() => { document.body.classList.remove('is-loading'); startAnimations(); }, 450);
  }

  /* ---------------- рендер ---------------- */
  function render() {
    const s = C.settings || {};
    document.title = s.metaTitle || document.title;
    $('meta[name="description"]').setAttribute('content', s.metaDescription || '');
    $$('[data-brand]').forEach((el) => (el.textContent = s.brand || ''));
    $$('[data-brand-accent]').forEach((el) => (el.textContent = s.brandAccent || ''));
    $('[data-login-label]').textContent = s.loginButton || 'Вход';
    $$('[data-t]').forEach((el) => (el.textContent = get(C, el.dataset.t) ?? ''));

    $('#nav').innerHTML = (C.nav || []).map((n) => `<a href="${esc(safeUrl(n.href))}">${esc(n.label)}</a>`).join('');

    $('#stats').innerHTML = (C.hero?.stats || []).map((st, i) => `
      <div class="stat reveal" style="--d:${i * 0.08}s">
        <div class="stat__value"><span data-count="${esc(st.value)}">0</span>${esc(st.suffix)}</div>
        <div class="stat__label">${esc(st.label)}</div>
      </div>`).join('');

    $('#aboutText').innerHTML = paragraphs(C.about?.text);
    $('#aboutPoints').innerHTML = (C.about?.points || []).map((p, i) => `
      <div class="point reveal" style="--d:${i * 0.08}s">
        <div class="point__icon">${esc(p.icon)}</div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>
      </div>`).join('');

    const mq = (C.marquee || []).map((t) => `<span class="marquee__item">${esc(t)}</span>`).join('');
    $('#marquee').innerHTML = mq + mq;

    $('#servicesGrid').innerHTML = (C.services?.items || []).map((sv, i) => `
      <article class="service reveal" style="--d:${(i % 3) * 0.08}s">
        <span class="service__num">0${i + 1}</span>
        <div class="service__icon">${esc(sv.icon)}</div>
        <h3>${esc(sv.title)}</h3><p>${esc(sv.text)}</p>
        <div class="tags">${(sv.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </article>`).join('');

    $('#timeline').insertAdjacentHTML('beforeend', (C.process?.steps || []).map((st, i) => `
      <div class="step reveal" style="--d:${i * 0.1}s">
        <div class="step__dot">${i + 1}</div><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p>
      </div>`).join(''));

    const ct = C.contact || {};
    $('#ctaBtn').href = safeUrl(ct.buttonLink);
    $('#contactLinks').innerHTML = (ct.links || []).map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');

    renderChips();
    renderWorks();
    buildTyped();
  }

  /* ---------------- портфолио: фильтр / сортировка ---------------- */
  function categories() { return C.works?.categories || []; }
  function catLabel(id) { return categories().find((c) => c.id === id)?.label || id || ''; }

  function renderChips() {
    const counts = PROJECTS.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
    const cats = [{ id: 'all', label: C.works?.allLabel || 'Все', n: PROJECTS.length }, ...categories().map((c) => ({ ...c, n: counts[c.id] || 0 }))];
    const wrap = $('#chips');
    $$('.chip', wrap).forEach((c) => c.remove());
    wrap.insertAdjacentHTML('beforeend', cats.map((c) => `<button class="chip ${c.id === state.cat ? 'is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.label)}<sup>${c.n}</sup></button>`).join(''));
    requestAnimationFrame(moveIndicator);
  }
  function moveIndicator() {
    const a = $('.chip.is-active'); const ind = $('.chips__indicator');
    if (!a || !ind) return;
    Object.assign(ind.style, { width: a.offsetWidth + 'px', height: a.offsetHeight + 'px', transform: `translate(${a.offsetLeft}px, ${a.offsetTop}px)` });
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    let list = PROJECTS.filter((p) => (state.cat === 'all' || p.category === state.cat) &&
      (!q || [p.title, p.short, p.description, ...(p.tags || [])].join(' ').toLowerCase().includes(q)));
    const t = (p) => new Date(p.date || 0).getTime() || 0;
    const sorters = {
      new: (a, b) => t(b) - t(a),
      old: (a, b) => t(a) - t(b),
      az: (a, b) => String(a.title).localeCompare(String(b.title), 'ru'),
      featured: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || t(b) - t(a)
    };
    return list.sort(sorters[state.sort] || sorters.new);
  }

  function coverHtml(p, i) {
    const src = p.cover || (p.media || []).find((m) => m.type === 'image')?.url;
    if (src) return isVideo(src) ? `<video src="${esc(src)}" muted loop playsinline preload="metadata"></video>` : `<img src="${esc(src)}" alt="${esc(p.title)}" loading="lazy">`;
    const h = [265, 190, 320, 210, 290, 170][(p.category ? p.category.length : i) % 6];
    return `<div class="work__placeholder" style="--h:${h}">${CAT_ICONS[p.category] || '✦'}</div>`;
  }

  function renderWorks() {
    const list = filtered();
    const grid = $('#worksGrid');
    grid.innerHTML = list.map((p, i) => {
      const hasVideo = (p.media || []).some((m) => m.type === 'video' || m.type === 'youtube') || isVideo(p.cover);
      const date = p.date ? new Date(p.date).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : '';
      return `
      <article class="work ${p.featured && state.cat === 'all' && !state.q ? 'is-featured' : ''}" data-id="${esc(p.id)}" style="animation-delay:${i * 0.06}s" tabindex="0">
        <div class="work__cover">
          ${coverHtml(p, i)}
          <span class="work__badge">${esc(catLabel(p.category))}</span>
          ${hasVideo ? '<span class="work__play">▶</span>' : ''}
          <span class="work__arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 17L17 7M8 7h9v9"/></svg></span>
        </div>
        <div class="work__body">
          <div class="work__meta"><span>${esc(date)}</span></div>
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.short)}</p>
          <div class="tags">${(p.tags || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </article>`;
    }).join('');
    const empty = $('#worksEmpty');
    empty.hidden = list.length > 0;
    empty.textContent = C.works?.emptyText || 'Ничего не найдено';
    $$('.work', grid).forEach(bindTilt);
    $$('.work video', grid).forEach((v) => {
      const card = v.closest('.work');
      card.addEventListener('mouseenter', () => v.play().catch(() => {}));
      card.addEventListener('mouseleave', () => v.pause());
    });
  }

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      state.cat = chip.dataset.cat;
      $$('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      moveIndicator(); renderWorks();
    }
    const work = e.target.closest('.work');
    if (work) openProject(work.dataset.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList?.contains('work')) openProject(e.target.dataset.id);
    if (e.key === 'Escape') $$('.modal.is-open').forEach(closeModal);
  });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderWorks(); });
  let searchT; $('#search').addEventListener('input', (e) => { clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value; renderWorks(); }, 150); });
  addEventListener('resize', moveIndicator);

  /* ---------------- модалка работы ---------------- */
  function mediaList(p) {
    const list = [...(p.media || [])];
    if (p.cover && !list.some((m) => m.url === p.cover)) list.unshift({ type: isVideo(p.cover) ? 'video' : 'image', url: p.cover });
    return list.filter((m) => m && m.url);
  }
  function stageHtml(m) {
    if (!m) return '';
    if (m.type === 'youtube' || youTubeId(m.url)) return `<iframe src="https://www.youtube-nocookie.com/embed/${esc(youTubeId(m.url))}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    if (m.type === 'video' || isVideo(m.url)) return `<video src="${esc(m.url)}" controls autoplay playsinline></video>`;
    return `<img src="${esc(m.url)}" alt="">`;
  }
  function thumbHtml(m, i) {
    const yt = youTubeId(m.url);
    const inner = yt ? `<img src="https://i.ytimg.com/vi/${esc(yt)}/mqdefault.jpg" alt="">` : m.type === 'video' || isVideo(m.url) ? `<video src="${esc(m.url)}#t=0.5" muted preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="">`;
    return `<button class="project__thumb ${i === 0 ? 'is-active' : ''}" data-i="${i}">${inner}</button>`;
  }
  function openProject(id) {
    const p = PROJECTS.find((x) => String(x.id) === String(id));
    if (!p) return;
    const media = mediaList(p);
    $('#projectBody').innerHTML = `
      ${media.length ? `<div class="project__media"><div class="project__stage" id="stage">${stageHtml(media[0])}</div>
        ${media.length > 1 ? `<div class="project__thumbs">${media.map(thumbHtml).join('')}</div>` : ''}</div>`
        : `<div class="work__cover" style="aspect-ratio:16/6">${coverHtml(p, 0)}</div>`}
      <div class="project__info">
        <div class="eyebrow">${esc(catLabel(p.category))}</div>
        <h2>${esc(p.title)}</h2>
        <div class="project__desc">${paragraphs(p.description || p.short)}</div>
        <div class="tags">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="project__foot">
          <span class="muted">${p.date ? esc(new Date(p.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })) : ''}</span>
          ${p.link ? `<a class="btn btn--primary magnetic" href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener"><span>Открыть проект</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 17L17 7M8 7h9v9"/></svg></a>` : ''}
        </div>
      </div>`;
    $$('.project__thumb').forEach((b) => b.addEventListener('click', () => {
      $$('.project__thumb').forEach((x) => x.classList.toggle('is-active', x === b));
      $('#stage').innerHTML = stageHtml(media[+b.dataset.i]);
    }));
    bindButtons($('#projectBody'));
    openModal($('#projectModal'));
  }

  function openModal(m) { m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open'); }
  function closeModal(m) {
    m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open');
    if (m.id === 'projectModal') setTimeout(() => { if (!m.classList.contains('is-open')) $('#projectBody').innerHTML = ''; }, 400);
  }
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(m); }));

  /* ---------------- вход ---------------- */
  $('#loginBtn').addEventListener('click', async () => {
    try { const r = await fetch('/api/me'); if ((await r.json()).authed) { location.href = '/admin'; return; } } catch { /* ignore */ }
    openModal($('#loginModal'));
    setTimeout(() => $('#loginForm input[name=email]').focus(), 300);
  });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const err = $('#loginError'); const btn = $('button[type=submit]', f);
    err.textContent = ''; btn.disabled = true; btn.querySelector('span').textContent = 'Входим...';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portfolio' }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка входа');
      btn.querySelector('span').textContent = 'Успешно ✓';
      location.href = '/admin';
    } catch (ex) {
      err.textContent = ex.message; f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      btn.disabled = false; btn.querySelector('span').textContent = 'Войти';
    }
  });

  /* ---------------- анимации ---------------- */
  function startAnimations() {
    // появление при скролле
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in'); io.unobserve(en.target);
      const cnt = en.target.querySelector('[data-count]'); if (cnt) countUp(cnt);
    }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach((el) => io.observe(el));

    rotateWords();
    typeCode();
    bindButtons(document);
    $$('.service').forEach((el) => el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`); el.style.setProperty('--my', `${e.clientY - r.top}px`);
    }));
    $$('.tilt').forEach(bindTilt);
  }

  function countUp(el) {
    const target = parseFloat(el.dataset.count) || 0; const dur = 1600; const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function rotateWords() {
    const el = $('#rotator'); const words = C.hero?.rotatingWords || [];
    if (!words.length) return;
    let i = 0;
    const show = (w) => { el.classList.remove('is-out'); el.innerHTML = [...w].map((ch, k) => `<span class="char" style="animation-delay:${k * 0.035}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join(''); };
    show(words[0]);
    if (words.length < 2) return;
    setInterval(() => { el.classList.add('is-out'); setTimeout(() => { i = (i + 1) % words.length; show(words[i]); }, 380); }, 2600);
  }

  let typedHtml = '';
  function buildTyped() {
    const s = C.settings || {};
    const services = (C.services?.items || []).map((x) => x.title.split(' ')[0].toLowerCase()).slice(0, 6);
    const lines = [
      ['c', '// кто мы и что делаем'],
      ['k', 'const ', 'p', 'team', '', ' = {'],
      ['', '  name: ', 's', `'${s.brand || ''}${s.brandAccent || ''}'`, '', ','],
      ['', '  stack: [', 's', services.map((x) => `'${x}'`).join(', '), '', '],'],
      ['', '  quality: ', 'n', '100', '', ','],
      ['', '  deadlines: ', 's', "'в срок'", '', ','],
      ['', '  support: ', 'k', 'true', '', ','],
      ['', '};'],
      ['', ''],
      ['k', 'await ', 'p', 'team', '', '.build(', 's', "'ваш проект'", '', ');'],
      ['c', '// ✔ готово к запуску 🚀']
    ];
    typedHtml = lines.map((l) => { let out = ''; for (let k = 0; k < l.length; k += 2) out += l[k] ? `<span class="${l[k]}">${esc(l[k + 1])}</span>` : esc(l[k + 1]); return out; }).join('\n');
  }
  function typeCode() {
    const el = $('#typed');
    if (reduceMotion) { el.innerHTML = typedHtml; return; }
    // печатаем посимвольно, сохраняя подсветку
    const tmp = document.createElement('div'); tmp.innerHTML = typedHtml;
    const nodes = []; tmp.childNodes.forEach((n) => nodes.push({ cls: n.nodeType === 1 ? n.className : '', text: n.textContent }));
    let ni = 0, ci = 0; let html = '';
    const tick = () => {
      if (ni >= nodes.length) return;
      const n = nodes[ni]; const ch = n.text[ci++];
      const part = esc(n.text.slice(0, ci));
      el.innerHTML = html + (n.cls ? `<span class="${n.cls}">${part}</span>` : part);
      if (ci >= n.text.length) { html += n.cls ? `<span class="${n.cls}">${esc(n.text)}</span>` : esc(n.text); ni++; ci = 0; }
      setTimeout(tick, ch === '\n' ? 160 : 18 + Math.random() * 40);
    };
    setTimeout(tick, 500);
  }

  function bindButtons(root) {
    $$('.btn', root).forEach((b) => {
      if (b.dataset.bound) return; b.dataset.bound = '1';
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
        b.style.setProperty('--x', `${x}px`); b.style.setProperty('--y', `${y}px`);
        if (b.classList.contains('magnetic') && !reduceMotion) b.style.transform = `translate(${(x - r.width / 2) * 0.22}px, ${(y - r.height / 2) * 0.3}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }

  function bindTilt(el) {
    if (reduceMotion || matchMedia('(hover: none)').matches) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - 0.5; const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translateY(-6px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  }

  // курсор-подсветка, прогресс, шапка, активный пункт меню, таймлайн
  const glow = $('.cursor-glow');
  addEventListener('pointermove', (e) => { glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }, { passive: true });
  let lastY = 0;
  const onScroll = () => {
    const y = scrollY; const h = document.documentElement.scrollHeight - innerHeight;
    $('.progress span').style.transform = `scaleX(${h > 0 ? y / h : 0})`;
    const header = $('#header');
    header.classList.toggle('is-scrolled', y > 30);
    header.classList.toggle('is-hidden', y > 400 && y > lastY && !document.body.classList.contains('nav-open'));
    lastY = y;
    const tl = $('#timeline');
    if (tl) {
      const r = tl.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (innerHeight * 0.7 - r.top) / r.height));
      tl.querySelector('.timeline__line').style.setProperty('--p', p);
      $$('.step', tl).forEach((s, i, arr) => s.classList.toggle('is-active', p >= i / Math.max(1, arr.length - 1) - 0.02));
    }
    let current = '';
    $$('section[id]').forEach((s) => { if (s.getBoundingClientRect().top < innerHeight * 0.4) current = s.id; });
    $$('#nav a').forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${current}`));
  };
  addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true });

  $('#burger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });

  init();
})();
