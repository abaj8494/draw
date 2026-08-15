// End-to-end smoke test in a real browser, served from the working tree.
// Skipped by default because it needs a chromium download. To run:
//   E2E=1 npm test     or     node tests/browser.test.js
if (require.main !== module && !process.env.E2E) return;

const { chromium } = require('playwright');
const staticServer = require('./static-server');

async function run() {
    const server = await staticServer.start();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const failures = [];

    page.on('pageerror', err => failures.push('pageerror: ' + err.message));

    try {
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        // Tools/Canvas are defined with `const` at script-tag scope so they aren't
        // attached to window. Wait for the toolbar instead and probe the symbols
        // through the page's own scope.
        await page.waitForSelector('[data-tool="text"]');

        // --- Text input ---
        await page.click('[data-tool="text"]');
        await page.mouse.click(500, 400);
        await page.waitForTimeout(80);
        const textState1 = await page.evaluate(() => ({
            hidden: document.getElementById('text-input-overlay').classList.contains('hidden'),
            focused: document.activeElement && document.activeElement.tagName,
        }));
        if (textState1.hidden) failures.push('text overlay hidden after click');
        if (textState1.focused !== 'TEXTAREA') failures.push('focus not on textarea: ' + textState1.focused);

        await page.keyboard.type('browser test');
        const typedValue = await page.$eval('#text-input-overlay', el => el.value);
        if (typedValue !== 'browser test') {
            failures.push('typed value did not land in textarea: ' + JSON.stringify(typedValue));
        }
        await page.keyboard.press('Enter');
        await page.waitForTimeout(80);
        const overlayHidden = await page.$eval('#text-input-overlay', el => el.classList.contains('hidden'));
        if (!overlayHidden) failures.push('overlay still visible after Enter');

        // --- Laser cursor on hover (uses default: laser-plain) ---
        await page.click('[data-tool="laser"]');
        await page.mouse.move(700, 500);
        await page.waitForTimeout(40);
        const laserVisible = await page.$eval('#laser-pointer', el => !el.classList.contains('hidden'));
        if (!laserVisible) failures.push('laser dot not visible on hover');

        // Click again to open the submenu, then pick laser-trail and hover.
        await page.click('[data-tool="laser"]');
        await page.click('[data-tool="laser-trail"]');
        await page.mouse.move(720, 520);
        await page.waitForTimeout(40);
        const trailVisible = await page.$eval('#laser-pointer', el => !el.classList.contains('hidden'));
        if (!trailVisible) failures.push('laser-trail dot not visible on hover');

        // --- Pixel eraser survives a redraw ---
        await page.click('[data-tool="pencil"]');
        await page.mouse.move(300, 300);
        await page.mouse.down();
        await page.mouse.move(500, 300, { steps: 10 });
        await page.mouse.up();

        await page.click('[data-tool="eraser"]');
        await page.mouse.move(400, 300);
        await page.mouse.down();
        await page.mouse.move(420, 300, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(40);

        // Panning forces a full redraw. The erasure must survive it.
        await page.click('[data-tool="pan"]');
        await page.mouse.move(600, 600);
        await page.mouse.down();
        await page.mouse.move(640, 620, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(40);

        // Autosave is debounced by a second, so wait it out before reading.
        await page.waitForTimeout(1300);
        const persisted = await page.evaluate(() => {
            const raw = window.localStorage.getItem('draw_autosave');
            if (!raw) return null;
            const state = JSON.parse(raw);
            return (state.strokes || []).map(s => s.type);
        });
        if (!persisted) {
            failures.push('autosave missing after erase + pan');
        } else {
            // The erasure must be part of the saved document, not a transient
            // paint that the next redraw wipes out.
            if (!persisted.includes('eraser')) {
                failures.push('eraser stroke not persisted: ' + JSON.stringify(persisted));
            }
            if (!persisted.includes('pencil')) {
                failures.push('pencil stroke not persisted: ' + JSON.stringify(persisted));
            }
        }

        // --- Video embed ---
        // The iframe API is not loaded here (no network), so this only checks
        // that the layer is anchored and the miniplayer is pinned.
        await page.fill('#video-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        await page.click('#video-embed-btn');
        await page.waitForTimeout(120);

        const layer = await page.evaluate(() => {
            const el = document.getElementById('video-layer');
            const mini = document.getElementById('video-miniplayer');
            return {
                visible: el && !el.classList.contains('hidden'),
                transform: el && el.style.transform,
                miniVisible: mini && !mini.classList.contains('hidden'),
                miniRight: mini && Math.round(window.innerWidth - mini.getBoundingClientRect().right),
                miniTop: mini && Math.round(mini.getBoundingClientRect().top),
            };
        });
        if (!layer.visible) failures.push('video layer not visible after embed');
        if (!/translate\(/.test(layer.transform || '')) {
            failures.push('video layer not positioned: ' + layer.transform);
        }
        if (!layer.miniVisible) failures.push('miniplayer not visible after embed');
        if (layer.miniTop > 60) failures.push('miniplayer not pinned to the top: ' + layer.miniTop);
        if (layer.miniRight > 60) failures.push('miniplayer not pinned to the right: ' + layer.miniRight);

        // Panning must move the video with the drawing.
        const before = layer.transform;
        await page.click('[data-tool="pan"]');
        await page.mouse.move(600, 400);
        await page.mouse.down();
        await page.mouse.move(700, 450, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(60);
        const after = await page.$eval('#video-layer', el => el.style.transform);
        if (after === before) failures.push('video layer did not track the pan');
    } catch (err) {
        failures.push('threw: ' + (err && err.message));
    } finally {
        await browser.close();
        await server.close();
    }

    if (failures.length) {
        console.log('\nbrowser.test.js FAIL');
        failures.forEach(f => console.log('  - ' + f));
    } else {
        console.log('\nbrowser.test.js OK — text, laser, eraser and video embed all behave in chromium');
    }
    return failures.length;
}

// Exported so the shared runner can await it without the suite calling
// process.exit() out from under the other test files.
module.exports = { run };

if (require.main === module) {
    run().then(count => process.exit(count ? 1 : 0))
        .catch(e => { console.error(e); process.exit(1); });
}
