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

// ------------------------------------------------------------------ mute

test('the mute button mutes and unmutes', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, {});
    const button = el(dom, 'video-mute');

    assertEqual(Video.isMuted(), false, 'starts unmuted');

    button.click();
    assertEqual(fake.called('mute').length, 1);
    assertEqual(Video.isMuted(), true);

    button.click();
    assertEqual(fake.called('unMute').length, 1);
    assertEqual(Video.isMuted(), false);

    Video.teardown();
    dom.window.close();
});

test('the mute button reflects the muted state', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, {});
    const button = el(dom, 'video-mute');

    assert(!button.classList.contains('vp-active'), 'not highlighted while audible');
    assertEqual(button.title, 'Mute');

    button.click();
    assert(button.classList.contains('vp-active'), 'highlighted while muted');
    assertEqual(button.title, 'Unmute');

    button.click();
    assert(!button.classList.contains('vp-active'));
    assertEqual(button.title, 'Mute');

    Video.teardown();
    dom.window.close();
});

test('a player that starts muted is shown as muted', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, { muted: true });

    assertEqual(Video.isMuted(), true);
    assert(el(dom, 'video-mute').classList.contains('vp-active'));

    Video.teardown();
    dom.window.close();
});

test('muting is a no-op with no player', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.toggleMute(), false);
    assertEqual(Video.isMuted(), false);

    dom.window.close();
});

// -------------------------------------------------------------- captions

test('the captions button turns captions on and off', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, {});
    const button = el(dom, 'video-cc');

    assertEqual(Video.captionsOn, false, 'off by default');

    button.click();
    assertEqual(Video.captionsOn, true);
    assert(fake.calls.includes('loadModule:captions'), 'the module is loaded on demand');
    assertEqual(fake.track.languageCode, 'en', 'a track is selected');

    button.click();
    assertEqual(Video.captionsOn, false);
    assertEqual(fake.calls.includes('unloadModule:captions'), true);
    assertEqual(Object.keys(fake.track).length, 0, 'the track is cleared');

    Video.teardown();
    dom.window.close();
});

test('the captions button reflects the caption state', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, {});
    const button = el(dom, 'video-cc');

    assert(!button.classList.contains('vp-active'));
    assertEqual(button.title, 'Show captions');

    button.click();
    assert(button.classList.contains('vp-active'));
    assertEqual(button.title, 'Hide captions');

    button.click();
    assert(!button.classList.contains('vp-active'));

    Video.teardown();
    dom.window.close();
});

test('captions use the first track the player offers', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { trackList: [{ languageCode: 'de' }, { languageCode: 'en' }] });

    Video.toggleCaptions();
    assertEqual(fake.track.languageCode, 'de');

    Video.teardown();
    dom.window.close();
});

test('captions do not force a track when the player lists none', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { trackList: [] });

    Video.toggleCaptions();

    // Naming a languageCode the video does not have selects nothing at all,
    // so loading the module and letting the player pick is the safer move.
    assertEqual(Video.captionsOn, true);
    assert(fake.calls.includes('loadModule:captions'));
    assertEqual(fake.calls.some(c => c.startsWith('setOption') && c.includes('languageCode')), false,
        'no track should be forced: ' + fake.calls.join(','));

    Video.teardown();
    dom.window.close();
});

test('captions work on a player that names the module cc', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = makeFakePlayer({ moduleName: 'cc' });
    Video.playerFactory = makeFactory(fake);
    Video.embed(URL_A);

    Video.toggleCaptions();

    assertEqual(Video.captionsOn, true);
    assert(fake.calls.some(c => c.startsWith('setOption:cc:track')), 'the cc module is addressed: ' + fake.calls.join(','));

    Video.teardown();
    dom.window.close();
});

test('captions are a no-op with no player', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(Video.toggleCaptions(), false);
    assertEqual(Video.captionsOn, false);

    dom.window.close();
});

