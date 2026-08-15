/**
 * Live canvas rooms — the WebSocket session layer.
 *
 * The document model is exactly js/sync.js's: a server-authoritative op log
 * with server-assigned monotonic seq, materialized through the SAME reducer
 * file the browser runs (js/reducer.js), so client and server converge
 * byte-for-byte from the same op stream.
 *
 * Every ceiling here refuses cleanly (an error/reject frame, or a close)
 * rather than degrading — this box hosts two mission-critical businesses.
 */

'use strict';

const crypto = require('crypto');
const Reducer = require('../js/reducer.js');
const { log } = require('./logger');

const logger = log('ws');

const OP_KINDS = new Set(Reducer.OP_KINDS);
const SEEN_CIDS = 64; // per-participant dedupe window

class Rooms {
  constructor(config, store) {
    this.config = config;
    this.store = store;                 // db api from openDb()
    this.rooms = new Map();             // canvasId -> room
    this.totalConns = 0;
    this.joinAttempts = new Map();      // ip -> [timestamps]

    this.pingTimer = setInterval(() => this._pingAll(), config.pingIntervalMs);
    this.pingTimer.unref();
  }

  /* ------------------------------------------------ connection entry ----- */

  /**
   * A fresh WebSocket straight from the upgrade handler. `ctx` is
   * { token, user|null, ip } — user was resolved LOCALLY from the draw_sid
   * cookie; identity is never consulted on this path.
   */
  attach(ws, ctx) {
    if (this.totalConns >= this.config.maxWsConnections) {
      return this._refuse(ws, 'busy');
    }
    if (!this._joinAllowed(ctx.ip)) {
      return this._refuse(ws, 'rate');
    }

    this.totalConns++;
    const conn = {
      ws,
      ctx,
      room: null,
      part: null,
      alive: true,
      // Token bucket: refuse-then-strike, three strikes closes the socket.
      tokens: this.config.rateBurst,
      lastRefill: Date.now(),
      strikes: 0,
    };
    ws._drawConn = conn;

    // A socket that never says hello is holding a global slot hostage.
    const helloTimeout = setTimeout(() => {
      if (!conn.part) ws.close(1000, 'no hello');
    }, 15000);
    helloTimeout.unref();

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (!this._takeToken(conn)) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      try {
        this._onMessage(conn, msg);
      } catch (err) {
        logger.error(err, { during: msg.type });
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      this.totalConns--;
      this._onClose(conn);
    });
    ws.on('error', () => { /* close follows */ });
  }

  _refuse(ws, code) {
    try { ws.send(JSON.stringify({ type: 'error', code })); } catch (e) { /* gone */ }
    ws.close(1013, code);
  }

  _joinAllowed(ip) {
    const now = Date.now();
    const list = (this.joinAttempts.get(ip) || [])
      .filter((t) => now - t < this.config.joinRateWindowMs);
    if (list.length >= this.config.joinRateCount) {
      this.joinAttempts.set(ip, list);
      return false;
    }
    list.push(now);
    this.joinAttempts.set(ip, list);
    if (this.joinAttempts.size > 1000) {
      // Drop stale IPs so the map cannot grow without bound.
      for (const [k, v] of this.joinAttempts) {
        if (v.every((t) => now - t >= this.config.joinRateWindowMs)) this.joinAttempts.delete(k);
      }
    }
    return true;
  }

  _takeToken(conn) {
    const now = Date.now();
    conn.tokens = Math.min(
      this.config.rateBurst,
      conn.tokens + ((now - conn.lastRefill) / 1000) * this.config.rateMsgsPerSec
    );
    conn.lastRefill = now;
    if (conn.tokens < 1) {
      conn.strikes++;
      if (conn.strikes >= this.config.rateStrikes) {
        logger.warn('rate limit: closing socket', { ip: conn.ctx.ip });
        conn.ws.close(1008, 'rate');
      }
      return false;
    }
    conn.tokens -= 1;
    return true;
  }

  /* ------------------------------------------------ message dispatch ----- */

  _onMessage(conn, msg) {
    if (msg.type === 'hello') return this._onHello(conn, msg);
    if (msg.type === 'pong') { conn.alive = true; return; }
    if (!conn.part || !conn.room) return; // everything else requires a join

    switch (msg.type) {
      case 'op': return this._onOp(conn, msg);
      case 'sync': return this._send(conn.ws, this._initMsg(conn.room, conn.part));
      case 'perm': return this._onPerm(conn, msg);
      case 'kick': return this._onKick(conn, msg);
      case 'video': return this._onVideo(conn, msg);
      default: /* unknown types are ignored, mirroring the client */ break;
    }
  }

  /* ------------------------------------------------ hello / join --------- */

  _onHello(conn, msg) {
    if (conn.part) return; // duplicate hello

    const canvas = this.store.canvasByToken(conn.ctx.token);
    if (!canvas) return this._fatal(conn.ws, 'bad_token');

    const room = this._loadRoom(canvas);
    if (!room) return this._refuse(conn.ws, 'busy'); // all room slots active

    const isHost = !!(conn.ctx.user && conn.ctx.user.id === canvas.user_id);
    let part = null;

    const resume = typeof msg.resume === 'string' ? msg.resume : '';
    if (resume && room.banned.has(resume)) return this._fatal(conn.ws, 'banned');
    if (resume && room.parts.has(resume)) {
      part = room.parts.get(resume);
      // A participant record minted for a host stays a host only while the
      // cookie still proves it; a forged/expired cookie demotes to guest.
      if (part.host && !isHost) part.host = false;
      if (part.conn && part.conn !== conn) {
        // Zombie socket from before a Cloudflare drop: the new one wins.
        try { part.conn.ws.close(1000, 'superseded'); } catch (e) { /* gone */ }
        part.conn.part = null;
      }
    }

    if (!part) {
      const name = String(msg.name || (isHost && conn.ctx.user
        ? conn.ctx.user.display_name || conn.ctx.user.username : '') || '')
        .trim().slice(0, 40);
      if (!name) return this._refuse(conn.ws, 'name_required');
      if (this._online(room).length >= this.config.maxParticipants) {
        return this._refuse(conn.ws, 'full');
      }
      part = {
        id: 'p' + crypto.randomBytes(6).toString('hex'),
        resume: crypto.randomBytes(24).toString('hex'),
        name,
        host: isHost,
        write: isHost,           // guests start read-only; the host grants
        userId: isHost ? conn.ctx.user.id : null,
        conn: null,
        seen: [],                // cid dedupe ring (last SEEN_CIDS)
        seenSet: new Set(),
      };
      room.parts.set(part.resume, part);
    } else if (msg.name && !part.host) {
      part.name = String(msg.name).trim().slice(0, 40) || part.name;
    }

    part.conn = conn;
    conn.part = part;
    conn.room = room;
    room.lastActive = Date.now();
    if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }

    this._send(conn.ws, this._initMsg(room, part));
    this._broadcastParticipants(room);
    logger.info('joined', {
      canvas: room.id, part: part.id, host: part.host, online: this._online(room).length,
    });
  }

  _fatal(ws, code) {
    try { ws.send(JSON.stringify({ type: 'error', code })); } catch (e) { /* gone */ }
    ws.close(1008, code);
  }

  _initMsg(room, part) {
    const msg = {
      type: 'init',
      seq: room.seq,
      you: { host: part.host, write: part.write },
      resume: part.resume,
      participants: this._participantList(room),
      doc: { strokes: room.doc.strokes, background: room.doc.background },
    };
    if (room.video) msg.video = room.video;
    return msg;
  }

  /* ------------------------------------------------ ops ------------------ */

  _onOp(conn, msg) {
    const { room, part } = conn;
    const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 64) : null;
    const reject = (reason) => this._send(conn.ws, { type: 'reject', cid, reason });

    if (!part.host && !part.write) return reject('forbidden');

    const op = msg.op;
    if (!op || typeof op !== 'object' || !OP_KINDS.has(op.kind)) return reject('bad_op');
    // Clear wipes everyone's work — host only, matching Sync.mayClear().
    if (op.kind === 'clear' && !part.host) return reject('forbidden');

    // Same cid seen before: the op already landed (this is a resend after a
    // reconnect). Ack, never apply twice.
    if (cid && part.seenSet.has(cid)) {
      return this._send(conn.ws, { type: 'ack', cid });
    }

    // Document ceilings, enforced before the reducer ever runs.
    if (op.kind === 'add' || op.kind === 'upsert') {
      const strokes = op.kind === 'add' ? [op.stroke] : op.strokes;
      if (!Array.isArray(strokes) && op.kind === 'upsert') return reject('bad_op');
      let newCount = 0;
      let addBytes = 0;
      for (const s of strokes || []) {
        if (!s || !s.id) continue;
        const bytes = JSON.stringify(s).length;
        const prev = room.strokeBytes.get(s.id);
        if (prev === undefined) newCount++;
        addBytes += bytes - (prev || 0);
      }
      if (room.doc.strokes.length + newCount > this.config.maxStrokes) {
        return reject('stroke_limit');
      }
      if (room.docBytes + addBytes > this.config.maxDocBytes) {
        return reject('doc_size');
      }
    }

    this._applyAndBroadcast(room, op, cid);
    if (cid) {
      part.seen.push(cid);
      part.seenSet.add(cid);
      if (part.seen.length > SEEN_CIDS) part.seenSet.delete(part.seen.shift());
    }
  }

  /**
   * Assign a seq, apply through the shared reducer, log, broadcast to every
   * participant — the originator included: reducer application is idempotent
   * and the echo heals a post-reconnect gap (and doubles as the ack via cid).
   */
  _applyAndBroadcast(room, op, cid) {
    Reducer.apply(room.doc, op);
    this._trackBytes(room, op);

    const seq = ++room.seq;
    this.store.appendOp(room.id, seq, op);

    const frame = { type: 'op', seq, op };
    if (cid) frame.cid = cid;
    this._broadcast(room, frame);

    room.opsSinceCompact++;
    room.dirty = true;
    if (room.opsSinceCompact >= this.config.compactEveryOps) this._compact(room);
    return seq;
  }

  // Incremental doc-size ledger: sum of each stroke's JSON length, so the
  // 2 MB ceiling never needs a full stringify on the hot path.
  _trackBytes(room, op) {
    const put = (s) => {
      if (!s || !s.id) return;
      const bytes = JSON.stringify(s).length;
      const prev = room.strokeBytes.get(s.id) || 0;
      room.strokeBytes.set(s.id, bytes);
      room.docBytes += bytes - prev;
    };
    switch (op.kind) {
      case 'add': put(op.stroke); break;
      case 'upsert': for (const s of op.strokes || []) put(s); break;
      case 'delete':
        for (const id of op.ids || []) {
          const prev = room.strokeBytes.get(id);
          if (prev !== undefined) { room.docBytes -= prev; room.strokeBytes.delete(id); }
        }
        break;
      case 'clear':
        room.strokeBytes.clear();
        room.docBytes = 0;
        break;
      default: break;
    }
  }

  /* ------------------------------------------------ host controls -------- */

  _onPerm(conn, msg) {
    const { room, part } = conn;
    if (!part.host) return; // tampered client: silently ignored server-side
    const target = this._byId(room, msg.participantId);
    if (!target || target.host) return;
    target.write = !!msg.write;
    if (target.conn) this._send(target.conn.ws, { type: 'perm', write: target.write });
    this._broadcastParticipants(room);
  }

  _onKick(conn, msg) {
    const { room, part } = conn;
    if (!part.host) return;
    const target = this._byId(room, msg.participantId);
    if (!target || target.host) return;
    room.banned.add(target.resume);
    room.parts.delete(target.resume);
    if (target.conn) {
      this._send(target.conn.ws, { type: 'kicked' });
      target.conn.part = null; // detach so close doesn't re-broadcast
      try { target.conn.ws.close(1000, 'kicked'); } catch (e) { /* gone */ }
    }
    this._broadcastParticipants(room);
    logger.info('kicked', { canvas: room.id, part: target.id });
  }

  _onVideo(conn, msg) {
    const { room, part } = conn;
    if (!part.host) return;
    room.video = {
      type: 'video',
      playing: !!msg.playing,
      time: Number(msg.time) || 0,
      rate: Number(msg.rate) || 1,
      at: Date.now(),           // server timestamp; clients correct via ping clock offset
    };
    this._broadcast(room, room.video);
  }

  /* ------------------------------------------------ presence ------------- */

  _onClose(conn) {
    const { room, part } = conn;
    if (!room || !part) return;
    if (part.conn === conn) part.conn = null;
    conn.part = null;
    this._broadcastParticipants(room);
    if (this._online(room).length === 0) {
      room.idleTimer = setTimeout(() => this._evict(room), this.config.roomIdleMs);
      room.idleTimer.unref();
    }
  }

  _online(room) {
    return [...room.parts.values()].filter((p) => p.conn);
  }

  _byId(room, id) {
    for (const p of room.parts.values()) if (p.id === id) return p;
    return null;
  }

  _participantList(room) {
    return this._online(room).map((p) => ({
      id: p.id, name: p.name, host: p.host, write: p.host || p.write,
    }));
  }

  _broadcastParticipants(room) {
    this._broadcast(room, { type: 'participants', participants: this._participantList(room) });
  }

  _broadcast(room, obj) {
    const data = JSON.stringify(obj);
    for (const p of this._online(room)) {
      if (p.conn.ws.readyState === 1) p.conn.ws.send(data);
    }
  }

  _send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  _pingAll() {
    const t = Date.now();
    for (const room of this.rooms.values()) {
      for (const p of this._online(room)) {
        if (!p.conn.alive) {
          // Two missed pings (~60-90s): Cloudflare has almost certainly
          // already killed it; reclaim the slot.
          try { p.conn.ws.terminate(); } catch (e) { /* gone */ }
          continue;
        }
        p.conn.alive = false;
        this._send(p.conn.ws, { type: 'ping', t });
      }
      if (room.dirty && Date.now() - room.lastCompact >= this.config.compactEveryMs) {
        this._compact(room);
      }
    }
  }

  /* ------------------------------------------------ room lifecycle ------- */

  _loadRoom(canvas) {
    let room = this.rooms.get(canvas.id);
    if (room) return room;

    if (this.rooms.size >= this.config.maxRooms) {
      // Evict the longest-idle room with nobody online (snapshot first).
      let victim = null;
      for (const r of this.rooms.values()) {
        if (this._online(r).length === 0 && (!victim || r.lastActive < victim.lastActive)) {
          victim = r;
        }
      }
      if (!victim) return null; // every slot has live participants: refuse
      this._evict(victim);
    }

    // Materialize: persisted doc + replay of any ops newer than it.
    const doc = JSON.parse(canvas.doc);
    if (!Array.isArray(doc.strokes)) doc.strokes = [];
    if (!doc.background) doc.background = 'grid-light';
    for (const { op } of this.store.opsAfter(canvas.id, canvas.doc_seq)) {
      Reducer.apply(doc, op);
    }

    room = {
      id: canvas.id,
      doc,
      seq: canvas.seq,
      parts: new Map(),          // resume key -> participant
      banned: new Set(),
      video: null,
      strokeBytes: new Map(),
      docBytes: 0,
      opsSinceCompact: 0,
      lastCompact: Date.now(),
      dirty: false,
      idleTimer: null,
      lastActive: Date.now(),
    };
    for (const s of doc.strokes) {
      if (s && s.id) {
        const b = JSON.stringify(s).length;
        room.strokeBytes.set(s.id, b);
        room.docBytes += b;
      }
    }
    this.rooms.set(canvas.id, room);
    return room;
  }

  _compact(room) {
    this.store.saveDoc(room.id, room.doc, room.seq);
    room.opsSinceCompact = 0;
    room.lastCompact = Date.now();
    room.dirty = false;
    // Re-true the incremental byte ledger while we hold the full JSON anyway.
    room.docBytes = 0;
    room.strokeBytes.clear();
    for (const s of room.doc.strokes) {
      if (s && s.id) {
        const b = JSON.stringify(s).length;
        room.strokeBytes.set(s.id, b);
        room.docBytes += b;
      }
    }
  }

  _evict(room) {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    if (room.dirty) this._compact(room);
    this.rooms.delete(room.id);
    logger.info('room evicted', { canvas: room.id });
  }

  /* ------------------------------------------------ HTTP-facing hooks ---- */

  /** Guest upload auth: does this resume key belong to a writer on this canvas? */
  findWriter(canvasId, resumeKey) {
    const room = this.rooms.get(canvasId);
    if (!room || !resumeKey) return null;
    const part = room.parts.get(resumeKey);
    return part && (part.host || part.write) ? part : null;
  }

  /**
   * Replace the LIVE document with a snapshot's state and broadcast it as
   * ordinary ops (clear + background + chunked upserts) so every connected
   * client converges through the same reducer path. Works with or without a
   * live room; returns false only if the doc could not be replaced.
   */
  loadSnapshotLive(canvas, state) {
    const strokes = (Array.isArray(state.strokes) ? state.strokes : [])
      .filter((s) => s && typeof s === 'object')
      .slice(0, this.config.maxStrokes)
      .map((s) => (s.id ? s : Object.assign({}, s, {
        id: 's' + crypto.randomBytes(8).toString('hex'),
      })));

    const ops = [{ kind: 'clear' }];
    if (Reducer.BACKGROUNDS.indexOf(state.background) !== -1) {
      ops.push({ kind: 'background', key: state.background });
    }
    // Chunk the upserts: a full 2 MB document must not go out as one frame.
    const CHUNK_BYTES = 64 * 1024;
    let chunk = [];
    let bytes = 0;
    const flush = () => {
      if (chunk.length) ops.push({ kind: 'upsert', strokes: chunk });
      chunk = [];
      bytes = 0;
    };
    for (const s of strokes) {
      const b = JSON.stringify(s).length;
      if (bytes + b > CHUNK_BYTES && chunk.length) flush();
      chunk.push(s);
      bytes += b;
    }
    flush();

    const room = this.rooms.get(canvas.id) || this._loadRoom(this.store.canvasById(canvas.id));
    if (room) {
      for (const op of ops) this._applyAndBroadcast(room, op, null);
      this._compact(room);
      return true;
    }
    // Every room slot is busy with live sessions; apply straight to storage.
    const fresh = this.store.canvasById(canvas.id);
    const doc = JSON.parse(fresh.doc);
    if (!Array.isArray(doc.strokes)) doc.strokes = [];
    for (const { op } of this.store.opsAfter(fresh.id, fresh.doc_seq)) Reducer.apply(doc, op);
    let seq = fresh.seq;
    for (const op of ops) {
      Reducer.apply(doc, op);
      this.store.appendOp(fresh.id, ++seq, op);
    }
    this.store.saveDoc(fresh.id, doc, seq);
    return true;
  }

  /** Persist every dirty room (shutdown path). */
  flush() {
    for (const room of this.rooms.values()) {
      if (room.dirty) this._compact(room);
    }
  }

  close() {
    clearInterval(this.pingTimer);
    for (const room of [...this.rooms.values()]) {
      for (const p of this._online(room)) {
        try { p.conn.ws.close(1001, 'server shutdown'); } catch (e) { /* gone */ }
      }
      this._evict(room);
    }
  }
}

module.exports = { Rooms };
