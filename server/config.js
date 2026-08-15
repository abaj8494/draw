/**
 * Server configuration. Everything is env-tunable; the hard ceilings exist
 * because this box runs two mission-critical businesses next to us and has
 * ~630 MB actually free — the server refuses cleanly rather than degrading.
 *
 * loadConfig(env, overrides) is a pure factory so tests can build isolated
 * instances with their own dirs/ports; the default export reads process.env.
 */

'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadConfig(env = process.env, overrides = {}) {
  const num = (key, fallback) => {
    const v = Number(env[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  const cfg = {
    root: ROOT,
    port: num('PORT', 5003),
    dbPath: env.DB_PATH || path.join(ROOT, 'data', 'draw.db'),

    // Blockstorage split, same as agents' attachments: SQLite metadata on the
    // root disk bind mount, bulk bytes on /mnt/blockstorage.
    savesDir: env.SAVES_DIR || '/mnt/blockstorage/draw/saves',
    filesDir: env.FILES_DIR || '/mnt/blockstorage/draw/files',

    // FatFort ID single sign-on. The ticket exchange must go straight to the
    // identity container over infra_web — /internal/verify refuses anything
    // carrying X-Forwarded-* headers, i.e. anything that came via a proxy.
    ssoAppId: env.SSO_APP_ID || 'draw',
    identityLoginUrl: env.IDENTITY_LOGIN_URL || 'https://fatfort.com/id/login',
    identityVerifyUrl: env.IDENTITY_VERIFY_URL || 'http://fatfort-id:5002/internal/verify',

    sessionTtlDays: num('SESSION_TTL_DAYS', 30),
    trustProxy: env.TRUST_PROXY !== '0',
    // Set by tests / local dev so cookies work without HTTPS.
    insecureCookies: env.INSECURE_COOKIES === '1',

    /* ---- hard ceilings ---- */
    maxWsConnections: num('MAX_WS_CONNECTIONS', 64),
    maxRooms: num('MAX_LIVE_CANVASES', 8),
    roomIdleMs: num('ROOM_IDLE_MS', 5 * 60 * 1000),
    maxParticipants: num('MAX_PARTICIPANTS', 24),

    // Per-connection token bucket. Bucket empty when a frame arrives = one
    // strike, three strikes closes the socket.
    rateMsgsPerSec: num('RATE_MSGS_PER_SEC', 30),
    rateBurst: num('RATE_BURST', 60),
    rateStrikes: num('RATE_STRIKES', 3),

    maxWsMessageBytes: num('MAX_WS_MESSAGE_BYTES', 32 * 1024),

    // Images travel over HTTP only — a 4 MB paste broadcast to 23 peers over
    // the WS would be a 92 MB burst.
    maxImageBytes: num('MAX_IMAGE_MB', 4) * 1024 * 1024,
    maxCanvasImageBytes: num('MAX_CANVAS_IMAGE_MB', 16) * 1024 * 1024,

    maxStrokes: num('MAX_STROKES', 2000),
    maxDocBytes: num('MAX_DOC_MB', 2) * 1024 * 1024,

    compactEveryOps: num('COMPACT_EVERY_OPS', 500),
    compactEveryMs: num('COMPACT_EVERY_MS', 60 * 1000),
    opLogCap: num('OP_LOG_CAP', 5000),

    maxSnapshotsPerUser: num('MAX_SNAPSHOTS_PER_USER', 50),
    maxSnapshotBytesPerUser: num('MAX_SNAPSHOT_MB_PER_USER', 64) * 1024 * 1024,

    joinRateCount: num('JOIN_RATE_COUNT', 10),
    joinRateWindowMs: num('JOIN_RATE_WINDOW_MS', 10 * 1000),

    pingIntervalMs: num('PING_INTERVAL_MS', 30 * 1000),
  };
  return Object.assign(cfg, overrides);
}

module.exports = { loadConfig, config: loadConfig() };
