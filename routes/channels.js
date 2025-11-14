const db = require('../db');

function registerChannels(app) {
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
    if (flag) db.togglePlatformFavorite(address, false);
    const row = db.getPlatform(address);
    res.json({ ok: true, address, blocked: row && row.blocked ? 1 : 0 });
  });

  app.post('/channel/favorite', (req, res) => {
    const title = String(req.body?.title || '');
    const address = req.body?.address ? String(req.body.address) : null;
    const flag = req.body && (req.body.favorite === 1 || req.body.favorite === '1' || req.body.favorite === true);
    if (!title) return res.status(400).json({ ok: false, message: '缺少 title' });
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
}

module.exports = { registerChannels };

