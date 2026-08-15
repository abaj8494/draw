// Image uploads: HTTP only, host or write-granted participant, 4 MB/file and
// 16 MB/canvas ceilings (scaled down here), sha256 dedupe, immutable serving.
'use strict';

const crypto = require('crypto');
const { test, assert, assertEqual } = require('./harness');
const H = require('./server-harness');

let inst, host, hws, gws, guestResume;

const png = (n, seed) => {
  // Deterministic pseudo-image bytes; content-type is what the server checks.
  const buf = Buffer.alloc(n);
  crypto.createHash('sha512').update(String(seed)).digest().copy(buf);
  return buf;
};

const upload = (bytes, { cookie, participant, type = 'image/png' } = {}) =>
  fetch(`${inst.base}/api/c/${host.canvas.share_token}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': type,
      ...(cookie ? { cookie } : {}),
      ...(participant !== undefined ? { 'X-Draw-Participant': participant } : {}),
    },
    body: bytes,
  });

test('server-files: setup', async () => {
  inst = await H.startInstance({
    maxImageBytes: 1000,
    maxCanvasImageBytes: 2500,
  });
  host = H.makeHost(inst, 'imghost');
  const h = await H.join(inst, host.canvas.share_token, { cookie: host.cookie });
  hws = h.c;
  const g = await H.join(inst, host.canvas.share_token, { name: 'Pixel' });
  gws = g.c;
  guestResume = g.init.resume;
  assert(inst.port > 0);
});

test('server-files: a read-only guest cannot upload', async () => {
  const r = await upload(png(100, 1), { participant: guestResume });
  assertEqual(r.status, 403);
  const anon = await upload(png(100, 1), {});
  assertEqual(anon.status, 403);
});

test('server-files: host upload round-trips with immutable caching', async () => {
  const bytes = png(400, 'a');
  const r = await upload(bytes, { cookie: host.cookie });
  assertEqual(r.status, 200);
  const { url } = await r.json();
  assert(/^\/api\/files\/[0-9a-f]{64}$/.test(url), 'content-addressed url');
  assertEqual(url.split('/').pop(), crypto.createHash('sha256').update(bytes).digest('hex'));

  const get = await fetch(inst.base + url);
  assertEqual(get.status, 200);
  assertEqual(get.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assertEqual(get.headers.get('content-type').split(';')[0], 'image/png');
  assert(Buffer.from(await get.arrayBuffer()).equals(bytes), 'bytes intact');
});

test('server-files: a write-granted guest may upload', async () => {
  const garyId = (await (async () => {
    gws.send({ type: 'sync' });
    const init = await gws.next('init');
    return init.participants.find((p) => p.name === 'Pixel').id;
  })());
  hws.send({ type: 'perm', participantId: garyId, write: true });
  await gws.next('perm');
  const r = await upload(png(300, 'b'), { participant: guestResume });
  assertEqual(r.status, 200);
});

test('server-files: over-size upload is refused with too_large', async () => {
  const r = await upload(png(1500, 'c'), { cookie: host.cookie });
  assertEqual(r.status, 413);
  assertEqual((await r.json()).error, 'too_large');
});

test('server-files: non-image content type is refused', async () => {
  const r = await upload(png(100, 'd'), { cookie: host.cookie, type: 'application/pdf' });
  assertEqual(r.status, 415);
});

test('server-files: canvas quota refuses with canvas_quota; dedupe is free', async () => {
  // Used so far: 400 + 300 of the 2500 cap.
  const third = await upload(png(900, 'e'), { cookie: host.cookie });
  assertEqual(third.status, 200);
  const thirdUrl = (await third.json()).url;
  // Re-uploading identical bytes costs nothing (sha256 dedupe).
  const dup = await upload(png(900, 'e'), { cookie: host.cookie });
  assertEqual(dup.status, 200);
  assertEqual((await dup.json()).url, thirdUrl);
  // A distinct image that would cross the cap is refused.
  const over = await upload(png(950, 'f'), { cookie: host.cookie });
  assertEqual(over.status, 413);
  assertEqual((await over.json()).error, 'canvas_quota');
});

test('server-files: unknown hash is a 404, bad hash a 400', async () => {
  const miss = await fetch(inst.base + '/api/files/' + '0'.repeat(64));
  assertEqual(miss.status, 404);
  const bad = await fetch(inst.base + '/api/files/nope');
  assertEqual(bad.status, 400);
});

test('server-files: shutdown', async () => {
  hws.close(); gws.close();
  await inst.close();
});
