const { loadApp, test, assert, assertEqual } = require('./harness');

function assertClose(actual, expected, eps = 1e-9, msg) {
    if (!(Math.abs(actual - expected) <= eps)) {
        throw new Error(`expected ~${expected}, got ${actual}` + (msg ? ' — ' + msg : ''));
    }
}

// Put the transform into a known, non-identity state.
function setView(Canvas, offsetX, offsetY, scale) {
    Canvas.offsetX = offsetX;
    Canvas.offsetY = offsetY;
    Canvas.scale = scale;
}

test('toScreen/toCanvas round-trip at scale 0.25, 1 and 7.5 with non-zero offsets', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    const views = [
        { offsetX: -320.5, offsetY: 88.25, scale: 0.25 },
        { offsetX: 17, offsetY: -1000, scale: 1 },
        { offsetX: 640, offsetY: 384, scale: 7.5 },
    ];
    const points = [
        { x: 0, y: 0 },
        { x: 123.75, y: -456.5 },
        { x: -2048, y: 1024 },
    ];

    for (const v of views) {
        setView(Canvas, v.offsetX, v.offsetY, v.scale);
        for (const p of points) {
            const s = Canvas.toScreen(p.x, p.y);
            const back = Canvas.toCanvas(s.x, s.y);
            assertClose(back.x, p.x, 1e-9, `x round-trip at scale ${v.scale}`);
            assertClose(back.y, p.y, 1e-9, `y round-trip at scale ${v.scale}`);

            // ...and the other direction: screen -> canvas -> screen.
            const c = Canvas.toCanvas(p.x, p.y);
            const fwd = Canvas.toScreen(c.x, c.y);
            assertClose(fwd.x, p.x, 1e-9, `screen x round-trip at scale ${v.scale}`);
            assertClose(fwd.y, p.y, 1e-9, `screen y round-trip at scale ${v.scale}`);
        }
    }

    dom.window.close();
});

test('toScreen and toCanvas produce the exact expected values for a known point', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    setView(Canvas, 100, -30, 2.5);

    // world (40, 12) -> 40*2.5 + 100 = 200 ; 12*2.5 - 30 = 0
    const s = Canvas.toScreen(40, 12);
    assertEqual(s.x, 200, 'toScreen x');
    assertEqual(s.y, 0, 'toScreen y');

    // screen (200, 0) -> (200-100)/2.5 = 40 ; (0-(-30))/2.5 = 12
    const c = Canvas.toCanvas(200, 0);
    assertEqual(c.x, 40, 'toCanvas x');
    assertEqual(c.y, 12, 'toCanvas y');

    // The origin maps straight to the offset.
    const origin = Canvas.toScreen(0, 0);
    assertEqual(origin.x, 100);
    assertEqual(origin.y, -30);

    dom.window.close();
});

test('pan accumulates into offsetX/offsetY and leaves scale alone', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    setView(Canvas, 10, -5, 1.5);

    Canvas.pan(25, 40);
    assertEqual(Canvas.offsetX, 35);
    assertEqual(Canvas.offsetY, 35);

    Canvas.pan(-100, -0.5);
    assertEqual(Canvas.offsetX, -65);
    assertEqual(Canvas.offsetY, 34.5);
    assertEqual(Canvas.scale, 1.5, 'pan must not change scale');

    // Panning by (0, 0) is a no-op.
    Canvas.pan(0, 0);
    assertEqual(Canvas.offsetX, -65);
    assertEqual(Canvas.offsetY, 34.5);

    dom.window.close();
});

test('setScale keeps the world point under the cursor pinned when zooming in', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Non-identity starting view.
    setView(Canvas, -100, 37, 0.5);

    const centerX = 300, centerY = 200;
    const worldBefore = Canvas.toCanvas(centerX, centerY);
    // (300 - -100)/0.5 = 800 ; (200 - 37)/0.5 = 326
    assertEqual(worldBefore.x, 800);
    assertEqual(worldBefore.y, 326);

    Canvas.setScale(2, centerX, centerY);

    assertEqual(Canvas.scale, 2);
    // offsetX = 300 - 800*2 = -1300 ; offsetY = 200 - 326*2 = -452
    assertClose(Canvas.offsetX, -1300);
    assertClose(Canvas.offsetY, -452);

    // Invariance: same world point still lands on the cursor.
    const screenAfter = Canvas.toScreen(worldBefore.x, worldBefore.y);
    assertClose(screenAfter.x, centerX, 1e-9, 'cursor anchor x');
    assertClose(screenAfter.y, centerY, 1e-9, 'cursor anchor y');

    dom.window.close();
});

