const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../db');
const { createPasswordHash, verifyPassword } = require('../lib/utils');

const DEFAULT_USER = 'flvAdmin';
const DEFAULT_PASS = 'Llyscysykr01!';
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
  const allow = new Set(['/auth/login', '/auth/logout', '/login', '/login.html', '/auth/me', '/download', '/download/parse']);
  const pathname = (req.path || '').trim() || (req.url ? String(req.url).split('?')[0] : '');
  const p = String(pathname || '').toLowerCase();
  if (allow.has(p) || p.startsWith('/auth/') || p.startsWith('/download') ) return next();
  if (req.method === 'OPTIONS') return next();
  const ck = parseCookies(req.headers.cookie || '');
  const sid = ck.sid || '';
  let sess = sid ? sessions.get(sid) : null;
  if (!sess) {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) sess = sessions.get(token) || null;
  }
  if (sess && sess.exp > Date.now()) return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect('/login');
  }
  return res.status(401).json({ ok: false, message: '未登录' });
}

// 注册认证相关路由
function registerAuth(app) {
  (function ensureAdminCreds() {
    try {
      let user = db.getSetting('admin_username');
      let pass = db.getSetting('admin_password');
      let needsReset = db.getSetting('admin_needs_reset');
      const now = new Date().toISOString();
      if (!user || !pass) {
        user = DEFAULT_USER;
        pass = createPasswordHash(DEFAULT_PASS);
        db.setSetting('admin_username', user);
        db.setSetting('admin_password', pass);
        db.setSetting('admin_needs_reset', '1');
      } else if (needsReset == null) {
        db.setSetting('admin_needs_reset', '0');
      }
    } catch (err) {
      log.error('ensure-admin-creds', { err: err?.stack || String(err) });
    }
  })();

  app.post('/auth/login', (req, res) => {
    const u = String(req.body?.username || '');
    const p = String(req.body?.password || '');
    const dbUser = db.getSetting('admin_username') || DEFAULT_USER;
    const dbPass = db.getSetting('admin_password');
    const needsReset = db.getSetting('admin_needs_reset') === '1';
    if (u === dbUser && dbPass && verifyPassword(p, dbPass)) {
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, { exp: Date.now() + 2 * 60 * 60 * 1000 });
      res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
      return res.json({ ok: true, token: sid, require_change: needsReset ? 1 : 0 });
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

  app.post('/auth/change_password', (req, res) => {
    const ck = parseCookies(req.headers.cookie || '');
    const sid = ck.sid || '';
    let sess = sid ? sessions.get(sid) : null;
    if (!sess) {
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token) sess = sessions.get(token) || null;
    }
    if (!sess || sess.exp <= Date.now()) return res.status(401).json({ ok: false, message: '未登录' });
    const oldPassword = String(req.body?.old_password || '');
    const newPassword = String(req.body?.new_password || '');
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ ok: false, message: '新密码长度至少 8 位' });
    }
    const dbUser = db.getSetting('admin_username') || DEFAULT_USER;
    const dbPass = db.getSetting('admin_password');
    if (!dbPass || !verifyPassword(oldPassword, dbPass)) {
      return res.status(400).json({ ok: false, message: '原密码错误' });
    }
    const encoded = createPasswordHash(newPassword);
    db.setSetting('admin_password', encoded);
    db.setSetting('admin_needs_reset', '0');
    return res.json({ ok: true });
  });

  app.get('/auth/me', (req, res) => {
    const ck = parseCookies(req.headers.cookie || '');
    const sid = ck.sid || '';
    let sess = sid ? sessions.get(sid) : null;
    if (!sess) {
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token) sess = sessions.get(token) || null;
    }
    if (sess && sess.exp > Date.now()) {
      return res.json({ ok: true });
    }
    return res.status(401).json({ ok: false, message: '未登录' });
  });
}

module.exports = { registerAuth, authGuard };
