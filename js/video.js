/**
 * Video Module - YouTube embedding
 */

const Video = {
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
    }
};