test('setScale keeps the cursor anchored when zooming out', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    setView(Canvas, 250.5, -80.25, 4);

    const centerX = 512, centerY = 384;
    const worldBefore = Canvas.toCanvas(centerX, centerY);

    Canvas.setScale(0.8, centerX, centerY);
    assertEqual(Canvas.scale, 0.8);

    // offset = center - world * newScale
    assertClose(Canvas.offsetX, centerX - worldBefore.x * 0.8);
    assertClose(Canvas.offsetY, centerY - worldBefore.y * 0.8);

    const screenAfter = Canvas.toScreen(worldBefore.x, worldBefore.y);
    assertClose(screenAfter.x, centerX, 1e-9, 'cursor anchor x');
    assertClose(screenAfter.y, centerY, 1e-9, 'cursor anchor y');

    // A point that is NOT under the cursor must move (this is a real zoom).
    const other = Canvas.toScreen(worldBefore.x + 100, worldBefore.y);
    assertClose(other.x, centerX + 80);

    dom.window.close();
});

test('setScale clamps to maxScale (20) and still anchors on the cursor', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    setView(Canvas, 12, -34, 1);
    const centerX = 400, centerY = 300;
    const worldBefore = Canvas.toCanvas(centerX, centerY); // (388, 334)

    Canvas.setScale(999, centerX, centerY);

    assertEqual(Canvas.scale, 20, 'clamped to maxScale');
    // offsetX = 400 - 388*20 = -7360 ; offsetY = 300 - 334*20 = -6380
    assertClose(Canvas.offsetX, -7360);
    assertClose(Canvas.offsetY, -6380);

    const screenAfter = Canvas.toScreen(worldBefore.x, worldBefore.y);
    assertClose(screenAfter.x, centerX);
    assertClose(screenAfter.y, centerY);

    dom.window.close();
});

test('setScale clamps to minScale (0.01) and still anchors on the cursor', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    setView(Canvas, -60, 25, 0.5);
    const centerX = 100, centerY = 700;
    const worldBefore = Canvas.toCanvas(centerX, centerY); // (320, 1350)
    assertEqual(worldBefore.x, 320);
    assertEqual(worldBefore.y, 1350);

    Canvas.setScale(0.0001, centerX, centerY);

    assertEqual(Canvas.scale, 0.01, 'clamped to minScale');
    // offsetX = 100 - 320*0.01 = 96.8 ; offsetY = 700 - 1350*0.01 = 686.5
    assertClose(Canvas.offsetX, 96.8);
    assertClose(Canvas.offsetY, 686.5);

    dom.window.close();
});

test('setScale early-returns without touching offsets when the clamped scale equals the current one', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Already at maxScale: any larger request clamps back to 20 === scale -> early return.
    setView(Canvas, 111, 222, 20);
    Canvas.setScale(1000, 0, 0);
    assertEqual(Canvas.scale, 20);
    assertEqual(Canvas.offsetX, 111, 'offsetX untouched on early return');
    assertEqual(Canvas.offsetY, 222, 'offsetY untouched on early return');

    // Already at minScale: any smaller request clamps back to 0.01 === scale -> early return.
    setView(Canvas, -7, 13, 0.01);
    Canvas.setScale(0, 500, 500);
    assertEqual(Canvas.scale, 0.01);
    assertEqual(Canvas.offsetX, -7);
    assertEqual(Canvas.offsetY, 13);

    // Requesting exactly the current scale is also a no-op, even off-centre.
    setView(Canvas, 42.5, -42.5, 3);
    Canvas.setScale(3, 900, 900);
    assertEqual(Canvas.scale, 3);
    assertEqual(Canvas.offsetX, 42.5);
    assertEqual(Canvas.offsetY, -42.5);

    dom.window.close();
});

test('resize recomputes width/height/dpr and re-applies setTransform on both contexts', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // jsdom's default viewport.
    assertEqual(Canvas.width, 1024);
    assertEqual(Canvas.height, 768);
    assertEqual(Canvas.dpr, 1);

    const bgCalls = [];
    const drawCalls = [];
    Canvas.bgCtx.setTransform = (...a) => bgCalls.push(a);
    Canvas.drawCtx.setTransform = (...a) => drawCalls.push(a);

    Canvas.resize();

    assertEqual(bgCalls.length, 1, 'background context transform re-applied once');
    assertEqual(drawCalls.length, 1, 'drawing context transform re-applied once');
    assertEqual(JSON.stringify(drawCalls[0]), JSON.stringify([1, 0, 0, 1, 0, 0]));

    // Backing store is width*dpr; CSS size stays in logical pixels.
    assertEqual(Canvas.drawCanvas.width, 1024);
    assertEqual(Canvas.drawCanvas.height, 768);
    assertEqual(Canvas.drawCanvas.style.width, '1024px');
    assertEqual(Canvas.drawCanvas.style.height, '768px');

    dom.window.close();
});

