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

// 修改下载接口：写入 SQLite，记录唯一 id 与状态
app.post('/download', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const rawTitle = req.body?.title;
    const title = sanitizeName(rawTitle);

    if (!url || !title) {
      return res.status(400).json({ ok: false, message: '缺少必填参数：url 或 title' });
    }

    if (activeDownloads.has(title)) {
      return res.status(200).json({
        ok: true,
        message: '同名下载任务正在进行，已跳过',
        task: { title, url },
      });
    }

    // 使用可配置的 BASE_DIR
    const folderPath = path.resolve(BASE_DIR, title);
    fs.mkdirSync(folderPath, { recursive: true });

    const id = `${title}${timestampString()}`;
    const filename = `${title}${timestampString()}.flv`;
    const filePath = path.join(folderPath, filename);

    // 预写入任务到 DB
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

    const response = await axios.get(url, {
      responseType: 'stream',
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 1000 * 60 * 5,
      signal: controller.signal,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    response.data.pipe(writer);

    writer.on('finish', () => {
      activeDownloads.delete(title);
      db.setStatus(id, 'completed');
      db.setFilePath(id, filePath);
    });

    const cleanupOnError = (err) => {
      activeDownloads.delete(title);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
      db.setStatus(id, 'error');
      console.error(`下载失败: ${title}`, err?.message || err);
    };

    writer.on('error', cleanupOnError);
    response.data.on('error', cleanupOnError);

    return res.status(202).json({
      ok: true,
      message: '下载任务已启动',
      task: { id, title, url, folderPath, filename, filePath },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: '下载任务启动失败',
      error: err?.message || String(err),
    });
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
    res.status(500).send(`代理失败: ${err?.message || err}`);
  }
});

// 新增：取消下载（按 title 取消），并清理已下载的部分文件
app.post('/cancel', (req, res) => {
  const title = sanitizeName(req.body?.title);
  if (!title) return res.status(400).json({ ok: false, message: '缺少 title' });
  const task = activeDownloads.get(title);
  if (!task) return res.status(404).json({ ok: false, message: '未找到进行中的同名任务' });

  try {
    task.controller.abort();
    try {
      task.writer.destroy();
    } catch (_) {}
    try {
      if (fs.existsSync(task.filePath)) fs.unlinkSync(task.filePath);
    } catch (_) {}
    activeDownloads.delete(title);
    db.setStatus(task.id, 'cancelled');

    res.json({ ok: true, message: '已取消下载并删除临时文件', taskId: task.id });
  } catch (err) {
    res.status(500).json({ ok: false, message: '取消失败', error: err?.message || String(err) });
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

const PORT = process.env.PORT || 3180;
app.listen(PORT, () => {
  console.log(`Video server listening on http://localhost:${PORT}`);
});