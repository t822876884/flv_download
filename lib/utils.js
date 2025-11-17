// 通用工具函数集合：命名清理、URL 规范化、时间戳、协议判断、配置校验等
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 清理文件/标题中的非法字符
function sanitizeName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim();
}

// 去除包裹符与空白，规范化 URL 文本
function normalizeUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  const m = s.match(/https?:\/\/[^\s'"`]+/i);
  if (m && m[0]) return m[0];
  s = s.replace(/^`+|`+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
  return s;
}

// 在 http/https 之间切换协议（用于降级/升级重试）
function toggleHttpScheme(u) {
  try {
    const p = new URL(u);
    p.protocol = p.protocol === 'http:' ? 'https:' : (p.protocol === 'https:' ? 'http:' : p.protocol);
    return p.href;
  } catch (_) {
    return u;
  }
}

// 生成 YYYYMMDDhhmmss 字符串
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

// 是否为 http/https URL
function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// 是否为 rtmp URL
function isRtmpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'rtmp:';
  } catch (_) {
    return /^rtmp:\/\//i.test(String(u || ''));
  }
}

// 确保探索接口基础地址合法
function ensureBaseUrl(u) {
  let v = normalizeUrl(u || '');
  if (!v) v = 'http://api.hclyz.com:81/mf/';
  if (!/^https?:\/\//i.test(v)) v = 'http://api.hclyz.com:81/mf/';
  if (!v.endsWith('/')) v += '/';
  return v;
}

// 校验并限制调度时间间隔（1-60）
function ensureIntervalMinutes(v) {
  const n = parseInt(String(v || '10'), 10);
  if (isNaN(n)) return 10;
  return Math.max(1, Math.min(60, n));
}

module.exports = {
  sanitizeName,
  normalizeUrl,
  toggleHttpScheme,
  timestampString,
  isHttpUrl,
  isRtmpUrl,
  ensureBaseUrl,
  ensureIntervalMinutes,
  createPasswordHash(plain, iterations = 120000) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(String(plain), salt, iterations, 32, 'sha256');
    return `pbkdf2$${iterations}$${salt.toString('hex')}$${hash.toString('hex')}`;
  },
  verifyPassword(plain, encoded) {
    try {
      const [scheme, itStr, saltHex, hashHex] = String(encoded).split('$');
      if (scheme !== 'pbkdf2') return false;
      const iterations = parseInt(itStr, 10);
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = crypto.pbkdf2Sync(String(plain), salt, iterations, expected.length, 'sha256');
      return crypto.timingSafeEqual(actual, expected);
    } catch (_) { return false; }
  },
};
