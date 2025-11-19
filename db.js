const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(process.cwd(), 'tasks.sqlite3');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  save_dir TEXT NOT NULL,
  file_path TEXT,
  status TEXT NOT NULL, -- downloading | completed | cancelled | deleted | error
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,
  title TEXT,
  xinimg TEXT,
  number INTEGER,
  favorite INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT UNIQUE NOT NULL,
  address TEXT,
  favorite INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

try {
  const info = db.prepare("PRAGMA table_info('channel')").all();
  const hasOldCols = Array.isArray(info) && info.some(c => c.name === 'platform_address');
  if (hasOldCols) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT UNIQUE NOT NULL,
        address TEXT,
        favorite INTEGER DEFAULT 0,
        blocked INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const rows = db.prepare("SELECT title, address, favorite, blocked, created_at, updated_at FROM channel WHERE title IS NOT NULL ORDER BY updated_at DESC").all();
    const seen = new Set();
    const ins = db.prepare("INSERT INTO channel_new (title, address, favorite, blocked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    const now = new Date().toISOString();
    const txn = db.transaction(() => {
      rows.forEach(r => {
        const t = r.title || null;
        if (!t || seen.has(t)) return;
        seen.add(t);
        ins.run(t, r.address || null, r.favorite ? 1 : 0, r.blocked ? 1 : 0, r.created_at || now, r.updated_at || now);
      });
    });
    txn();
    db.exec("DROP TABLE channel");
    db.exec("ALTER TABLE channel_new RENAME TO channel");
  }
} catch (_) {}

const insertTask = db.prepare(`
  INSERT INTO tasks (id, title, url, save_dir, file_path, status, created_at, updated_at)
  VALUES (@id, @title, @url, @save_dir, @file_path, @status, @created_at, @updated_at)
`);

const updateStatus = db.prepare(`
  UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
`);

const updateFilePath = db.prepare(`
  UPDATE tasks SET file_path = ?, updated_at = ? WHERE id = ?
`);

const deleteTaskRow = db.prepare(`
  DELETE FROM tasks WHERE id = ?
`);

const getTaskByIdStmt = db.prepare(`
  SELECT * FROM tasks WHERE id = ?
`);

const hasDownloadingByTitleStmt = db.prepare(`
  SELECT 1 FROM tasks WHERE title = ? AND status = 'downloading' LIMIT 1
`);

const getDownloadingByTitleStmt = db.prepare(`
  SELECT id FROM tasks WHERE title = ? AND status = 'downloading' ORDER BY updated_at DESC LIMIT 1
`);

const countByStatusStmt = db.prepare(`
  SELECT COUNT(*) AS total FROM tasks WHERE status = ?
`);

const listByStatusStmt = db.prepare(`
  SELECT id, title, url, save_dir, file_path, status, created_at, updated_at
  FROM tasks
  WHERE status = ?
  ORDER BY created_at DESC
  LIMIT ? OFFSET ?
`);

// 统一列表：按时间倒序列出所有任务
const countAllStmt = db.prepare(`
  SELECT COUNT(*) AS total FROM tasks
`);
const listAllStmt = db.prepare(`
  SELECT id, title, url, save_dir, file_path, status, created_at, updated_at
  FROM tasks
  ORDER BY created_at DESC
  LIMIT ? OFFSET ?
`);

