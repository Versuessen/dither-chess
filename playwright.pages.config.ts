import { defineConfig, devices } from '@playwright/test';

/**
 * The GitHub Pages check (tests/pages): the web build for a sub-path, served without COOP/COEP
 * like Pages serves it. `pnpm test:pages` builds into dist-pages first; with DITHER_PAGES_DIR the
 * test serves an existing build instead (the Pages workflow tests the very files it deploys).
 */
const executablePath = process.env.DITHER_CHROMIUM || undefined;
const pagesBase = `/${(process.env.DITHER_PAGES_BASE ?? 'dither-chess').replace(/^\/+|\/+$/g, '')}/`;
const prebuilt = process.env.DITHER_PAGES_DIR;
const serve = `node tools/serve-static.ts ${prebuilt ?? 'dist-pages'} ${pagesBase} 4174`;

export default defineConfig({
  testDir: 'tests/pages',
  timeout: 6 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-pages' }]] : 'list',
  use: {
    baseURL: `http://localhost:4174${pagesBase}`,
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
    command: prebuilt ? serve : `pnpm exec vite build --outDir dist-pages && ${serve}`,
    env: { DITHER_BASE: pagesBase },
    url: `http://localhost:4174${pagesBase}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
