// 顶部：增加 db 与静态目录挂载
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('uncaughtExceptionMonitor', (err) => {
  console.error('[uncaughtExceptionMonitor]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.error('[signal]', sig);
    process.exit(0);
  });
});
process.on('exit', (code) => {
  console.error('[exit]', code);
});

axios.interceptors.response.use(
  (r) => r,
  (e) => {
    const m = e && e.config && e.config.method ? String(e.config.method).toUpperCase() : '-';
    const u = e && e.config && e.config.url ? e.config.url : '-';
    console.error('[axios]', m, u, e && e.stack ? e.stack : e);
    return Promise.reject(e);
  }
);

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const rid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  req.rid = rid;
  console.log('[request]', rid, req.method, req.originalUrl);
  res.on('finish', () => {
    console.log('[response]', rid, res.statusCode, (Date.now() - start) + 'ms');
  });
  next();
});

const ADMIN_USER = 'flvAdmin';
const ADMIN_PASS = 'Llyscysykr01!';
const sessions = new Map();

function parseCookies(str) {
  const out = {};
  if (!str) return out;
  String(str).split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function authGuard(req, res, next) {
  const allow = ['/auth/login', '/auth/logout', '/login', '/login.html'];
  if (allow.includes(req.path)) return next();
  const ck = parseCookies(req.headers.cookie || '');
  const sid = ck.sid || '';
  const sess = sid ? sessions.get(sid) : null;
  if (sess && sess.exp > Date.now()) return next();
  if (req.method === 'GET') {
    const p = path.join(process.cwd(), 'public', 'login.html');
    return fs.existsSync(p) ? res.sendFile(p) : res.status(401).send('未登录');
  }
  return res.status(401).json({ ok: false, message: '未登录' });
}

app.post('/auth/login', (req, res) => {
  const u = String(req.body?.username || '');
  const p = String(req.body?.password || '');
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { exp: Date.now() + 2 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, message: '用户名或密码错误' });
});

app.post('/auth/logout', (req, res) => {
  const ck = parseCookies(req.headers.cookie || '');
  const sid = ck.sid || '';
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/login', (req, res) => {
  const p = path.join(process.cwd(), 'public', 'login.html');
  res.sendFile(p);
});

app.use(authGuard);
app.use(express.static(path.join(process.cwd(), 'public')));

// 基础存储目录（可通过环境变量覆盖）
const BASE_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : process.cwd();
fs.mkdirSync(BASE_DIR, { recursive: true });

const activeDownloads = new Map();

