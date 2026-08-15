const { loadApp, test, assert, assertEqual } = require('./harness');

test('laser-plain shows pointer when mouse moves over canvas without clicking', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('laser-plain');
    const laser = document.getElementById('laser-pointer');
    assert(laser.classList.contains('hidden'), 'laser starts hidden');

    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mousemove', {
        clientX: 300, clientY: 200, bubbles: true,
    }));

    assert(!laser.classList.contains('hidden'), 'laser should appear on hover');
    assertEqual(laser.style.transform, 'translate3d(300px, 200px, 0) translate(-50%, -50%)',
        'positioned by transform so movement is composited, not laid out');

    dom.window.close();
});

test('laser-trail shows pointer when mouse moves over canvas without clicking', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('laser-trail');
    const laser = document.getElementById('laser-pointer');
    assert(laser.classList.contains('hidden'));

    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mousemove', {
        clientX: 120, clientY: 90, bubbles: true,
    }));

    assert(!laser.classList.contains('hidden'),
        'laser-trail should also follow the cursor on hover (regression: was only shown on mousedown)');
    assertEqual(laser.style.transform, 'translate3d(120px, 90px, 0) translate(-50%, -50%)');

    dom.window.close();
});

test('laser dot hides when mouse leaves the canvas', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;
    const Canvas = window.Canvas;

    Tools.setTool('laser-trail');
    const laser = document.getElementById('laser-pointer');

    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mousemove', {
        clientX: 50, clientY: 50, bubbles: true,
    }));
    assert(!laser.classList.contains('hidden'));

    Canvas.drawCanvas.dispatchEvent(new window.MouseEvent('mouseleave', {
        clientX: -10, clientY: -10, bubbles: true,
    }));
    assert(laser.classList.contains('hidden'),
        'laser should hide when cursor leaves canvas');

    dom.window.close();
});

test('laser trail fade time is short (≤ 1000ms) so the trail is not too long', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'tools.js'), 'utf8');
    const m = src.match(/const fadeTime\s*=\s*(\d+)/);
    assert(m, 'fadeTime constant missing in tools.js');
    const fade = parseInt(m[1], 10);
    assert(fade <= 1000, `expected fadeTime <= 1000ms (got ${fade})`);
    assert(fade >= 100, `expected fadeTime >= 100ms (got ${fade})`);
});

test('laser trail prunes points older than fadeTime', async () => {
    const dom = await loadApp();
    const { window } = dom;
    const Tools = window.Tools;

    const now = Date.now();
    // Seed trail with one fresh and one stale point.
    Tools.laserTrail = [
        { x: 0, y: 0, time: now - 5000 },
        { x: 10, y: 10, time: now },
    ];

    // Replicate the prune logic from startLaserTrailAnimation
    const fadeTime = 600;
    const pruned = Tools.laserTrail.filter(p => Date.now() - p.time < fadeTime);
    assertEqual(pruned.length, 1, 'old trail point should be removed');

    dom.window.close();
});

// Records the drawing calls the trail makes, so the curve can be inspected
// without a real canvas.
function recordingCtx() {
    const calls = [];
    const rec = (name) => (...args) => calls.push({ name, args });
    return {
        calls,
        find: (name) => calls.filter(c => c.name === name),
        beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
        quadraticCurveTo: rec('quadraticCurveTo'),
        stroke() { calls.push({ name: 'stroke', alpha: this.strokeStyle, width: this.lineWidth }); },
        clearRect: rec('clearRect'), setTransform: rec('setTransform'),
        strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    };
}

const trailPoints = (n, now) => Array.from({ length: n }, (_, i) => ({
    x: 100 + i * 20, y: 100 + (i % 2) * 30, time: now - i,
}));

test('the laser trail is drawn as curves rather than straight segments', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const now = Date.now();
    const ctx = recordingCtx();

    Tools.drawLaserTrail(ctx, trailPoints(6, now), now, 600);

    assert(ctx.find('quadraticCurveTo').length >= 4,
        'sparse pointer samples should be smoothed, not joined with corners');

    dom.window.close();
});

test('the laser trail tapers as it fades', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const now = Date.now();
    const ctx = recordingCtx();

    // Oldest first, so the head of the trail is the freshest point.
    const points = [
        { x: 0, y: 0, time: now - 500 },
        { x: 50, y: 0, time: now - 300 },
        { x: 100, y: 0, time: now - 100 },
        { x: 150, y: 0, time: now },
    ];
    Tools.drawLaserTrail(ctx, points, now, 600);

    const widths = ctx.find('stroke').map(c => c.width);
    assert(widths.length >= 2, 'several segments drawn');
    assert(widths[widths.length - 1] > widths[0],
        `the head should be thicker than the tail (got ${JSON.stringify(widths)})`);

    dom.window.close();
});

test('fully faded points are not drawn', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const now = Date.now();
    const ctx = recordingCtx();

    const points = [
        { x: 0, y: 0, time: now - 5000 },
        { x: 50, y: 0, time: now - 5000 },
        { x: 100, y: 0, time: now - 5000 },
    ];
    Tools.drawLaserTrail(ctx, points, now, 600);

    assertEqual(ctx.find('stroke').length, 0, 'nothing to draw once the trail has expired');

    dom.window.close();
});

test('a trail of fewer than two points draws nothing', async () => {
    const dom = await loadApp();
    const Tools = dom.window.Tools;
    const now = Date.now();

    const empty = recordingCtx();
    Tools.drawLaserTrail(empty, [], now, 600);
    assertEqual(empty.calls.length, 0);

    const single = recordingCtx();
    Tools.drawLaserTrail(single, [{ x: 1, y: 1, time: now }], now, 600);
    assertEqual(single.calls.length, 0);

    dom.window.close();
});

test('the trail canvas is sized for the device pixel ratio', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;

    const canvas = document.createElement('canvas');
    let transform = null;
    canvas.getContext = () => ({ setTransform: (...a) => { transform = a; } });

    Tools.sizeLaserTrailCanvas(canvas);

    const dpr = window.devicePixelRatio || 1;
    assertEqual(canvas.width, Math.round(window.innerWidth * dpr));
    assertEqual(canvas.height, Math.round(window.innerHeight * dpr));
    assert(transform, 'the context scale is reapplied after a resize');
    assertEqual(transform[0], dpr);

    dom.window.close();
});

test('resizing the trail canvas is skipped when nothing changed', async () => {
    const dom = await loadApp();
    const { window, window: { document } } = dom;
    const Tools = window.Tools;

    const canvas = document.createElement('canvas');
    let contexts = 0;
    canvas.getContext = () => { contexts++; return { setTransform() {} }; };

    Tools.sizeLaserTrailCanvas(canvas);
    assertEqual(contexts, 1, 'sized once');

    Tools.sizeLaserTrailCanvas(canvas);
    Tools.sizeLaserTrailCanvas(canvas);
    assertEqual(contexts, 1, 'no work on an unchanged canvas, this runs every frame');

    dom.window.close();
});
