const db = require('../db');
const { ensureBaseUrl, ensureIntervalMinutes } = require('../lib/utils');
const { startChannelUpdateScheduler } = require('../lib/scheduler');

function registerConfig(app) {
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
}

module.exports = { registerConfig };

