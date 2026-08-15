// Resource ceilings that need their own small instances: global connection
// cap, join rate per IP, per-connection message rate (3 strikes), the 32 KB
// frame cap, and the live-rooms-in-memory cap.
'use strict';

const { test, assert, assertEqual } = require('./harness');
const H = require('./server-harness');

test('server-limits: global concurrent WS connection ceiling', async () => {
  const inst = await H.startInstance({ maxWsConnections: 2 });
  const host = H.makeHost(inst, 'cap');
  const a = await new H.WSClient(inst, host.canvas.share_token).open();
  const b = await new H.WSClient(inst, host.canvas.share_token).open();
  const c = await new H.WSClient(inst, host.canvas.share_token).open();
  const err = await c.next('error');
  assertEqual(err.code, 'busy');
  await c.waitClose();
  // A freed slot is reusable.
  a.close();
  await a.waitClose();
  await H.sleep(50);
  const d = await new H.WSClient(inst, host.canvas.share_token).open();
  d.hello({ name: 'D' });
  await d.next('init');
  b.close(); d.close();
  await inst.close();
});

test('server-limits: join rate per IP', async () => {
  const inst = await H.startInstance({ joinRateCount: 3, joinRateWindowMs: 60 * 1000 });
  const host = H.makeHost(inst, 'joins');
  const ok = [];
  for (let i = 0; i < 3; i++) {
    const c = await new H.WSClient(inst, host.canvas.share_token).open();
    ok.push(c);
  }
  const c4 = await new H.WSClient(inst, host.canvas.share_token).open();
  const err = await c4.next('error');
  assertEqual(err.code, 'rate');
  await c4.waitClose();
  for (const c of ok) c.close();
  await inst.close();
});

test('server-limits: message flood strikes out and closes the socket', async () => {
  const inst = await H.startInstance({ rateMsgsPerSec: 1, rateBurst: 5, rateStrikes: 3 });
  const host = H.makeHost(inst, 'flood');
  const { c } = await H.join(inst, host.canvas.share_token, { cookie: host.cookie });
  for (let i = 0; i < 20; i++) c.send({ type: 'pong', t: i });
  const info = await c.waitClose();
  assertEqual(info.code, 1008);
  await inst.close();
});

test('server-limits: an over-32KB frame closes the connection', async () => {
  const inst = await H.startInstance();
  const host = H.makeHost(inst, 'big');
  const { c } = await H.join(inst, host.canvas.share_token, { cookie: host.cookie });
  c.send({ type: 'op', cid: 'x', op: { kind: 'add', stroke: { id: 'b', text: 'x'.repeat(40 * 1024) } } });
  const info = await c.waitClose();
  assertEqual(info.code, 1009, 'ws message-too-big close');
  await inst.close();
});

test('server-limits: live-canvas slots cap, with idle rooms evicted (snapshot first)', async () => {
  const inst = await H.startInstance({ maxRooms: 1 });
  const h1 = H.makeHost(inst, 'roomone');
  const h2 = H.makeHost(inst, 'roomtwo');

  const { c: c1 } = await H.join(inst, h1.canvas.share_token, { cookie: h1.cookie });
  c1.send({ type: 'op', cid: 'k1', op: { kind: 'background', key: 'blank-dark' } });
  await c1.next('op');

  // While room 1 has a live participant, room 2 cannot come up.
  const busy = await new H.WSClient(inst, h2.canvas.share_token).open();
  busy.hello({ name: 'X' });
  const err = await busy.next('error');
  assertEqual(err.code, 'busy');
  await busy.waitClose();

  // Once room 1 is idle, it is evicted (persisted first) to make space.
  c1.close();
  await c1.waitClose();
  const { c: c2, init } = await H.join(inst, h2.canvas.share_token, { cookie: h2.cookie });
  assertEqual(init.you.host, true);
  assertEqual(inst.rooms.rooms.size, 1, 'old room made way');
  // Room 1's un-compacted op survived the eviction.
  const row = inst.store.canvasById(h1.canvas.id);
  assert(row.doc.includes('blank-dark'), 'evicted room was snapshotted');
  c2.close();
  await inst.close();
});
