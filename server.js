'use strict';
/**
 * Портфолио команды — сервер без внешних зависимостей (Node.js >= 18).
 * - Раздаёт сайт из /public и медиа из /uploads (с поддержкой Range для видео)
 * - REST API для админки: тексты, работы, загрузка файлов, смена пароля
 * - Доступ в админку: ADMIN_EMAIL / ADMIN_PASSWORD из переменных окружения (.env)
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const DEFAULT_DB = path.join(ROOT, 'data', 'default-content.json');
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 1024) * 1024 * 1024;
const MAX_JSON = 5 * 1024 * 1024;
const SESSION_HOURS = 24 * 7;
const IS_PROD = process.env.NODE_ENV === 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.zip': 'application/zip', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.mp4', '.webm', '.mov', '.m4v', '.ogg', '.mp3', '.pdf', '.zip']);

/* ------------------------------ helpers ------------------------------ */
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* .env не обязателен */ }
}

function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.copyFileSync(DEFAULT_DB, DB_FILE);
}

function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function verifyPassword(password, auth) {
  if (!auth) return false;
  const test = crypto.scryptSync(String(password), auth.salt, 64);
  const real = Buffer.from(auth.hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

/** Учётка админа: data/auth.json (после смены пароля в админке) или переменные окружения. */
let envAuth = null;
function getAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { /* нет файла */ }
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return null;
  if (!envAuth) envAuth = { email: process.env.ADMIN_EMAIL.trim().toLowerCase(), ...hashPassword(process.env.ADMIN_PASSWORD), version: 1 };
  return envAuth;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function unsign(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  const p = unsign(parseCookies(req).session);
  const auth = getAuth();
  return !!(p && auth && p.email === auth.email && p.v === (auth.version || 1));
}

function sessionCookie(req, token, maxAge) {
  const secure = IS_PROD || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function send(res, status, data, headers = {}) {
  const isObj = typeof data === 'object' && !Buffer.isBuffer(data);
  res.writeHead(status, { 'Content-Type': isObj ? MIME['.json'] : MIME['.txt'], 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(data) : data);
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_JSON) { reject(httpError(413, 'Слишком большой запрос')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(httpError(400, 'Некорректный JSON')); } });
    req.on('error', reject);
  });
}

async function readDb() { return JSON.parse(await fsp.readFile(DB_FILE, 'utf8')); }
let writeQueue = Promise.resolve();
function writeDb(db) {
  writeQueue = writeQueue.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
    await fsp.rename(tmp, DB_FILE);
  });
  return writeQueue;
}

