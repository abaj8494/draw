// The WebSocket session protocol: upgrade auth, hello/init, ops through the
// shared reducer (parity), permissions enforced server-side, cid dedupe,
// resume, kick/ban, video relay, document ceilings, compaction, load-live.
'use strict';

const { test, assert, assertEqual } = require('./harness');
const H = require('./server-harness');
const Reducer = require('../js/reducer.js');

let inst;
let host;              // alice, canvas owner
let hws;               // host socket
let gws;               // guest socket (Gary)
let garyId, garyResume;
let localDoc;          // client-side mirror, advanced by applying op frames

const stroke = (id, extra) => Object.assign({ id, type: 'pen', color: '#000', points: [{ x: 1, y: 2 }] }, extra);

test('server-ws: valid draw_sid cookie on the upgrade ⇒ host', async () => {
  inst = await H.startInstance({
    maxStrokes: 5,
    maxDocBytes: 5000,
    maxParticipants: 3,
    compactEveryOps: 4,
    roomIdleMs: 150,
  });
  host = H.makeHost(inst, 'alice');
  localDoc = { strokes: [], background: 'grid-light' };

  const { c, init } = await H.join(inst, host.canvas.share_token, { cookie: host.cookie });
  hws = c;
  assertEqual(init.you.host, true);
  assertEqual(init.you.write, true);
  assertEqual(init.seq, 0);
  assertEqual(JSON.stringify(init.doc), JSON.stringify({ strokes: [], background: 'grid-light' }));
  assert(typeof init.resume === 'string' && init.resume.length >= 16, 'resume key');
  assertEqual(init.participants.length, 1);
  assertEqual(init.participants[0].host, true);
});

test('server-ws: absent cookie ⇒ guest, read-only, named join', async () => {
  const { c, init } = await H.join(inst, host.canvas.share_token, { name: 'Gary' });
  gws = c;
  assertEqual(init.you.host, false);
  assertEqual(init.you.write, false);
  garyResume = init.resume;
  garyId = init.participants.find((p) => p.name === 'Gary').id;
  // The host hears about Gary.
  const parts = await hws.next((m) => m.type === 'participants'
    && m.participants.some((p) => p.name === 'Gary'));
  assertEqual(parts.participants.find((p) => p.name === 'Gary').write, false);
});

test('server-ws: forged cookie ⇒ guest, never host', async () => {
  const { c, init } = await H.join(inst, host.canvas.share_token, {
    cookie: 'draw_sid=' + 'f'.repeat(64), name: 'Mallory',
  });
  assertEqual(init.you.host, false);
  assertEqual(init.you.write, false);
  c.close();
  await c.waitClose();
});

test('server-ws: a read-only guest\'s op is rejected server-side', async () => {
  gws.send({ type: 'op', cid: 'c1', op: { kind: 'add', stroke: stroke('g1') } });
  const rej = await gws.next('reject');
  assertEqual(rej.cid, 'c1');
  gws.send({ type: 'sync' });
  const init = await gws.next('init');
  assertEqual(init.doc.strokes.length, 0, 'nothing landed');
  assertEqual(init.seq, 0);
});

test('server-ws: host grants write; the guest is told', async () => {
  hws.send({ type: 'perm', participantId: garyId, write: true });
  const perm = await gws.next('perm');
  assertEqual(perm.write, true);
  await hws.next((m) => m.type === 'participants'
    && m.participants.some((p) => p.name === 'Gary' && p.write));
});

test('server-ws: guest op applies, gets a seq, broadcasts to everyone (originator included)', async () => {
  gws.send({ type: 'op', cid: 'c2', op: { kind: 'add', stroke: stroke('g1') } });
  const own = await gws.next('op');
  assertEqual(own.seq, 1);
  assertEqual(own.cid, 'c2');
  const echo = await hws.next('op');
  assertEqual(JSON.stringify(echo.op), JSON.stringify(own.op));
  Reducer.apply(localDoc, own.op);
});

test('server-ws: duplicate cid is acked, not applied twice', async () => {
  gws.send({ type: 'op', cid: 'c2', op: { kind: 'add', stroke: stroke('g1') } });
  const ack = await gws.next('ack');
  assertEqual(ack.cid, 'c2');
  await gws.none('op');
  gws.send({ type: 'sync' });
  const init = await gws.next('init');
  assertEqual(init.seq, 1, 'no extra seq consumed');
  assertEqual(init.doc.strokes.length, 1);
});