test('resize picks up a changed devicePixelRatio and viewport size', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Object.defineProperty(dom.window, 'devicePixelRatio', { value: 2, configurable: true });
    Object.defineProperty(dom.window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(dom.window, 'innerHeight', { value: 600, configurable: true });

    const drawCalls = [];
    Canvas.drawCtx.setTransform = (...a) => drawCalls.push(a);

    Canvas.resize();

    assertEqual(Canvas.dpr, 2);
    assertEqual(Canvas.width, 800);
    assertEqual(Canvas.height, 600);
    assertEqual(Canvas.drawCanvas.width, 1600, 'backing store scaled by dpr');
    assertEqual(Canvas.drawCanvas.height, 1200);
    assertEqual(Canvas.bgCanvas.width, 1600);
    assertEqual(Canvas.bgCanvas.height, 1200);
    assertEqual(Canvas.drawCanvas.style.width, '800px', 'CSS size stays logical');
    assertEqual(JSON.stringify(drawCalls[0]), JSON.stringify([2, 0, 0, 2, 0, 0]));

    dom.window.close();
});

test('resetView with no strokes returns the identity transform', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [];
    setView(Canvas, -777, 888, 6.25);

    Canvas.resetView();

    assertEqual(Canvas.offsetX, 0);
    assertEqual(Canvas.offsetY, 0);
    assertEqual(Canvas.scale, 1);

    dom.window.close();
});

test('resetView fits a single large stroke with 40px padding (scale below the 2x cap)', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Viewport 1024x768, padding 40 => availW 944, availH 688.
    assertEqual(Canvas.width, 1024);
    assertEqual(Canvas.height, 768);

    // Content: 1000 x 500, top-left at (100, -50).
    Canvas.strokes = [{
        type: 'pen',
        points: [{ x: 100, y: -50 }, { x: 1100, y: 450 }],
        color: '#000', size: 3, opacity: 1
    }];
    setView(Canvas, 12, 34, 5);

    Canvas.resetView();

    // scale = min(944/1000, 688/500, 2) = 0.944
    assertClose(Canvas.scale, 0.944);
    // offsetX = 40 + (944 - 1000*0.944)/2 - 100*0.944 = 40 + 0 - 94.4 = -54.4
    assertClose(Canvas.offsetX, -54.4, 1e-9);
    // offsetY = 40 + (688 - 500*0.944)/2 - (-50*0.944) = 40 + 108 + 47.2 = 195.2
    assertClose(Canvas.offsetY, 195.2, 1e-9);

    // The fitted content is inside the padded viewport and centred on the tight axis.
    const tl = Canvas.toScreen(100, -50);
    const br = Canvas.toScreen(1100, 450);
    assertClose(tl.x, 40, 1e-9, 'content left edge sits at the padding');
    assertClose(br.x, 1024 - 40, 1e-9, 'content right edge sits at the padding');
    assertClose(tl.y + br.y, 768, 1e-9, 'content vertically centred');

    dom.window.close();
});

test('resetView clamps scale at the 2x cap for tiny content', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // 10 x 10 of content: 944/10 and 688/10 both exceed the cap.
    Canvas.strokes = [{
        type: 'pencil',
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        color: '#000', size: 2, opacity: 1
    }];
    setView(Canvas, 0, 0, 0.3);

    Canvas.resetView();

    assertEqual(Canvas.scale, 2, '2x cap binds');
    // offsetX = 40 + (944 - 10*2)/2 - 0 = 40 + 462 = 502
    assertClose(Canvas.offsetX, 502);
    // offsetY = 40 + (688 - 10*2)/2 - 0 = 40 + 334 = 374
    assertClose(Canvas.offsetY, 374);

    // Content is centred in the padded area.
    const tl = Canvas.toScreen(0, 0);
    const br = Canvas.toScreen(10, 10);
    assertClose(tl.x + br.x, 1024, 1e-9, 'horizontally centred');
    assertClose(tl.y + br.y, 768, 1e-9, 'vertically centred');

    dom.window.close();
});

