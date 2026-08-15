const { loadApp, test, assert, assertEqual } = require('./harness');
const { makeFakePlayer, makeFactory, PLAYING, PAUSED } = require('./fake-yt');

const URL_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// Embed with a fake player attached, returning it for assertions.
function embedWithFake(window, options = {}) {
    const fake = makeFakePlayer(options);
    window.Video.playerFactory = makeFactory(fake);
    window.Video.embed(options.url || URL_A);
    return fake;
}

const el = (dom, id) => dom.window.document.getElementById(id);

// ------------------------------------------------------------------- skipping

test('back 10 seconds seeks backwards', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 25 });

    Video.skip(-10);

    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:15:true');
    assertEqual(fake.currentTime, 15);

    Video.teardown();
    dom.window.close();
});

test('forward 10 seconds seeks forwards', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 25 });

    Video.skip(10);

    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:35:true');

    Video.teardown();
    dom.window.close();
});

test('skipping back clamps at the start of the video', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 5 });

    Video.skip(-10);

    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:0:true', 'never seeks negative');

    Video.teardown();
    dom.window.close();
});

test('skipping forward clamps at the end of the video', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 196 });

    Video.skip(10);

    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:200:true', 'never seeks past the end');

    Video.teardown();
    dom.window.close();
});

test('skipping is a no-op with no player', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    Video.skip(-10);
    Video.skip(10);
    assertEqual(Video.player, null);

    dom.window.close();
});

test('the miniplayer buttons drive the ten second skips', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 50 });

    el(dom, 'video-back10').click();
    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:40:true');

    el(dom, 'video-fwd10').click();
    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:50:true');

    assertEqual(Video.SKIP_SECONDS, 10);

    Video.teardown();
    dom.window.close();
});

// ---------------------------------------------------------------- play / pause

test('play/pause pauses a playing video and plays a paused one', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: PAUSED });

    Video.togglePlay();
    assertEqual(fake.called('playVideo').length, 1);
    assertEqual(fake.state, PLAYING);

    Video.togglePlay();
    assertEqual(fake.called('pauseVideo').length, 1);
    assertEqual(fake.state, PAUSED);

    Video.teardown();
    dom.window.close();
});

test('the play button reflects the player state', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: PAUSED });
    const button = el(dom, 'video-playpause');

    assert(!button.classList.contains('vp-playing'), 'starts showing play');
    assertEqual(button.title, 'Play');

    button.click();
    assert(button.classList.contains('vp-playing'), 'shows pause while playing');
    assertEqual(button.title, 'Pause');

    button.click();
    assert(!button.classList.contains('vp-playing'));

    Video.teardown();
    dom.window.close();
});

test('a video is never auto-played on embed', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: PAUSED });

    assertEqual(fake.called('playVideo').length, 0, 'playback needs a user gesture');

    Video.teardown();
    dom.window.close();
});

// -------------------------------------------------------------- playback speed

test('playback rate cycles 1, 1.5, 2, 0.5 and back to 1', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { rate: 1 });

    assertEqual(Video.cyclePlaybackRate(), 1.5);
    assertEqual(Video.cyclePlaybackRate(), 2);
    assertEqual(Video.cyclePlaybackRate(), 0.5);
    assertEqual(Video.cyclePlaybackRate(), 1);

    assertEqual(fake.called('setPlaybackRate').length, 4);
    assertEqual(fake.rate, 1);

    Video.teardown();
    dom.window.close();
});

test('an unexpected playback rate resets the cycle to 1.5', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, { rate: 1.75 });

    assertEqual(Video.cyclePlaybackRate(), 1.5);

    Video.teardown();
    dom.window.close();
});

test('the rate button shows the current speed', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, { rate: 1 });
    const button = el(dom, 'video-rate');

    button.click();
    assertEqual(button.textContent, '1.5×');
    button.click();
    assertEqual(button.textContent, '2×');

    Video.teardown();
    dom.window.close();
});

// -------------------------------------------------------------------- scrubbing

test('releasing the scrubber seeks to the matching fraction of the video', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 300, currentTime: 0 });
    const scrubber = el(dom, 'video-scrubber');

    scrubber.value = '500';
    scrubber.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:150:true', 'halfway through a 300s video');

    Video.teardown();
    dom.window.close();
});

test('dragging the scrubber suppresses tick updates until release', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 100, currentTime: 10 });
    const scrubber = el(dom, 'video-scrubber');

    scrubber.value = '900';
    scrubber.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assertEqual(Video.isScrubbing, true);

    // A tick landing mid-drag must not yank the handle back to the play head.
    Video.updateTransport();
    assertEqual(scrubber.value, '900', 'the drag position is preserved');

    scrubber.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assertEqual(Video.isScrubbing, false);
    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:90:true');

    Video.teardown();
    dom.window.close();
});

test('the scrubber tracks the play head when idle', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 0 });
    const scrubber = el(dom, 'video-scrubber');

    fake.currentTime = 50;
    Video.updateTransport();
    assertEqual(scrubber.value, '250', 'a quarter of the way through');

    Video.teardown();
    dom.window.close();
});

test('scrubbing a zero-length video does not seek', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 0 });
    const scrubber = el(dom, 'video-scrubber');

    scrubber.value = '500';
    scrubber.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assertEqual(fake.called('seekTo').length, 0);

    Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------------- time chrome