test('server-ws: reducer parity — upsert/delete/background produce identical documents', async () => {
  const ops = [
    { kind: 'upsert', strokes: [stroke('g1', { color: '#f00' }), stroke('h2')] },
    { kind: 'delete', ids: ['g1'] },
    { kind: 'background', key: 'grid-dark' },
  ];
  let n = 10;
  for (const op of ops) hws.send({ type: 'op', cid: 'h' + n++, op });
  for (let i = 0; i < ops.length; i++) {
    const frame = await gws.next('op');
    Reducer.apply(localDoc, frame.op);   // exactly what the browser does
    await hws.next('op');                // consume the echoes
  }
  gws.send({ type: 'sync' });
  const init = await gws.next('init');
  assertEqual(init.seq, 4);
  assertEqual(JSON.stringify(init.doc), JSON.stringify(localDoc),
    'server doc and client-reduced doc are byte-identical');
});

test('server-ws: clear is host-only even for a write-granted guest', async () => {
  gws.send({ type: 'op', cid: 'c3', op: { kind: 'clear' } });
  const rej = await gws.next('reject');
  assertEqual(rej.cid, 'c3');
  hws.send({ type: 'op', cid: 'h20', op: { kind: 'clear' } });
  const frame = await gws.next('op');
  assertEqual(frame.op.kind, 'clear');
  Reducer.apply(localDoc, frame.op);
  await hws.next('op');
  assertEqual(localDoc.strokes.length, 0);
});

test('server-ws: guest perm/kick/video frames are dead ends server-side', async () => {
  gws.msgs.length = 0;
  hws.msgs.length = 0;
  gws.send({ type: 'perm', participantId: garyId, write: false });
  gws.send({ type: 'kick', participantId: hws.hostId });
  gws.send({ type: 'video', playing: true, time: 1, rate: 1 });
  await hws.none('video');
  await hws.none('kicked');
  // Gary still has write: an op still lands.
  gws.send({ type: 'op', cid: 'c4', op: { kind: 'add', stroke: stroke('g5') } });
  const frame = await gws.next('op');
  assertEqual(frame.op.stroke.id, 'g5');
  Reducer.apply(localDoc, frame.op);
  await hws.next('op');
  assert(!hws.closed, 'host socket untouched by guest kick attempt');
});

test('server-ws: host video state is relayed with a server timestamp', async () => {
  const before = Date.now();
  hws.send({ type: 'video', playing: true, time: 12.5, rate: 1.5 });
  const v = await gws.next('video');
  assertEqual(v.playing, true);
  assertEqual(v.time, 12.5);
  assertEqual(v.rate, 1.5);
  assert(typeof v.at === 'number' && v.at >= before && v.at <= Date.now() + 1000,
    '`at` is a server clock reading');
  // A late joiner gets the video state in init.
  gws.send({ type: 'sync' });
  const init = await gws.next('init');
  assertEqual(init.video.time, 12.5);
});

test('server-ws: revoked write is enforced server-side against a tampered client', async () => {
  hws.send({ type: 'perm', participantId: garyId, write: false });
  const perm = await gws.next('perm');
  assertEqual(perm.write, false);
  gws.send({ type: 'op', cid: 'c5', op: { kind: 'add', stroke: stroke('evil') } });
  const rej = await gws.next('reject');
  assertEqual(rej.cid, 'c5');
  gws.send({ type: 'sync' });
  const init = await gws.next('init');
  assert(!init.doc.strokes.some((s) => s.id === 'evil'));
});

test('server-ws: reconnect with resume keeps identity, permission and dedupe window', async () => {
  hws.send({ type: 'perm', participantId: garyId, write: true });
  await gws.next('perm');
  gws.close();
  await gws.waitClose();

  const { c, init } = await H.join(inst, host.canvas.share_token, {
    resume: garyResume, lastSeq: 6,
  });
  gws = c;
  assertEqual(init.you.host, false);
  assertEqual(init.you.write, true, 'write grant survives the reconnect');
  assertEqual(init.resume, garyResume);
  assert(init.participants.some((p) => p.id === garyId), 'same participant identity');
  assertEqual(JSON.stringify(init.doc), JSON.stringify(localDoc), 'init doc heals any gap');

  // A resent op from before the drop is deduped by cid even across sockets.
  gws.send({ type: 'op', cid: 'c4', op: { kind: 'add', stroke: stroke('g5') } });
  const ack = await gws.next('ack');
  assertEqual(ack.cid, 'c4');
  await gws.none('op');
});

test('server-ws: kick disconnects and bans the resume key', async () => {
  hws.send({ type: 'kick', participantId: garyId });
  await gws.next('kicked');
  await gws.waitClose();

  const c = await new H.WSClient(inst, host.canvas.share_token).open();
  c.hello({ resume: garyResume, lastSeq: 0 });
  const err = await c.next('error');
  assertEqual(err.code, 'banned');
  await c.waitClose();
});

