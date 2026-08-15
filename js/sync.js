/**
 * Sync Module - session layer for the collaborative whiteboard.
 *
 * Design (see README): server-authoritative append-only op log with
 * server-assigned monotonic seq, per-object last-write-wins by full-object
 * upsert, five op kinds (add / upsert / delete / clear / background) applied
 * on both sides by the shared Reducer (js/reducer.js).
 *
 * INERT IN SOLO MODE: until a session is established, `Sync.active` is false
 * and every hook below is a no-op, which keeps solo behaviour byte-identical
 * to the pre-sync app. Remote ops are applied through the same reducer under
 * the `Sync.applying` guard so the graft points do not re-emit them.
 */

const Sync = {
    // ---- state -------------------------------------------------------------
    active: false,      // a session is established (init received at least once)
    applying: false,    // a remote/inverse op is being applied; hooks must not emit
    connected: false,   // the socket is currently open and initialized
    isHost: false,
    canWrite: false,
    kicked: false,
    fatal: null,        // fatal join error code: no reconnect

    ws: null,
    token: null,        // share token used in /c/<token> and /ws/c/<token>
    resume: null,       // participant resume key, survives reconnects
    name: null,
    user: null,         // identity user (host only)
    seq: 0,             // last applied server seq

    pending: new Map(),       // cid -> op (unacked local ops; doubles as outbox)
    pendingAddIds: new Set(), // stroke ids added locally but not yet acked
    _cidCounter: 0,
    _cidRand: Math.random().toString(36).slice(2, 8),

    clockOffset: 0,           // serverNow - localNow, sampled from pings
    _reconnectDelay: 1000,
    _reconnectTimer: null,

    lastVideo: null,          // last host video state received
    userUnmuted: false,       // the guest tapped to unmute
    participants: [],

    VIDEO_DEADBAND_S: 0.75,
    MAX_OP_BYTES: 30000,      // stay under the server's 32 KB frame cap
    // Tools a read-only participant may still use (they never mutate the doc).
    READONLY_TOOLS: ['pan', 'lasso', 'marquee', 'laser-plain', 'laser-trail'],

    _copy(value) {
        return JSON.parse(JSON.stringify(value));
    },

    // ---- mode detection ----------------------------------------------------

    /**
     * Decide solo / host / guest. Never throws; on any failure the app stays
     * in solo mode exactly as before.
     */
    async init() {
        if (typeof window === 'undefined' || !window.location) return;

        const match = /^\/c\/([0-9a-zA-Z]{8,128})\/?$/.exec(window.location.pathname);
        if (match) {
            this.token = match[1];
            this._startGuestFlow();
            return;
        }

        let data = null;
        try {
            const res = await fetch('/api/session');
            if (res && res.ok) data = await res.json();
        } catch (e) { /* no server: solo mode */ }

        if (!data || !data.user || !data.canvas || !data.canvas.shareToken) {
            this._showSignin(data);
            return;
        }

        this.user = data.user;
        this.token = data.canvas.shareToken;
        this.name = data.user.display_name || data.user.username;
        this._showPanel();
        this._connect();
    },

    // ---- permission gates (queried by the graft points) --------------------

    /** May the local user mutate the shared document right now? */
    mayEdit() {
        if (!this.active) return true; // solo: unrestricted
        return this.connected && this.canWrite;
    },

    /** Clear is host-only in a session. */
    mayClear() {
        if (!this.active) return true;
        return this.connected && this.isHost;
    },

    /** Should this tool be inert for the local user? */
    blocksTool(tool) {
        if (!this.active) return false;
        if (this.connected && this.canWrite) return false;
        return this.READONLY_TOOLS.indexOf(tool) === -1;
    },

    /** Guests follow the host's playback; only the host drives transport. */
    blocksVideoTransport() {
        return this.active && !this.isHost;
    },

    // ---- outbound hooks (called from Canvas/Tools/Video graft points) ------

    onStrokeAdded(stroke) {
        if (!this.active || this.applying || !stroke || !stroke.id) return;
        this._shrinkToFit(stroke);
        this.pendingAddIds.add(stroke.id);
        this.emitOp({ kind: 'add', stroke: this._copy(stroke) });
    },

    onStrokesUpserted(strokes) {
        if (!this.active || this.applying) return;
        const withIds = (strokes || []).filter(s => s && s.id);
        if (withIds.length === 0) return;
        this.emitOp({ kind: 'upsert', strokes: this._copy(withIds) });
    },

    onStrokesDeleted(ids) {
        if (!this.active || this.applying) return;
        const clean = (ids || []).filter(Boolean);
        if (clean.length === 0) return;
        this.emitOp({ kind: 'delete', ids: clean });
    },

    onClear() {
        if (!this.active || this.applying) return;
        this.emitOp({ kind: 'clear' });
    },

    onBackground(key) {
        if (!this.active || this.applying) return;
        this.emitOp({ kind: 'background', key: key });
    },

    /** Host transport action (togglePlay / skip / scrub / rate). */
    onVideoControl(state) {
        if (!this.active || !this.isHost || !this.connected) return;
        this._send({
            type: 'video',
            playing: !!state.playing,
            time: Number(state.time) || 0,
            rate: Number(state.rate) || 1
        });
    },

    /**
     * A pathological freehand stroke can exceed the server frame cap. Thin its
     * points (in place, so the local copy matches what everyone else gets)
     * until the op fits.
     */
    _shrinkToFit(stroke) {
        if (!stroke.points || stroke.points.length < 3) return;
        let json = JSON.stringify(stroke);
        while (json.length > this.MAX_OP_BYTES && stroke.points.length > 2) {
            const kept = stroke.points.filter((p, i) =>
                i % 2 === 0 || i === stroke.points.length - 1);
            stroke.points.length = 0;
            Array.prototype.push.apply(stroke.points, kept);
            json = JSON.stringify(stroke);
        }
    },

    emitOp(op) {
        const cid = 'c' + this._cidRand + '-' + (++this._cidCounter);
        this.pending.set(cid, op);
        this._send({ type: 'op', cid: cid, op: op });
    },

    _send(obj) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(obj));
        }
    },

    // ---- applying ops locally ---------------------------------------------

    /**
     * Apply an op to the local document through the shared reducer.
     * Remote deletes shift array indices, so everything the UI tracks BY
     * INDEX (selection, active text edit, hidden stroke) is remapped first.
     */
    applyRemote(op) {
        this.applying = true;
        try {
            if (op.kind === 'delete') this._remapForDelete(op.ids || []);
            if (op.kind === 'clear') this._resetIndexState();

            const doc = { strokes: Canvas.strokes, background: Canvas.currentBackground };
            Reducer.apply(doc, op);

            if (op.kind === 'background' && doc.background !== Canvas.currentBackground) {
                Canvas.currentBackground = doc.background;
                Canvas.drawBackground();
                if (typeof UI !== 'undefined') UI.updateBackgroundSelection(doc.background);
            }

            // Keep our unacked local adds at the tail: committed strokes sit
            // in server seq order, optimistic ones float on top until acked.
            if (op.kind === 'add' || op.kind === 'upsert') this._floatPendingToTail();

            Canvas.redraw();
            if (typeof Tools !== 'undefined' && Tools.selectedStrokes.length > 0) {
                Tools.highlightSelection();
            }
        } finally {
            this.applying = false;
        }
    },

    /** Remap index-tracked UI state before strokes at `ids` are spliced out. */
    _remapForDelete(ids) {
        const idSet = {};
        for (const id of ids) idSet[id] = true;
        const removed = [];
        for (let i = 0; i < Canvas.strokes.length; i++) {
            const s = Canvas.strokes[i];
            if (s && s.id && idSet[s.id]) removed.push(i);
        }
        if (removed.length === 0) return;

        const shift = (index) => {
            if (index < 0) return index;
            if (removed.indexOf(index) !== -1) return -1; // deleted
            let below = 0;
            for (const r of removed) if (r < index) below++;
            return index - below;
        };

        if (typeof Tools !== 'undefined') {
            const before = Tools.selectedStrokes.length;
            Tools.selectedStrokes = Tools.selectedStrokes
                .map(shift)
                .filter(i => i >= 0);

            // A resize/move drag in flight over a selection that just changed
            // under it cannot continue coherently: cancel it.
            if (before !== Tools.selectedStrokes.length && (Tools.resizingHandle || Tools.moveStart)) {
                Tools.resizingHandle = null;
                Tools.resizeAnchor = null;
                Tools.resizeOriginalBounds = null;
                Tools.resizeStartMouse = null;
                Tools._resizeOriginalStrokes = null;
                Tools.moveStart = null;
                Tools._moveOriginalStrokes = null;
                Tools._didMove = false;
                Tools.isDrawing = false;
            }

            // An active text edit whose stroke was deleted remotely is
            // cancelled; one on a later stroke shifts down with it.
            if (Tools.textInputActive && Tools.editingTextIndex >= 0) {
                const next = shift(Tools.editingTextIndex);
                if (next === -1) {
                    Tools.cancelTextInput();
                } else {
                    Tools.editingTextIndex = next;
                }
            }
        }

        if (Canvas.hiddenStrokeIndex !== -1) {
            Canvas.hiddenStrokeIndex = shift(Canvas.hiddenStrokeIndex);
        }
    },

    /** A remote clear invalidates every index-tracked bit of UI state. */
    _resetIndexState() {
        if (typeof Tools !== 'undefined') {
            if (Tools.textInputActive) Tools.cancelTextInput();
            Tools.selectedStrokes = [];
            Tools.removeSelectionOverlay();
            Tools.resizingHandle = null;
            Tools.moveStart = null;
            Tools._moveOriginalStrokes = null;
        }
        Canvas.hiddenStrokeIndex = -1;
    },

    _floatPendingToTail() {
        if (this.pendingAddIds.size === 0) return;
        const strokes = Canvas.strokes;
        const before = strokes.slice();
        const floating = [];
        for (let i = strokes.length - 1; i >= 0; i--) {
            if (strokes[i] && this.pendingAddIds.has(strokes[i].id)) {
                floating.unshift(strokes.splice(i, 1)[0]);
            }
        }
        if (floating.length === 0) return;
        for (const s of floating) strokes.push(s);

        // The reorder moved indices; follow them by object identity.
        const follow = (index) =>
            index >= 0 && index < before.length ? strokes.indexOf(before[index]) : index;
        if (typeof Tools !== 'undefined') {
            Tools.selectedStrokes = Tools.selectedStrokes.map(follow).filter(i => i >= 0);
            if (Tools.editingTextIndex >= 0) Tools.editingTextIndex = follow(Tools.editingTextIndex);
        }
        if (Canvas.hiddenStrokeIndex >= 0) Canvas.hiddenStrokeIndex = follow(Canvas.hiddenStrokeIndex);
    },

    // ---- per-user undo/redo ------------------------------------------------

    /**
     * Undo the local user's last action by emitting inverse ops through the
     * same funnel as every other mutation. Global undo in a shared document
     * would destroy other people's work, so only the local history is walked.
     */
    undo() {
        if (!this.mayEdit()) return false;
        if (Canvas.undoStack.length === 0) return false;
        const entry = Canvas.undoStack.pop();
        const pair = this._invertEntry(entry);
        if (!pair) return false;
        for (const op of pair.undoOps) this._applyLocalAndEmit(op);
        Canvas.redoStack.push({ action: 'sync', undoOps: pair.undoOps, redoOps: pair.redoOps });
        if (typeof Tools !== 'undefined') Tools.clearSelection();
        return true;
    },

    redo() {
        if (!this.mayEdit()) return false;
        if (Canvas.redoStack.length === 0) return false;
        const entry = Canvas.redoStack.pop();
        if (entry.action !== 'sync') return false; // pre-session entries are gone
        for (const op of entry.redoOps) this._applyLocalAndEmit(op);
        Canvas.undoStack.push(entry);
        if (typeof Tools !== 'undefined') Tools.clearSelection();
        return true;
    },

    _applyLocalAndEmit(op) {
        this.applyRemote(op); // sets/clears the applying guard itself
        if (op.kind === 'add' && op.stroke) this.pendingAddIds.add(op.stroke.id);
        this.emitOp(op);
    },

    /**
     * Turn a Canvas undo entry into { undoOps, redoOps }. All object payloads
     * are deep copies captured NOW, before anything mutates.
     */
    _invertEntry(entry) {
        const currentById = (id) => {
            const i = Reducer.indexById(Canvas.strokes, id);
            return i >= 0 ? this._copy(Canvas.strokes[i]) : null;
        };

        switch (entry.action) {
            case 'add': {
                const stroke = this._copy(entry.stroke);
                if (!stroke.id) return null;
                return {
                    undoOps: [{ kind: 'delete', ids: [stroke.id] }],
                    redoOps: [{ kind: 'add', stroke: stroke }]
                };
            }
            case 'remove': {
                const stroke = this._copy(entry.stroke);
                if (!stroke.id) return null;
                return {
                    undoOps: [{ kind: 'add', stroke: stroke }],
                    redoOps: [{ kind: 'delete', ids: [stroke.id] }]
                };
            }
            case 'remove-multiple': {
                const items = entry.strokes.slice().sort((a, b) => a.index - b.index);
                const strokes = items.map(i => this._copy(i.stroke)).filter(s => s.id);
                if (strokes.length === 0) return null;
                return {
                    undoOps: [{ kind: 'upsert', strokes: strokes }],
                    redoOps: [{ kind: 'delete', ids: strokes.map(s => s.id) }]
                };
            }
            case 'replace': {
                const before = this._copy(entry.before).filter(s => s && s.id);
                if (before.length === 0) return null;
                const after = before.map(s => currentById(s.id)).filter(Boolean);
                return {
                    undoOps: [{ kind: 'upsert', strokes: before }],
                    redoOps: [{ kind: 'upsert', strokes: after }]
                };
            }
            case 'resize': {
                const originals = this._copy(entry.originalStrokes).filter(s => s && s.id);
                if (originals.length === 0) return null;
                const after = originals.map(s => currentById(s.id)).filter(Boolean);
                return {
                    undoOps: [{ kind: 'upsert', strokes: originals }],
                    redoOps: [{ kind: 'upsert', strokes: after }]
                };
            }
            case 'clear': {
                const strokes = this._copy(entry.strokes).filter(s => s && s.id);
                return {
                    undoOps: [{ kind: 'upsert', strokes: strokes }],
                    redoOps: [{ kind: 'clear' }]
                };
            }
            case 'sync':
                return { undoOps: entry.undoOps, redoOps: entry.redoOps };
            default:
                return null;
        }
    },

    // ---- images over HTTP --------------------------------------------------

    /**
     * Upload a pasted image once, then place a tiny /api/files/<hash>
     * reference on the canvas. Data URLs never cross the WebSocket.
     */
    async pasteImage(blob) {
        if (!this.mayEdit()) return null;
        try {
            const res = await fetch('/api/c/' + encodeURIComponent(this.token) + '/files', {
                method: 'POST',
                headers: {
                    'Content-Type': blob.type || 'application/octet-stream',
                    'X-Draw-Participant': this.resume || ''
                },
                body: blob
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(this._uploadError(err.error));
                return null;
            }
            const info = await res.json();
            return await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    resolve(Canvas.addImageStroke(info.url, img.naturalWidth, img.naturalHeight));
                    if (typeof UI !== 'undefined') UI.updateUndoRedoButtons();
                };
                img.onerror = () => { alert('Image upload failed.'); resolve(null); };
                img.src = info.url;
            });
        } catch (e) {
            alert('Image upload failed.');
            return null;
        }
    },

    _uploadError(code) {
        if (code === 'too_large') return 'Image too large (4 MB max).';
        if (code === 'canvas_quota') return 'This canvas has reached its 16 MB image limit.';
        return 'Image upload failed.';
    },

    // ---- snapshot load in a session ---------------------------------------

    /** Host-only: server replays the snapshot as ops to every participant. */
    async loadSnapshot(name) {
        const res = await fetch('/api/load-live/' + encodeURIComponent(name), { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to load drawing');
        }
    },

    // ---- websocket ---------------------------------------------------------

    _wsUrl() {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return proto + '//' + window.location.host + '/ws/c/' + this.token;
    },

    _connect() {
        if (this.kicked || this.fatal) return;
        this._setStatus('Connecting…');
        let ws;
        try {
            ws = new WebSocket(this._wsUrl());
        } catch (e) {
            this._scheduleReconnect();
            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            this._send({
                type: 'hello',
                name: this.name || undefined,
                resume: this.resume || undefined,
                lastSeq: this.seq
            });
        };
        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            this._onMessage(msg);
        };
        ws.onclose = () => {
            this.connected = false;
            if (this.ws === ws) this.ws = null;
            this._updateUi();
            if (!this.kicked && !this.fatal) {
                this._setStatus('Reconnecting…');
                this._scheduleReconnect();
            }
        };
        ws.onerror = () => { /* onclose follows */ };
    },

    _scheduleReconnect() {
        if (this._reconnectTimer || this.kicked || this.fatal) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._connect();
        }, this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000);
    },

    _onMessage(msg) {
        switch (msg.type) {
            case 'init': this._onInit(msg); break;
            case 'op': this._onOp(msg); break;
            case 'ack': this._ackCid(msg.cid); break;
            case 'reject': this._onReject(msg); break;
            case 'perm': this._onPerm(msg); break;
            case 'participants':
                this.participants = msg.participants || [];
                this._updateUi();
                break;
            case 'kicked': this._onKicked(); break;
            case 'video': this._onVideo(msg); break;
            case 'ping':
                if (typeof msg.t === 'number') this.clockOffset = msg.t - Date.now();
                this._send({ type: 'pong', t: msg.t });
                break;
            case 'error': this._onError(msg); break;
        }
    },

    _onInit(msg) {
        this._reconnectDelay = 1000;
        this.seq = msg.seq || 0;
        this.isHost = !!(msg.you && msg.you.host);
        this.canWrite = !!(msg.you && (msg.you.host || msg.you.write));
        if (msg.resume) {
            this.resume = msg.resume;
            this._remember();
        }
        this.participants = msg.participants || [];

        this.applying = true;
        try {
            Canvas.loadState({
                strokes: (msg.doc && msg.doc.strokes) || [],
                background: (msg.doc && msg.doc.background) || 'grid-light',
                offsetX: Canvas.offsetX,
                offsetY: Canvas.offsetY,
                scale: Canvas.scale
            });
        } finally {
            this.applying = false;
        }
        if (typeof UI !== 'undefined') {
            UI.updateBackgroundSelection(Canvas.currentBackground);
            UI.updateUndoRedoButtons();
        }

        this.active = true;
        this.connected = true;
        this._hideJoinOverlay();
        this._updateUi();
        this._setStatus(this.isHost ? 'Live — hosting' : (this.canWrite ? 'Live — editing' : 'Live — viewing'));

        if (msg.video) this._onVideo(msg.video);

        // Anything unacked from before the drop is resent; the server dedupes
        // by cid, so an op that already landed is acked, not applied twice.
        for (const [cid, op] of this.pending) {
            this._send({ type: 'op', cid: cid, op: op });
        }
    },

    _onOp(msg) {
        if (typeof msg.seq === 'number') this.seq = msg.seq;
        // Own ops come back too. Reducer application is idempotent, so simply
        // apply everything; this also heals the post-reconnect case where the
        // init doc predates a resent op.
        this.applyRemote(msg.op);
        if (msg.cid) this._ackCid(msg.cid);
        if (typeof UI !== 'undefined') UI.updateUndoRedoButtons();
    },

    _ackCid(cid) {
        const op = this.pending.get(cid);
        if (!op) return;
        this.pending.delete(cid);
        if (op.kind === 'add' && op.stroke) this.pendingAddIds.delete(op.stroke.id);
    },

    /**
     * The server refused an op (permission race, cap hit). The optimistic
     * local application is now wrong; ask for a fresh document rather than
     * trying to surgically roll back.
     */
    _onReject(msg) {
        if (msg.cid) this._ackCid(msg.cid);
        if (msg.reason === 'stroke_limit' || msg.reason === 'doc_size') {
            alert('The canvas is full (limit reached).');
        }
        this._send({ type: 'sync' });
    },

    _onPerm(msg) {
        this.canWrite = !!msg.write || this.isHost;
        if (!this.canWrite) {
            // Revoked mid-gesture: drop anything in flight.
            if (Canvas.currentStroke) Canvas.currentStroke = null;
            if (typeof Tools !== 'undefined') {
                Tools.isDrawing = false;
                Tools.shapeStart = null;
                if (Tools.textInputActive) Tools.cancelTextInput();
            }
            Canvas.redraw();
        }
        this._setStatus(this.isHost ? 'Live — hosting' : (this.canWrite ? 'Live — editing' : 'Live — viewing'));
        this._updateUi();
    },

    _onKicked() {
        this.kicked = true;
        this.connected = false;
        this._setStatus('Removed from session');
        this._showJoinOverlay('You were removed from this session.', false);
    },

    _onError(msg) {
        const fatalCodes = ['bad_token', 'banned', 'kicked'];
        if (fatalCodes.indexOf(msg.code) !== -1) this.fatal = msg.code;
        const text = {
            bad_token: 'This share link is no longer valid.',
            banned: 'You cannot rejoin this session.',
            full: 'This session is full.',
            busy: 'The server is at capacity — try again shortly.',
            rate: 'Too many join attempts — wait a few seconds.',
            name_required: 'Enter a display name to join.'
        }[msg.code] || 'Could not join the session.';
        if (this.active && !this.fatal) {
            this._setStatus(text);
        } else {
            this._showJoinOverlay(text, !this.fatal);
        }
    },

    // ---- video follow (guests) ---------------------------------------------

    _onVideo(msg) {
        this.lastVideo = msg;
        if (this.isHost) return;
        this._applyVideoState(msg);
    },

    /** Called from Video.onPlayerReady so a late-mounting player catches up. */
    onVideoPlayerReady() {
        if (!this.active) return;
        if (this.isHost) return;
        if (typeof Video !== 'undefined') Video.setTransportEnabled(true); // re-runs the guest lock
        if (this.lastVideo) this._applyVideoState(this.lastVideo);
    },

    _applyVideoState(msg) {
        if (typeof Video === 'undefined' || !Video.player) return;
        const player = Video.player;

        const rate = Number(msg.rate) || 1;
        if (typeof player.getPlaybackRate === 'function'
            && typeof player.setPlaybackRate === 'function'
            && player.getPlaybackRate() !== rate) {
            player.setPlaybackRate(rate);
        }

        // Where the host's playhead is NOW, projected with the server clock.
        let target = Number(msg.time) || 0;
        if (msg.playing && typeof msg.at === 'number') {
            const serverNow = Date.now() + this.clockOffset;
            target += Math.max(0, (serverNow - msg.at) / 1000) * rate;
        }

        const current = Video.readTime('getCurrentTime');
        if (Math.abs(current - target) > this.VIDEO_DEADBAND_S
            && typeof player.seekTo === 'function') {
            player.seekTo(target, true);
        }

        const playing = Video.isPlaying();
        if (msg.playing && !playing) {
            // Autoplay with sound needs a user gesture; follow muted and offer
            // a tap-to-unmute affordance instead.
            if (!this.userUnmuted && typeof player.mute === 'function') {
                player.mute();
                this._showUnmute(true);
            }
            if (typeof player.playVideo === 'function') player.playVideo();
        } else if (!msg.playing && playing) {
            if (typeof player.pauseVideo === 'function') player.pauseVideo();
        }
        Video.updateTransport();
    },

    // ---- DOM: status, panel, join overlay ----------------------------------

    _el(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    },

    _setStatus(text) {
        const el = this._el('session-status');
        if (el) el.textContent = text;
    },

    _showSignin(data) {
        const section = this._el('session-section');
        if (!section) return;
        // Only reveal the sign-in link when a real server answered; a purely
        // static deployment (tests) keeps the section hidden.
        if (!data || typeof data !== 'object' || Array.isArray(data) || !('user' in data)) return;
        section.classList.remove('hidden');
        this._setStatus('Solo');
        const signin = this._el('session-signin');
        if (signin) signin.classList.remove('hidden');
    },

    _showPanel() {
        const section = this._el('session-section');
        if (!section) return;
        section.classList.remove('hidden');
        const signin = this._el('session-signin');
        if (signin) signin.classList.add('hidden');
        const host = this._el('session-host-controls');
        if (host) host.classList.remove('hidden');

        const link = this._el('share-link');
        if (link) link.value = window.location.origin + '/c/' + this.token;

        const copy = this._el('share-copy-btn');
        if (copy && !copy._wired) {
            copy._wired = true;
            copy.addEventListener('click', () => {
                const input = this._el('share-link');
                if (!input) return;
                input.select();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(input.value).catch(() => {});
                } else if (typeof document.execCommand === 'function') {
                    document.execCommand('copy');
                }
            });
        }

        const rotate = this._el('share-rotate-btn');
        if (rotate && !rotate._wired) {
            rotate._wired = true;
            rotate.addEventListener('click', async () => {
                if (!confirm('Create a new share link? Everyone with the old link loses access.')) return;
                try {
                    const res = await fetch('/api/rotate-token', { method: 'POST' });
                    if (!res.ok) throw new Error('rotate failed');
                    const data = await res.json();
                    this.token = data.shareToken;
                    const input = this._el('share-link');
                    if (input) input.value = window.location.origin + '/c/' + this.token;
                } catch (e) {
                    alert('Could not rotate the share link.');
                }
            });
        }
    },

    _startGuestFlow() {
        let stored = null;
        try {
            stored = JSON.parse(window.sessionStorage.getItem('draw_guest_' + this.token));
        } catch (e) { /* fresh guest */ }
        if (stored && stored.resume) {
            this.resume = stored.resume;
            this.name = stored.name;
            this._connect();
            return;
        }
        this._showJoinOverlay('Enter a display name to join this whiteboard.', true);
    },

    _remember() {
        try {
            window.sessionStorage.setItem('draw_guest_' + this.token,
                JSON.stringify({ resume: this.resume, name: this.name }));
        } catch (e) { /* private mode */ }
    },

    _showJoinOverlay(message, joinable) {
        const overlay = this._el('join-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        const msgEl = this._el('join-message');
        if (msgEl) msgEl.textContent = message;
        const nameEl = this._el('join-name');
        const btn = this._el('join-btn');
        if (nameEl) nameEl.classList.toggle('hidden', !joinable);
        if (btn) btn.classList.toggle('hidden', !joinable);
        if (!joinable) return;

        if (nameEl && this.name) nameEl.value = this.name;
        const join = () => {
            const name = (nameEl && nameEl.value || '').trim().slice(0, 40);
            if (!name) return;
            this.name = name;
            overlay.classList.add('hidden');
            this._connect();
        };
        if (btn && !btn._wired) {
            btn._wired = true;
            btn.addEventListener('click', join);
            if (nameEl) {
                nameEl.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') join();
                });
            }
        }
        if (nameEl) nameEl.focus();
    },

    _hideJoinOverlay() {
        const overlay = this._el('join-overlay');
        if (overlay) overlay.classList.add('hidden');
    },

    _showUnmute(show) {
        const btn = this._el('video-unmute-overlay');
        if (!btn) return;
        btn.classList.toggle('hidden', !show);
        if (show && !btn._wired) {
            btn._wired = true;
            btn.addEventListener('click', () => {
                this.userUnmuted = true;
                if (typeof Video !== 'undefined' && Video.isMuted()) Video.toggleMute();
                btn.classList.add('hidden');
            });
        }
    },

    /** Re-render everything that depends on role/permission/presence. */
    _updateUi() {
        this._updateToolLock();
        this._renderParticipants();
        const section = this._el('session-section');
        if (this.active && section) section.classList.remove('hidden');
        // Snapshots are the host's private saves; guests get no save/load.
        if (this.active && !this.isHost) {
            for (const id of ['save-btn', 'load-btn']) {
                const el = this._el(id);
                if (el) el.classList.add('hidden');
            }
        }
    },

    _updateToolLock() {
        if (typeof document === 'undefined') return;
        const locked = this.active && (!this.connected || !this.canWrite);
        const allowed = ['pan', 'lasso', 'marquee', 'laser', 'laser-plain', 'laser-trail'];
        document.querySelectorAll('.tool-btn').forEach((btn) => {
            const tool = btn.dataset.tool;
            btn.disabled = locked && !!tool && allowed.indexOf(tool) === -1;
        });
        for (const id of ['clear-btn', 'video-embed-btn', 'video-remove-btn']) {
            const el = this._el(id);
            if (el) el.disabled = this.active && (id === 'clear-btn'
                ? !(this.connected && this.isHost)
                : locked);
        }
        document.querySelectorAll('.bg-option').forEach((el) => {
            el.disabled = locked;
        });
        document.body.classList.toggle('sync-readonly', locked);
    },

    _renderParticipants() {
        const list = this._el('participant-list');
        if (!list) return;
        list.innerHTML = '';
        if (!this.active) return;

        for (const p of this.participants) {
            const row = document.createElement('div');
            row.className = 'participant-row';

            const label = document.createElement('span');
            label.className = 'participant-name';
            label.textContent = p.name + (p.host ? ' (host)' : '');
            row.appendChild(label);

            if (this.isHost && !p.host) {
                const write = document.createElement('button');
                write.className = 'session-btn participant-btn';
                write.textContent = p.write ? 'Revoke edit' : 'Allow edit';
                write.addEventListener('click', () => {
                    this._send({ type: 'perm', participantId: p.id, write: !p.write });
                });
                row.appendChild(write);

                const kick = document.createElement('button');
                kick.className = 'session-btn participant-btn participant-kick';
                kick.textContent = 'Kick';
                kick.addEventListener('click', () => {
                    if (confirm('Remove ' + p.name + ' from the session?')) {
                        this._send({ type: 'kick', participantId: p.id });
                    }
                });
                row.appendChild(kick);
            }
            list.appendChild(row);
        }
    }
};
