const { loadApp, test, assert, assertEqual } = require('./harness');
const { makeFakePlayer, makeFactory, makeThrowingFactory } = require('./fake-yt');

const URL_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const ID_A = 'dQw4w9WgXcQ';
const URL_B = 'https://youtu.be/aaaaaaaaaaa';
const ID_B = 'aaaaaaaaaaa';

// jsdom's window is 1024x768, so Canvas.width/height are 1024/768.
// addVideoStroke: worldWidth = (width * 0.6) / scale, worldHeight = 9/16 of that,
// centred on toCanvas(width/2, height/2).
// At scale 1, offset 0: 1024 * 0.6 = 614.4 wide, 345.59999999999997 tall,
// centre (512, 384) => x 204.8, y 211.20000000000002.
const W1 = 614.4;
const H1 = 345.59999999999997;
const X1 = 204.8;
const Y1 = 211.20000000000002;

/** Attach a fake player and embed, returning the fake. */
function embedWithFake(window, options = {}) {
    const fake = makeFakePlayer(options.player || { duration: 200 });
    window.Video.playerFactory = makeFactory(fake);
    window.Video.embed(options.url || URL_A);
    return fake;
}

/** A 2D context stand-in that records every drawing call made against it. */
function recordingCtx() {
    const calls = [];
    const ctx = { calls };
    const methods = [
        'clearRect', 'save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke',
        'fill', 'arc', 'fillText', 'fillRect', 'strokeRect', 'closePath',
        'quadraticCurveTo', 'drawImage', 'clip', 'setLineDash', 'translate',
        'scale', 'rotate', 'setTransform', 'transform', 'resetTransform',
    ];
    for (const name of methods) {
        ctx[name] = (...args) => { calls.push(name); };
    }
    ctx.getLineDash = () => [];
    ctx.measureText = (t) => ({ width: (t || '').length * 8 });
    return ctx;
}

/** Every teardown path must leave the module and the DOM in this exact state. */
function assertTornDown(window, fake, label) {
    const Video = window.Video;
    const document = window.document;
    assertEqual(Video.player, null, label + ': player should be null');
    assertEqual(Video.currentVideoId, null, label + ': currentVideoId should be null');
    assertEqual(fake.destroyed, true, label + ': player.destroy() should have been called');
    assertEqual(fake.called('destroy').length, 1, label + ': destroy called exactly once');

    const layer = document.getElementById('video-layer');
    assert(layer.classList.contains('hidden'), label + ': #video-layer should be hidden');

    const target = document.getElementById('video-player-target');
    assert(target, label + ': #video-player-target should be restored');
    assertEqual(target.parentElement, layer, label + ': target should live inside the layer');
    assertEqual(Video.getVideoStroke(), null, label + ': no video stroke should remain');
}

// --------------------------------------------------------------- embed / geometry

test('embed adds exactly one 16:9 video stroke centred in the viewport', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    assertEqual(Canvas.width, 1024, 'jsdom viewport width');
    assertEqual(Canvas.height, 768, 'jsdom viewport height');
    assertEqual(Canvas.scale, 1);

    const fake = embedWithFake(window);
    const videos = Canvas.strokes.filter(s => s.type === 'video');
    assertEqual(Canvas.strokes.length, 1, 'exactly one stroke');
    assertEqual(videos.length, 1, 'exactly one video stroke');

    const stroke = videos[0];
    assertEqual(stroke.type, 'video');
    assertEqual(stroke.videoId, ID_A);
    assertEqual(stroke.start, 0);
    assertEqual(stroke.width, W1, 'worldWidth = 1024 * 0.6 / 1');
    assertEqual(stroke.height, H1, 'worldHeight = worldWidth * 9 / 16');
    assertEqual(stroke.x, X1, 'centre.x - worldWidth / 2');
    assertEqual(stroke.y, Y1, 'centre.y - worldHeight / 2');
    assertEqual(stroke.opacity, 1);
    // 16:9 within float tolerance.
    assert(Math.abs(stroke.width / stroke.height - 16 / 9) < 1e-9, 'aspect ratio is 16:9');

    assertEqual(window.Video.currentVideoId, ID_A);
    assertEqual(fake.videoId, ID_A);

    window.Video.teardown();
    dom.window.close();
});

