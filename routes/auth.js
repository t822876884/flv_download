const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../lib/logger');

// 简易认证：固定管理员凭证 + 会话 Cookie
const ADMIN_USER = 'flvAdmin';
const ADMIN_PASS = 'Llyscysykr01!';
const sessions = new Map();
const log = logger.child({ scope: 'auth' });

function parseCookies(str) {
  const out = {};
  if (!str) return out;
  String(str).split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// 保护除认证与登录页外的所有路由
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

// 注册认证相关路由
function registerAuth(app) {
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
}

module.exports = { registerAuth, authGuard };
