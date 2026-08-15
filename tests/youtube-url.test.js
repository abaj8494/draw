const { loadApp, test, assert, assertEqual } = require('./harness');

const ID = 'dQw4w9WgXcQ';

const ACCEPTED = [
    // [input, expected videoId, expected start]
    [`https://www.youtube.com/watch?v=${ID}`, ID, 0],
    [`http://youtube.com/watch?v=${ID}`, ID, 0],
    [`https://m.youtube.com/watch?v=${ID}`, ID, 0],
    [`www.youtube.com/watch?v=${ID}`, ID, 0],
    [`https://youtu.be/${ID}`, ID, 0],
    [`youtu.be/${ID}`, ID, 0],
    [`https://www.youtube.com/embed/${ID}`, ID, 0],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID, 0],
    [`https://www.youtube.com/shorts/${ID}`, ID, 0],
    [`https://www.youtube.com/live/${ID}`, ID, 0],
    [`https://www.youtube.com/v/${ID}`, ID, 0],
    [ID, ID, 0],

    // Start offsets
    [`https://www.youtube.com/watch?v=${ID}&t=90s`, ID, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=90`, ID, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m10s`, ID, 3730],
    [`https://www.youtube.com/watch?v=${ID}&t=2m`, ID, 120],
    [`https://youtu.be/${ID}?t=30`, ID, 30],
    [`https://www.youtube.com/embed/${ID}?start=45`, ID, 45],
    [`https://www.youtube.com/watch?v=${ID}#t=15`, ID, 15],

    // v= is not the first query parameter
    [`https://www.youtube.com/watch?list=PL123&v=${ID}&index=2`, ID, 0],
    [`https://www.youtube.com/watch?app=desktop&v=${ID}`, ID, 0],

    // Ids using the full character class
    ['https://youtu.be/a_B-c1D2e3F', 'a_B-c1D2e3F', 0],
];

const REJECTED = [
    '',
    '   ',
    'hello',
    'https://vimeo.com/123456',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch',
    'https://example.com/watch?v=dQw4w9WgXcQextra',
    'not an url at all',
    null,
    undefined,
    42,
    {},
];

test('parseVideoId accepts every supported YouTube URL shape', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    for (const [input, videoId, start] of ACCEPTED) {
        const result = Video.parseVideoId(input);
        assert(result !== null, `expected a match for ${input}`);
        assertEqual(result.videoId, videoId, `videoId for ${input}`);
        assertEqual(result.start, start, `start for ${input}`);
    }

    dom.window.close();
});

test('parseVideoId rejects anything that is not a YouTube reference', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    for (const input of REJECTED) {
        assertEqual(Video.parseVideoId(input), null, `should reject ${JSON.stringify(input)}`);
    }

    dom.window.close();
});

test('parseVideoId prefers the t parameter over start', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    const result = Video.parseVideoId(`https://www.youtube.com/embed/${ID}?start=10&t=99`);
    assertEqual(result.start, 99);

    dom.window.close();
});

test('parseVideoId trims surrounding whitespace', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.parseVideoId(`  https://youtu.be/${ID}  `).videoId, ID);
    assertEqual(Video.parseVideoId(`\n${ID}\t`).videoId, ID);

    dom.window.close();
});

test('parseTimeParam understands the YouTube duration formats', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.parseTimeParam('0'), 0);
    assertEqual(Video.parseTimeParam('90'), 90);
    assertEqual(Video.parseTimeParam('90s'), 90);
    assertEqual(Video.parseTimeParam('2m'), 120);
    assertEqual(Video.parseTimeParam('1h'), 3600);
    assertEqual(Video.parseTimeParam('1h2m10s'), 3730);
    assertEqual(Video.parseTimeParam('2m30s'), 150);

    // Anything unparseable means "from the beginning", never NaN.
    assertEqual(Video.parseTimeParam(''), 0);
    assertEqual(Video.parseTimeParam('abc'), 0);
    assertEqual(Video.parseTimeParam(null), 0);
    assertEqual(Video.parseTimeParam(undefined), 0);

    dom.window.close();
});

test('formatTime renders M:SS and H:MM:SS', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.formatTime(0), '0:00');
    assertEqual(Video.formatTime(9), '0:09');
    assertEqual(Video.formatTime(59), '0:59');
    assertEqual(Video.formatTime(60), '1:00');
    assertEqual(Video.formatTime(65), '1:05');
    assertEqual(Video.formatTime(600), '10:00');
    assertEqual(Video.formatTime(3600), '1:00:00');
    assertEqual(Video.formatTime(3725), '1:02:05');
    assertEqual(Video.formatTime(36000), '10:00:00');

    // Fractional seconds truncate rather than leaking a decimal.
    assertEqual(Video.formatTime(65.9), '1:05');

    dom.window.close();
});

test('formatTime degrades gracefully for missing or invalid input', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.formatTime(NaN), '0:00');
    assertEqual(Video.formatTime(undefined), '0:00');
    assertEqual(Video.formatTime(null), '0:00');
    assertEqual(Video.formatTime(-5), '0:00', 'never renders a negative time');

    dom.window.close();
});