test('embed sizes and centres the box in world coords at a non-identity view', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    Canvas.scale = 2;
    Canvas.offsetX = -100;
    Canvas.offsetY = 50;

    const fake = embedWithFake(window);
    const stroke = window.Video.getVideoStroke();

    // worldWidth = 1024 * 0.6 / 2 = 307.2, worldHeight = 172.79999999999998
    // centre = toCanvas(512, 384) = ((512 + 100) / 2, (384 - 50) / 2) = (306, 167)
    assertEqual(stroke.width, 307.2);
    assertEqual(stroke.height, 172.79999999999998);
    assertEqual(stroke.x, 152.4, '306 - 307.2 / 2');
    assertEqual(stroke.y, 80.60000000000001, '167 - 172.8 / 2');

    // The DOM layer is placed from the same numbers.
    const layer = window.document.getElementById('video-layer');
    const topLeft = Canvas.toScreen(stroke.x, stroke.y);
    assertEqual(layer.style.transform,
        `translate(${topLeft.x}px, ${topLeft.y}px) scale(2)`);
    assertEqual(layer.style.width, stroke.width + 'px');
    assertEqual(layer.style.height, stroke.height + 'px');
    assert(fake.destroyed === false);

    window.Video.teardown();
    dom.window.close();
});

test('embed pushes an add undo entry and clears the redo stack', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    // Seed the redo stack with a drawn-then-undone stroke.
    Canvas.startStroke('pen', 10, 10, '#000', 4, 1);
    Canvas.addPoint(20, 20);
    Canvas.endStroke();
    Canvas.undo();
    assertEqual(Canvas.redoStack.length, 1, 'redo stack seeded');
    assertEqual(Canvas.undoStack.length, 0);

    embedWithFake(window);

    assertEqual(Canvas.undoStack.length, 1, 'one undo entry for the embed');
    assertEqual(Canvas.undoStack[0].action, 'add');
    assertEqual(Canvas.undoStack[0].stroke, Canvas.strokes[0], 'entry points at the video stroke');
    assertEqual(Canvas.redoStack.length, 0, 'redo stack cleared');

    window.Video.teardown();
    dom.window.close();
});

test('embed with unparseable input returns null and adds nothing', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;

    const fake = makeFakePlayer();
    Video.playerFactory = makeFactory(fake);

    for (const bad of ['', '   ', 'not a url', 'https://vimeo.com/123456', null, undefined, 42, {}]) {
        assertEqual(Video.embed(bad), null, 'embed(' + JSON.stringify(bad) + ') should return null');
    }

    assertEqual(Canvas.strokes.length, 0, 'no strokes added');
    assertEqual(Canvas.undoStack.length, 0, 'no undo entries');
    assertEqual(Video.player, null, 'no player created');
    assertEqual(Video.currentVideoId, null);

    dom.window.close();
});

test('embed honours a t= start offset in the stroke and the player options', async () => {
    const dom = await loadApp();
    const { window } = dom;

    const fake = embedWithFake(window, { url: 'https://www.youtube.com/watch?v=' + ID_A + '&t=1m30s' });
    const stroke = window.Video.getVideoStroke();

    assertEqual(stroke.start, 90, '1m30s => 90 seconds');
    assertEqual(fake.options.videoId, ID_A);
    assertEqual(fake.options.playerVars.start, 90, 'start passed through to playerVars');
    assertEqual(fake.options.host, window.Video.HOST, 'privacy-enhanced host');

    window.Video.teardown();
    dom.window.close();
});

// ----------------------------------------------------------------- re-embedding

test('a second embed mutates the existing video stroke in place', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    const first = Canvas.strokes[0];
    const undoLen = Canvas.undoStack.length;

    const returned = window.Video.embed('https://youtu.be/' + ID_B + '?t=45');

    assertEqual(Canvas.strokes.length, 1, 'still exactly one stroke');
    assertEqual(Canvas.strokes.filter(s => s.type === 'video').length, 1);
    assertEqual(returned, first, 'the same stroke object is returned');
    assertEqual(Canvas.strokes[0], first, 'mutated in place, not replaced');
    assertEqual(first.videoId, ID_B);
    assertEqual(first.start, 45);
    // Geometry is untouched by a re-embed.
    assertEqual(first.x, X1);
    assertEqual(first.y, Y1);
    assertEqual(first.width, W1);
    assertEqual(first.height, H1);
    // NOTE: re-embedding is deliberately not a separate undo step — the undo
    // stack still only holds the original 'add'.
    assertEqual(Canvas.undoStack.length, undoLen, 're-embed adds no undo entry');

    window.Video.teardown();
    dom.window.close();
});

