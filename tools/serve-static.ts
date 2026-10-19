/**
 * A static file server that behaves like GitHub Pages for the end-to-end Pages test: files under
 * a sub-path, ordinary content types, byte ranges, no special headers. In particular it sends no
 * COOP/COEP, so cross-origin isolation has to come from the app's service worker, as on Pages.
 *
 *   node tools/serve-static.ts <dir> <base path> <port>
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [dirArg = 'dist-pages', baseArg = '/dither-chess/', portArg = '4174'] = process.argv.slice(2);
const dir = resolve(dirArg);
const base = `/${baseArg.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const port = Number(portArg);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  if (path === base.slice(0, -1)) {
    res.writeHead(301, { Location: base + url.search });
    res.end();
    return;
  }
  if (!path.startsWith(base)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  let file = normalize(join(dir, path.slice(base.length)));
  if (file !== dir && !file.startsWith(dir + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'max-age=600'
  };
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${dir} at http://localhost:${port}${base}`));
