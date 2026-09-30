(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isVideo = (u) => /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(u || '');
  const isImage = (u) => /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(u || '');
  const ytId = (u) => (String(u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/) || [])[1];
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');

  const LABELS = {
    settings: 'Общие настройки', brand: 'Название (основная часть)', brandAccent: 'Название (цветная часть)', metaTitle: 'Заголовок вкладки браузера (SEO)', metaDescription: 'Описание для поисковиков', loginButton: 'Текст кнопки входа',
    nav: 'Меню в шапке', label: 'Текст', href: 'Ссылка / якорь (#about)', hero: 'Первый экран', badge: 'Плашка над заголовком', titleTop: 'Заголовок — первая строка', rotatingWords: 'Меняющиеся слова в заголовке',
    titleBottom: 'Заголовок — нижняя строка', subtitle: 'Подзаголовок', ctaPrimary: 'Текст главной кнопки', ctaSecondary: 'Текст второй кнопки', stats: 'Цифры', value: 'Число', suffix: 'Приписка (+, %, лет)',
    about: 'О команде', eyebrow: 'Надзаголовок', title: 'Заголовок', text: 'Текст', points: 'Преимущества', icon: 'Иконка (эмодзи)', marquee: 'Бегущая строка (технологии)', services: 'Услуги', items: 'Карточки',
    tags: 'Теги', process: 'Этапы работы', steps: 'Шаги', works: 'Блок «Работы»', categories: 'Категории работ', id: 'ID категории (латиницей, не меняйте у используемых)', allLabel: 'Текст фильтра «Все»',
    emptyText: 'Текст, если работ нет', contact: 'Контакты', buttonText: 'Текст кнопки', buttonLink: 'Ссылка кнопки', links: 'Ссылки', url: 'Адрес ссылки', footer: 'Подвал'
  };
  const LONG = new Set(['text', 'subtitle', 'metaDescription', 'description']);
  const label = (k) => LABELS[k] || k;

  let DB = { content: {}, projects: [] };
  let draft = {};
  let dirty = false;
  const openSecs = new Set();

  /* ---------------- API ---------------- */
  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portfolio', ...(opts.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.includes('login') && !url.includes('password')) { showAuth(); throw new Error('Требуется вход'); }
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    return d;
  }
  function upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/admin/upload?name=${encodeURIComponent(file.name)}`);
      x.setRequestHeader('X-Requested-With', 'portfolio');
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Ошибка загрузки')); };
      x.onerror = () => reject(new Error('Сеть недоступна'));
      x.send(file);
    });
  }
  async function uploadMany(files) {
    const q = $('#uploadQueue'); const out = [];
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'up';
      row.innerHTML = `<div>${esc(file.name)} · ${fmtSize(file.size)}</div><div class="up__bar"><span></span></div>`;
      q.prepend(row);
      try {
        const d = await upload(file, (p) => (row.querySelector('span').style.width = `${p * 100}%`));
        out.push(d.url); row.remove();
      } catch (e) { row.innerHTML = `❌ ${esc(file.name)}: ${esc(e.message)}`; setTimeout(() => row.remove(), 6000); }
    }
    if (out.length) toast(`Загружено файлов: ${out.length}`);
    return out;
  }

  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-err', !!err); t.classList.add('is-show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('is-show'), 2600);
  }

  /* ---------------- вход ---------------- */
  function showAuth() { $('#app').hidden = true; $('#auth').hidden = false; }
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; $('#authErr').textContent = '';
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ email: f.email.value, password: f.password.value }) }); f.reset(); boot(); }
    catch (ex) { $('#authErr').textContent = ex.message; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; });

  async function boot() {
    try {
      DB = await api('/api/admin/data');
    } catch { showAuth(); return; }
    $('#auth').hidden = true; $('#app').hidden = false;
    draft = clone(DB.content || {});
    $('#pwdForm').email.value = DB.email || '';
    setDirty(false); renderContent(); renderProjects(); loadMedia();
  }

  /* ---------------- вкладки ---------------- */
  const TITLES = { content: 'Тексты сайта', projects: 'Работы', media: 'Медиатека', account: 'Аккаунт' };
  let tab = 'content';
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('.tab').forEach((x) => x.classList.toggle('is-active', x === b));
    $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    $('#pageTitle').textContent = TITLES[tab];
    setDirty(dirty);
    if (tab === 'media') loadMedia();
  }));

  function setDirty(v) {
    dirty = v;
    $('#dirty').hidden = !(v && tab === 'content');
    $('#saveBtn').hidden = tab !== 'content';
    $('#saveBtn').disabled = !v;
  }
  addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (tab === 'content' && dirty) saveContent(); } });
  $('#saveBtn').addEventListener('click', saveContent);
  async function saveContent() {
    const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = 'Сохраняем...';
    try { await api('/api/admin/content', { method: 'PUT', body: JSON.stringify({ content: draft }) }); DB.content = clone(draft); setDirty(false); toast('Сохранено ✓'); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
    btn.textContent = 'Сохранить';
  }

  /* ---------------- редактор текстов (генерируется из JSON) ---------------- */
  const getAt = (obj, path) => path.reduce((o, k) => o?.[k], obj);
  const setAt = (obj, path, val) => { const last = path[path.length - 1]; getAt(obj, path.slice(0, -1))[last] = val; };
  const blankLike = (v) => (Array.isArray(v) ? [] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)])) : typeof v === 'number' ? 0 : '');

  function renderContent() {
    const root = $('#contentForm');
    root.innerHTML = Object.keys(draft).map((key) => `
      <details class="sec" data-sec="${esc(key)}" ${openSecs.has(key) ? 'open' : ''}>
        <summary>${esc(label(key))}</summary>
        <div class="sec__body">${renderValue(draft[key], [key], key)}</div>
      </details>`).join('');
    $$('details.sec', root).forEach((d) => d.addEventListener('toggle', () => (d.open ? openSecs.add(d.dataset.sec) : openSecs.delete(d.dataset.sec))));
  }

  function renderValue(val, path, key) {
    const p = esc(JSON.stringify(path));
    if (Array.isArray(val)) {
      const simple = val.every((x) => typeof x !== 'object');
      const items = val.map((item, i) => {
        const ip = [...path, i];
        const tools = `<button type="button" class="icon-btn" data-act="up" data-path="${esc(JSON.stringify(ip))}" title="Выше">↑</button><button type="button" class="icon-btn" data-act="down" data-path="${esc(JSON.stringify(ip))}" title="Ниже">↓</button><button type="button" class="icon-btn icon-btn--danger" data-act="del" data-path="${esc(JSON.stringify(ip))}" title="Удалить">×</button>`;
        if (simple) return `<div class="arr__item arr__item--inline"><input class="inp" data-path="${esc(JSON.stringify(ip))}" value="${esc(item)}">${tools}</div>`;
        return `<div class="arr__item"><span class="arr__num">#${i + 1}</span><div class="arr__tools">${tools}</div>${renderValue(item, ip, '')}</div>`;
      }).join('');
      return `<div class="arr"><div class="arr__label">${esc(label(key))}</div>${items}<button type="button" class="b b--ghost b--sm" data-act="add" data-path="${p}">+ Добавить</button></div>`;
    }
    if (val && typeof val === 'object') {
      const entries = Object.entries(val);
      const short = entries.filter(([k, v]) => typeof v !== 'object' && !LONG.has(k) && String(v).length < 90);
      const rest = entries.filter((e) => !short.includes(e));
      const f = ([k, v]) => renderValue(v, [...path, k], k);
      return `${short.length > 1 ? `<div class="grid2">${short.map(f).join('')}</div>` : short.map(f).join('')}${rest.map(f).join('')}`;
    }
    const long = LONG.has(key) || String(val).length >= 90;
    const type = typeof val === 'number' ? 'number' : 'text';
    return `<label class="f"><span>${esc(label(key))}</span>${long
      ? `<textarea data-path="${p}" rows="${Math.min(12, Math.max(3, Math.ceil(String(val).length / 80)))}">${esc(val)}</textarea>`
      : `<input type="${type}" data-path="${p}" value="${esc(val)}">`}</label>`;
  }

  $('#contentForm').addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]'); if (!el || !('value' in el)) return;
    const path = JSON.parse(el.dataset.path);
    const old = getAt(draft, path);
    setAt(draft, path, typeof old === 'number' ? Number(el.value) : el.value);
    setDirty(true);
  });
  $('#contentForm').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const path = JSON.parse(b.dataset.path); const act = b.dataset.act;
    if (act === 'add') {
      const arr = getAt(draft, path);
      arr.push(arr.length ? blankLike(arr[0]) : '');
    } else {
      const arr = getAt(draft, path.slice(0, -1)); const i = path[path.length - 1];
      if (act === 'del') { if (!confirm('Удалить этот элемент?')) return; arr.splice(i, 1); }
      if (act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    }
    setDirty(true); renderContent();
  });

  /* ---------------- работы ---------------- */
  const CAT_ICONS = { web: '🌐', backend: '⚙️', apps: '📱', bots: '🤖', scripts: '🧩', parsers: '🕷️' };
  const cats = () => DB.content?.works?.categories || [];
  const catLabel = (id) => cats().find((c) => c.id === id)?.label || id || '—';
  const coverOf = (p) => p.cover || (p.media || []).find((m) => m.type === 'image')?.url || '';

  function renderProjects() {
    const list = [...(DB.projects || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const el = $('#projectList');
    if (!list.length) { el.innerHTML = '<div class="empty">Пока нет работ. Нажмите «Добавить работу».</div>'; return; }
    el.innerHTML = list.map((p) => {
      const c = coverOf(p);
      const cover = c ? (isVideo(c) ? `<video src="${esc(c)}#t=0.5" muted preload="metadata"></video>` : '') : CAT_ICONS[p.category] || '✦';
      return `<div class="pcard ${p.hidden ? 'is-hidden' : ''}">
        <div class="pcard__cover" style="${c && !isVideo(c) ? `background-image:url('${esc(c)}')` : ''}">${cover}
          <div class="pcard__flags"><span class="flag">${esc(catLabel(p.category))}</span>${p.featured ? '<span class="flag">★ Избранное</span>' : ''}${p.hidden ? '<span class="flag">Скрыто</span>' : ''}</div></div>
        <div class="pcard__body"><h3>${esc(p.title || 'Без названия')}</h3><p>${esc(p.short || '')}</p>
          <div class="pcard__tools">
            <button class="b b--ghost b--sm" data-edit="${esc(p.id)}">✎ Изменить</button>
            <button class="icon-btn" data-toggle="${esc(p.id)}" title="${p.hidden ? 'Показать' : 'Скрыть'}">${p.hidden ? '👁️' : '🙈'}</button>
            <button class="icon-btn" data-dup="${esc(p.id)}" title="Дублировать">⧉</button>
            <button class="icon-btn icon-btn--danger" data-remove="${esc(p.id)}" title="Удалить">🗑</button>
          </div></div></div>`;
    }).join('');
  }

  async function saveProjects(msg = 'Сохранено ✓') {
    try { const d = await api('/api/admin/projects', { method: 'PUT', body: JSON.stringify({ projects: DB.projects }) }); DB.projects = d.projects; renderProjects(); toast(msg); return true; }
    catch (e) { toast(e.message, true); return false; }
  }

  $('#projectList').addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const find = (id) => DB.projects.findIndex((p) => String(p.id) === id);
    if (t.dataset.edit) openEditor(DB.projects[find(t.dataset.edit)]);
    if (t.dataset.toggle) { const p = DB.projects[find(t.dataset.toggle)]; p.hidden = !p.hidden; saveProjects(p.hidden ? 'Работа скрыта' : 'Работа опубликована'); }
    if (t.dataset.dup) { const p = clone(DB.projects[find(t.dataset.dup)]); p.id = ''; p.title += ' (копия)'; p.hidden = true; DB.projects.push(p); saveProjects('Копия создана (скрыта)'); }
    if (t.dataset.remove && confirm('Удалить работу? Загруженные файлы останутся в медиатеке.')) { DB.projects.splice(find(t.dataset.remove), 1); saveProjects('Работа удалена'); }
  });
  $('#addProject').addEventListener('click', () => openEditor(null));

  let editing = null;
  function openEditor(p) {
    editing = p ? clone(p) : { id: '', title: '', category: cats()[0]?.id || '', short: '', description: '', tags: [], cover: '', media: [], link: '', date: new Date().toISOString().slice(0, 10), featured: false, hidden: false };
    $('#drawerTitle').textContent = p ? 'Редактирование работы' : 'Новая работа';
    renderEditor();
    openDrawer($('#drawer'));
  }

  function renderEditor() {
    const p = editing;
    $('#projectForm').innerHTML = `
      <label class="f"><span>Название</span><input name="title" value="${esc(p.title)}" required></label>
      <div class="grid2">
        <label class="f"><span>Категория</span><select name="category">${cats().map((c) => `<option value="${esc(c.id)}" ${c.id === p.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        <label class="f"><span>Дата (для сортировки)</span><input type="date" name="date" value="${esc(p.date)}"></label>
      </div>
      <label class="f"><span>Короткое описание (в карточке)</span><input name="short" value="${esc(p.short)}"></label>
      <label class="f"><span>Подробное описание (в окне работы). Пустая строка — новый абзац</span><textarea name="description" rows="7">${esc(p.description)}</textarea></label>
      <div class="grid2">
        <label class="f"><span>Теги через запятую</span><input name="tags" value="${esc((p.tags || []).join(', '))}"></label>
        <label class="f"><span>Ссылка на проект (необязательно)</span><input name="link" value="${esc(p.link)}" placeholder="https://..."></label>
      </div>
      <div class="f"><label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> ★ Избранная (большая карточка)</label>
        <label class="check"><input type="checkbox" name="hidden" ${p.hidden ? 'checked' : ''}> Скрыть с сайта</label></div>

      <div class="f"><span>Обложка (картинка или видео)</span>
        <div class="filefield"><input class="inp" name="cover" value="${esc(p.cover)}" placeholder="Загрузите файл или вставьте ссылку">
          <button type="button" class="b b--ghost b--sm" data-cover="upload">Загрузить</button>
          <button type="button" class="b b--ghost b--sm" data-cover="pick">Из медиатеки</button></div>
        ${p.cover ? `<div class="preview">${isVideo(p.cover) ? `<video src="${esc(p.cover)}" muted controls></video>` : `<img src="${esc(p.cover)}" alt="">`}</div>` : ''}
      </div>

      <div class="f"><span>Галерея: фото, видео, YouTube (показывается в окне работы)</span>
        <div class="mlist">${(p.media || []).map((m, i) => `
          <div class="mitem">
            <div class="mitem__thumb">${m.type === 'youtube' ? `<img src="https://i.ytimg.com/vi/${esc(ytId(m.url))}/mqdefault.jpg" alt="">` : m.type === 'video' ? `<video src="${esc(m.url)}#t=0.5" muted preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="">`}</div>
            <div class="mitem__name"><div class="mitem__type">${m.type === 'youtube' ? 'YouTube' : m.type === 'video' ? 'Видео' : 'Фото'}</div>${esc(m.url)}</div>
            <button type="button" class="icon-btn" data-m="up" data-i="${i}">↑</button>
            <button type="button" class="icon-btn" data-m="down" data-i="${i}">↓</button>
            <button type="button" class="icon-btn icon-btn--danger" data-m="del" data-i="${i}">×</button>
          </div>`).join('') || '<div class="hint" style="margin:0">Пока пусто</div>'}</div>
        <div class="row">
          <button type="button" class="b b--ghost b--sm" data-m="upload">⬆ Загрузить файлы</button>
          <button type="button" class="b b--ghost b--sm" data-m="pick">🎞 Из медиатеки</button>
          <input class="inp" id="ytInput" placeholder="Ссылка на YouTube" style="flex:1;min-width:180px">
          <button type="button" class="b b--ghost b--sm" data-m="yt">+ YouTube</button>
        </div>
      </div>`;
  }

  function readEditor() {
    const f = $('#projectForm');
    Object.assign(editing, {
      title: f.title.value.trim(), category: f.category.value, date: f.date.value, short: f.short.value, description: f.description.value,
      tags: f.tags.value.split(',').map((s) => s.trim()).filter(Boolean), link: f.link.value.trim(), featured: f.featured.checked, hidden: f.hidden.checked, cover: f.cover.value.trim()
    });
  }
  const pickFiles = (accept, multiple) => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.onchange = () => res([...i.files]); i.click(); });
  const typeOf = (url) => (ytId(url) ? 'youtube' : isVideo(url) ? 'video' : 'image');

  $('#projectForm').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    readEditor();
    if (b.dataset.cover === 'upload') { const files = await pickFiles('image/*,video/*', false); if (!files.length) return; toast('Загрузка...'); const [u] = await uploadMany(files); if (u) editing.cover = u; }
    if (b.dataset.cover === 'pick') { const u = await pick((f) => isImage(f.url) || isVideo(f.url)); if (u) editing.cover = u; }
    const m = b.dataset.m; const i = Number(b.dataset.i); const arr = editing.media = editing.media || [];
    if (m === 'upload') { const files = await pickFiles('image/*,video/*', true); if (!files.length) return; toast('Загрузка...'); (await uploadMany(files)).forEach((u) => arr.push({ type: typeOf(u), url: u })); }
    if (m === 'pick') { const u = await pick((f) => isImage(f.url) || isVideo(f.url)); if (u) arr.push({ type: typeOf(u), url: u }); }
    if (m === 'yt') { const u = $('#ytInput').value.trim(); if (!ytId(u)) return toast('Не похоже на ссылку YouTube', true); arr.push({ type: 'youtube', url: u }); }
    if (m === 'del') arr.splice(i, 1);
    if (m === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    if (m === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    renderEditor();
  });
  $('#projectForm').addEventListener('change', (e) => { if (e.target.name === 'cover') { readEditor(); renderEditor(); } });

  $('#projectSave').addEventListener('click', async () => {
    readEditor();
    if (!editing.title) return toast('Укажите название', true);
    const idx = DB.projects.findIndex((p) => p.id && p.id === editing.id);
    if (idx >= 0) DB.projects[idx] = editing; else DB.projects.push(editing);
    if (await saveProjects('Работа сохранена ✓')) closeDrawer($('#drawer'));
  });

  /* ---------------- медиатека ---------------- */
  let MEDIA = [];
  async function loadMedia() { try { MEDIA = (await api('/api/admin/uploads')).files; renderMedia(); } catch { /* */ } }
  const thumb = (f) => (isVideo(f.url) ? `<video src="${esc(f.url)}#t=0.5" muted preload="metadata"></video>` : isImage(f.url) ? `<img src="${esc(f.url)}" loading="lazy" alt="">` : '📄');
  function renderMedia() {
    $('#mediaGrid').innerHTML = MEDIA.length ? MEDIA.map((f) => `
      <div class="mcard"><div class="mcard__thumb">${thumb(f)}</div>
        <div class="mcard__info"><div class="mcard__name" title="${esc(f.name)}">${esc(f.name)}</div>${fmtSize(f.size)}
          <div class="mcard__tools"><button class="b b--ghost b--sm" data-copy="${esc(f.url)}">Ссылка</button><a class="b b--ghost b--sm" href="${esc(f.url)}" target="_blank">↗</a><button class="icon-btn icon-btn--danger" data-del="${esc(f.name)}">🗑</button></div>
        </div></div>`).join('') : '<div class="empty" style="grid-column:1/-1">Файлов пока нет</div>';
  }
  $('#mediaGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copy) { await navigator.clipboard?.writeText(location.origin + b.dataset.copy).catch(() => {}); toast('Ссылка скопирована'); }
    if (b.dataset.del) {
      const used = JSON.stringify(DB).includes(b.dataset.del);
      if (!confirm(used ? 'Этот файл используется на сайте! Всё равно удалить?' : 'Удалить файл?')) return;
      await api(`/api/admin/uploads/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); loadMedia(); toast('Файл удалён');
    }
  });
  const drop = $('#drop');
  $('#mediaInput').addEventListener('change', async (e) => { await uploadMany([...e.target.files]); e.target.value = ''; loadMedia(); });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', async (e) => { await uploadMany([...e.dataTransfer.files]); loadMedia(); });

  let pickResolve = null;
  async function pick(filter) {
    await loadMedia();
    const files = MEDIA.filter(filter);
    $('#pickerGrid').innerHTML = files.length ? files.map((f) => `<div class="mcard" data-url="${esc(f.url)}"><div class="mcard__thumb">${thumb(f)}</div><div class="mcard__info"><div class="mcard__name">${esc(f.name)}</div></div></div>`).join('') : '<div class="empty" style="grid-column:1/-1">В медиатеке нет подходящих файлов</div>';
    openDrawer($('#picker'));
    return new Promise((res) => (pickResolve = res));
  }
  $('#pickerGrid').addEventListener('click', (e) => { const c = e.target.closest('[data-url]'); if (!c) return; pickResolve?.(c.dataset.url); pickResolve = null; closeDrawer($('#picker')); });

  function openDrawer(d) { d.classList.add('is-open'); d.setAttribute('aria-hidden', 'false'); }
  function closeDrawer(d) { d.classList.remove('is-open'); d.setAttribute('aria-hidden', 'true'); if (d.id === 'picker' && pickResolve) { pickResolve(null); pickResolve = null; } }
  $$('.drawer').forEach((d) => d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(d); }));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { const open = $$('.drawer.is-open').pop(); if (open) closeDrawer(open); } });

  /* ---------------- аккаунт ---------------- */
  $('#pwdForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; $('#pwdErr').textContent = '';
    try { await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ email: f.email.value, current: f.current.value, next: f.next.value }) }); f.current.value = ''; f.next.value = ''; toast('Данные для входа обновлены ✓'); }
    catch (ex) { $('#pwdErr').textContent = ex.message; }
  });

  boot();
})();
