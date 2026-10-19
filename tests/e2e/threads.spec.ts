import { expect, test } from '@playwright/test';

/**
 * onnxruntime-web runs WebAssembly threads in workers it starts from inside the inference worker.
 * Where those cannot start (WebView2 under the desktop app's own protocol on Windows: the first
 * model load died with "Uncaught [object Event]"), inference has to carry on single-threaded.
 *
 * Reproduced with the preview server refusing the thread workers' script (tools/vite/testHooks.ts;
 * Playwright cannot intercept requests made by workers that workers start). The service worker is
 * blocked so that request reaches the server, and the device reports four cores, so the app asks
 * for three threads even on a two-core test machine.
 */
test.use({ serviceWorkers: 'block' });

test('inference falls back to one thread when WebAssembly thread workers cannot start', async ({ page, context, request }) => {
  test.setTimeout(5 * 60_000);
  await context.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 }));
  await request.get('/__test/refuse-thread-workers?on=1');
  try {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/#/models');
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    const row = page.locator('[data-pack="maia3-23m"]');
    await row.getByRole('button', { name: 'Download' }).click();
    await expect(row).toContainText('verified', { timeout: 5 * 60_000 });

    await page.goto('/#/bot/grinder');
    const panel = page.getByRole('dialog');
    await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
    await panel.getByRole('button', { name: 'Play' }).click();
    const screen = page.locator('.screen-game');
    await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
    const input = page.getByLabel('Type a move');
    await input.fill('e4');
    await input.press('Enter');
    await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
    await expect(page.locator('ol.moves li').first().locator('button')).toHaveCount(2);

    // The thread workers really were refused, and the app says what it did about it.
    const hook = (await (await request.get('/__test/refuse-thread-workers')).json()) as { refused: number };
    expect(hook.refused).toBeGreaterThan(0);
    // The runtime details are developer information: switch it on with the © on the home screen.
    await page.goto('/#/');
    await page.locator('button.year').click();
    await expect(page.locator('button.year')).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/#/settings');
    await expect(page.getByText(/inference on WebAssembly, 1 thread\b/)).toBeVisible();
    await expect(page.getByTestId('single-thread-reason')).toContainText(/WebAssembly thread/);
    expect(errors).toEqual([]);
  } finally {
    await request.get('/__test/refuse-thread-workers?on=0');
  }
});
