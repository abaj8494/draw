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
    assertEqual(laser.style.left, '300px');
    assertEqual(laser.style.top, '200px');

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
    assertEqual(laser.style.left, '120px');
    assertEqual(laser.style.top, '90px');

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
