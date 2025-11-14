const axios = require('axios');
const db = require('../db');
const { ensureBaseUrl } = require('../lib/utils');

function registerExplore(app) {
  app.get('/platforms', (req, res) => {
    const rows = db.listPlatforms();
    const items = rows.filter((x) => x && x.address && !x.blocked);
    const favorites = db.listPlatformFavorites();
    const blocks = db.listPlatformBlocked();
    res.json({ ok: true, items, favorites, blocks });
  });

  app.post('/platforms/sync', async (req, res) => {
    try {
      const favs = db.listPlatformFavorites().map((p) => p.address);
      const blks = db.listPlatformBlocked().map((p) => p.address);
      db.clearPlatforms();
      const base = ensureBaseUrl(db.getSetting('explore_base_url'));
      const url = base + 'json.txt';
      const r = await axios.get(url, { timeout: 1000 * 20, validateStatus: (s) => s >= 200 && s < 400 });
      const data = r && r.data && typeof r.data === 'object' ? r.data : {};
      const list = Array.isArray(data.pingtai) ? data.pingtai : [];
      list.forEach((p) => {
        const address = String(p.address || '');
        db.upsertPlatform({ address, title: p.title || null, xinimg: p.xinimg || null, number: Number(p.Number || 0) });
        if (address) {
          if (favs.includes(address)) db.togglePlatformFavorite(address, true);
          if (blks.includes(address)) db.togglePlatformBlocked(address, true);
        }
      });
      const rows = db.listPlatforms();
      const items = rows.filter((x) => x && x.address && !x.blocked);
      res.json({ ok: true, count: items.length });
    } catch (err) {
      res.status(500).json({ ok: false, message: err?.message || String(err) });
    }
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
      if (req.log) req.log.error('explore-platforms-error', { err: err?.stack || String(err) });
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
      if (req.log) req.log.error('explore-channel-error', { err: err?.stack || String(err) });
      res.status(500).json({ ok: false, message: err?.message || String(err) });
    }
  });
}

module.exports = { registerExplore };

