import { defineConfig, devices } from '@playwright/test';

/**
 * The static-host check (tests/static): the website build (every model preinstalled, source
 * archive) for a sub-path, served by a plain static server without COOP/COEP
 * (tools/serve-static.ts), so cross-origin isolation has to come from the service worker.
 * `pnpm test:static` builds into dist-static first; with DITHER_STATIC_DIR the test serves an
 * existing build instead.
 */
const executablePath = process.env.DITHER_CHROMIUM || undefined;
const base = `/${(process.env.DITHER_STATIC_BASE ?? 'dither').replace(/^\/+|\/+$/g, '')}/`;
const prebuilt = process.env.DITHER_STATIC_DIR;
const serve = `node tools/serve-static.ts ${prebuilt ?? 'dist-static'} ${base} 4174`;

export default defineConfig({
  testDir: 'tests/static',
  timeout: 8 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-static' }]] : 'list',
  use: {
    baseURL: `http://localhost:4174${base}`,
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
  webServer: {
    command: prebuilt ? serve : `pnpm exec vite build --outDir dist-static && ${serve}`,
    env: { DITHER_BASE: base, DITHER_PREINSTALL: 'all', DITHER_SOURCE_ARCHIVE: '1' },
    url: `http://localhost:4174${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
