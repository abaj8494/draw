// Structured logging to stdout/stderr, captured by Docker's json-file driver
// (3x10MB rotation — see docker-compose.yml). Same shape as agents':
//   2026-08-15T11:22:33.444Z INFO  [ws] message {"key":"value"}
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, scope, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${
    extra ? ' ' + JSON.stringify(extra) : ''
  }`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

const log = (scope) => ({
  debug: (msg, extra) => emit('debug', scope, msg, extra),
  info: (msg, extra) => emit('info', scope, msg, extra),
  warn: (msg, extra) => emit('warn', scope, msg, extra),
  error: (msg, extra) =>
    emit('error', scope, msg instanceof Error ? `${msg.message}\n${msg.stack}` : msg, extra),
});

// Express middleware: one line per completed API request.
function requestLogger() {
  const http = log('http');
  return (req, res, next) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) return next();
    const start = process.hrtime.bigint();
    res.on('close', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const line = `${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`;
      const extra = { ip: req.ip, ...(req.user ? { user: req.user.username } : {}) };
      if (res.statusCode >= 500) http.error(line, extra);
      else if (res.statusCode >= 400) http.warn(line, extra);
      else http.info(line, extra);
    });
    next();
  };
}

module.exports = { log, requestLogger };
