/**
 * Draw server — Express + better-sqlite3 + ws, one container, port 5003.
 *
 * Serves its own static frontend (index.html, /css, /js — explicitly, never
 * the repo root, so .env / data / server internals can never leak) plus the
 * HTTP API and the /ws/c/<token> session socket.
 *
 * createServer(config) is a factory so the test suite can run several fully
 * isolated instances (own DB, own dirs, ephemeral ports) in one process.
 */

'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { makeAuth } = require('./auth');
const { Rooms } = require('./rooms');
const { makeAuthRouter } = require('./routes/auth');
const { makeApiRouter } = require('./routes/api');
const { log, requestLogger } = require('./logger');

const logger = log('app');

const TOKEN_RE = /^[0-9a-zA-Z]{8,128}$/;

function createServer(config = loadConfig()) {
  const store = openDb(config);
  const auth = makeAuth(config, store);
  const rooms = new Rooms(config, store);

  const app = express();
  app.disable('x-powered-by');
  // Cloudflare terminates TLS at the edge, Caddy appends its hop: two proxies,
  // so a hop count of 2 recovers the actual visitor IP for logs/rate limits.
  if (config.trustProxy) app.set('trust proxy', 2);
  app.use(requestLogger());

  app.use('/auth', makeAuthRouter(config, store, auth));
  app.use('/api', makeApiRouter(config, store, rooms, auth));

  /* ---------------- static frontend ---------------- */

  const index = path.join(config.root, 'index.html');
  app.use('/css', express.static(path.join(config.root, 'css'), { maxAge: '1h' }));
  app.use('/js', express.static(path.join(config.root, 'js'), { maxAge: '1h' }));
  app.get('/', (req, res) => res.sendFile(index));
  // The join page: same app; the client reads the token from the path and
  // opens the WS itself. Token validity is settled over the socket
  // (bad_token), so a rotated link still renders a clear error, not a 404.
  app.get('/c/:token', (req, res) => {
    if (!TOKEN_RE.test(req.params.token)) return res.status(404).send('Not found');
    res.sendFile(index);
  });

  // JSON error handler (body-parser 413s and friends).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'too_large' });
    }
    logger.error(err, { path: req.path });
    res.status(err.status || 500).json({ error: 'server_error' });
  });

  /* ---------------- websocket upgrade ---------------- */

  const server = http.createServer(app);
  // maxPayload enforces the 32 KB frame ceiling in ws itself: an oversized
  // frame closes the connection with 1009 before we ever buffer it.
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxWsMessageBytes });

  server.on('upgrade', (req, socket, head) => {
    const m = /^\/ws\/c\/([0-9a-zA-Z]{8,128})$/.exec((req.url || '').split('?')[0]);
    if (!m) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    // WS upgrade auth is LOCAL — a same-origin wss:// handshake carries
    // cookies, so draw_sid resolves against our own SQLite. No identity call
    // sits in the reconnect path (Cloudflare forces frequent reconnects).
    // Absent or invalid cookie ⇒ guest, never host.
    const user = auth.userFromRequest(req);
    const ip = clientIp(req, config);
    wss.handleUpgrade(req, socket, head, (ws) => {
      rooms.attach(ws, { token: m[1], user, ip });
    });
  });

  /* ---------------- lifecycle ---------------- */

  const purge = setInterval(() => store.purgeExpiredSessions(), 24 * 60 * 60 * 1000);
  purge.unref();
  store.purgeExpiredSessions();

  return {
    app,
    server,
    rooms,
    store,
    config,
    listen(port = config.port, host) {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    async close() {
      clearInterval(purge);
      rooms.flush();
      rooms.close();
      // Keep-alive sockets (undici pools them) would stall a graceful close.
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      store.db.close();
    },
  };
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    // Two trusted hops (Cloudflare, Caddy): the real client is third from the
    // end. Fewer entries: take the leftmost we have.
    if (xff.length) return xff[Math.max(0, xff.length - 2)];
  }
  return req.socket.remoteAddress || 'unknown';
}

module.exports = { createServer };

if (require.main === module) {
  const inst = createServer();
  process.on('unhandledRejection', (err) => logger.error(err, { source: 'unhandledRejection' }));
  process.on('uncaughtException', (err) => {
    logger.error(err, { source: 'uncaughtException' });
    process.exit(1); // docker restarts us with a clean state
  });
  // Persist every live document before docker stops us.
  const shutdown = () => {
    logger.info('shutting down');
    inst.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  inst.listen().then((port) => logger.info(`draw listening on :${port}`));
}
