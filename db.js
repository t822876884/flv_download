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
  platform_address TEXT NOT NULL,
  address TEXT NOT NULL,
  title TEXT,
  img TEXT,
  favorite INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform_address, address)
);
`);

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

const upsertChannelStmt = db.prepare(`
  INSERT INTO channel (platform_address, address, title, img, favorite, blocked, created_at, updated_at)
  VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  ON CONFLICT(platform_address, address) DO UPDATE SET
    title = excluded.title,
    img = excluded.img,
    updated_at = excluded.updated_at
`);
const getChannelStmt = db.prepare(`
  SELECT * FROM channel WHERE platform_address = ? AND address = ?
`);
const toggleChannelFavoriteStmt = db.prepare(`
  UPDATE channel SET favorite = ?, updated_at = ? WHERE platform_address = ? AND address = ?
`);
const toggleChannelBlockedStmt = db.prepare(`
  UPDATE channel SET blocked = ?, updated_at = ? WHERE platform_address = ? AND address = ?
`);
const listChannelByPlatformStmt = db.prepare(`
  SELECT platform_address, address, title, img, favorite, blocked FROM channel WHERE platform_address = ? ORDER BY created_at DESC
`);
const listChannelFavoritesStmt = db.prepare(`
  SELECT platform_address, address, title, img FROM channel WHERE favorite = 1 ORDER BY updated_at DESC
`);
const listChannelBlockedStmt = db.prepare(`
  SELECT platform_address, address, title, img FROM channel WHERE blocked = 1 ORDER BY updated_at DESC
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
  listByStatus(status, page = 1, pageSize = 10) {
    const total = countByStatusStmt.get(status).total;
    const offset = (Math.max(1, page) - 1) * Math.max(1, pageSize);
    const items = listByStatusStmt.all(status, Math.max(1, pageSize), offset);
    return { items, total, page, pageSize };
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
  upsertChannel(item) {
    upsertChannelStmt.run(item.platform_address, item.address, item.title || null, item.img || null, new Date().toISOString(), new Date().toISOString());
  },
  getChannel(platform_address, address) {
    return getChannelStmt.get(platform_address, address);
  },
  toggleChannelFavorite(platform_address, address, flag) {
    toggleChannelFavoriteStmt.run(flag ? 1 : 0, new Date().toISOString(), platform_address, address);
  },
  toggleChannelBlocked(platform_address, address, flag) {
    toggleChannelBlockedStmt.run(flag ? 1 : 0, new Date().toISOString(), platform_address, address);
  },
  listChannelsByPlatform(platform_address) {
    return listChannelByPlatformStmt.all(platform_address);
  },
  listChannelFavorites() {
    return listChannelFavoritesStmt.all();
  },
  listChannelBlocked() {
    return listChannelBlockedStmt.all();
  },
};