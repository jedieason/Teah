import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!path.startsWith(root + sep) || path.includes(`${sep}.git${sep}`)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(path);
        res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`題矣：http://127.0.0.1:${port}`));
