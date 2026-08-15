/**
 * HTTP API — everything js/storage.js and js/sync.js call:
 *
 *   GET  /api/session            who am I / lazy canvas creation / share token
 *   POST /api/rotate-token       invalidate old share links
 *   POST /api/save               named snapshot  (host-only, per-user, on disk)
 *   GET  /api/load/:name         snapshot JSON back, exactly as saved
 *   GET  /api/list               [{name, timestamp(seconds)}]
 *   DELETE /api/delete/:name
 *   POST /api/load-live/:name    replace the LIVE canvas and broadcast it
 *   POST /api/c/:token/files     image upload (images NEVER cross the WS)
 *   GET  /api/files/:hash        immutable, sha256-addressed image bytes
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Router, json, raw } = require('express');
const { log } = require('../logger');

const logger = log('api');

function makeApiRouter(config, store, rooms, auth) {
  const router = Router();
  const requireHost = auth.requireHost.bind(auth);

  /* ---------------- session ---------------- */

  // The canvas is created lazily on the host's first visit — this endpoint IS
  // that visit. Unauthenticated answers {user:null} (the client's cue to show
  // the sign-in link) rather than a 401, because solo drawing must keep working.
  router.get('/session', (req, res) => {
    const user = auth.userFromRequest(req);
    if (!user) return res.json({ user: null });
    const canvas = store.ensureCanvas(user.id);
    res.json({
      user: { id: user.id, username: user.username, display_name: user.display_name },
      canvas: { shareToken: canvas.share_token },
    });
  });

  router.post('/rotate-token', requireHost, (req, res) => {
    store.ensureCanvas(req.user.id);
    const shareToken = store.rotateToken(req.user.id);
    logger.info('token rotated', { user: req.user.username });
    res.json({ shareToken });
  });

  /* ---------------- snapshots (host-only, private per user) -------------- */

  const cleanName = (raw) => {
    const name = String(raw || '').trim().slice(0, 120);
    // Anything printable except path separators and control characters.
    if (!name || /[/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') return null;
    return name;
  };
  // Deterministic filesystem-safe slug; the hash tail keeps two names that
  // sanitize identically from colliding on disk.
  const slugFor = (name) =>
    name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
    + '-' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 8);

  const userDir = (userId) => path.join(config.savesDir, String(userId));
  const snapPath = (userId, slug) => path.join(userDir(userId), slug + '.json');

  router.post('/save', requireHost, json({ limit: '8mb' }), (req, res) => {
    const name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: 'Invalid drawing name' });
    if (!req.body || typeof req.body.data !== 'object' || req.body.data === null) {
      return res.status(400).json({ error: 'Nothing to save' });
    }

    const payload = JSON.stringify(req.body.data);
    const bytes = Buffer.byteLength(payload);
    const usage = store.snapshotUsage(req.user.id);
    const existing = store.snapshotByName(req.user.id, name);
    if (!existing && usage.count >= config.maxSnapshotsPerUser) {
      return res.status(507).json({
        error: `Save limit reached (${config.maxSnapshotsPerUser} drawings). Delete one first.`,
      });
    }
    if (usage.bytes - (existing ? existing.bytes : 0) + bytes > config.maxSnapshotBytesPerUser) {
      return res.status(507).json({ error: 'Storage limit reached. Delete some drawings first.' });
    }

    const slug = slugFor(name);
    fs.mkdirSync(userDir(req.user.id), { recursive: true });
    const file = snapPath(req.user.id, slug);
    fs.writeFileSync(file + '.tmp', payload);
    fs.renameSync(file + '.tmp', file); // atomic: never a half-written save
    store.upsertSnapshot(req.user.id, name, slug, bytes);
    res.json({ name });
  });

  router.get('/load/:name', requireHost, (req, res) => {
    const name = cleanName(req.params.name);
    const snap = name && store.snapshotByName(req.user.id, name);
    if (!snap) return res.status(404).json({ error: 'Drawing not found' });
    try {
      const data = fs.readFileSync(snapPath(req.user.id, snap.slug), 'utf8');
      res.type('json').send(data);
    } catch (err) {
      logger.error(err, { route: 'load', name });
      res.status(404).json({ error: 'Drawing not found' });
    }
  });

  router.get('/list', requireHost, (req, res) => {
    res.json(store.snapshotList(req.user.id).map((s) => ({
      name: s.name,
      timestamp: s.timestamp, // seconds; the client multiplies by 1000
    })));
  });

  router.delete('/delete/:name', requireHost, (req, res) => {
    const name = cleanName(req.params.name);
    const snap = name && store.snapshotByName(req.user.id, name);
    if (!snap) return res.status(404).json({ error: 'Drawing not found' });
    store.deleteSnapshot(req.user.id, name);
    fs.rm(snapPath(req.user.id, snap.slug), { force: true }, () => {});
    res.json({ ok: true });
  });

  // Host-only: replace the live canvas with a snapshot and broadcast the
  // replacement as ordinary ops so every connected client converges.
  router.post('/load-live/:name', requireHost, (req, res) => {
    const name = cleanName(req.params.name);
    const snap = name && store.snapshotByName(req.user.id, name);
    if (!snap) return res.status(404).json({ error: 'Drawing not found' });
    let state;
    try {
      state = JSON.parse(fs.readFileSync(snapPath(req.user.id, snap.slug), 'utf8'));
    } catch (err) {
      logger.error(err, { route: 'load-live', name });
      return res.status(404).json({ error: 'Drawing not found' });
    }
    const canvas = store.ensureCanvas(req.user.id);
    rooms.loadSnapshotLive(canvas, state);
    logger.info('snapshot loaded live', { user: req.user.username, name });
    res.json({ ok: true });
  });

  /* ---------------- images (HTTP only — never over the WS) --------------- */

  router.post(
    '/c/:token/files',
    raw({ type: () => true, limit: config.maxImageBytes + 64 * 1024 }),
    (req, res) => {
      const canvas = store.canvasByToken(String(req.params.token || ''));
      if (!canvas) return res.status(404).json({ error: 'not_found' });

      // Two ways to be allowed: the owner's draw_sid cookie, or a live
      // participant's resume key with write permission (sent by sync.js as
      // X-Draw-Participant — guests have no cookie to send).
      const user = auth.userFromRequest(req);
      const isOwner = user && user.id === canvas.user_id;
      const writer = rooms.findWriter(canvas.id, req.get('X-Draw-Participant') || '');
      if (!isOwner && !writer) return res.status(403).json({ error: 'forbidden' });

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'empty' });
      }
      if (req.body.length > config.maxImageBytes) {
        return res.status(413).json({ error: 'too_large' });
      }
      const mime = (req.get('Content-Type') || '').split(';')[0].trim();
      if (!/^image\//.test(mime)) {
        return res.status(415).json({ error: 'unsupported_type' });
      }

      const hash = crypto.createHash('sha256').update(req.body).digest('hex');
      const known = store.fileByHash(hash);
      const alreadyOnCanvas = known && store.db
        .prepare('SELECT 1 FROM canvas_files WHERE canvas_id = ? AND hash = ?')
        .get(canvas.id, hash);
      if (!alreadyOnCanvas
          && store.canvasImageBytes(canvas.id) + req.body.length > config.maxCanvasImageBytes) {
        return res.status(413).json({ error: 'canvas_quota' });
      }

      if (!known) {
        fs.mkdirSync(config.filesDir, { recursive: true });
        const file = path.join(config.filesDir, hash);
        if (!fs.existsSync(file)) {
          fs.writeFileSync(file + '.tmp', req.body);
          fs.renameSync(file + '.tmp', file);
        }
      }
      store.recordFile(canvas.id, hash, req.body.length, mime);
      res.json({ url: '/api/files/' + hash });
    }
  );

  // Content-addressed and therefore immutable: cache forever. The hash is
  // unguessable, which is the (deliberate) whole of the read-side access
  // control — every participant, cookie-less guests included, must be able
  // to fetch the images the document references.
  router.get('/files/:hash', (req, res) => {
    const hash = String(req.params.hash || '');
    if (!/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ error: 'bad_hash' });
    const file = store.fileByHash(hash);
    if (!file) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', file.mime);
    res.sendFile(path.join(config.filesDir, hash), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not_found' });
    });
  });

  router.get('/health', (req, res) => res.json({ ok: true }));

  return router;
}

module.exports = { makeApiRouter };
