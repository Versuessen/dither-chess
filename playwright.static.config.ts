import { defineConfig, devices } from '@playwright/test';

/**
 * The static-host check (tests/static): the website build (every model preinstalled, source
 * archive) for a sub-path, served by a plain static server without COOP/COEP
 * (tools/serve-static.ts), so cross-origin isolation has to come from the service worker.
 * `pnpm test:static` builds into dist-static first; with DITHER_STATIC_DIR the test serves an
 * existing build instead (DITHER_STATIC_BASE: its base path), and with DITHER_STATIC_HEADERS set to
 * a vercel.json the server sends that file's headers, as the website's host does.
 *
 * DITHER_STATIC_URL=https://… runs the same test against the live website instead (no local
 * server; through HTTPS_PROXY when one is set). The host is expected to send the headers.
 */
const executablePath = process.env.DITHER_CHROMIUM || undefined;
const base = `/${(process.env.DITHER_STATIC_BASE ?? 'dither').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const prebuilt = process.env.DITHER_STATIC_DIR;
const headers = process.env.DITHER_STATIC_HEADERS;
const remote = process.env.DITHER_STATIC_URL;
const proxy = remote && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const serve = `node tools/serve-static.ts ${prebuilt ?? 'dist-static'} ${base} 4174${headers ? ` ${headers}` : ''}`;

export default defineConfig({
  testDir: 'tests/static',
  timeout: 8 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-static' }]] : 'list',
  // Read by the test: does the host send COOP/COEP itself (no service-worker reload)?
  metadata: { hostSendsHeaders: !!(headers || remote) },
  use: {
    baseURL: remote ? `${remote.replace(/\/+$/, '')}/` : `http://localhost:4174${base}`,
    ...(proxy ? { proxy } : {}),
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath,
      args: executablePath
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
        : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: remote
    ? undefined
    : {
        command: prebuilt ? serve : `pnpm exec vite build --outDir dist-static && ${serve}`,
        env: { DITHER_BASE: base, DITHER_PREINSTALL: 'all', DITHER_SOURCE_ARCHIVE: '1' },
        url: `http://localhost:4174${base}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000
      }
});