test('a second embed re-points the existing player instead of recreating it', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Video = window.Video;

    const fake = embedWithFake(window);
    const created = Video.player;
    assertEqual(created, fake, 'the fake is the live player');
    assertEqual(fake.calls.length, 0, 'creation itself records no player calls');

    // A factory that would explode if it were called a second time.
    Video.playerFactory = makeThrowingFactory('must not create a second player');
    Video.embed(URL_B);

    assertEqual(Video.player, fake, 'same player instance kept');
    assertEqual(Video.apiFailed, false, 'the throwing factory was never reached');
    assertEqual(fake.destroyed, false, 'existing player must NOT be destroyed');
    assertEqual(fake.called('destroy').length, 0);
    assertEqual(fake.called('loadVideoById').length, 1, 're-pointed once');
    assertEqual(fake.calls[0], 'loadVideoById:' + ID_B + ':0');
    assertEqual(fake.videoId, ID_B);
    assertEqual(Video.currentVideoId, ID_B);

    Video.teardown();
    dom.window.close();
});

// ----------------------------------------------------------------- persistence

test('a video stroke round-trips through getState/JSON/loadState', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window, { url: 'https://www.youtube.com/watch?v=' + ID_A + '&t=2m' });
    const before = Canvas.strokes[0];
    const snapshot = { ...before };

    const state = JSON.parse(JSON.stringify(Canvas.getState()));
    Canvas.loadState(state);

    assertEqual(Canvas.strokes.length, 1);
    const after = Canvas.strokes[0];
    assert(after !== before, 'loadState installs a fresh object');
    for (const key of ['type', 'videoId', 'x', 'y', 'width', 'height', 'start', 'opacity']) {
        assertEqual(after[key], snapshot[key], 'field ' + key + ' survives the round trip');
    }
    assertEqual(Object.keys(after).sort().join(','),
        Object.keys(snapshot).sort().join(','), 'no fields gained or lost');
    // The reconciler recognises the reloaded stroke as the same video.
    assertEqual(window.Video.currentVideoId, ID_A);
    assertEqual(window.Video.player.destroyed, false, 'player survived the reload');

    window.Video.teardown();
    dom.window.close();
});

// -------------------------------------------------------------- teardown paths

test('undo after an embed tears the player down', async () => {
    const dom = await loadApp();
    const { window } = dom;

    const fake = embedWithFake(window);
    assertEqual(window.Canvas.undo(), true);

    assertEqual(window.Canvas.strokes.length, 0);
    assertTornDown(window, fake, 'undo');

    dom.window.close();
});

test('clearAll tears the player down', async () => {
    const dom = await loadApp();
    const { window } = dom;

    const fake = embedWithFake(window);
    window.Canvas.clearAll();

    assertEqual(window.Canvas.strokes.length, 0);
    assertTornDown(window, fake, 'clearAll');

    dom.window.close();
});

test('reset tears the player down', async () => {
    const dom = await loadApp();
    const { window } = dom;

    const fake = embedWithFake(window);
    window.Canvas.reset();

    assertEqual(window.Canvas.strokes.length, 0);
    assertEqual(window.Canvas.scale, 1);
    assertTornDown(window, fake, 'reset');

    dom.window.close();
});

test('Video.remove tears the player down', async () => {
    const dom = await loadApp();
    const { window } = dom;

    const fake = embedWithFake(window);
    assertEqual(window.Video.remove(), true);

    assertEqual(window.Canvas.strokes.length, 0);
    assertTornDown(window, fake, 'remove');

    dom.window.close();
});

test('a torn-down layer still accepts a fresh embed', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Video = window.Video;

    const first = embedWithFake(window);
    Video.remove();
    assertTornDown(window, first, 'remove');

    const second = makeFakePlayer();
    Video.playerFactory = makeFactory(second);
    Video.embed(URL_B);

    assertEqual(Video.player, second, 'a new player was created into the restored target');
    assertEqual(Video.currentVideoId, ID_B);
    assertEqual(second.target, window.document.getElementById('video-player-target'));
    assert(!window.document.getElementById('video-layer').classList.contains('hidden'),
        'layer shown again');

    Video.teardown();
    dom.window.close();
});

test('Video.remove returns false when there is no video', async () => {
    const dom = await loadApp();
    const { window } = dom;

    assertEqual(window.Video.remove(), false);
    assertEqual(window.Canvas.undoStack.length, 0, 'nothing recorded');

    // A non-video stroke is not mistaken for one.
    window.Canvas.startStroke('pen', 5, 5, '#000', 4, 1);
    window.Canvas.addPoint(15, 15);
    window.Canvas.endStroke();
    assertEqual(window.Video.remove(), false);
    assertEqual(window.Canvas.strokes.length, 1, 'the pen stroke is untouched');

    dom.window.close();
});

