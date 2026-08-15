const { loadApp, test, assert, assertEqual } = require('./harness');
const { makeFakePlayer, makeFactory } = require('./fake-yt');

// These tests are about the video DOM layer staying glued to the canvas world:
// the transform maths, the dirty check that keeps redraw() cheap, and the
// reconciler that mounts/unmounts the player from Canvas.strokes.

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIDEO_ID = 'dQw4w9WgXcQ';

// A clean box so every expected number can be derived by hand.
const BOX = { x: 100, y: 50, width: 640, height: 360 };

function boxStroke(extra) {
    return Object.assign({ type: 'video', videoId: VIDEO_ID, start: 0, opacity: 1 }, BOX, extra);
}

// Embed with the fake player injected first, then force the stroke onto BOX
// geometry and the view onto a known transform.
function embedAtBox(window, view) {
    const Video = window.Video;
    const Canvas = window.Canvas;
    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);
    Video.embed(VIDEO_URL);

    const stroke = Video.getVideoStroke();
    Object.assign(stroke, BOX);
    Canvas.offsetX = (view && view.offsetX) || 0;
    Canvas.offsetY = (view && view.offsetY) || 0;
    Canvas.scale = (view && view.scale) || 1;
    Canvas.redraw();

    return { fake, stroke };
}

// ------------------------------------------------------------------ geometry

test('computeScreenRect maps world box to screen at scale 2 with offsets', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.scale = 2;
    Canvas.offsetX = 30;
    Canvas.offsetY = -10;

    // left = 100 * 2 + 30 = 230, top = 50 * 2 + (-10) = 90
    // width = 640 * 2 = 1280, height = 360 * 2 = 720
    const rect = window.Video.computeScreenRect(boxStroke());
    assertEqual(rect.left, 230);
    assertEqual(rect.top, 90);
    assertEqual(rect.width, 1280);
    assertEqual(rect.height, 720);

    dom.window.close();
});

test('computeScreenRect is the identity at scale 1 with no offset', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.scale = 1;
    Canvas.offsetX = 0;
    Canvas.offsetY = 0;

    const rect = window.Video.computeScreenRect(boxStroke());
    assertEqual(rect.left, 100);
    assertEqual(rect.top, 50);
    assertEqual(rect.width, 640);
    assertEqual(rect.height, 360);

    dom.window.close();
});

test('computeScreenRect handles a fractional scale', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.scale = 0.25;
    Canvas.offsetX = 8;
    Canvas.offsetY = 4;

    // left = 100 * 0.25 + 8 = 33, top = 50 * 0.25 + 4 = 16.5
    // width = 640 * 0.25 = 160, height = 360 * 0.25 = 90
    const rect = window.Video.computeScreenRect(boxStroke());
    assertEqual(rect.left, 33);
    assertEqual(rect.top, 16.5);
    assertEqual(rect.width, 160);
    assertEqual(rect.height, 90);

    dom.window.close();
});

test('computeScreenRect handles negative offsets scrolling the box off-screen', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.scale = 1;
    Canvas.offsetX = -200;
    Canvas.offsetY = -75;

    // left = 100 - 200 = -100, top = 50 - 75 = -25
    const rect = window.Video.computeScreenRect(boxStroke());
    assertEqual(rect.left, -100);
    assertEqual(rect.top, -25);
    assertEqual(rect.width, 640);
    assertEqual(rect.height, 360);

    dom.window.close();
});

// ------------------------------------------------------------------ applyRect

test('applyRect writes a translate+scale transform and world-sized intrinsic box', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;

    Canvas.scale = 2;
    Canvas.offsetX = 30;
    Canvas.offsetY = -10;

    Video.applyRect(boxStroke());

    const layer = document.getElementById('video-layer');
    assertEqual(layer.style.transform, 'translate(230px, 90px) scale(2)');
    // Intrinsic size is the *world* size, not the 1280x720 screen size: the
    // wrapper is blown up by the scale() in the transform.
    assertEqual(layer.style.width, '640px');
    assertEqual(layer.style.height, '360px');

    dom.window.close();
});

