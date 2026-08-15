// HTTP API: session, rotate-token, and the snapshot store (save / load /
// list / delete) — authenticated, host-only, per-user, quota-enforced.
'use strict';

const { test, assert, assertEqual } = require('./harness');
const H = require('./server-harness');

let inst;
let host;   // canvas owner
let other;  // a second, unrelated host

test('server-http: instance starts', async () => {
  inst = await H.startInstance({
    maxSnapshotsPerUser: 3,
    maxSnapshotBytesPerUser: 10 * 1024,
  });
  host = H.makeHost(inst, 'alice');
  other = H.makeHost(inst, 'bob');
  assert(inst.port > 0, 'listening');
});

test('server-http: /api/session unauthenticated answers {user:null}', async () => {
  const r = await fetch(inst.base + '/api/session');
  assertEqual(r.status, 200);
  const data = await r.json();
  assert('user' in data, 'user key present (the client checks for it)');
  assertEqual(data.user, null);
});

test('server-http: /api/session with a forged cookie is not a host', async () => {
  const r = await fetch(inst.base + '/api/session', {
    headers: { cookie: 'draw_sid=' + 'f'.repeat(64) },
  });
  const data = await r.json();
  assertEqual(data.user, null);
});

test('server-http: /api/session returns user + stable share token', async () => {
  const r = await fetch(inst.base + '/api/session', { headers: { cookie: host.cookie } });
  assertEqual(r.status, 200);
  const data = await r.json();
  assertEqual(data.user.username, 'alice');
  assert(/^[0-9a-zA-Z]{8,128}$/.test(data.canvas.shareToken), 'token shape');
  assertEqual(data.canvas.shareToken, host.canvas.share_token);
  // Second call: same canvas, not a new one.
  const again = await (await fetch(inst.base + '/api/session', { headers: { cookie: host.cookie } })).json();
  assertEqual(again.canvas.shareToken, data.canvas.shareToken);
});

test('server-http: rotate-token invalidates the old link', async () => {
  const r = await fetch(inst.base + '/api/rotate-token', {
    method: 'POST', headers: { cookie: host.cookie },
  });
  assertEqual(r.status, 200);
  const { shareToken } = await r.json();
  assert(shareToken && shareToken !== host.canvas.share_token, 'token changed');
  assertEqual(inst.store.canvasByToken(host.canvas.share_token), null);
  host.canvas = inst.store.canvasForUser(host.user.id);
  assertEqual(host.canvas.share_token, shareToken);
});

test('server-http: rotate-token requires auth', async () => {
  const r = await fetch(inst.base + '/api/rotate-token', { method: 'POST' });
  assertEqual(r.status, 401);
});

const state1 = { strokes: [{ id: 's1', type: 'pen', points: [{ x: 1, y: 2 }] }], background: 'grid-sepia', offsetX: 3, offsetY: 4, scale: 1.5 };

test('server-http: save → list → load round-trip preserves the exact document', async () => {
  const save = await fetch(inst.base + '/api/save', {
    method: 'POST',
    headers: { cookie: host.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'My drawing', data: state1 }),
  });
  assertEqual(save.status, 200);
  assertEqual((await save.json()).name, 'My drawing');

  const list = await (await fetch(inst.base + '/api/list', { headers: { cookie: host.cookie } })).json();
  assert(Array.isArray(list), 'list is a bare array (storage.js does files.map)');
  assertEqual(list.length, 1);
  assertEqual(list[0].name, 'My drawing');
  assert(typeof list[0].timestamp === 'number', 'timestamp in seconds');
  assert(Math.abs(list[0].timestamp * 1000 - Date.now()) < 60 * 1000, 'timestamp is now-ish in seconds');

  const load = await fetch(inst.base + '/api/load/' + encodeURIComponent('My drawing'), {
    headers: { cookie: host.cookie },
  });
  assertEqual(load.status, 200);
  assertEqual(JSON.stringify(await load.json()), JSON.stringify(state1));
});