test('Video.remove goes through Canvas.removeStroke so it is undoable', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;

    const first = embedWithFake(window);
    const stroke = Canvas.strokes[0];

    assertEqual(Video.remove(), true);
    const entry = Canvas.undoStack[Canvas.undoStack.length - 1];
    assertEqual(entry.action, 'remove', 'removal is recorded as an undoable action');
    assertEqual(entry.stroke, stroke);
    assertEqual(entry.index, 0);

    // Undo brings the video back and the reconciler builds a player again.
    const second = makeFakePlayer();
    Video.playerFactory = makeFactory(second);
    assertEqual(Canvas.undo(), true);

    assertEqual(Canvas.strokes.length, 1);
    assertEqual(Canvas.strokes[0], stroke, 'the same stroke object is restored');
    assertEqual(Video.player, second, 'a player is created again');
    assertEqual(Video.currentVideoId, ID_A);
    assertEqual(first.destroyed, true, 'the original player stayed destroyed');
    assert(!window.document.getElementById('video-layer').classList.contains('hidden'));

    Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------------- geometry

test('findStrokeAt hits inside the video box and misses outside it', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    // Box spans x 204.8..819.2, y 211.2..556.8 in world == screen coords here.
    assertEqual(Canvas.findStrokeAt(512, 384), 0, 'centre of the box');
    assertEqual(Canvas.findStrokeAt(210, 220), 0, 'just inside the top-left');
    assertEqual(Canvas.findStrokeAt(10, 10), -1, 'far outside');
    assertEqual(Canvas.findStrokeAt(900, 384), -1, 'right of the box');
    assertEqual(Canvas.findStrokeAt(512, 700), -1, 'below the box');

    window.Video.teardown();
    dom.window.close();
});

test('findStrokesInRect selects the video when the rect overlaps the box', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);

    assertEqual(Canvas.findStrokesInRect({ x: 0, y: 0, width: 2000, height: 2000 }).join(), '0',
        'rect enclosing everything');
    assertEqual(Canvas.findStrokesInRect({ x: 800, y: 500, width: 100, height: 100 }).join(), '0',
        'rect clipping the bottom-right corner');
    assertEqual(Canvas.findStrokesInRect({ x: 900, y: 0, width: 50, height: 50 }).length, 0,
        'rect entirely to the right');
    assertEqual(Canvas.findStrokesInRect({ x: 0, y: 600, width: 100, height: 100 }).length, 0,
        'rect entirely below-left');

    window.Video.teardown();
    dom.window.close();
});

test('findStrokesInPolygon selects the video when a corner is contained', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    // Top-left corner is (204.8, 211.2).
    const around = [{ x: 150, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 300 }, { x: 150, y: 300 }];
    assertEqual(Canvas.findStrokesInPolygon(around).join(), '0', 'polygon around the top-left corner');

    // A polygon strictly inside the box contains no corner, so nothing selects.
    const inside = [{ x: 400, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 400 }, { x: 400, y: 400 }];
    assertEqual(Canvas.findStrokesInPolygon(inside).length, 0,
        'a polygon inside the box catches no corner');

    const elsewhere = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];
    assertEqual(Canvas.findStrokesInPolygon(elsewhere).length, 0, 'polygon nowhere near the box');

    window.Video.teardown();
    dom.window.close();
});

test('moveStrokes shifts the video box and keeps the layer glued to it', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    const stroke = Canvas.strokes[0];
    const x0 = stroke.x, y0 = stroke.y, w0 = stroke.width, h0 = stroke.height;

    Canvas.moveStrokes([0], 40, -25);

    assertEqual(stroke.x, x0 + 40);
    assertEqual(stroke.y, y0 - 25);
    assertEqual(stroke.width, w0, 'width unchanged by a move');
    assertEqual(stroke.height, h0, 'height unchanged by a move');

    const layer = window.document.getElementById('video-layer');
    assertEqual(layer.style.transform,
        `translate(${x0 + 40}px, ${y0 - 25}px) scale(1)`, 'layer follows the stroke');

    window.Video.teardown();
    dom.window.close();
});