const getSettingStmt = db.prepare(`
  SELECT value FROM settings WHERE key = ?
`);
const setSettingStmt = db.prepare(`
  INSERT INTO settings (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

const upsertPlatformStmt = db.prepare(`
  INSERT INTO platform (address, title, xinimg, number, favorite, blocked, created_at, updated_at)
  VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  ON CONFLICT(address) DO UPDATE SET
    title = excluded.title,
    xinimg = excluded.xinimg,
    number = excluded.number,
    updated_at = excluded.updated_at
`);
const getPlatformStmt = db.prepare(`
  SELECT * FROM platform WHERE address = ?
`);
const togglePlatformFavoriteStmt = db.prepare(`
  UPDATE platform SET favorite = ?, updated_at = ? WHERE address = ?
`);
const togglePlatformBlockedStmt = db.prepare(`
  UPDATE platform SET blocked = ?, updated_at = ? WHERE address = ?
`);
const listPlatformFavoritesStmt = db.prepare(`
  SELECT address, title, xinimg, number FROM platform WHERE favorite = 1 ORDER BY updated_at DESC
`);
const listPlatformBlockedStmt = db.prepare(`
  SELECT address, title, xinimg, number FROM platform WHERE blocked = 1 ORDER BY updated_at DESC
`);
const listPlatformsStmt = db.prepare(`
  SELECT address, title, xinimg, number, favorite, blocked FROM platform ORDER BY id ASC
`);
const clearPlatformsStmt = db.prepare(`
  DELETE FROM platform
`);

const upsertChannelByTitleStmt = db.prepare(`
  INSERT INTO channel (title, address, favorite, blocked, created_at, updated_at)
  VALUES (?, ?, 0, 0, ?, ?)
  ON CONFLICT(title) DO UPDATE SET
    address = excluded.address,
    updated_at = excluded.updated_at
`);
const getChannelByTitleStmt = db.prepare(`
  SELECT * FROM channel WHERE title = ?
`);
const toggleChannelFavoriteByTitleStmt = db.prepare(`
  UPDATE channel SET favorite = ?, updated_at = ? WHERE title = ?
`);
const toggleChannelBlockedByTitleStmt = db.prepare(`
  UPDATE channel SET blocked = ?, updated_at = ? WHERE title = ?
`);
const updateChannelAddressByTitleStmt = db.prepare(`
  UPDATE channel SET address = ?, updated_at = ? WHERE title = ?
`);
const listChannelFavoritesStmt = db.prepare(`
  SELECT title, address FROM channel WHERE favorite = 1 ORDER BY updated_at DESC
`);
const listChannelBlockedStmt = db.prepare(`
  SELECT title, address FROM channel WHERE blocked = 1 ORDER BY updated_at DESC
`);
const listChannelsWithAddressStmt = db.prepare(`
  SELECT title, address FROM channel WHERE address IS NOT NULL ORDER BY updated_at DESC
`);
const listTopPlatformsUnblockedStmt = db.prepare(`
  SELECT address, title FROM platform WHERE blocked = 0 ORDER BY updated_at DESC LIMIT ?
`);

const clearAllChannelAddressesStmt = db.prepare(`
  UPDATE channel SET address = NULL, updated_at = ?
`);
const clearFavoriteChannelAddressesStmt = db.prepare(`
  UPDATE channel SET address = NULL, updated_at = ? WHERE favorite = 1
`);

module.exports = {
  insert(task) {
    insertTask.run(task);
  },
  setStatus(id, status) {
    updateStatus.run(status, new Date().toISOString(), id);
  },
  setFilePath(id, filePath) {
    updateFilePath.run(filePath, new Date().toISOString(), id);
  },
  deleteRow(id) {
    deleteTaskRow.run(id);
  },
  getById(id) {
    return getTaskByIdStmt.get(id);
  },
  hasDownloadingByTitle(title) {
    const r = hasDownloadingByTitleStmt.get(title);
    return !!r;
  },
  getDownloadingByTitle(title) {
    const r = getDownloadingByTitleStmt.get(title);
    return r ? r.id : null;
  },
  listByStatus(status, page = 1, pageSize = 10) {
    const p = Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1;
    const ps = Number.isFinite(Number(pageSize)) ? Math.floor(Number(pageSize)) : 10;
    const safePage = Math.max(1, p);
    const safePageSize = Math.max(1, ps);
    const total = countByStatusStmt.get(status).total;
    const offset = (safePage - 1) * safePageSize;
    const items = listByStatusStmt.all(status, safePageSize, offset);
    return { items, total, page: safePage, pageSize: safePageSize };
  },
  listAll(page = 1, pageSize = 10) {
    const p = Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1;
    const ps = Number.isFinite(Number(pageSize)) ? Math.floor(Number(pageSize)) : 10;
    const safePage = Math.max(1, p);
    const safePageSize = Math.max(1, ps);
    const total = countAllStmt.get().total;
    const offset = (safePage - 1) * safePageSize;
    const items = listAllStmt.all(safePageSize, offset);
    return { items, total, page: safePage, pageSize: safePageSize };
  },
  getSetting(key) {
    const r = getSettingStmt.get(key);
    return r ? r.value : null;
  },
  setSetting(key, value) {
    setSettingStmt.run(key, value, new Date().toISOString());
  },
  upsertPlatform(item) {
    upsertPlatformStmt.run(item.address, item.title || null, item.xinimg || null, item.number || null, new Date().toISOString(), new Date().toISOString());
  },
  getPlatform(address) {
    return getPlatformStmt.get(address);
  },
  togglePlatformFavorite(address, flag) {
    togglePlatformFavoriteStmt.run(flag ? 1 : 0, new Date().toISOString(), address);
  },
  togglePlatformBlocked(address, flag) {
    togglePlatformBlockedStmt.run(flag ? 1 : 0, new Date().toISOString(), address);
  },
  listPlatformFavorites() {
    return listPlatformFavoritesStmt.all();
  },
  listPlatformBlocked() {
    return listPlatformBlockedStmt.all();
  },
  listPlatforms() {
    return listPlatformsStmt.all();
  },
  clearPlatforms() {
    return clearPlatformsStmt.run();
  },
  upsertChannelByTitle(item) {
    upsertChannelByTitleStmt.run(item.title, item.address || null, new Date().toISOString(), new Date().toISOString());
  },
  getChannelByTitle(title) {
    return getChannelByTitleStmt.get(title);
  },
  toggleChannelFavoriteByTitle(title, flag) {
    toggleChannelFavoriteByTitleStmt.run(flag ? 1 : 0, new Date().toISOString(), title);
  },
  toggleChannelBlockedByTitle(title, flag) {
    toggleChannelBlockedByTitleStmt.run(flag ? 1 : 0, new Date().toISOString(), title);
  },
  updateChannelAddressByTitle(title, address) {
    updateChannelAddressByTitleStmt.run(address || null, new Date().toISOString(), title);
  },
  listChannelFavorites() {
    return listChannelFavoritesStmt.all();
  },
  listChannelBlocked() {
    return listChannelBlockedStmt.all();
  },
  listChannelsWithAddress() {
    return listChannelsWithAddressStmt.all();
  },
  listTopPlatformsUnblocked(limit) {
    return listTopPlatformsUnblockedStmt.all(limit);
  },
  clearAllChannelAddresses() {
    return clearAllChannelAddressesStmt.run(new Date().toISOString());
  },
  clearFavoriteChannelAddresses() {
    return clearFavoriteChannelAddressesStmt.run(new Date().toISOString());
  },
};