test('server-http: snapshots are private per user', async () => {
  const list = await (await fetch(inst.base + '/api/list', { headers: { cookie: other.cookie } })).json();
  assertEqual(list.length, 0);
  const load = await fetch(inst.base + '/api/load/' + encodeURIComponent('My drawing'), {
    headers: { cookie: other.cookie },
  });
  assertEqual(load.status, 404);
  const del = await fetch(inst.base + '/api/delete/' + encodeURIComponent('My drawing'), {
    method: 'DELETE', headers: { cookie: other.cookie },
  });
  assertEqual(del.status, 404);
  // Alice's save is untouched by Bob's attempts.
  const still = await fetch(inst.base + '/api/load/' + encodeURIComponent('My drawing'), {
    headers: { cookie: host.cookie },
  });
  assertEqual(still.status, 200);
});

test('server-http: guests (no cookie) cannot save, load, list or delete', async () => {
  for (const [method, url, body] of [
    ['POST', '/api/save', JSON.stringify({ name: 'x', data: {} })],
    ['GET', '/api/load/My%20drawing', undefined],
    ['GET', '/api/list', undefined],
    ['DELETE', '/api/delete/My%20drawing', undefined],
    ['POST', '/api/load-live/My%20drawing', undefined],
  ]) {
    const r = await fetch(inst.base + url, {
      method, body, headers: body ? { 'Content-Type': 'application/json' } : {},
    });
    assertEqual(r.status, 401, `${method} ${url}`);
  }
});

test('server-http: path-traversal names are refused', async () => {
  for (const name of ['../evil', 'a/b', 'a\\b', '..', '.']) {
    const r = await fetch(inst.base + '/api/save', {
      method: 'POST',
      headers: { cookie: host.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: {} }),
    });
    assertEqual(r.status, 400, `name ${JSON.stringify(name)}`);
  }
});

test('server-http: snapshot count quota refuses cleanly', async () => {
  // Limit is 3; "My drawing" occupies one slot already.
  for (const name of ['two', 'three']) {
    const r = await fetch(inst.base + '/api/save', {
      method: 'POST',
      headers: { cookie: host.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: state1 }),
    });
    assertEqual(r.status, 200);
  }
  const over = await fetch(inst.base + '/api/save', {
    method: 'POST',
    headers: { cookie: host.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'four', data: state1 }),
  });
  assertEqual(over.status, 507);
  assert((await over.json()).error.length > 0, 'error message for the client alert');
  // Overwriting an EXISTING name is still allowed at the count limit.
  const overwrite = await fetch(inst.base + '/api/save', {
    method: 'POST',
    headers: { cookie: host.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'two', data: state1 }),
  });
  assertEqual(overwrite.status, 200);
});

test('server-http: snapshot byte quota refuses cleanly', async () => {
  const big = { strokes: [{ id: 'big', text: 'x'.repeat(11 * 1024) }], background: 'grid-light' };
  const r = await fetch(inst.base + '/api/save', {
    method: 'POST',
    headers: { cookie: other.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'big', data: big }),
  });
  assertEqual(r.status, 507);
});

test('server-http: delete removes the snapshot', async () => {
  const del = await fetch(inst.base + '/api/delete/' + encodeURIComponent('My drawing'), {
    method: 'DELETE', headers: { cookie: host.cookie },
  });
  assertEqual(del.status, 200);
  const load = await fetch(inst.base + '/api/load/' + encodeURIComponent('My drawing'), {
    headers: { cookie: host.cookie },
  });
  assertEqual(load.status, 404);
  const list = await (await fetch(inst.base + '/api/list', { headers: { cookie: host.cookie } })).json();
  assertEqual(list.length, 2);
});

test('server-http: / and /c/<token> serve the app, bad tokens 404', async () => {
  const home = await fetch(inst.base + '/');
  assertEqual(home.status, 200);
  assert((await home.text()).includes('js/sync.js'), 'app page includes the sync layer');
  const share = await fetch(inst.base + '/c/' + host.canvas.share_token);
  assertEqual(share.status, 200);
  assert((await share.text()).includes('join-overlay'), 'join page has the name prompt');
  const bad = await fetch(inst.base + '/c/@@@');
  assertEqual(bad.status, 404);
  // Static must never expose server internals.
  const env = await fetch(inst.base + '/server/config.js');
  assertEqual(env.status, 404);
});

test('server-http: shutdown', async () => {
  await inst.close();
});
