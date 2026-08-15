// FatFort ID SSO round trip against a fake identity verify endpoint:
// happy path (state cookie + ticket exchange + draw_sid issued) and the
// no_grant / state-mismatch refusals.
'use strict';

const http = require('http');
const { test, assert, assertEqual } = require('./harness');
const H = require('./server-harness');

const GOOD = 'a'.repeat(64);
const NO_GRANT = 'b'.repeat(64);

let fakeId;        // fake identity server
let fakeIdPort;
let seenRequests = [];
let inst;

test('server-sso: fake identity + draw instance start', async () => {
  fakeId = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seenRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
      const { ticket, app } = JSON.parse(body || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (app !== 'draw') { res.statusCode = 403; return res.end(JSON.stringify({ error: 'bad_app' })); }
      if (ticket === GOOD) {
        return res.end(JSON.stringify({
          user: { id: 424242, username: 'Carol', display_name: 'Carol C', email: 'carol@example.com' },
        }));
      }
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'no_grant' }));
    });
  });
  fakeIdPort = await new Promise((resolve) => {
    fakeId.listen(0, '127.0.0.1', () => resolve(fakeId.address().port));
  });
  inst = await H.startInstance({
    identityVerifyUrl: `http://127.0.0.1:${fakeIdPort}/internal/verify`,
  });
  assert(inst.port > 0);
});

async function startSso() {
  const r = await fetch(inst.base + '/auth/sso/start', { redirect: 'manual' });
  assertEqual(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assertEqual(loc.searchParams.get('app'), 'draw');
  const state = loc.searchParams.get('state');
  assert(/^[0-9a-f]{32}$/.test(state), 'random state nonce');
  const cookie = H.getSetCookies(r).find((c) => c.startsWith('draw_sso_state='));
  assert(cookie, 'state rides in a short-lived cookie');
  return { state, stateCookie: cookie.split(';')[0] };
}

test('server-sso: happy path issues draw_sid and lands on /', async () => {
  const { state, stateCookie } = await startSso();
  const cb = await fetch(
    `${inst.base}/auth/sso/callback?ticket=${GOOD}&state=${state}`,
    { redirect: 'manual', headers: { cookie: stateCookie } }
  );
  assertEqual(cb.status, 302);
  assertEqual(cb.headers.get('location'), '/');
  const sid = H.getSetCookies(cb).find((c) => c.startsWith('draw_sid='));
  assert(sid, 'draw_sid cookie set');
  assert(/HttpOnly/i.test(sid), 'HttpOnly');
  assert(/SameSite=Lax/i.test(sid), 'SameSite=Lax');

  // The verify call went straight to identity, and named the right app.
  const seen = seenRequests[seenRequests.length - 1];
  assertEqual(seen.body.app, 'draw');
  assertEqual(seen.body.ticket, GOOD);
  assert(!seen.headers['x-forwarded-for'] && !seen.headers['x-forwarded-host'],
    'no X-Forwarded-* on the internal verify call');

  // The session works: /api/session recognizes the new host.
  const session = await (await fetch(inst.base + '/api/session', {
    headers: { cookie: sid.split(';')[0] },
  })).json();
  assertEqual(session.user.username, 'carol'); // normalized
  assertEqual(session.user.display_name, 'Carol C');
  assert(session.canvas.shareToken, 'canvas created lazily for the new host');
});

test('server-sso: no_grant is a 403 with no session issued', async () => {
  const { state, stateCookie } = await startSso();
  const cb = await fetch(
    `${inst.base}/auth/sso/callback?ticket=${NO_GRANT}&state=${state}`,
    { redirect: 'manual', headers: { cookie: stateCookie } }
  );
  assertEqual(cb.status, 403);
  assert((await cb.text()).includes('No access'), 'human-facing refusal page');
  assert(!H.getSetCookies(cb).some((c) => c.startsWith('draw_sid=') && !c.includes('Max-Age=0')),
    'no draw_sid issued');
});

test('server-sso: state mismatch is refused before any identity call', async () => {
  const before = seenRequests.length;
  const { stateCookie } = await startSso();
  const cb = await fetch(
    `${inst.base}/auth/sso/callback?ticket=${GOOD}&state=${'0'.repeat(32)}`,
    { redirect: 'manual', headers: { cookie: stateCookie } }
  );
  assertEqual(cb.status, 403);
  assertEqual(seenRequests.length, before, 'ticket never left the building');
});

test('server-sso: malformed ticket is refused', async () => {
  const { state, stateCookie } = await startSso();
  const cb = await fetch(
    `${inst.base}/auth/sso/callback?ticket=nope&state=${state}`,
    { redirect: 'manual', headers: { cookie: stateCookie } }
  );
  assertEqual(cb.status, 400);
});

test('server-sso: shutdown', async () => {
  await inst.close();
  await new Promise((r) => fakeId.close(r));
});
