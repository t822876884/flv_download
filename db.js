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
};