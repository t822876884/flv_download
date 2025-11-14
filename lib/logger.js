const fs = require('fs');
const path = require('path');

// 轻量日志框架：按级别输出到 console 与每日滚动文件（logs/app-YYYYMMDD.log）
const LEVELS = { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10 };
const levelName = process.env.LOG_LEVEL ? String(process.env.LOG_LEVEL).toLowerCase() : 'info';
const LEVEL = LEVELS[levelName] || LEVELS.info;

// 按日期创建日志文件写入流（追加模式）
function ensureLogStream() {
  const dir = path.resolve(process.cwd(), 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const file = `app-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`;
  const p = path.join(dir, file);
  const stream = fs.createWriteStream(p, { flags: 'a' });
  return stream;
}

let stream = ensureLogStream();

function ts() {
  return new Date().toISOString();
}

// 写一条结构化日志；obj 可传入上下文（如 rid、err 等）
function write(level, msg, obj) {
  if (LEVELS[level] < LEVEL) return;
  const line = JSON.stringify({ time: ts(), level, msg, ...(obj || {}) }) + '\n';
  try { stream.write(line); } catch (_) {}
  try {
    const text = `[${level}] ${msg}` + (obj && obj.err ? `\n${obj.err}` : '');
    if (level === 'error' || level === 'fatal') {
      console.error(text);
    } else {
      console.log(text);
    }
  } catch (_) {}
}

// 创建带绑定字段的子 logger（如 scope、rid 等）
function child(bindings = {}) {
  return {
    fatal: (msg, obj) => write('fatal', msg, { ...bindings, ...(obj || {}) }),
    error: (msg, obj) => write('error', msg, { ...bindings, ...(obj || {}) }),
    warn: (msg, obj) => write('warn', msg, { ...bindings, ...(obj || {}) }),
    info: (msg, obj) => write('info', msg, { ...bindings, ...(obj || {}) }),
    debug: (msg, obj) => write('debug', msg, { ...bindings, ...(obj || {}) }),
    trace: (msg, obj) => write('trace', msg, { ...bindings, ...(obj || {}) }),
  };
}

// Express 请求日志中间件：在 req.log 中挂载子 logger
function requestLogger() {
  return (req, res, next) => {
    const rid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const log = child({ rid, method: req.method, url: req.originalUrl });
    req.rid = rid;
    req.log = log;
    const start = Date.now();
    log.info('request');
    res.on('finish', () => {
      log.info('response', { statusCode: res.statusCode, duration_ms: Date.now() - start });
    });
    next();
  };
}

module.exports = { child, requestLogger, write };