test('the time readout shows position and duration', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 3725, currentTime: 65 });

    Video.updateTransport();

    assertEqual(el(dom, 'video-current').textContent, '1:05');
    assertEqual(el(dom, 'video-duration').textContent, '1:02:05');

    Video.teardown();
    dom.window.close();
});

test('a player reporting NaN before metadata loads reads as zero', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, {});
    fake.duration = NaN;
    fake.currentTime = NaN;

    Video.updateTransport();

    assertEqual(el(dom, 'video-current').textContent, '0:00');
    assertEqual(el(dom, 'video-duration').textContent, '0:00');

    Video.teardown();
    dom.window.close();
});

// --------------------------------------------------------------- miniplayer life

test('the miniplayer appears with a video and disappears without one', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const mini = el(dom, 'video-miniplayer');

    assert(mini.classList.contains('hidden'), 'hidden until something is embedded');

    embedWithFake(dom.window, {});
    assert(!mini.classList.contains('hidden'), 'shown once a video exists');

    Video.remove();
    assert(mini.classList.contains('hidden'), 'hidden again once it is gone');

    dom.window.close();
});

test('the miniplayer close button removes the video undoably', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;
    const Video = dom.window.Video;

    embedWithFake(dom.window, {});
    assertEqual(Canvas.strokes.length, 1);

    el(dom, 'video-close').click();

    assertEqual(Canvas.strokes.length, 0);
    assertEqual(Video.player, null);

    Canvas.undo();
    assertEqual(Canvas.strokes.length, 1, 'closing is undoable');

    Video.teardown();
    dom.window.close();
});

test('transport controls are disabled until a player is ready', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(el(dom, 'video-playpause').disabled, true);
    assertEqual(el(dom, 'video-scrubber').disabled, true);

    embedWithFake(dom.window, {});

    assertEqual(el(dom, 'video-playpause').disabled, false, 'enabled once ready');
    assertEqual(el(dom, 'video-back10').disabled, false);
    assertEqual(el(dom, 'video-fwd10').disabled, false);
    assertEqual(el(dom, 'video-rate').disabled, false);
    assertEqual(el(dom, 'video-scrubber').disabled, false);

    Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------------------ ticking

test('a ready player starts the tick and teardown stops it', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.tickTimer, null, 'no timer before anything is embedded');

    embedWithFake(dom.window, { duration: 100 });
    assert(Video.tickTimer !== null, 'the tick runs while a player exists');

    Video.teardown();
    assertEqual(Video.tickTimer, null, 'the interval must not outlive the player');

    dom.window.close();
});

test('the tick keeps the readout in step with playback', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 100, currentTime: 0 });

    assertEqual(el(dom, 'video-current').textContent, '0:00');

    fake.currentTime = 42;
    await new Promise(resolve => setTimeout(resolve, Video.TICK_MS + 120));

    assertEqual(el(dom, 'video-current').textContent, '0:42');

    Video.teardown();
    dom.window.close();
});

test('teardown returns the chrome to its idle state', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 100, rate: 2 });
    Video.updateTransport();
    assertEqual(el(dom, 'video-current').textContent, '1:40');

    Video.teardown();

    assertEqual(el(dom, 'video-current').textContent, '0:00');
    assertEqual(el(dom, 'video-duration').textContent, '0:00');
    assertEqual(el(dom, 'video-scrubber').value, '0');
    assertEqual(el(dom, 'video-rate').textContent, '1×');
    assertEqual(el(dom, 'video-playpause').disabled, true);
    assertEqual(Video.isScrubbing, false);

    dom.window.close();
});

test('transport calls are safe once the player is gone', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    embedWithFake(dom.window, {});
    Video.teardown();

    // Nothing here should throw.
    Video.skip(10);
    Video.togglePlay();
    Video.cyclePlaybackRate();
    Video.onScrubChange();
    Video.updateTransport();

    assertEqual(Video.player, null);

    dom.window.close();
});

// ---------------------------------------------------------------------- label

test('the miniplayer names the video by title when the API provides one', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = makeFakePlayer({ duration: 100 });
    fake.getVideoData = () => ({ title: 'But what is a neural network?' });
    Video.playerFactory = makeFactory(fake);
    Video.embed(URL_A);

    assertEqual(el(dom, 'video-label').textContent, 'But what is a neural network?');

    Video.teardown();
    dom.window.close();
});

test('the miniplayer falls back to the video id when no title is available', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, {});

    assertEqual(el(dom, 'video-label').textContent, 'dQw4w9WgXcQ');

    Video.teardown();
    dom.window.close();
});

test('a throwing getVideoData does not break the label', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = makeFakePlayer({ duration: 100 });
    fake.getVideoData = () => { throw new Error('not ready'); };
    Video.playerFactory = makeFactory(fake);
    Video.embed(URL_A);

    assertEqual(el(dom, 'video-label').textContent, 'dQw4w9WgXcQ');

    Video.teardown();
    dom.window.close();
});

test('teardown restores the default label', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, {});
    assertEqual(el(dom, 'video-label').textContent, 'dQw4w9WgXcQ');

    Video.teardown();
    assertEqual(el(dom, 'video-label').textContent, 'Video');

    dom.window.close();
});
