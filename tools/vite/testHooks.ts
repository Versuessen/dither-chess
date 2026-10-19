/**
 * Vite plugin, end-to-end tests only (DITHER_TEST_HOOKS=1, set by playwright.config.ts): lets a
 * test make `vite preview` refuse the scripts of workers started by other workers (which is what
 * onnxruntime-web's WebAssembly threads are), as WebView2 under the desktop app's protocol does on
 * Windows (tests/e2e/threads.spec.ts). Playwright cannot intercept requests made by workers that
 * workers start, so the server has to do it. A worker's script request names the script that
 * started it as Referer: a page's workers come from the page, nested ones from /assets/.
 *
 *   GET /__test/refuse-thread-workers?on=1|0   switch it on or off
 *   GET /__test/refuse-thread-workers          {"on": boolean, "refused": number}
 */
import type { Plugin } from 'vite';

export function testHooks(): Plugin {
  let on = false;
  let refused = 0;
  return {
    name: 'dither-test-hooks',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/__test/refuse-thread-workers') {
          const v = url.searchParams.get('on');
          if (v !== null) {
            on = v === '1';
            refused = 0;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ on, refused }));
          return;
        }
        const referer = req.headers.referer ? new URL(req.headers.referer).pathname : '';
        if (on && req.headers['sec-fetch-dest'] === 'worker' && referer.startsWith('/assets/')) {
          refused++;
          res.statusCode = 404;
          res.end();
          return;
        }
        next();
      });
    }
  };
}