function safeName(name) {
  const ext = path.extname(name || '').toLowerCase();
  const base = path.basename(name || 'file', ext).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
  return { ext, file: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}` };
}

/* ------------------------- rate limit на логин ------------------------- */
const attempts = new Map();
function recentAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list;
}

/* ------------------------------ static ------------------------------ */
async function serveFile(req, res, baseDir, relPath, cache) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir + path.sep)) return false;
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return false; }
  if (stat.isDirectory()) return serveFile(req, res, baseDir, path.join(relPath, 'index.html'), cache);
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'Last-Modified': stat.mtime.toUTCString() };
  if (type === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(filePath).pipe(res);
  return true;
}

/* -------------------------------- API -------------------------------- */
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

  // Защита от CSRF: изменяющие запросы принимаются только от нашего фронтенда
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'portfolio') return send(res, 403, { error: 'Forbidden' });

  if (route === 'GET /api/content') {
    const db = await readDb();
    return send(res, 200, { content: db.content, projects: (db.projects || []).filter((p) => !p.hidden) });
  }

  if (route === 'POST /api/login') {
    const list = recentAttempts(ip);
    if (list.length >= 8) return send(res, 429, { error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    const { email = '', password = '' } = await readJson(req);
    const auth = getAuth();
    if (!auth) return send(res, 500, { error: 'Админ не настроен: задайте ADMIN_EMAIL и ADMIN_PASSWORD' });
    if (String(email).trim().toLowerCase() !== auth.email || !verifyPassword(password, auth)) {
      list.push(Date.now());
      return send(res, 401, { error: 'Неверная почта или пароль' });
    }
    attempts.delete(ip);
    const token = sign({ email: auth.email, v: auth.version || 1, exp: Date.now() + SESSION_HOURS * 3600e3 });
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_HOURS * 3600) });
  }

  if (route === 'POST /api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  if (route === 'GET /api/me') return send(res, 200, { authed: isAuthed(req) });

  // ---- всё ниже — только для админа ----
  if (!isAuthed(req)) return send(res, 401, { error: 'Требуется вход' });

  if (route === 'GET /api/admin/data') {
    const db = await readDb();
    return send(res, 200, { ...db, email: getAuth().email });
  }

  if (route === 'PUT /api/admin/content') {
    const { content } = await readJson(req);
    if (!content || typeof content !== 'object') return send(res, 400, { error: 'Нет данных' });
    const db = await readDb(); db.content = content; await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (route === 'PUT /api/admin/projects') {
    const { projects } = await readJson(req);
    if (!Array.isArray(projects)) return send(res, 400, { error: 'Нет данных' });
    const db = await readDb();
    db.projects = projects.map((p) => ({ ...p, id: p.id || crypto.randomUUID() }));
    await writeDb(db);
    return send(res, 200, { ok: true, projects: db.projects });
  }

  if (route === 'POST /api/admin/upload') {
    const { ext, file } = safeName(url.searchParams.get('name'));
    if (!UPLOAD_EXT.has(ext)) return send(res, 400, { error: `Формат ${ext || '?'} не поддерживается` });
    if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) return send(res, 413, { error: 'Файл слишком большой' });
    const dest = path.join(UPLOAD_DIR, file);
    try {
      await new Promise((resolve, reject) => {
        let size = 0;
        const out = fs.createWriteStream(dest);
        req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { req.unpipe(out); out.destroy(); reject(httpError(413, 'Файл слишком большой')); } });
        req.on('error', reject); req.on('aborted', () => reject(httpError(400, 'Загрузка прервана')));
        out.on('finish', resolve); out.on('error', reject);
        req.pipe(out);
      });
    } catch (e) { await fsp.rm(dest, { force: true }); throw e; }
    return send(res, 200, { ok: true, url: `/uploads/${file}`, name: file });
  }

  if (route === 'GET /api/admin/uploads') {
    const files = [];
    for (const name of await fsp.readdir(UPLOAD_DIR)) {
      if (name.startsWith('.')) continue;
      const st = await fsp.stat(path.join(UPLOAD_DIR, name));
      if (st.isFile()) files.push({ name, url: `/uploads/${name}`, size: st.size, time: st.mtimeMs });
    }
    files.sort((a, b) => b.time - a.time);
    return send(res, 200, { files });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/uploads/')) {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/api/admin/uploads/'.length)));
    if (name && !name.startsWith('.')) await fsp.rm(path.join(UPLOAD_DIR, name), { force: true });
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/admin/password') {
    const { current = '', email, next = '' } = await readJson(req);
    const auth = getAuth();
    if (!verifyPassword(current, auth)) return send(res, 400, { error: 'Текущий пароль неверный' });
    if (String(next).length < 8) return send(res, 400, { error: 'Новый пароль — минимум 8 символов' });
    const updated = { email: String(email || auth.email).trim().toLowerCase(), ...hashPassword(next), version: (auth.version || 1) + 1 };
    await fsp.writeFile(AUTH_FILE, JSON.stringify(updated), { mode: 0o600 });
    const token = sign({ email: updated.email, v: updated.version, exp: Date.now() + SESSION_HOURS * 3600e3 });
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_HOURS * 3600) });
  }

  return send(res, 404, { error: 'Not found' });
}

/* ------------------------------- server ------------------------------- */
ensureDirs();
const SECRET = getSecret();

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method Not Allowed');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/uploads/')) {
      if (!(await serveFile(req, res, UPLOAD_DIR, pathname.slice('/uploads/'.length), 'public, max-age=31536000, immutable'))) send(res, 404, 'Not found');
      return;
    }
    const rel = pathname === '/' ? 'index.html' : pathname === '/admin' || pathname === '/admin/' ? 'admin.html' : pathname;
    const cache = IS_PROD ? 'public, max-age=3600' : 'no-cache';
    if (!(await serveFile(req, res, PUBLIC_DIR, rel, cache))) await serveFile(req, res, PUBLIC_DIR, 'index.html', 'no-cache');
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Ошибка сервера' });
    else res.end();
  }
});

server.requestTimeout = 0; // большие видео могут грузиться долго
server.listen(PORT, () => {
  console.log(`✔ Сайт:    http://localhost:${PORT}\n✔ Админка: http://localhost:${PORT}/admin`);
  if (!getAuth()) console.warn('⚠ Задайте ADMIN_EMAIL и ADMIN_PASSWORD в .env — иначе вход в админку не заработает');
});
