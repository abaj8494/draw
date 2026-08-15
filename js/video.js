/**
 * Video Module - world-anchored YouTube embedding
 *
 * The player is a DOM iframe layered between the background and drawing
 * canvases. Its screen rect is derived from a `type:'video'` stroke living in
 * Canvas.strokes, so it pans and zooms with the drawing and annotations stay
 * locked to the frame.
 */

const Video = {
    API_TIMEOUT_MS: 10000,
    API_SRC: 'https://www.youtube.com/iframe_api',
    HOST: 'https://www.youtube-nocookie.com',
    RATES: [0.5, 1, 1.5, 2],
    SKIP_SECONDS: 10,
    TICK_MS: 250,
    PLAYING: 1, // YT.PlayerState.PLAYING

    player: null,
    isScrubbing: false,
    tickTimer: null,
    // Test seam: (targetEl, opts) => player. When set, the network is never
    // touched and player creation is synchronous.
    playerFactory: null,
    currentVideoId: null,
    apiFailed: false,

    _apiPromise: null,
    _creating: false,
    _applyCount: 0,
    _lastTransform: null,
    _lastW: null,
    _lastH: null,

    /**
     * Parse a YouTube time parameter ("90", "90s", "1h2m10s", "2m") to seconds
     */
    parseTimeParam(value) {
        if (value === null || value === undefined) return 0;
        const raw = String(value).trim();
        if (!raw) return 0;
        if (/^\d+$/.test(raw)) return parseInt(raw, 10);

        const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
        if (!match || (!match[1] && !match[2] && !match[3])) return 0;

        return parseInt(match[1] || 0, 10) * 3600
            + parseInt(match[2] || 0, 10) * 60
            + parseInt(match[3] || 0, 10);
    },

    /**
     * Extract {videoId, start} from a YouTube URL or a bare 11-character id.
     * Returns null when the input is not a YouTube reference.
     *
     * Regex-based rather than new URL(): bare ids and protocol-less input
     * break the URL parser.
     */
    parseVideoId(input) {
        if (typeof input !== 'string') return null;
        const raw = input.trim();
        if (!raw) return null;

        const ID = '([A-Za-z0-9_-]{11})';
        const patterns = [
            new RegExp('youtu\\.be/' + ID),
            new RegExp('youtube(?:-nocookie)?\\.com/(?:embed|shorts|live|v)/' + ID),
            new RegExp('youtube(?:-nocookie)?\\.com/watch\\?(?:[^#]*&)?v=' + ID),
        ];

        let videoId = null;
        for (const pattern of patterns) {
            const match = raw.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        if (!videoId && /^[A-Za-z0-9_-]{11}$/.test(raw)) {
            videoId = raw;
        }
        if (!videoId) return null;

        let start = 0;
        const tParam = raw.match(/[?&#]t=([^&#]+)/);
        if (tParam) {
            start = this.parseTimeParam(tParam[1]);
        } else {
            const startParam = raw.match(/[?&#]start=(\d+)/);
            if (startParam) start = parseInt(startParam[1], 10);
        }

        return { videoId: videoId, start: start };
    },

    /**
     * Format seconds as M:SS, or H:MM:SS past an hour
     */
    formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        const pad = (n) => (n < 10 ? '0' + n : String(n));
        return hours > 0
            ? `${hours}:${pad(minutes)}:${pad(secs)}`
            : `${minutes}:${pad(secs)}`;
    },

    // --------------------------------------------------------------- geometry

    /**
     * The video stroke on the canvas, if any
     */
    getVideoStroke() {
        if (typeof Canvas === 'undefined' || !Canvas.strokes) return null;
        for (const stroke of Canvas.strokes) {
            if (stroke && stroke.type === 'video') return stroke;
        }
        return null;
    },

    /**
     * Screen-space rect for a video stroke, in CSS pixels
     */
    computeScreenRect(stroke) {
        const topLeft = Canvas.toScreen(stroke.x, stroke.y);
        return {
            left: topLeft.x,
            top: topLeft.y,
            width: stroke.width * Canvas.scale,
            height: stroke.height * Canvas.scale
        };
    },

    /**
     * Position the layer.
     *
     * Pan and zoom write `transform` only, which is GPU-composited and never
     * reflows the player's internal document. The iframe's intrinsic size is
     * the stroke's *world* size and is rewritten only when the stroke is
     * resized. Both writes are dirty-checked because redraw() runs on every
     * pointer move while drawing.
     */
    applyRect(stroke) {
        const layer = document.getElementById('video-layer');
        if (!layer) return;

        const rect = this.computeScreenRect(stroke);
        const transform = `translate(${rect.left}px, ${rect.top}px) scale(${Canvas.scale})`;
        const width = stroke.width + 'px';
        const height = stroke.height + 'px';

        if (transform === this._lastTransform && width === this._lastW && height === this._lastH) {
            return;
        }

        layer.style.transform = transform;
        layer.style.width = width;
        layer.style.height = height;

        this._lastTransform = transform;
        this._lastW = width;
        this._lastH = height;
        this._applyCount++;
    },

    // ------------------------------------------------------------- reconciler

    /**
     * Make the DOM a pure function of Canvas.strokes. Called from the tail of
     * Canvas.redraw(), so clearAll, reset, undo and object-erase all tear the
     * player down without any extra wiring.
     */
    syncFromCanvas() {
        const stroke = this.getVideoStroke();

        if (!stroke) {
            if (this.player || this.currentVideoId !== null) this.teardown();
            else this.hideChrome();
            return;
        }

        this.showChrome();

        if (stroke.videoId !== this.currentVideoId) {
            this.mountVideo(stroke);
        }
        this.applyRect(stroke);
    },

    showChrome() {
        const layer = document.getElementById('video-layer');
        if (layer) layer.classList.remove('hidden');
        const mini = document.getElementById('video-miniplayer');
        if (mini) mini.classList.remove('hidden');
    },

    hideChrome() {
        const layer = document.getElementById('video-layer');
        if (layer) layer.classList.add('hidden');
        const mini = document.getElementById('video-miniplayer');
        if (mini) mini.classList.add('hidden');
    },

    /**
     * Point the layer at a video id, creating the player on first use. An
     * existing player is re-pointed rather than destroyed, to avoid flicker.
     */
    mountVideo(stroke) {
        if (this.player && typeof this.player.loadVideoById === 'function') {
            this.currentVideoId = stroke.videoId;
            this.player.loadVideoById({
                videoId: stroke.videoId,
                startSeconds: stroke.start || 0
            });
            return;
        }

        if (this._creating) return;
        this._creating = true;

        // With a factory injected (tests) creation is synchronous and offline.
        if (this.playerFactory) {
            this.finishMount(stroke);
            this._creating = false;
            return;
        }

        const done = () => { this._creating = false; };
        this.loadApi()
            .then(() => { this.finishMount(stroke); })
            .catch(() => {
                this.apiFailed = true;
                if (this.renderFallbackIframe(stroke)) {
                    this.currentVideoId = stroke.videoId;
                }
            })
            .then(done, done);
    },

    /**
     * Try to render the video, falling back to a plain embed if the player
     * cannot be built.
     *
     * currentVideoId is only set once something actually rendered, so a mount
     * that failed because the layer was not in the DOM yet is retried on the
     * next redraw instead of wedging the reconciler.
     */
    finishMount(stroke) {
        if (this.createPlayer(stroke)) {
            this.currentVideoId = stroke.videoId;
            return true;
        }
        if (this.renderFallbackIframe(stroke)) {
            this.currentVideoId = stroke.videoId;
            return true;
        }
        return false;
    },

    /**
     * Inject the IFrame Player API on first embed rather than from index.html,
     * so a user who never embeds pays nothing. Memoised; rejects on network
     * error or timeout so the caller can fall back.
     */
    loadApi() {
        if (this.playerFactory) return Promise.resolve();
        if (this._apiPromise) return this._apiPromise;

        this._apiPromise = new Promise((resolve, reject) => {
            if (window.YT && window.YT.Player) {
                resolve();
                return;
            }

            let settled = false;
            let timer = null;
            const settle = (fn, arg) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                fn(arg);
            };

            const previous = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function() {
                if (typeof previous === 'function') {
                    try { previous(); } catch (e) { /* not ours to handle */ }
                }
                settle(resolve);
            };

            const script = document.createElement('script');
            script.src = this.API_SRC;
            script.async = true;
            script.onerror = () => settle(reject, new Error('YouTube API failed to load'));
            document.head.appendChild(script);

            timer = setTimeout(
                () => settle(reject, new Error('YouTube API timed out')),
                this.API_TIMEOUT_MS
            );
        });

        return this._apiPromise;
    },

    /**
     * Build the player. YT.Player *replaces* its target element with a
     * generated iframe, which is why the target is nested inside the layer we
     * position rather than being the layer itself.
     */
    createPlayer(stroke) {
        const target = document.getElementById('video-player-target');
        if (!target) return null;

        const options = {
            host: this.HOST,
            videoId: stroke.videoId,
            width: '100%',
            height: '100%',
            playerVars: {
                playsinline: 1,
                rel: 0,
                modestbranding: 1,
                start: stroke.start || 0
            },
            events: {
                onReady: (event) => {
                    // onReady can fire before the constructor returns, so adopt
                    // the player from the event rather than waiting for the
                    // assignment below.
                    if (!this.player && event && event.target) this.player = event.target;
                    this.currentVideoId = stroke.videoId;
                    this.onPlayerReady();
                },
                onStateChange: () => this.onPlayerStateChange()
            }
        };

        try {
            const factory = this.playerFactory
                || ((el, opts) => new window.YT.Player(el, opts));
            this.player = factory(target, options);
        } catch (err) {
            // A blocked or broken API must never take the drawing down with it.
            this.apiFailed = true;
            this.player = null;
            return null;
        }

        return this.player;
    },

    onPlayerReady() {
        this.setTransportEnabled(true);
        this.updateLabel();
        this.startTick();
        this.updateTransport();
    },

    /**
     * Name the video in the miniplayer, so it is clear what is being
     * annotated. Falls back to the id when the API cannot tell us the title.
     */
    updateLabel() {
        const label = document.getElementById('video-label');
        if (!label) return;

        let title = '';
        if (this.player && typeof this.player.getVideoData === 'function') {
            try {
                const data = this.player.getVideoData();
                title = (data && data.title) || '';
            } catch (e) { /* the API is not ready yet */ }
        }

        label.textContent = title || this.currentVideoId || 'Video';
        label.title = label.textContent;
    },

    onPlayerStateChange() {
        this.updateTransport();
    },

    /**
     * Last resort when the API is blocked or the machine is offline: a plain
     * privacy-enhanced iframe. Still world-anchored, but without transport.
     */
    renderFallbackIframe(stroke) {
        const layer = document.getElementById('video-layer');
        if (!layer) return false;

        const start = stroke.start ? `?start=${stroke.start}` : '';
        layer.innerHTML =
            `<iframe id="video-player-target" src="${this.HOST}/embed/${stroke.videoId}${start}"`
            + ' frameborder="0" allowfullscreen></iframe>';
        return true;
    },

    /**
     * Destroy the player and restore the layer's pristine markup, so the next
     * embed has a target element for YT.Player to replace.
     */
    teardown() {
        this.stopTick();

        if (this.player && typeof this.player.destroy === 'function') {
            try { this.player.destroy(); } catch (e) { /* already gone */ }
        }
        this.player = null;
        this.currentVideoId = null;
        this._creating = false;
        this._lastTransform = null;
        this._lastW = null;
        this._lastH = null;

        const layer = document.getElementById('video-layer');
        if (layer) {
            layer.innerHTML = '<div id="video-player-target"></div>';
            layer.style.transform = '';
            layer.classList.add('hidden');
        }

        const mini = document.getElementById('video-miniplayer');
        if (mini) mini.classList.add('hidden');
        this.resetTransport();
    },

    // --------------------------------------------------------------- transport

    /**
     * Seek relative to the current position, clamped to the video bounds
     */
    skip(delta) {
        if (!this.player || typeof this.player.seekTo !== 'function') return;

        const current = this.readTime('getCurrentTime');
        const duration = this.readTime('getDuration');

        let target = current + delta;
        if (target < 0) target = 0;
        if (duration > 0 && target > duration) target = duration;

        this.player.seekTo(target, true);
        this.updateTransport();
    },

    togglePlay() {
        if (!this.player) return;
        if (this.isPlaying()) this.player.pauseVideo();
        else if (typeof this.player.playVideo === 'function') this.player.playVideo();
        this.updateTransport();
    },

    /**
     * Cycle 1 -> 1.5 -> 2 -> 0.5 -> 1
     */
    cyclePlaybackRate() {
        if (!this.player || typeof this.player.setPlaybackRate !== 'function') return 1;

        const current = typeof this.player.getPlaybackRate === 'function'
            ? this.player.getPlaybackRate()
            : 1;

        let index = this.RATES.indexOf(current);
        if (index === -1) index = this.RATES.indexOf(1);

        const next = this.RATES[(index + 1) % this.RATES.length];
        this.player.setPlaybackRate(next);
        this.updateTransport();
        return next;
    },

    /**
     * While a scrub is in progress the tick must not fight the user's drag.
     */
    onScrubInput() {
        this.isScrubbing = true;
    },

    onScrubChange() {
        const scrubber = document.getElementById('video-scrubber');
        this.isScrubbing = false;
        if (!scrubber || !this.player || typeof this.player.seekTo !== 'function') return;

        const duration = this.readTime('getDuration');
        if (duration > 0) {
            const fraction = Number(scrubber.value) / Number(scrubber.max || 1000);
            this.player.seekTo(fraction * duration, true);
        }
        this.updateTransport();
    },

    isPlaying() {
        return !!this.player
            && typeof this.player.getPlayerState === 'function'
            && this.player.getPlayerState() === this.PLAYING;
    },

    /**
     * Read a time from the player, treating anything non-finite as zero — the
     * API reports NaN before metadata has loaded.
     */
    readTime(method) {
        if (!this.player || typeof this.player[method] !== 'function') return 0;
        const value = Number(this.player[method]());
        return isFinite(value) && value > 0 ? value : 0;
    },

    /**
     * Push player state into the miniplayer chrome
     */
    updateTransport() {
        if (!this.player) return;

        const current = this.readTime('getCurrentTime');
        const duration = this.readTime('getDuration');

        const currentEl = document.getElementById('video-current');
        if (currentEl) currentEl.textContent = this.formatTime(current);

        const durationEl = document.getElementById('video-duration');
        if (durationEl) durationEl.textContent = this.formatTime(duration);

        const scrubber = document.getElementById('video-scrubber');
        if (scrubber && !this.isScrubbing) {
            const max = Number(scrubber.max || 1000);
            scrubber.value = duration > 0
                ? String(Math.round((current / duration) * max))
                : '0';
        }

        const playPause = document.getElementById('video-playpause');
        if (playPause) {
            const playing = this.isPlaying();
            playPause.classList.toggle('vp-playing', playing);
            playPause.title = playing ? 'Pause' : 'Play';
            playPause.innerHTML = playing
                ? '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
        }

        const rate = document.getElementById('video-rate');
        if (rate && typeof this.player.getPlaybackRate === 'function') {
            rate.textContent = this.player.getPlaybackRate() + '×';
        }
    },

    /**
     * Return the chrome to its idle state when there is no player
     */
    resetTransport() {
        this.isScrubbing = false;
        this.setTransportEnabled(false);

        const scrubber = document.getElementById('video-scrubber');
        if (scrubber) scrubber.value = '0';
        const currentEl = document.getElementById('video-current');
        if (currentEl) currentEl.textContent = '0:00';
        const durationEl = document.getElementById('video-duration');
        if (durationEl) durationEl.textContent = '0:00';
        const rate = document.getElementById('video-rate');
        if (rate) rate.textContent = '1×';
        const label = document.getElementById('video-label');
        if (label) {
            label.textContent = 'Video';
            label.title = '';
        }
    },

    startTick() {
        this.stopTick();
        this.tickTimer = setInterval(() => this.updateTransport(), this.TICK_MS);
    },

    /**
     * Must run on teardown: a live interval outlives the page in tests and
     * keeps polling a destroyed player in the browser.
     */
    stopTick() {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    },

    setTransportEnabled(enabled) {
        const ids = ['video-back10', 'video-playpause', 'video-fwd10', 'video-rate', 'video-scrubber'];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        }
    },

    // -------------------------------------------------------------- lifecycle

    /**
     * Embed a video from a URL or bare id. Re-embedding replaces the current
     * video in place rather than stacking a second one on the canvas.
     */
    embed(input) {
        const parsed = this.parseVideoId(input);
        if (!parsed) return null;

        const existing = this.getVideoStroke();
        if (existing) {
            existing.videoId = parsed.videoId;
            existing.start = parsed.start;
            Canvas.redraw();
            return existing;
        }

        return Canvas.addVideoStroke(parsed.videoId, parsed.start);
    },

    /**
     * Remove the video. Delegates to Canvas so undo comes for free, and the
     * reconciler tears the iframe down on the resulting redraw.
     */
    remove() {
        const stroke = this.getVideoStroke();
        if (!stroke) return false;
        return Canvas.removeStroke(Canvas.strokes.indexOf(stroke));
    },

    /**
     * Wire the miniplayer controls. Safe to call before any video exists.
     */
    init() {
        const on = (id, event, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(event, handler);
        };

        on('video-back10', 'click', () => this.skip(-this.SKIP_SECONDS));
        on('video-fwd10', 'click', () => this.skip(this.SKIP_SECONDS));
        on('video-playpause', 'click', () => this.togglePlay());
        on('video-rate', 'click', () => this.cyclePlaybackRate());
        on('video-scrubber', 'input', () => this.onScrubInput());
        on('video-scrubber', 'change', () => this.onScrubChange());
        on('video-close', 'click', () => {
            this.remove();
            if (typeof UI !== 'undefined') UI.updateUndoRedoButtons();
            if (typeof App !== 'undefined') App.triggerAutoSave();
        });

        this.resetTransport();
        this.syncFromCanvas();
    }
};