function sanitizeName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(raw) {
  if (!raw) return '';
  let u = String(raw).trim();
  u = u.replace(/^`+|`+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
  return u;
}

function toggleHttpScheme(u) {
  try {
    const p = new URL(u);
    p.protocol = p.protocol === 'http:' ? 'https:' : (p.protocol === 'https:' ? 'http:' : p.protocol);
    return p.href;
  } catch (_) {
    return u;
  }
}

function timestampString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${Y}${M}${D}${h}${m}${s}`;
}

// 新增：通用校验与启动函数
function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isRtmpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'rtmp:';
  } catch (_) {
    return /^rtmp:\/\//i.test(String(u || ''));
  }
}

function startDownload(title, url) {
  const folderPath = path.resolve(BASE_DIR, title);
  fs.mkdirSync(folderPath, { recursive: true });

  const id = `${title}${timestampString()}`;
  const filename = `${title}${timestampString()}.flv`;
  const filePath = path.join(folderPath, filename);

  db.insert({
    id,
    title,
    url,
    save_dir: folderPath,
    file_path: filePath,
    status: 'downloading',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const writer = fs.createWriteStream(filePath);
  const controller = new AbortController();

  activeDownloads.set(title, {
    id,
    title,
    url,
    folderPath,
    filePath,
    startedAt: new Date().toISOString(),
    writer,
    controller,
  });

  const cleanupOnError = (err) => {
    activeDownloads.delete(title);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
    db.setStatus(id, 'error');
    console.error('[download-error]', id, title, err && err.stack ? err.stack : err);
  };

  const tryGet = (u, attempt = 0) => {
    return axios
      .get(u, {
        responseType: 'stream',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 1000 * 60 * 5,
        signal: controller.signal,
        validateStatus: (status) => status >= 200 && status < 400,
      })
      .then((response) => {
        response.data.pipe(writer);

        writer.on('finish', () => {
          activeDownloads.delete(title);
          db.setStatus(id, 'completed');
          db.setFilePath(id, filePath);
        });

        writer.on('error', cleanupOnError);
        response.data.on('error', cleanupOnError);
      })
      .catch((err) => {
        const msg = String(err?.message || '');
        if (attempt === 0 && /protocol/i.test(msg)) {
          try {
            const alt = toggleHttpScheme(u);
            return tryGet(alt, 1);
          } catch (_) {}
        }
        cleanupOnError(err);
      });
  };

  tryGet(url);

  return { id, folderPath, filename, filePath };
}

// 修改下载接口：写入 SQLite，记录唯一 id 与状态
app.post('/download', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const rawTitle = req.body?.title;
    const title = sanitizeName(rawTitle);

    if (!url || !title || !isHttpUrl(url)) {
      return res.status(400).json({ ok: false, message: '缺少必填参数或 URL 非 http/https' });
    }

    if (activeDownloads.has(title)) {
      return res.status(200).json({
        ok: true,
        message: '同名下载任务正在进行，已跳过',
        task: { title, url },
      });
    }

    const task = startDownload(title, url);
    return res.status(202).json({
      ok: true,
      message: '下载任务已启动',
      task: { id: task.id, title, url, folderPath: task.folderPath, filename: task.filename, filePath: task.filePath },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: '下载任务启动失败',
      error: err?.message || String(err),
    });
  }
});

// 新增：解析 ffmpeg 风格文本并发起下载（独立入口）
app.post('/download/parse', express.text({ type: ['text/plain', 'text/*', 'application/octet-stream'] }), (req, res) => {
  try {
    const input = typeof req.body === 'string' && req.body.trim()
      ? req.body
      : (req.body && req.body.text) || '';

    if (!input || typeof input !== 'string') {
      return res.status(400).json({ ok: false, message: '缺少文本内容' });
    }

    // 提取 URL
    const urlMatch = input.match(/https?:\/\/[^\s'"`]+/i);
    const rawUrl = urlMatch ? urlMatch[0] : '';
    const url = normalizeUrl(rawUrl);

    // 提取标题：优先 ffmpeg 之前的前缀；其次输出文件名中的标题；最后从 URL 推断
    let titleCandidate = '';
    const beforeFfmpeg = input.split(/ffmpeg/i)[0].trim();
    if (beforeFfmpeg) {
      titleCandidate = beforeFfmpeg;
    } else {
      const outMatch = input.match(/\.\/([^\/\\\s]+?)(\d{8,})\.flv/i);
      if (outMatch && outMatch[1]) {
        titleCandidate = outMatch[1];
      }
    }
    if (!titleCandidate && url) {
      try {
        const u = new URL(url);
        const base = (u.pathname.split('/').pop() || '').replace(/\.flv$/i, '');
        // 去掉末尾纯数字时间戳
        titleCandidate = base.replace(/\d{8,}$/, '') || base;
      } catch (_) {}
    }
    let title = sanitizeName(titleCandidate) || '视频';

    if (!url || !isHttpUrl(url) || !title) {
      return res.status(400).json({ ok: false, message: '无法从文本中解析到有效的 URL/标题' });
    }

    if (activeDownloads.has(title)) {
      return res.status(200).json({
        ok: true,
        message: '同名下载任务正在进行，已跳过',
        task: { title, url },
      });
    }

    const task = startDownload(title, url);
    return res.status(202).json({
      ok: true,
      message: '解析成功并已启动下载',
      task: { id: task.id, title, url, folderPath: task.folderPath, filename: task.filename, filePath: task.filePath },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: '解析或启动失败', error: err?.message || String(err) });
  }
});

