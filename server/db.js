/**
 * SQLite (better-sqlite3) — metadata only. Bulk bytes live on disk:
 * snapshots under config.savesDir/<user_id>/, images under config.filesDir.
 *
 * openDb(config) is a factory so tests can run several isolated instances in
 * one process (each with its own file). No local passwords anywhere: accounts
 * are FatFort ID's, this ledger just keys everything by local users.id.
 */

'use strict';

const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function openDb(config) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  identity_id INTEGER UNIQUE,        -- FatFort ID user id
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Draw's OWN sessions (draw_sid cookie). WS upgrade auth resolves against
-- this table locally — identity is never in the reconnect path.
CREATE TABLE IF NOT EXISTS host_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One canvas per user, created lazily on the host's first /api/session.
-- doc is the materialized {strokes, background} at doc_seq; ops newer than
-- doc_seq are in oplog and replayed on room load.
CREATE TABLE IF NOT EXISTS canvases (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,
  doc TEXT NOT NULL DEFAULT '{"strokes":[],"background":"grid-light"}',
  doc_seq INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oplog (
  canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  op TEXT NOT NULL,
  PRIMARY KEY (canvas_id, seq)
);

-- Named saves; the JSON itself is a file at savesDir/<user_id>/<slug>.json.
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

-- Uploaded images, sha256-deduped globally; canvas_files is the per-canvas
-- quota ledger (16 MB per canvas counts each distinct image once).
CREATE TABLE IF NOT EXISTS files (
  hash TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS canvas_files (
  canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  hash TEXT NOT NULL REFERENCES files(hash),
  PRIMARY KEY (canvas_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_host_sessions_expiry ON host_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id);
`);

  const api = {
    db,

    /* ---------------- users & sessions ---------------- */

    // JIT-provision on SSO callback. Existing rows keep their local id but
    // pick up fresh display_name/email — identity is authoritative for those.
    upsertSsoUser({ id, username, display_name, email }) {
      db.prepare(
        `INSERT INTO users (identity_id, username, display_name, email)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           identity_id = excluded.identity_id,
           display_name = excluded.display_name,
           email = excluded.email`
      ).run(id, String(username).trim().toLowerCase(), display_name || null, email || null);
      return db.prepare('SELECT * FROM users WHERE username = ?')
        .get(String(username).trim().toLowerCase());
    },

    issueSession(userId) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare(
        "INSERT INTO host_sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
      ).run(token, userId, `+${config.sessionTtlDays} days`);
      return token;
    },

    sessionUser(token) {
      if (!token) return null;
      return db.prepare(
        `SELECT u.id, u.username, u.display_name, u.email FROM host_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`
      ).get(token) || null;
    },

    destroySession(token) {
      if (token) db.prepare('DELETE FROM host_sessions WHERE token = ?').run(token);
    },

    purgeExpiredSessions() {
      db.prepare("DELETE FROM host_sessions WHERE expires_at < datetime('now')").run();
    },

    /* ---------------- canvases ---------------- */

    newShareToken() {
      // 24 base36ish chars from 16 random bytes — matches the client's
      // /^\/c\/([0-9a-zA-Z]{8,128})\/?$/ token shape and is unguessable.
      return crypto.randomBytes(16).toString('hex');
    },

    canvasForUser(userId) {
      return db.prepare('SELECT * FROM canvases WHERE user_id = ?').get(userId) || null;
    },

    ensureCanvas(userId) {
      const existing = api.canvasForUser(userId);
      if (existing) return existing;
      db.prepare('INSERT INTO canvases (user_id, share_token) VALUES (?, ?)')
        .run(userId, api.newShareToken());
      return api.canvasForUser(userId);
    },

    canvasByToken(token) {
      if (!token) return null;
      return db.prepare('SELECT * FROM canvases WHERE share_token = ?').get(token) || null;
    },

    canvasById(id) {
      return db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) || null;
    },

    rotateToken(userId) {
      const token = api.newShareToken();
      db.prepare("UPDATE canvases SET share_token = ?, updated_at = datetime('now') WHERE user_id = ?")
        .run(token, userId);
      return token;
    },

    /* ---------------- op log + doc persistence ---------------- */

    appendOp(canvasId, seq, op) {
      db.prepare('INSERT OR REPLACE INTO oplog (canvas_id, seq, op) VALUES (?, ?, ?)')
        .run(canvasId, seq, JSON.stringify(op));
      db.prepare('UPDATE canvases SET seq = ? WHERE id = ?').run(seq, canvasId);
      // Hard cap: the log may never grow past config.opLogCap rows per canvas.
      db.prepare(
        `DELETE FROM oplog WHERE canvas_id = ? AND seq <= (
           SELECT seq FROM oplog WHERE canvas_id = ?
           ORDER BY seq DESC LIMIT 1 OFFSET ?)`
      ).run(canvasId, canvasId, config.opLogCap);
    },

    opsAfter(canvasId, seq) {
      return db.prepare('SELECT seq, op FROM oplog WHERE canvas_id = ? AND seq > ? ORDER BY seq')
        .all(canvasId, seq)
        .map((r) => ({ seq: r.seq, op: JSON.parse(r.op) }));
    },

    // Compaction: persist the materialized doc and drop the ops it covers.
    saveDoc(canvasId, doc, seq) {
      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE canvases SET doc = ?, doc_seq = ?, seq = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(doc), seq, seq, canvasId);
        db.prepare('DELETE FROM oplog WHERE canvas_id = ? AND seq <= ?').run(canvasId, seq);
      });
      tx();
    },

    /* ---------------- snapshots ---------------- */

    snapshotList(userId) {
      return db.prepare(
        `SELECT name, slug, bytes, CAST(strftime('%s', created_at) AS INTEGER) AS timestamp
         FROM snapshots WHERE user_id = ? ORDER BY created_at DESC`
      ).all(userId);
    },

    snapshotByName(userId, name) {
      return db.prepare('SELECT * FROM snapshots WHERE user_id = ? AND name = ?')
        .get(userId, name) || null;
    },

    snapshotUsage(userId) {
      return db.prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM snapshots WHERE user_id = ?'
      ).get(userId);
    },

    upsertSnapshot(userId, name, slug, bytes) {
      db.prepare(
        `INSERT INTO snapshots (user_id, name, slug, bytes) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET slug = excluded.slug,
           bytes = excluded.bytes, created_at = datetime('now')`
      ).run(userId, name, slug, bytes);
    },

    deleteSnapshot(userId, name) {
      return db.prepare('DELETE FROM snapshots WHERE user_id = ? AND name = ?')
        .run(userId, name).changes > 0;
    },

    /* ---------------- image files ---------------- */

    fileByHash(hash) {
      return db.prepare('SELECT * FROM files WHERE hash = ?').get(hash) || null;
    },

    canvasImageBytes(canvasId) {
      return db.prepare(
        `SELECT COALESCE(SUM(f.bytes), 0) AS bytes FROM canvas_files cf
         JOIN files f ON f.hash = cf.hash WHERE cf.canvas_id = ?`
      ).get(canvasId).bytes;
    },

    recordFile(canvasId, hash, bytes, mime) {
      const tx = db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO files (hash, bytes, mime) VALUES (?, ?, ?)')
          .run(hash, bytes, mime);
        db.prepare('INSERT OR IGNORE INTO canvas_files (canvas_id, hash) VALUES (?, ?)')
          .run(canvasId, hash);
      });
      tx();
    },
  };

  return api;
}

module.exports = { openDb };