test('resizeStrokes scales the video box about an anchor', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    const stroke = Canvas.strokes[0];
    const x0 = stroke.x, y0 = stroke.y, w0 = stroke.width, h0 = stroke.height;

    Canvas.resizeStrokes([0], 0, 0, 2, 2);

    assertEqual(stroke.width, w0 * 2);
    assertEqual(stroke.height, h0 * 2);
    assertEqual(stroke.x, x0 * 2, 'anchored at the origin');
    assertEqual(stroke.y, y0 * 2);

    // Halving about the same anchor is the inverse.
    Canvas.resizeStrokes([0], 0, 0, 0.5, 0.5);
    assertEqual(stroke.width, w0);
    assertEqual(stroke.height, h0);

    window.Video.teardown();
    dom.window.close();
});

test('getStrokeBounds returns the video box and resetView fits a lone video', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    const stroke = Canvas.strokes[0];

    const b = Canvas.getStrokeBounds(stroke);
    assertEqual(b.minX, stroke.x);
    assertEqual(b.minY, stroke.y);
    assertEqual(b.maxX, stroke.x + stroke.width);
    assertEqual(b.maxY, stroke.y + stroke.height);

    // Disturb the view, then fit.
    Canvas.offsetX = 999;
    Canvas.offsetY = -400;
    Canvas.scale = 0.25;
    Canvas.resetView();

    const padding = 40;
    const availW = 1024 - padding * 2;
    const availH = 768 - padding * 2;
    // resetView measures the content from the bounds, so (maxX - minX) rather
    // than stroke.width — the two differ in the last float bit.
    const contentW = b.maxX - b.minX;
    const contentH = b.maxY - b.minY;
    const expectedScale = Math.min(availW / contentW, availH / contentH, 2);
    assertEqual(Canvas.scale, expectedScale, 'scale fits the box with 40px padding');
    assertEqual(Canvas.offsetX,
        padding + (availW - contentW * expectedScale) / 2 - b.minX * expectedScale);
    assertEqual(Canvas.offsetY,
        padding + (availH - contentH * expectedScale) / 2 - b.minY * expectedScale);

    // The fitted box lands inside the viewport.
    const tl = Canvas.toScreen(stroke.x, stroke.y);
    const br = Canvas.toScreen(stroke.x + stroke.width, stroke.y + stroke.height);
    assert(tl.x >= padding - 1e-9 && tl.y >= padding - 1e-9, 'top-left inside the padding');
    assert(br.x <= 1024 - padding + 1e-9 && br.y <= 768 - padding + 1e-9, 'bottom-right inside');

    window.Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------------- rendering

test('renderStroke draws nothing to the 2D context for a video stroke', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;

    embedWithFake(window);
    const stroke = Canvas.strokes[0];

    const ctx = recordingCtx();
    Canvas.renderStroke(stroke, ctx);
    assertEqual(ctx.calls.length, 0, 'a video is a DOM layer, not pixels');

    // And a full redraw through the recording context is equally silent.
    const ctx2 = recordingCtx();
    for (const s of Canvas.strokes) Canvas.renderStroke(s, ctx2);
    assertEqual(ctx2.calls.length, 0);

    // Degenerate video strokes must not throw either.
    Canvas.renderStroke({ type: 'video' }, ctx);
    assertEqual(ctx.calls.length, 0);

    window.Video.teardown();
    dom.window.close();
});

// ------------------------------------------------------------------ robustness

test('a throwing player factory sets apiFailed without taking the drawing down', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Canvas = window.Canvas;
    const Video = window.Video;

    const uncaught = [];
    window.addEventListener('error', (e) => uncaught.push(e));

    Video.playerFactory = makeThrowingFactory();
    const stroke = Video.embed(URL_A);

    assertEqual(Video.apiFailed, true, 'failure is recorded');
    assertEqual(Video.player, null, 'no half-built player is kept');
    assertEqual(uncaught.length, 0, 'no uncaught exception escaped');

    assert(stroke, 'the stroke is still returned');
    assertEqual(Canvas.strokes.length, 1, 'the video stroke still exists');
    assertEqual(Canvas.strokes[0].videoId, ID_A);
    assertEqual(Video._creating, false, 'the creation latch is released');

    // The video is still watchable: a plain privacy-enhanced embed replaces
    // the scripted player, and the mount counts as done so later redraws do
    // not keep retrying a factory that is known to throw.
    const layer = dom.window.document.getElementById('video-layer');
    assert(/youtube-nocookie\.com\/embed\//.test(layer.innerHTML), 'fallback iframe rendered');
    assert(layer.innerHTML.includes(ID_A));
    assertEqual(Video.currentVideoId, ID_A);

    // Later canvas work keeps working.
    Canvas.redraw();
    Canvas.pan(10, 10);
    assertEqual(Canvas.strokes.length, 1);
    assertEqual(uncaught.length, 0);

    Video.teardown();
    dom.window.close();
});
