// Shared jsdom test harness for the draw app.
//
// The app's source files declare top-level `const`s (Tools, Canvas, ...).
// Top-level `const` is module-scoped in a script tag, so we append a small
// re-export footer that copies them onto `window` so tests can read them.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'js');
const SRC_FILES = ['storage.js', 'canvas.js', 'video.js', 'tools.js', 'export.js', 'ui.js', 'app.js'];

const stubCtx = () => ({
    clearRect() {}, save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
    fillText() {}, fillRect() {}, strokeRect() {}, closePath() {},
    quadraticCurveTo() {}, drawImage() {}, clip() {},
    setLineDash() {}, getLineDash() { return []; },
    translate() {}, scale() {}, rotate() {},
    setTransform() {}, transform() {}, resetTransform() {},
    isPointInPath() { return false; },
    createLinearGradient() { return { addColorStop() {} }; },
    createPattern() { return null; },
    measureText: (t) => ({ width: (t || '').length * 8 }),
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: '', lineJoin: '', globalAlpha: 1,
    globalCompositeOperation: '', font: '',
    textBaseline: '', textAlign: '',
});

async function loadApp() {
    const sources = SRC_FILES
        .map(f => fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
        .join('\n')
        + '\nwindow.Tools = Tools; window.Canvas = Canvas;'
        + ' window.UI = UI; window.App = App; window.Storage = Storage;'
        + ' window.Export = Export; window.Video = Video;'
        + ' window.__appReady = true;';

    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
        .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
        + `<script>${sources}</script>`;

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost/',
        pretendToBeVisual: true,
    });

    dom.window.HTMLCanvasElement.prototype.getContext = function() { return stubCtx(); };
    dom.window.HTMLCanvasElement.prototype.toDataURL = function() { return 'data:image/png;base64,'; };
    // Stub fetch so storage.list/server probes don't blow up in node.
    dom.window.fetch = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve(''),
    });

    // Wait for App.init to finish (it's async because of Storage.init).
    await new Promise((resolve) => {
        const tick = () => {
            if (dom.window.__appReady && dom.window.Tools && dom.window.Canvas.drawCanvas) {
                resolve();
            } else {
                setTimeout(tick, 5);
            }
        };
        tick();
    });
    // Give one more tick for DOMContentLoaded handler chain.
    await new Promise(r => setTimeout(r, 20));

    return dom;
}

// Tiny test runner: collects results and exits non-zero on any failure.
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll() {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ok   ${name}`);
        } catch (err) {
            failed++;
            console.log(`  FAIL ${name}`);
            console.log('       ' + (err.stack || err.message).split('\n').join('\n       '));
        }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
    if (failed) process.exit(1);
}

function assert(cond, msg) {
    if (!cond) throw new Error('assertion failed: ' + (msg || ''));
}
function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` + (msg ? ' — ' + msg : ''));
    }
}

module.exports = { loadApp, test, runAll, assert, assertEqual };