test('server-ws: participants-per-canvas ceiling refuses with `full`', async () => {
  // Cap is 3 and the host occupies one slot.
  const { c: g2 } = await H.join(inst, host.canvas.share_token, { name: 'G2' });
  const { c: g3 } = await H.join(inst, host.canvas.share_token, { name: 'G3' });
  const c4 = await new H.WSClient(inst, host.canvas.share_token).open();
  c4.hello({ name: 'G4' });
  const err = await c4.next('error');
  assertEqual(err.code, 'full');
  await c4.waitClose();
  g2.close(); g3.close();
  await g2.waitClose(); await g3.waitClose();
});

test('server-ws: stroke-count ceiling rejects with stroke_limit', async () => {
  hws.msgs.length = 0;
  hws.send({ type: 'op', cid: 'h29', op: { kind: 'clear' } }); // start from an empty doc
  await hws.next('op');
  hws.send({
    type: 'op', cid: 'h30',
    op: { kind: 'upsert', strokes: ['s1', 's2', 's3', 's4', 's5'].map((id) => stroke(id)) },
  });
  await hws.next('op');
  hws.send({ type: 'op', cid: 'h31', op: { kind: 'add', stroke: stroke('s6') } });
  const rej = await hws.next('reject');
  assertEqual(rej.reason, 'stroke_limit');
  // Replacing an existing stroke is still fine at the cap.
  hws.send({ type: 'op', cid: 'h32', op: { kind: 'add', stroke: stroke('s1', { color: '#00f' }) } });
  const ok = await hws.next('op');
  assertEqual(ok.op.stroke.color, '#00f');
});

test('server-ws: document-size ceiling rejects with doc_size', async () => {
  hws.send({
    type: 'op', cid: 'h33',
    op: { kind: 'add', stroke: stroke('s1', { text: 'x'.repeat(6000) }) },
  });
  const rej = await hws.next('reject');
  assertEqual(rej.reason, 'doc_size');
});

test('server-ws: op log compacts into the stored doc and stays bounded', async () => {
  // compactEveryOps=4 and plenty of ops have flowed: the persisted doc must
  // be near the live seq, with only the tail still in the op log.
  const row = inst.store.canvasById(host.canvas.id);
  assert(row.doc_seq > 0, 'doc has been compacted at least once');
  const logCount = inst.store.db
    .prepare('SELECT COUNT(*) AS n FROM oplog WHERE canvas_id = ?').get(host.canvas.id).n;
  assertEqual(logCount, row.seq - row.doc_seq, 'log holds exactly the uncompacted tail');
  assert(logCount < 8, 'tail stays short');
});

test('server-ws: load-live replaces the canvas for every participant via ops', async () => {
  const state = {
    strokes: [{ type: 'pen', color: '#123', points: [{ x: 5, y: 6 }] }], // note: no id (old save format)
    background: 'grid-sepia', offsetX: 1, offsetY: 2, scale: 3,
  };
  const save = await fetch(inst.base + '/api/save', {
    method: 'POST', headers: { cookie: host.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'live1', data: state }),
  });
  assertEqual(save.status, 200);

  const { c: g2, init: gInit } = await H.join(inst, host.canvas.share_token, { name: 'Watcher' });
  const before = gInit.seq;
  const r = await fetch(inst.base + '/api/load-live/live1', {
    method: 'POST', headers: { cookie: host.cookie },
  });
  assertEqual(r.status, 200);

  const doc = { strokes: gInit.doc.strokes, background: gInit.doc.background };
  let last = before;
  // clear + background + one upsert chunk, in order, as ordinary ops.
  for (const kind of ['clear', 'background', 'upsert']) {
    const frame = await g2.next('op');
    assertEqual(frame.op.kind, kind);
    assertEqual(frame.seq, ++last, 'seq stays monotonic');
    Reducer.apply(doc, frame.op);
  }
  assertEqual(doc.background, 'grid-sepia');
  assertEqual(doc.strokes.length, 1);
  assert(doc.strokes[0].id, 'the server assigned the missing stroke id');
  assertEqual(doc.strokes[0].color, '#123');

  g2.send({ type: 'sync' });
  const init = await g2.next('init');
  assertEqual(JSON.stringify(init.doc), JSON.stringify(doc), 'everyone converges');
  g2.close();
  await g2.waitClose();
});

test('server-ws: idle room is evicted after persisting, and reloads intact', async () => {
  gws.close();
  hws.close();
  await gws.waitClose();
  await hws.waitClose();
  await H.sleep(400); // > roomIdleMs (150)
  assertEqual(inst.rooms.rooms.size, 0, 'room evicted');

  const { c, init } = await H.join(inst, host.canvas.share_token, { cookie: host.cookie });
  assertEqual(init.doc.background, 'grid-sepia');
  assertEqual(init.doc.strokes.length, 1);
  assertEqual(init.doc.strokes[0].color, '#123');
  c.close();
  await c.waitClose();
});

test('server-ws: shutdown', async () => {
  await inst.close();
});