test('applyRect keeps intrinsic size in world units across a zoom change', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');
    const stroke = boxStroke();

    Canvas.scale = 1;
    Canvas.offsetX = 0;
    Canvas.offsetY = 0;
    Video.applyRect(stroke);
    assertEqual(layer.style.transform, 'translate(100px, 50px) scale(1)');
    assertEqual(layer.style.width, '640px');

    Canvas.scale = 4;
    Video.applyRect(stroke);
    // Screen rect is 2560x1440, but the element stays 640x360 and the
    // transform does the magnifying.
    assertEqual(Video.computeScreenRect(stroke).width, 2560);
    assertEqual(layer.style.transform, 'translate(400px, 200px) scale(4)');
    assertEqual(layer.style.width, '640px');
    assertEqual(layer.style.height, '360px');

    dom.window.close();
});

// --------------------------------------------------------------- live tracking

test('pan moves the layer transform through the real redraw path', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const { stroke } = embedAtBox(window);
    const layer = document.getElementById('video-layer');

    assertEqual(layer.style.transform, 'translate(100px, 50px) scale(1)');

    Canvas.pan(25, -15);

    // offsets become 25 / -15 => left = 100 + 25 = 125, top = 50 - 15 = 35
    assertEqual(Canvas.offsetX, 25);
    assertEqual(Canvas.offsetY, -15);
    assertEqual(layer.style.transform, 'translate(125px, 35px) scale(1)');

    const rect = Video.computeScreenRect(stroke);
    assertEqual(
        layer.style.transform,
        `translate(${rect.left}px, ${rect.top}px) scale(${Canvas.scale})`
    );

    Video.teardown();
    dom.window.close();
});

test('setScale rescales the layer transform through the real redraw path', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const { stroke } = embedAtBox(window, { offsetX: 25, offsetY: -15, scale: 1 });
    const layer = document.getElementById('video-layer');

    // Zoom to 2x about screen origin (0,0):
    //   canvasX = (0 - 25) / 1 = -25, canvasY = (0 - -15) / 1 = 15
    //   offsetX = 0 - (-25 * 2) = 50, offsetY = 0 - (15 * 2) = -30
    //   left = 100 * 2 + 50 = 250, top = 50 * 2 - 30 = 70
    Canvas.setScale(2, 0, 0);

    assertEqual(Canvas.scale, 2);
    assertEqual(Canvas.offsetX, 50);
    assertEqual(Canvas.offsetY, -30);
    assertEqual(layer.style.transform, 'translate(250px, 70px) scale(2)');
    // Intrinsic size is untouched by zoom.
    assertEqual(layer.style.width, '640px');
    assertEqual(layer.style.height, '360px');

    const rect = Video.computeScreenRect(stroke);
    assertEqual(
        layer.style.transform,
        `translate(${rect.left}px, ${rect.top}px) scale(${Canvas.scale})`
    );

    Video.teardown();
    dom.window.close();
});

// ----------------------------------------------------------------- dirty check

test('a genuine view change bumps _applyCount exactly once', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    embedAtBox(window);

    const before = Video._applyCount;
    Canvas.pan(10, 0);
    assertEqual(Video._applyCount, before + 1, 'one pan should write the layer once');

    Video.teardown();
    dom.window.close();
});

test('repeated redraws with no state change never rewrite the layer', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    embedAtBox(window);
    const layer = document.getElementById('video-layer');

    const before = Video._applyCount;
    // redraw() runs on every pointer move while drawing, so this is the hot path.
    for (let i = 0; i < 25; i++) Canvas.redraw();

    assertEqual(Video._applyCount, before, 'idle redraws must not touch the DOM');
    assertEqual(layer.style.transform, 'translate(100px, 50px) scale(1)');

    Video.teardown();
    dom.window.close();
});