function ensureBaseUrl(u) {
  let v = normalizeUrl(u || '');
  if (!v) v = 'http://api.hclyz.com:81/mf/';
  if (!/^https?:\/\//i.test(v)) v = 'http://api.hclyz.com:81/mf/';
  if (!v.endsWith('/')) v += '/';
  return v;
}

function ensureIntervalMinutes(v) {
  const n = parseInt(String(v || '1'), 10);
  if (isNaN(n)) return 1;
  return Math.max(1, Math.min(60, n));
}

app.get('/config/explore_base_url', (req, res) => {
  const v = db.getSetting('explore_base_url');
  const base = ensureBaseUrl(v);
  res.json({ ok: true, value: base });
});

app.post('/config/explore_base_url', (req, res) => {
  const raw = req.body && req.body.value;
  const base = ensureBaseUrl(raw);
  db.setSetting('explore_base_url', base);
  res.json({ ok: true, value: base });
});

app.get('/config/poll_interval_minutes', (req, res) => {
  const v = db.getSetting('poll_interval_minutes');
  const n = ensureIntervalMinutes(v);
  res.json({ ok: true, value: n });
});

app.post('/config/poll_interval_minutes', (req, res) => {
  const raw = req.body && req.body.value;
  const n = ensureIntervalMinutes(raw);
  db.setSetting('poll_interval_minutes', String(n));
  res.json({ ok: true, value: n });
  startChannelUpdateScheduler();
});

app.get('/explore/platforms', async (req, res) => {
  try {
    const base = ensureBaseUrl(db.getSetting('explore_base_url'));
    const url = base + 'json.txt';
    const r = await axios.get(url, { timeout: 1000 * 20, validateStatus: (s) => s >= 200 && s < 400 });
    const data = r && r.data && typeof r.data === 'object' ? r.data : {};
    const list = Array.isArray(data.pingtai) ? data.pingtai : [];
    list.forEach((p) => {
      db.upsertPlatform({ address: String(p.address || ''), title: p.title || null, xinimg: p.xinimg || null, number: Number(p.Number || 0) });
    });
    const items = list.map((p) => {
      const row = db.getPlatform(String(p.address || '')) || {};
      return { address: String(p.address || ''), title: p.title || null, xinimg: p.xinimg || null, number: Number(p.Number || 0), favorite: row.favorite ? 1 : 0, blocked: row.blocked ? 1 : 0 };
    }).filter((x) => x.address && !x.blocked);
    const favorites = db.listPlatformFavorites();
    const blocks = db.listPlatformBlocked();
    res.json({ ok: true, items, favorites, blocks });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

app.get('/explore/channel', async (req, res) => {
  try {
    const platformAddress = String(req.query.address || '');
    if (!platformAddress) return res.status(400).json({ ok: false, message: '缺少 address' });
    const base = ensureBaseUrl(db.getSetting('explore_base_url'));
    const url = base + platformAddress;
    const r = await axios.get(url, { timeout: 1000 * 20, validateStatus: (s) => s >= 200 && s < 400 });
    const data = r && r.data && typeof r.data === 'object' ? r.data : {};
    const list = Array.isArray(data.zhubo) ? data.zhubo : [];
    const items = list.map((c) => {
      const row = c.title ? db.getChannelByTitle(String(c.title)) || {} : {};
      return { platform_address: platformAddress, address: String(c.address || ''), title: c.title || null, img: c.img || null, favorite: row.favorite ? 1 : 0, blocked: row.blocked ? 1 : 0 };
    }).filter((x) => x.address && !x.blocked);
    const pRow = db.getPlatform(platformAddress) || {};
    const platform_title = pRow && pRow.title ? pRow.title : null;
    const favorites = db.listChannelFavorites();
    const blocks = db.listChannelBlocked();
    res.json({ ok: true, platform_address: platformAddress, platform_title, items, favorites, blocks });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

app.post('/platform/:address/favorite', (req, res) => {
  const address = String(req.params.address || '');
  const flag = req.body && (req.body.favorite === 1 || req.body.favorite === '1' || req.body.favorite === true);
  if (!address) return res.status(400).json({ ok: false, message: '缺少 address' });
  db.togglePlatformFavorite(address, flag);
  const row = db.getPlatform(address);
  res.json({ ok: true, address, favorite: row && row.favorite ? 1 : 0 });
});

app.post('/platform/:address/blocked', (req, res) => {
  const address = String(req.params.address || '');
  const flag = req.body && (req.body.blocked === 1 || req.body.blocked === '1' || req.body.blocked === true);
  if (!address) return res.status(400).json({ ok: false, message: '缺少 address' });
  db.togglePlatformBlocked(address, flag);
  if (flag) {
    db.togglePlatformFavorite(address, false);
  }
  const row = db.getPlatform(address);
  res.json({ ok: true, address, blocked: row && row.blocked ? 1 : 0 });
});

app.post('/channel/favorite', (req, res) => {
  const title = String(req.body?.title || '');
  const address = req.body?.address ? String(req.body.address) : null;
  const flag = req.body && (req.body.favorite === 1 || req.body.favorite === '1' || req.body.favorite === true);
  if (!title) return res.status(400).json({ ok: false, message: '缺少 title' });
  const now = new Date().toISOString();
  const row = db.getChannelByTitle(title);
  if (!row) db.upsertChannelByTitle({ title, address });
  if (address) db.updateChannelAddressByTitle(title, address);
  db.toggleChannelFavoriteByTitle(title, flag);
  const ret = db.getChannelByTitle(title);
  res.json({ ok: true, title, address: ret?.address || null, favorite: ret?.favorite ? 1 : 0 });
});

app.post('/channel/blocked', (req, res) => {
  const title = String(req.body?.title || '');
  const flag = req.body && (req.body.blocked === 1 || req.body.blocked === '1' || req.body.blocked === true);
  if (!title) return res.status(400).json({ ok: false, message: '缺少 title' });
  const row = db.getChannelByTitle(title);
  if (!row) db.upsertChannelByTitle({ title, address: null });
  db.toggleChannelBlockedByTitle(title, flag);
  if (flag) db.toggleChannelFavoriteByTitle(title, false);
  const ret = db.getChannelByTitle(title);
  res.json({ ok: true, title, blocked: ret?.blocked ? 1 : 0 });
});

app.get('/channels/favorites', (req, res) => {
  const rows = db.listChannelFavorites();
  res.json({ ok: true, items: rows });
});

app.get('/channels/blocked', (req, res) => {
  const rows = db.listChannelBlocked();
  res.json({ ok: true, items: rows });
});

// 预留的播放接口占位
app.get('/play', (req, res) => {
  res.status(501).json({ ok: false, message: '播放接口尚未实现' });
});

// 新增：播放接口（本地文件按 Range 流式；下载中跳转用 /proxy）
app.get('/play/:id', (req, res) => {
  const id = req.params.id;
  const task = db.getById(id);
  if (!task) return res.status(404).send('任务不存在');

  if (task.status !== 'completed' || !task.file_path || !fs.existsSync(task.file_path)) {
    return res.status(400).send('任务未完成或文件不存在');
  }

  const stat = fs.statSync(task.file_path);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const file = fs.createReadStream(task.file_path, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/x-flv',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/x-flv',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(task.file_path).pipe(res);
  }
});

// 新增：远程 FLV 代理（用于“下载中”的播放）
app.get('/proxy', async (req, res) => {
  const raw = req.query.url;
  const url = normalizeUrl(raw);
  if (!url) return res.status(400).send('缺少 url');

  const http = require('http');
  const https = require('https');
  const httpAgent = new http.Agent({ keepAlive: true });
  const httpsAgent = new https.Agent({ keepAlive: true });
  const controller = new AbortController();
  let closed = false;
  const ua = 'Mozilla/5.0';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/x-flv');
  res.setHeader('Cache-Control', 'no-store');

  req.on('close', () => { closed = true; try { controller.abort(); } catch (_) {} });
  res.on('close', () => { closed = true; try { controller.abort(); } catch (_) {} });

  const maxAttempts = 3;
  const baseDelay = 800;

  async function fetchOnce(u) {
    return axios.get(u, {
      responseType: 'stream',
      timeout: 1000 * 60 * 2,
      signal: controller.signal,
      headers: { 'User-Agent': ua, Accept: '*/*', Connection: 'keep-alive' },
      httpAgent,
      httpsAgent,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
  }

  async function tryStream(u, attempt) {
    try {
      const r = await fetchOnce(u);
      if (closed) return;
      r.data.on('error', async (e) => {
        if (closed) return;
        if (attempt + 1 < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((ok) => setTimeout(ok, delay));
          tryStream(u, attempt + 1);
        } else {
          try { res.status(502).end('代理失败'); } catch (_) {}
        }
      });
      r.data.pipe(res);
    } catch (err) {
      const msg = String(err?.message || '');
      if (attempt === 0 && /protocol/i.test(msg)) {
        try {
          const alt = toggleHttpScheme(u);
          return tryStream(alt, attempt + 1);
        } catch (_) {}
      }
      if (attempt + 1 < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((ok) => setTimeout(ok, delay));
        return tryStream(u, attempt + 1);
      }
      try { res.status(500).end(`代理失败: ${err?.message || err}`); } catch (_) {}
    }
  }

  tryStream(url, 0);
});

// 新增：RTMP → HTTP-FLV 实时转发，用于浏览器播放
app.get('/proxy-rtmp', async (req, res) => {
  const raw = req.query.url;
  const url = normalizeUrl(raw);
  if (!url || !isRtmpUrl(url)) return res.status(400).send('缺少 rtmp:// URL');

  res.setHeader('Content-Type', 'video/x-flv');
  res.setHeader('Transfer-Encoding', 'chunked');

  const { spawn } = require('child_process');
  // 直接复制音视频并封装为 FLV；若源编码浏览器不支持，可改为转码
  const ff = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-rtmp_transport', 'tcp',
    '-rtmp_live', 'live',
    '-i', url,
    '-fflags', '+genpts',
    '-re',
    '-analyzeduration', '0',
    '-probesize', '8192',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-ar', '44100',
    '-f', 'flv',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let started = false;
  ff.stdout.on('data', (chunk) => {
    if (!started) { started = true; }
    res.write(chunk);
  });
  ff.stderr.on('data', (buf) => { try { console.error('[proxy-rtmp]', String(buf)); } catch (_) {} });
  ff.on('close', (code) => {
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    try { res.end(); } catch (_) {}
  });
  ff.on('error', (err) => {
    try { res.status(500).send('ffmpeg 不可用或启动失败: ' + (err?.message || String(err))); } catch (_) {}
  });
  req.on('close', () => { try { ff.kill('SIGINT'); } catch (_) {} });
});

// 新增：取消下载（按 title 取消），并清理已下载的部分文件
app.post('/cancel', (req, res) => {
  // 支持按 id 或 title 取消，优先 id（更精确）
  const id = req.body?.id ? String(req.body.id).trim() : '';
  const rawTitle = req.body?.title;
  const titleInBody = rawTitle ? sanitizeName(rawTitle) : '';

  let title = titleInBody;

  if (id) {
    const t = db.getById(id);
    if (!t) {
      return res.status(404).json({ ok: false, message: '未找到该任务 id' });
    }
    if (t.status !== 'downloading') {
      return res.status(400).json({ ok: false, message: '仅可取消 status=downloading 的任务' });
    }
    title = sanitizeName(t.title);
  }

  if (!title) return res.status(400).json({ ok: false, message: '缺少 id 或 title' });

  const task = activeDownloads.get(title);
  if (!task) return res.status(404).json({ ok: false, message: '未找到进行中的同名任务' });

  try {
    task.controller.abort();
    try { task.writer.destroy(); } catch (_) {}
    try { if (fs.existsSync(task.filePath)) fs.unlinkSync(task.filePath); } catch (_) {}

    activeDownloads.delete(title);
    db.setStatus(task.id, 'cancelled');

    return res.json({ ok: true, message: '已取消下载并删除临时文件', taskId: task.id });
  } catch (err) {
    return res.status(500).json({ ok: false, message: '取消失败', error: err?.message || String(err) });
  }
});

// 新增：删除已完成任务文件
app.post('/delete', (req, res) => {
  const id = req.body?.id;
  if (!id) return res.status(400).json({ ok: false, message: '缺少 id' });

  const task = db.getById(id);
  if (!task) return res.status(404).json({ ok: false, message: '任务不存在' });
  if (task.status !== 'completed') {
    return res.status(400).json({ ok: false, message: '仅可删除 status=completed 的任务' });
  }

  try {
    if (task.file_path && fs.existsSync(task.file_path)) {
      fs.unlinkSync(task.file_path);
    }
    db.setStatus(id, 'deleted');
    res.json({ ok: true, message: '已删除文件', id });
  } catch (err) {
    res.status(500).json({ ok: false, message: '删除失败', error: err?.message || String(err) });
  }
});

// 新增：任务列表查询（支持 status=downloading | completed）
app.get('/tasks', (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '10', 10);

    const allowed = ['downloading', 'completed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: 'status must be downloading or completed' });
    }

    const result = db.listByStatus(status, page, pageSize);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'query failed', error: err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 3180;
app.use((err, req, res, next) => {
  const rid = req && req.rid ? req.rid : '-';
  console.error('[route-error]', rid, req.method, req.originalUrl, err && err.stack ? err.stack : err);
  res.status(500).json({ ok: false, message: 'internal error' });
});
app.listen(PORT, () => {
  console.log(`Video server listening on http://localhost:${PORT}`);
});
function ensureBaseUrl(v) {
  const def = 'http://api.hclyz.com:81/mf/';
  let s = String(v || def).trim();
  if (!s) s = def;
  if (!s.endsWith('/')) s += '/';
  return s;
}

function ensureIntervalMinutes(v) {
  const n = parseInt(String(v || '10'), 10);
  if (isNaN(n)) return 10;
  return Math.max(1, Math.min(60, n));
}

let channelUpdateTimer = null;
async function updateFavoriteChannelAddresses() {
  try {
    try { db.clearFavoriteChannelAddresses(); } catch (_) {}
    const favorites = db.listChannelFavorites();
    if (!favorites || favorites.length === 0) return;
    const favPlatforms = db.listPlatformFavorites();
    let platforms = favPlatforms && favPlatforms.length > 0
      ? favPlatforms.map(p => ({ address: p.address, title: p.title }))
      : db.listTopPlatformsUnblocked(5);
    if (!platforms || platforms.length === 0) return;
    const base = ensureBaseUrl(db.getSetting('explore_base_url'));
    const titleToAddr = new Map();
    for (const p of platforms) {
      try {
        const url = base + String(p.address || '');
        const r = await axios.get(url, { timeout: 1000 * 20, validateStatus: (s) => s >= 200 && s < 400 });
        const data = r && r.data && typeof r.data === 'object' ? r.data : {};
        const list = Array.isArray(data.zhubo) ? data.zhubo : [];
        list.forEach((c) => {
          if (c && c.title) {
            const t = String(c.title);
            const a = c.address ? String(c.address) : null;
            if (a && !titleToAddr.has(t)) titleToAddr.set(t, a);
          }
        });
      } catch (e) {}
    }
    favorites.forEach(f => {
      const t = String(f.title);
      const a = titleToAddr.get(t) || null;
      if (a) {
        db.updateChannelAddressByTitle(t, a);
      }
    });
  } catch (err) {
    console.error('[channel-update]', err?.stack || err);
  }
}

function startChannelUpdateScheduler() {
  const minutes = ensureIntervalMinutes(db.getSetting('poll_interval_minutes'));
  if (channelUpdateTimer) clearInterval(channelUpdateTimer);
  channelUpdateTimer = setInterval(updateFavoriteChannelAddresses, minutes * 60 * 1000);
  // 立即执行一次，确保首页初始数据
  updateFavoriteChannelAddresses();
}

startChannelUpdateScheduler();
