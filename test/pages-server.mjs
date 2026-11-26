// Server di prova che imita GitHub Pages: dist/ servita sotto /aMICOLettore/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
const dist = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.pdf': 'application/pdf' };
export function startPagesServer(port = 8099) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/aMICOLettore/')) { res.writeHead(404).end(); return; }
    p = p.slice('/aMICOLettore'.length);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(dist, p));
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
    catch { res.writeHead(404).end('Not found'); }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
