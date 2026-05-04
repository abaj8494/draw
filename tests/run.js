// Discover and run every *.test.js file in this directory.
const fs = require('fs');
const path = require('path');
const { runAll } = require('./harness');

const dir = __dirname;
const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js'))
    .sort();

(async () => {
    for (const f of files) {
        console.log(`\n${f}`);
        require(path.join(dir, f));
    }
    await runAll();
})();
