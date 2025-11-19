const axios = require('axios');
const db = require('../db');
const { ensureBaseUrl, ensureIntervalMinutes } = require('./utils');
const logger = require('./logger');

// 收藏频道地址同步调度器：周期性从平台列表刷新 title -> address 映射
let timer = null;
const log = logger.child({ scope: 'scheduler' });

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
      } catch (_) {}
    }
    favorites.forEach(f => {
      const t = String(f.title);
      const a = titleToAddr.get(t) || null;
      if (a) db.updateChannelAddressByTitle(t, a);
    });
  } catch (err) {
    log.error('channel-update', { err: err?.stack || String(err) });
  }
}

function startChannelUpdateScheduler() {
  const minutes = ensureIntervalMinutes(db.getSetting('poll_interval_minutes'));
  if (timer) clearInterval(timer);
  timer = setInterval(updateFavoriteChannelAddresses, minutes * 60 * 1000);
  updateFavoriteChannelAddresses();
}

function stopChannelUpdateScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startChannelUpdateScheduler, stopChannelUpdateScheduler, updateFavoriteChannelAddresses };