test('resizing the stroke rewrites the intrinsic size and bumps _applyCount', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const { stroke } = embedAtBox(window);
    const layer = document.getElementById('video-layer');

    const before = Video._applyCount;
    stroke.width = 800;
    Canvas.redraw();

    assertEqual(Video._applyCount, before + 1);
    assertEqual(layer.style.width, '800px');
    assertEqual(layer.style.height, '360px');
    // Position is unchanged: only the box got wider.
    assertEqual(layer.style.transform, 'translate(100px, 50px) scale(1)');

    Canvas.redraw();
    assertEqual(Video._applyCount, before + 1, 'the new size is now clean');

    Video.teardown();
    dom.window.close();
});

// ----------------------------------------------------------------- reconciler

test('syncFromCanvas with no video stroke hides the layer', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');

    layer.classList.remove('hidden');
    assertEqual(window.Canvas.strokes.length, 0);

    Video.syncFromCanvas();

    assert(layer.classList.contains('hidden'), 'layer should be hidden with no video stroke');
    assertEqual(Video.player, null);

    dom.window.close();
});

test('syncFromCanvas does not throw when #video-layer is missing entirely', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Video = window.Video;

    const layer = document.getElementById('video-layer');
    layer.parentNode.removeChild(layer);
    assertEqual(document.getElementById('video-layer'), null);

    // No video stroke: hideChrome() has nothing to hide.
    Video.syncFromCanvas();

    // And with a stroke present the mount path is equally null-safe: there is
    // no #video-player-target to build a player in, so nothing is created.
    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);
    window.Canvas.strokes.push(boxStroke());
    Video.syncFromCanvas();

    // Nothing rendered, so the mount is not recorded — a later redraw retries
    // rather than leaving the reconciler permanently wedged.
    assertEqual(Video.player, null);
    assertEqual(Video.currentVideoId, null);

    Video.teardown();
    dom.window.close();
});

test('a mount that failed is retried once the layer is back in the DOM', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Video = window.Video;

    const layer = document.getElementById('video-layer');
    const parent = layer.parentNode;
    parent.removeChild(layer);

    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);
    window.Canvas.strokes.push(boxStroke());
    Video.syncFromCanvas();
    assertEqual(Video.player, null, 'nothing to mount into yet');

    parent.appendChild(layer);
    Video.syncFromCanvas();

    assert(Video.player === fake, 'the player is created once the layer reappears');
    assertEqual(Video.currentVideoId, VIDEO_ID);

    Video.teardown();
    dom.window.close();
});

test('syncFromCanvas with a video stroke unhides the layer and mounts the player', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');

    assert(layer.classList.contains('hidden'), 'layer starts hidden');

    const { fake } = embedAtBox(window);

    assert(!layer.classList.contains('hidden'), 'layer should be visible once a video exists');
    assertEqual(Video.player, fake);
    assertEqual(Video.currentVideoId, VIDEO_ID);
    assertEqual(fake.videoId, VIDEO_ID);
    assertEqual(layer.style.transform, 'translate(100px, 50px) scale(1)');

    Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------------ loadState

test('loadState of a state with a video stroke mounts and positions the layer', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');

    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);

    Canvas.loadState({
        strokes: [boxStroke()],
        background: 'grid-light',
        offsetX: 30,
        offsetY: -10,
        scale: 2
    });

    assertEqual(Video.player, fake);
    assertEqual(Video.currentVideoId, VIDEO_ID);
    assert(!layer.classList.contains('hidden'), 'layer visible after loading a video state');
    assertEqual(layer.style.transform, 'translate(230px, 90px) scale(2)');
    assertEqual(layer.style.width, '640px');
    assertEqual(layer.style.height, '360px');

    Video.teardown();
    dom.window.close();
});

