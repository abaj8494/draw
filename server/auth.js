/**
 * Cookie/session helpers. Draw has NO local passwords: the only way to become
 * a host is the FatFort ID SSO round trip (routes/auth.js), which lands here
 * to mint a draw_sid row in host_sessions. Guests never touch any of this.
 */

'use strict';

const COOKIE = 'draw_sid';
const STATE_COOKIE = 'draw_sso_state';

function parseCookies(header = '') {
  const out = {};
  for (const c of String(header).split(';')) {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  }
  return out;
}

function makeAuth(config, store) {
  const secure = config.insecureCookies ? '' : '; Secure';

  return {
    COOKIE,
    STATE_COOKIE,
    parseCookies,

    sessionCookie(token) {
      const maxAge = config.sessionTtlDays * 24 * 60 * 60;
      // SameSite=Lax: blocks cross-site POSTs while still sending the cookie
      // on the top-level navigation back from fatfort.com — and on the
      // same-origin wss:// handshake, which is what makes local WS auth work.
      return `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
    },

    clearSessionCookie() {
      return `${COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
    },

    // The SSO state nonce rides in a short-lived cookie across the round trip.
    stateCookie(state, maxAge = 600) {
      return `${STATE_COOKIE}=${state}; HttpOnly${secure}; SameSite=Lax; Path=/auth/sso; Max-Age=${maxAge}`;
    },

    clearStateCookie() {
      return this.stateCookie('', 0);
    },

    /** Resolve the user for a request (or raw upgrade req). Local DB only. */
    userFromRequest(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      return store.sessionUser(token);
    },

    sessionTokenFromRequest(req) {
      return parseCookies(req.headers.cookie)[COOKIE] || null;
    },

    /** Express middleware: 401 unless a valid draw_sid resolves to a user. */
    requireHost(req, res, next) {
      const user = store.sessionUser(parseCookies(req.headers.cookie)[COOKIE]);
      if (!user) return res.status(401).json({ error: 'not_authenticated' });
      req.user = user;
      next();
    },
  };
}

module.exports = { makeAuth, parseCookies };
