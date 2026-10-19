import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build served by `vite preview` (cross-origin
 * isolated). DITHER_CHROMIUM points at a local Chromium binary when Playwright's own browser
 * download is not available; CI uses `playwright install chromium`.
 */
const executablePath = process.env.DITHER_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
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
    command: 'pnpm build && pnpm preview',
    // Lets tests/e2e/threads.spec.ts make the preview server refuse WebAssembly thread workers.
    env: { DITHER_TEST_HOOKS: '1' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