test('resetView fits the union of several strokes', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    Canvas.strokes = [
        { type: 'pen', points: [{ x: 0, y: 0 }, { x: 200, y: 100 }], color: '#000', size: 2, opacity: 1 },
        { type: 'image', src: 'data:image/png;base64,', x: 800, y: 400, width: 200, height: 100, opacity: 1 },
    ];
    // Union bounds: (0, 0) -> (1000, 500) => identical to the single-stroke case.
    Canvas.resetView();

    assertClose(Canvas.scale, 0.944);
    assertClose(Canvas.offsetX, 40, 1e-9);
    assertClose(Canvas.offsetY, 148, 1e-9);

    dom.window.close();
});

test('getStrokeBounds returns tight bounds for freehand, image and text strokes', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    // Freehand: min/max over the points (stroke width is not included).
    const freehand = {
        type: 'pen',
        points: [{ x: 10, y: 50 }, { x: -5, y: 120 }, { x: 300, y: 7 }],
        color: '#000', size: 20, opacity: 1
    };
    const fb = Canvas.getStrokeBounds(freehand);
    assertEqual(fb.minX, -5);
    assertEqual(fb.minY, 7);
    assertEqual(fb.maxX, 300);
    assertEqual(fb.maxY, 120);

    // Single-point stroke degenerates to a zero-area box.
    const dot = Canvas.getStrokeBounds({ type: 'pencil', points: [{ x: 4, y: 9 }], size: 5 });
    assertEqual(dot.minX, 4);
    assertEqual(dot.maxX, 4);
    assertEqual(dot.minY, 9);
    assertEqual(dot.maxY, 9);

    // Empty / point-less freehand strokes have no bounds.
    assertEqual(Canvas.getStrokeBounds({ type: 'pen', points: [] }), null);
    assertEqual(Canvas.getStrokeBounds({ type: 'pen' }), null);

    // Image: x/y plus width/height.
    const ib = Canvas.getStrokeBounds({
        type: 'image', src: 'data:image/png;base64,', x: -20, y: 30, width: 150, height: 80, opacity: 1
    });
    assertEqual(ib.minX, -20);
    assertEqual(ib.minY, 30);
    assertEqual(ib.maxX, 130);
    assertEqual(ib.maxY, 110);

    // Text: width = longest line length * fontSize * 0.6, height = lineCount * fontSize * 1.3.
    const tb = Canvas.getStrokeBounds({
        type: 'text', text: 'abc\nde', x: 100, y: 200, fontSize: 20, color: '#000', opacity: 1
    });
    assertEqual(tb.minX, 100);
    assertEqual(tb.minY, 200);
    assertClose(tb.maxX, 100 + 3 * 20 * 0.6); // 136
    assertClose(tb.maxY, 200 + 2 * 20 * 1.3); // 252

    // Single-line text.
    const tb2 = Canvas.getStrokeBounds({
        type: 'text', text: 'hello', x: 0, y: 0, fontSize: 10, color: '#000', opacity: 1
    });
    assertClose(tb2.maxX, 30);
    assertClose(tb2.maxY, 13);

    // NOTE: text bounds ignore the trailing-line-gap and use a character-count
    // approximation, so an empty-string text stroke is a zero-width, one-line box.
    const tb3 = Canvas.getStrokeBounds({
        type: 'text', text: '', x: 5, y: 5, fontSize: 10, color: '#000', opacity: 1
    });
    assertEqual(tb3.maxX, 5);
    assertClose(tb3.maxY, 18);

    dom.window.close();
});

test('pan then zoom composes: a world point tracks its expected screen position', async () => {
    const dom = await loadApp();
    const Canvas = dom.window.Canvas;

    setView(Canvas, 0, 0, 1);
    Canvas.pan(-200, -150);          // offset (-200, -150)
    assertEqual(Canvas.offsetX, -200);
    assertEqual(Canvas.offsetY, -150);

    // world (400, 300) is currently at screen (200, 150)
    const before = Canvas.toScreen(400, 300);
    assertEqual(before.x, 200);
    assertEqual(before.y, 150);

    Canvas.setScale(3, 200, 150);
    assertEqual(Canvas.scale, 3);
    // offsetX = 200 - 400*3 = -1000 ; offsetY = 150 - 300*3 = -750
    assertClose(Canvas.offsetX, -1000);
    assertClose(Canvas.offsetY, -750);

    const after = Canvas.toScreen(400, 300);
    assertClose(after.x, 200);
    assertClose(after.y, 150);

    // A world point 10 units to the right is now 30 screen px away.
    const neighbour = Canvas.toScreen(410, 300);
    assertClose(neighbour.x, 230);

    dom.window.close();
});
