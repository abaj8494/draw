// Shared helpers for the server-side suite. Each test file spins up its own
// fully isolated server instance (own SQLite file, own saves/files dirs, an
// ephemeral port) so files can't interfere with one another.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { loadConfig } = require('../server/config');
const { createServer } = require('../server/index');

let identitySeq = 7000;

function tmpConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-test-'));
  return loadConfig(process.env, Object.assign({
    dbPath: path.join(dir, 'draw.db'),
    savesDir: path.join(dir, 'saves'),
    filesDir: path.join(dir, 'files'),
    insecureCookies: true,
    trustProxy: false,
    // Generous defaults so unrelated tests never trip the ceilings; each
    // ceiling test overrides the one limit it exercises.
    joinRateCount: 100000,
    pingIntervalMs: 60 * 1000,
  }, overrides));
}

async function startInstance(overrides) {
  const inst = createServer(tmpConfig(overrides));
  const port = await inst.listen(0, '127.0.0.1');
  inst.port = port;
  inst.base = `http://127.0.0.1:${port}`;
  return inst;
}

// A signed-in canvas owner, minted straight into the local DB (the SSO round
// trip itself is covered by server-sso.test.js).
function makeHost(inst, username = 'host') {
  const user = inst.store.upsertSsoUser({
    id: ++identitySeq, username, display_name: username[0].toUpperCase() + username.slice(1), email: null,
  });
  const sid = inst.store.issueSession(user.id);
  const canvas = inst.store.ensureCanvas(user.id);
  return { user, sid, cookie: `draw_sid=${sid}`, canvas };
}

class WSClient {
  constructor(inst, token, { cookie } = {}) {
    this.msgs = [];
    this.closed = false;
    this.closeInfo = null;
    this.ws = new WebSocket(`ws://127.0.0.1:${inst.port}/ws/c/${token}`, {
      headers: cookie ? { cookie } : {},
    });
    this.ws.on('message', (d) => {
      try { this.msgs.push(JSON.parse(d.toString())); } catch (e) { /* ignore */ }
    });
    this.ws.on('close', (code, reason) => {
      this.closed = true;
      this.closeInfo = { code, reason: reason ? reason.toString() : '' };
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }

  async open() { await this.opened; return this; }

  send(obj) { this.ws.send(JSON.stringify(obj)); }

  hello(fields = {}) { this.send(Object.assign({ type: 'hello', lastSeq: 0 }, fields)); }

  /** First not-yet-consumed message matching pred (or type string). */
  async next(pred, timeoutMs = 4000) {
    const match = typeof pred === 'string' ? (m) => m.type === pred : pred;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.msgs.findIndex(match);
      if (i !== -1) return this.msgs.splice(i, 1)[0];
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${typeof pred === 'string' ? pred : 'message'}; saw ${
          JSON.stringify(this.msgs.map((m) => m.type))}`);
      }
      await sleep(10);
    }
  }

  /** Assert NO matching message arrives within windowMs. */
  async none(pred, windowMs = 300) {
    const match = typeof pred === 'string' ? (m) => m.type === pred : pred;
    await sleep(windowMs);
    if (this.msgs.some(match)) {
      throw new Error(`unexpected message: ${JSON.stringify(this.msgs.filter(match)[0])}`);
    }
  }

  async waitClose(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('timed out waiting for close');
      await sleep(10);
    }
    return this.closeInfo;
  }

  close() { try { this.ws.close(); } catch (e) { /* already gone */ } }
}

/** Convenience: connect + hello + return {client, init}. */
async function join(inst, token, { cookie, name, resume, lastSeq = 0 } = {}) {
  const c = await new WSClient(inst, token, { cookie }).open();
  c.hello({ name, resume, lastSeq });
  const init = await c.next('init');
  return { c, init };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getSetCookies = (res) =>
  typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];

module.exports = { startInstance, makeHost, WSClient, join, sleep, getSetCookies };
