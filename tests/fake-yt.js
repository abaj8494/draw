// A recording stand-in for a YT.Player, so the video module can be driven in
// jsdom without touching the network.
//
// Usage:
//   const fake = makeFakePlayer({ duration: 200 });
//   Video.playerFactory = makeFactory(fake);
//   Video.embed('https://youtu.be/dQw4w9WgXcQ');

// YT.PlayerState
const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;

function makeFakePlayer(options = {}) {
    const fake = {
        calls: [],
        destroyed: false,
        currentTime: options.currentTime || 0,
        duration: options.duration === undefined ? 100 : options.duration,
        state: options.state === undefined ? PAUSED : options.state,
        rate: options.rate || 1,
        videoId: options.videoId || null,

        record(name, ...args) {
            this.calls.push(args.length ? `${name}:${args.join(':')}` : name);
        },
        called(name) {
            return this.calls.filter(c => c === name || c.startsWith(name + ':'));
        },

        playVideo() { this.record('playVideo'); this.state = PLAYING; },
        pauseVideo() { this.record('pauseVideo'); this.state = PAUSED; },
        seekTo(seconds, allowSeekAhead) {
            this.record('seekTo', seconds, allowSeekAhead);
            this.currentTime = seconds;
        },
        getCurrentTime() { return this.currentTime; },
        getDuration() { return this.duration; },
        getPlayerState() { return this.state; },
        setPlaybackRate(rate) { this.record('setPlaybackRate', rate); this.rate = rate; },
        getPlaybackRate() { return this.rate; },
        loadVideoById(arg) {
            const id = typeof arg === 'string' ? arg : arg.videoId;
            const start = typeof arg === 'string' ? 0 : (arg.startSeconds || 0);
            this.record('loadVideoById', id, start);
            this.videoId = id;
            this.currentTime = start;
        },
        destroy() { this.record('destroy'); this.destroyed = true; },
        getIframe() { return null; },
    };
    return fake;
}

// Mirrors the real API: the ready callback fires once the player exists.
function makeFactory(fake) {
    return function(target, opts) {
        fake.videoId = opts.videoId;
        fake.target = target;
        fake.options = opts;
        if (opts.events && typeof opts.events.onReady === 'function') {
            opts.events.onReady({ target: fake });
        }
        return fake;
    };
}

// A factory that blows up, standing in for a blocked or broken API.
function makeThrowingFactory(message = 'YT unavailable') {
    return function() { throw new Error(message); };
}

module.exports = {
    makeFakePlayer, makeFactory, makeThrowingFactory,
    UNSTARTED, ENDED, PLAYING, PAUSED,
};
