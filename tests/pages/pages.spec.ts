import { expect, test, type Page } from '@playwright/test';

/**
 * The GitHub Pages deployment, reproduced: the build served under a sub-path by a plain static
 * server (tools/serve-static.ts) that sends no COOP/COEP. The first visit is not isolated; the
 * service worker then adds the headers and the app reloads once, isolated. Every request stays
 * under the base path, a model installs from the same-origin mirror, a game is played, and the
 * app starts again offline.
 */

async function isolated(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined');
  } catch {
    return false; // the page is reloading
  }
}

test('runs from a static host under a sub-path, isolated by its service worker', async ({ page, context, baseURL }) => {
  test.setTimeout(6 * 60_000);
  const base = new URL(baseURL!);
  const outside: string[] = [];
  const failed: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === base.origin && !u.pathname.startsWith(base.pathname)) outside.push(u.pathname);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  await expect.poll(() => isolated(page), { timeout: 90_000, message: 'service worker isolation after one reload' }).toBe(true);
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('button[data-persona]').first()).toBeVisible();

  await page.goto('./#/models');
  const row = page.locator('[data-pack="fastelo-7m"]');
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(row).toContainText('verified', { timeout: 5 * 60_000 });

  const play = async () => {
    await page.goto('./#/bot/grinder');
    const panel = page.getByRole('dialog');
    await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
    await panel.getByRole('button', { name: 'Play' }).click();
    const screen = page.locator('.screen-game');
    await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
    const input = page.getByLabel('Type a move');
    await input.fill('e4');
    await input.press('Enter');
    await expect(page.locator('ol.moves')).toContainText('e4');
    await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
    await expect(page.locator('ol.moves li').first().locator('button')).toHaveCount(2);
  };
  await play();

  await context.setOffline(true);
  try {
    await page.goto('./#/');
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
    expect(await isolated(page)).toBe(true);
    await play();
  } finally {
    await context.setOffline(false);
  }

  expect(outside, 'requests outside the base path').toEqual([]);
  expect(failed, 'failed requests').toEqual([]);
  expect(errors, 'page errors').toEqual([]);
});