test('a player with no captions API does not throw', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = makeFakePlayer({});
    delete fake.getOptions;
    delete fake.loadModule;
    delete fake.unloadModule;
    delete fake.setOption;
    delete fake.getOption;
    Video.playerFactory = makeFactory(fake);
    Video.embed(URL_A);

    Video.toggleCaptions();
    assertEqual(Video.captionsOn, true, 'state still tracks the user intent');

    Video.teardown();
    dom.window.close();
});

test('captions reset when a different video is loaded', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, {});

    Video.toggleCaptions();
    assertEqual(Video.captionsOn, true);

    Video.embed('https://youtu.be/aBcDeFgHiJk');

    assertEqual(Video.captionsOn, false, 'captions do not carry across videos');
    assert(!el(dom, 'video-cc').classList.contains('vp-active'));

    Video.teardown();
    dom.window.close();
});

test('both new controls are disabled until a player is ready', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    assertEqual(el(dom, 'video-cc').disabled, true);
    assertEqual(el(dom, 'video-mute').disabled, true);

    embedWithFake(dom.window, {});

    assertEqual(el(dom, 'video-cc').disabled, false);
    assertEqual(el(dom, 'video-mute').disabled, false);

    Video.teardown();

    assertEqual(el(dom, 'video-cc').disabled, true, 'disabled again once the video is gone');
    assertEqual(el(dom, 'video-mute').disabled, true);

    dom.window.close();
});

test('teardown resets the caption and mute chrome', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, {});

    Video.toggleCaptions();
    Video.toggleMute();
    assert(el(dom, 'video-cc').classList.contains('vp-active'));
    assert(el(dom, 'video-mute').classList.contains('vp-active'));

    Video.teardown();

    assertEqual(Video.captionsOn, false);
    assert(!el(dom, 'video-cc').classList.contains('vp-active'));
    assert(!el(dom, 'video-mute').classList.contains('vp-active'));
    assertEqual(el(dom, 'video-mute').title, 'Mute');

    dom.window.close();
});

// ------------------------------------------------------- chrome write churn

test('an idle tick makes no DOM writes', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    embedWithFake(dom.window, { duration: 200, currentTime: 30 });

    Video.updateTransport();
    const before = Video._chromeWrites;

    // Twenty ticks with nothing changing. Rewriting the play or mute icon here
    // destroys the element a pointer may be pressing, swallowing the click.
    for (let i = 0; i < 20; i++) Video.updateTransport();

    assertEqual(Video._chromeWrites, before, 'the tick must be a no-op when nothing changed');

    Video.teardown();
    dom.window.close();
});

test('the play icon is only replaced when playback state changes', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200 });
    const button = el(dom, 'video-playpause');

    Video.updateTransport();
    const icon = button.querySelector('svg');
    assert(icon, 'an icon is present');

    for (let i = 0; i < 10; i++) Video.updateTransport();
    assert(button.querySelector('svg') === icon,
        'the very same element survives idle ticks, so a press is never orphaned');

    fake.state = PLAYING;
    Video.updateTransport();
    assert(button.querySelector('svg') !== icon, 'and is replaced when the state really changes');

    Video.teardown();
    dom.window.close();
});

test('the mute icon is only replaced when the muted state changes', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, {});
    const button = el(dom, 'video-mute');

    Video.updateTransport();
    const icon = button.querySelector('svg');

    for (let i = 0; i < 10; i++) Video.updateTransport();
    assert(button.querySelector('svg') === icon, 'unchanged across idle ticks');

    fake.muted = true;
    Video.updateTransport();
    assert(button.querySelector('svg') !== icon, 'swapped once it actually mutes');

    Video.teardown();
    dom.window.close();
});

