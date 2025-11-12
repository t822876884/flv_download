// 顶部：增加 db 与静态目录挂载
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
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
    console.error(`下载失败: ${title}`, err?.message || err);
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

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 1000 * 60 * 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    res.setHeader('Content-Type', 'video/x-flv');
    res.setHeader('Access-Control-Allow-Origin', '*');
    response.data.pipe(res);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/protocol/i.test(msg)) {
      try {
        const alt = toggleHttpScheme(url);
        const response = await axios.get(alt, {
          responseType: 'stream',
          timeout: 1000 * 60 * 5,
          validateStatus: (s) => s >= 200 && s < 400,
        });
        res.setHeader('Content-Type', 'video/x-flv');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return response.data.pipe(res);
      } catch (_) {}
    }
    res.status(500).send(`代理失败: ${err?.message || err}`);
  }
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
app.listen(PORT, () => {
  console.log(`Video server listening on http://localhost:${PORT}`);
});