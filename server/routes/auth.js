/**
 * FatFort ID single sign-on for draw.fatfort.com.
 *
 * /auth/sso/start    → mint a state nonce, bounce to https://fatfort.com/id/login
 * /auth/sso/callback → verify state, exchange the one-shot ticket at
 *                      http://fatfort-id:5002/internal/verify (direct to the
 *                      container — that endpoint refuses anything carrying
 *                      X-Forwarded-* headers, i.e. anything proxied), then
 *                      JIT-provision the local user row and set draw_sid.
 *
 * The callback URL is registered with identity as
 * https://draw.fatfort.com/auth/sso/callback — the redirect target lives in
 * identity's apps table, never in a parameter.
 */

'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { log } = require('../logger');

const authLog = log('auth');

// Static text only — nothing user-controlled is interpolated here.
function ssoPage(res, status, title, bodyHtml, { retry = true } = {}) {
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Draw</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #1a1d23; color: #e9edf2;
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width: min(420px, 90vw); background: #22262e; border: 1px solid #333a45;
          border-radius: 16px; padding: 2rem; }
  h1 { margin: 0 0 0.6rem; font-size: 1.15rem; }
  p { margin: 0.4rem 0; color: #9aa6b2; }
  a { color: #e8833a; }
</style></head><body>
<div class="card">
  <h1>${title}</h1>
  ${bodyHtml}
  ${retry ? '<p><a href="/auth/sso/start">Try signing in again</a></p>' : ''}
</div>
</body></html>`);
}

function makeAuthRouter(config, store, auth) {
  const router = Router();

  router.get('/sso/start', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', auth.stateCookie(state));
    const url = new URL(config.identityLoginUrl);
    url.searchParams.set('app', config.ssoAppId);
    url.searchParams.set('state', state);
    res.redirect(302, url.href);
  });

  router.get('/sso/callback', async (req, res) => {
    const echoed = String(req.query.state || '');
    const expected = auth.parseCookies(req.headers.cookie)[auth.STATE_COOKIE] || '';
    if (!echoed || !expected || echoed !== expected) {
      authLog.warn('sso state mismatch', { ip: req.ip });
      return ssoPage(res, 403, 'Sign-in could not be completed',
        '<p>This sign-in attempt did not originate from this browser, or took too long. No one has been signed in.</p>');
    }

    const ticket = String(req.query.ticket || '');
    if (!/^[0-9a-f]{64}$/.test(ticket)) {
      return ssoPage(res, 400, 'Sign-in could not be completed',
        '<p>The sign-in link was malformed. No one has been signed in.</p>');
    }

    let outcome;
    try {
      const r = await fetch(config.identityVerifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, app: config.ssoAppId }),
        signal: AbortSignal.timeout(5000),
      });
      outcome = { status: r.status, body: await r.json().catch(() => ({})) };
    } catch (err) {
      authLog.error(err, { route: 'sso/callback' });
      return ssoPage(res, 502, 'FatFort ID is unreachable',
        '<p>The sign-in service could not be reached. This is a fault on our side, not yours.</p>');
    }

    if (outcome.status !== 200 || !outcome.body?.user?.username) {
      const reason = outcome.body?.error || 'unknown';
      authLog.warn('sso ticket refused', { reason, ip: req.ip });
      if (reason === 'no_grant') {
        return ssoPage(res, 403, 'No access to Draw',
          '<p>You are signed in to FatFort ID, but hosting a whiteboard has not been granted for your account.</p>',
          { retry: false });
      }
      if (reason === 'used') {
        return ssoPage(res, 403, 'Sign-in link already used',
          '<p>This sign-in link has already been used once and cannot be used again.</p>');
      }
      if (reason === 'expired') {
        return ssoPage(res, 403, 'Sign-in link expired',
          '<p>Sign-in links are only valid for a minute, and this one has lapsed.</p>');
      }
      if (reason === 'bad_app') {
        return ssoPage(res, 403, 'Sign-in misconfigured',
          '<p>FatFort ID and Draw disagree about who this sign-in was for.</p>');
      }
      return ssoPage(res, 502, 'Sign-in failed',
        '<p>FatFort ID gave an answer this app did not understand. No one has been signed in.</p>');
    }

    // A `draw` grant means "may own and host a canvas": JIT-provision the
    // local row and issue draw's own session. No local passwords exist.
    const user = store.upsertSsoUser(outcome.body.user);
    const token = store.issueSession(user.id);
    res.setHeader('Set-Cookie', [auth.sessionCookie(token), auth.clearStateCookie()]);
    authLog.info('sso login', { username: user.username, ip: req.ip });
    res.redirect(302, '/');
  });

  router.post('/logout', (req, res) => {
    store.destroySession(auth.sessionTokenFromRequest(req));
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    res.redirect(302, '/');
  });

  return router;
}

module.exports = { makeAuthRouter };
