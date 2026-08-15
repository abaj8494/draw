// Minimal static file server for end-to-end tests, so the browser suite can
// exercise the working tree instead of whatever is currently deployed.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

function start() {
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0];

        // The app talks to a small nginx/Lua API that does not exist here.
        // Answer just enough for the page to boot.
        if (url === '/api/list') {
            res.writeHead(200, { 'Content-Type': TYPES['.json'] });
            res.end('[]');
            return;
        }

        const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
        const filePath = path.join(ROOT, rel);

        // Never serve outside the project.
        if (!filePath.startsWith(ROOT + path.sep)) {
            res.writeHead(403);
            res.end('forbidden');
            return;
        }

        fs.readFile(filePath, (err, body) => {
            if (err) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            const type = TYPES[path.extname(filePath)] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/`,
                close: () => new Promise(r => server.close(r)),
            });
        });
    });
}

module.exports = { start };
