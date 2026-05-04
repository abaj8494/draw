// End-to-end smoke test against the live deployment using a real browser.
// Skipped by default because it depends on the site being reachable. To run:
//   E2E=1 npm test     or     node tests/browser.test.js
if (require.main !== module && !process.env.E2E) return;

const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const failures = [];

    page.on('pageerror', err => failures.push('pageerror: ' + err.message));

    await page.goto('http://draw.abaj.ai/', { waitUntil: 'networkidle' });
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

    await browser.close();
    if (failures.length) {
        console.log('FAIL');
        failures.forEach(f => console.log(' - ' + f));
        process.exit(1);
    } else {
        console.log('OK — text input and laser hover both behave correctly in chromium');
    }
})().catch(e => { console.error(e); process.exit(1); });