test('the time readout still advances with playback', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 0 });

    Video.updateTransport();
    assertEqual(el(dom, 'video-current').textContent, '0:00');

    fake.currentTime = 65;
    Video.updateTransport();
    assertEqual(el(dom, 'video-current').textContent, '1:05', 'dirty checking must not freeze the clock');

    dom.window.close();
});

test('pressing the scrubber claims the drag before any value change', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { duration: 200, currentTime: 100 });
    const scrubber = el(dom, 'video-scrubber');

    assertEqual(Video.isScrubbing, false);

    // Grab the thumb but do not move it yet.
    scrubber.dispatchEvent(new dom.window.Event('mousedown', { bubbles: true }));
    assertEqual(Video.isScrubbing, true, 'a tick must not snap the thumb back mid-grab');

    scrubber.value = '750';
    Video.updateTransport();
    assertEqual(scrubber.value, '750', 'the grabbed position is held');

    scrubber.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assertEqual(Video.isScrubbing, false);
    assertEqual(fake.calls[fake.calls.length - 1], 'seekTo:150:true');

    Video.teardown();
    dom.window.close();
});

test('a fresh embed resets the chrome cache so the first tick paints', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;

    embedWithFake(dom.window, { duration: 200, currentTime: 30 });
    assertEqual(el(dom, 'video-duration').textContent, '3:20');

    Video.teardown();
    assertEqual(el(dom, 'video-duration').textContent, '0:00');

    embedWithFake(dom.window, { duration: 200, currentTime: 30 });
    assertEqual(el(dom, 'video-duration').textContent, '3:20', 'the cache did not suppress the repaint');

    Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------- responsiveness

const BUFFERING = 3;

test('a buffering video counts as playing', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: BUFFERING });

    // YouTube goes unstarted -> buffering -> playing. Reading buffering as
    // stopped is what made the button need several presses.
    assertEqual(Video.isPlaying(), true);

    Video.updateTransport();
    assert(el(dom, 'video-playpause').classList.contains('vp-playing'));
    assertEqual(el(dom, 'video-playpause').title, 'Pause');

    Video.teardown();
    dom.window.close();
});

test('one press pauses a video that is still buffering', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: PAUSED });
    const button = el(dom, 'video-playpause');

    button.click();
    assertEqual(fake.called('playVideo').length, 1);

    // The player has accepted the play but is still fetching data.
    fake.state = BUFFERING;

    button.click();
    assertEqual(fake.called('pauseVideo').length, 1, 'the second press pauses rather than replaying');
    assertEqual(fake.called('playVideo').length, 1, 'and does not fire another play');

    Video.teardown();
    dom.window.close();
});

test('the button responds on press without waiting for the player', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: PAUSED });
    const button = el(dom, 'video-playpause');

    // A player that has not yet reported its new state, as happens while the
    // change is in flight over postMessage.
    fake.playVideo = function() { this.record('playVideo'); };

    button.click();

    assert(button.classList.contains('vp-playing'),
        'the icon flips immediately rather than after a round trip');
    assertEqual(button.title, 'Pause');

    // A tick during the grace period keeps showing the intent.
    Video.updateTransport();
    assert(button.classList.contains('vp-playing'), 'the intent holds while the change is in flight');

    // Once the grace period lapses, reality wins again.
    Video._playIntent.expires = Date.now() - 1;
    Video.updateTransport();
    assert(!button.classList.contains('vp-playing'), 'a play that never started is corrected');

    Video.teardown();
    dom.window.close();
});

test('an ended video shows the play icon again', async () => {
    const dom = await loadApp();
    const Video = dom.window.Video;
    const fake = embedWithFake(dom.window, { state: PLAYING });

    Video.updateTransport();
    assert(el(dom, 'video-playpause').classList.contains('vp-playing'));

    fake.state = 0; // ENDED
    Video.updateTransport();

    assertEqual(Video.isPlaying(), false);
    assert(!el(dom, 'video-playpause').classList.contains('vp-playing'));

    Video.teardown();
    dom.window.close();
});