test('loadState of a state without a video tears the player down', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');

    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);
    Canvas.loadState({ strokes: [boxStroke()], background: 'grid-light', scale: 1 });
    assertEqual(Video.player, fake);

    Canvas.loadState({ strokes: [], background: 'grid-light', scale: 1 });

    assertEqual(fake.destroyed, true, 'player should be destroyed');
    assertEqual(Video.player, null);
    assertEqual(Video.currentVideoId, null);
    assert(layer.classList.contains('hidden'), 'layer hidden with no video');
    assertEqual(layer.style.transform, '');
    // Pristine markup is restored so the next embed has a target to replace.
    assert(layer.querySelector('#video-player-target'), 'target element restored');

    dom.window.close();
});

// ------------------------------------------------------------------- teardown

test('teardown clears the dirty check so a later embed repositions the layer', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');

    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);
    Video.embed(VIDEO_URL);

    // A video always lands centred on the viewport, so panning out and back
    // leaves the *screen* transform identical to the first one.
    const firstTransform = layer.style.transform;
    assert(firstTransform.length > 0, 'first embed positions the layer');
    Canvas.pan(40, 20);
    assert(layer.style.transform !== firstTransform, 'pan moves the layer');
    Canvas.pan(-40, -20);
    assertEqual(layer.style.transform, firstTransform);
    assertEqual(Video._lastTransform, firstTransform);

    Video.remove();
    assertEqual(Video.player, null);
    assertEqual(Video._lastTransform, null, 'teardown must clear the dirty-check cache');
    assertEqual(layer.style.transform, '');

    // Re-embedding computes the very same transform. Without the teardown
    // reset, applyRect would consider it clean and leave the layer at ''.
    const fake2 = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake2);
    const stroke = Video.embed(VIDEO_URL);

    const rect = Video.computeScreenRect(stroke);
    assertEqual(
        layer.style.transform,
        `translate(${rect.left}px, ${rect.top}px) scale(${Canvas.scale})`
    );
    assertEqual(layer.style.transform, firstTransform);
    assert(!layer.classList.contains('hidden'));

    Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------- api / fallback

test('loadApi resolves without appending a script when playerFactory is set', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Video = window.Video;

    const fake = makeFakePlayer({ duration: 200 });
    Video.playerFactory = makeFactory(fake);

    const before = document.querySelectorAll('script').length;
    await Video.loadApi();

    assertEqual(document.querySelectorAll('script[src*="iframe_api"]').length, 0,
        'the IFrame API script must never be injected in tests');
    assertEqual(document.querySelectorAll('script').length, before);
    assertEqual(Video._apiPromise, null, 'the factory short-circuit is not memoised');

    // And a full embed likewise stays offline.
    Video.embed(VIDEO_URL);
    assertEqual(document.querySelectorAll('script[src*="iframe_api"]').length, 0);

    Video.teardown();
    dom.window.close();
});

test('renderFallbackIframe puts a nocookie embed inside the layer, keeping the target id', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Video = window.Video;
    const layer = document.getElementById('video-layer');

    Video.renderFallbackIframe(boxStroke({ start: 0 }));

    const iframe = layer.querySelector('iframe');
    assert(iframe, 'a fallback iframe should exist inside #video-layer');
    assertEqual(iframe.id, 'video-player-target');
    assertEqual(iframe.getAttribute('src'),
        'https://www.youtube-nocookie.com/embed/' + VIDEO_ID);
    assert(iframe.getAttribute('src').indexOf('youtube-nocookie.com/embed/') !== -1);
    assertEqual(iframe.parentNode, layer);
    assertEqual(layer.querySelectorAll('#video-player-target').length, 1);

    // A start offset rides along as a query param.
    Video.renderFallbackIframe(boxStroke({ start: 90 }));
    assertEqual(layer.querySelector('iframe').getAttribute('src'),
        'https://www.youtube-nocookie.com/embed/' + VIDEO_ID + '?start=90');

    dom.window.close();
});
