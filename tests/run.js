// Discover and run every *.test.js file in this directory.
// The browser suite is opt-in (E2E=1) and runs last, after the unit tests.
const fs = require('fs');
const path = require('path');
const { runAll } = require('./harness');

const dir = __dirname;
const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js') && f !== 'browser.test.js')
    .sort();

(async () => {
    for (const f of files) {
        console.log(`\n${f}`);
        require(path.join(dir, f));
    }
    await runAll();

    if (process.env.E2E) {
        const browser = require(path.join(dir, 'browser.test.js'));
        const failures = await browser.run();
        if (failures) process.exit(1);
    }
})();
