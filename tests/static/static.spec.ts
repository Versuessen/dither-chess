import { expect, test, type Page } from '@playwright/test';
import manifest from '../../models/manifest.json' with { type: 'json' };

/**
 * The website build on a plain static host: served under a sub-path by a server that sends no
 * COOP/COEP (tools/serve-static.ts). The first visit is not isolated; the service worker then
 * adds the headers and the app reloads once, isolated. (When the host sends the headers, as
 * vercel.json makes the website's host do, the first load must be isolated without a reload.)
 * The build preinstalls every model: the first game's model is ready when the preloader ends, the
 * others arrive by themselves, and a game starts straight from the roster. The source archive is linked and served, every request
 * stays under the base path, and the app starts again offline.
 */

async function isolated(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined');
  } catch {
    return false; // the page is reloading
  }
}

async function playFromRoster(page: Page) {
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
}

test('the website installs its models by itself and runs from a static host', async ({ page, context, baseURL, request }) => {
  test.setTimeout(8 * 60_000);
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

  let loads = 0;
  page.on('load', () => loads++);
  await page.goto('./');
  await expect.poll(() => isolated(page), { timeout: 90_000, message: 'cross-origin isolation' }).toBe(true);
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 120_000 });
  // Headers from the host isolate the first load; without them the service worker's reload does.
  expect(loads, 'page loads until isolated').toBe(test.info().config.metadata.hostSendsHeaders ? 1 : 2);

  // The first game's model (fastelo, the default) was installed behind the preloader.
  await page.goto('./#/models');
  await expect(page.locator('[data-pack="fastelo-7m"]')).toContainText('verified');
  // The rest arrive by themselves, nobody clicks Download.
  for (const p of manifest.packs) {
    await expect(page.locator(`[data-pack="${p.id}"]`)).toContainText('verified', { timeout: 5 * 60_000 });
  }

  await playFromRoster(page);

  // The source of this build is offered and served.
  await page.goto('./#/settings');
  const link = page.getByRole('link', { name: 'Download the source code of this version' });
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute('href'))!, page.url()).href;
  const archive = await request.get(href);
  expect(archive.status()).toBe(200);
  const body = await archive.body();
  expect([body[0], body[1]]).toEqual([0x1f, 0x8b]);
  expect(body.length).toBeGreaterThan(1_000_000);

  await context.setOffline(true);
  try {
    await page.goto('./#/');
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
    expect(await isolated(page)).toBe(true);
    await playFromRoster(page);
  } finally {
    await context.setOffline(false);
  }

  expect(outside, 'requests outside the base path').toEqual([]);
  expect(failed, 'failed requests').toEqual([]);
  expect(errors, 'page errors').toEqual([]);
});
