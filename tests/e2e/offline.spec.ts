import { expect, test } from '@playwright/test';

/**
 * An offline session: after one online visit (service worker installed, a model pack downloaded),
 * the app starts, verifies the pack and plays with the network switched off.
 */
test('works without a connection after the first visit', async ({ page, context }) => {
  test.setTimeout(5 * 60_000);
  await page.goto('/#/models');
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
  // The service worker controls the page (it precaches the whole app on install).
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && !!navigator.serviceWorker.controller;
  }, null, { timeout: 60_000 });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  const row = page.locator('[data-pack="fastelo-7m"]');
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(row).toContainText('verified', { timeout: 5 * 60_000 });

  await context.setOffline(true);
  try {
    await page.goto('/#/');
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    // Still isolated: the service worker adds the headers to cached responses.
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    await page.goto('/#/models');
    await expect(page.locator('[data-pack="fastelo-7m"]')).toContainText('verified', { timeout: 60_000 });

    await page.goto('/#/bot/grinder');
    const panel = page.getByRole('dialog');
    await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
    await panel.getByRole('button', { name: 'Play' }).click();
    const screen = page.locator('.screen-game');
    await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });

    // e2-e4 by clicking, then the bot answers from the local model.
    const box = (await page.locator('cg-board').boundingBox())!;
    const at = (f: number, r: number) => ({ x: box.x + ((f + 0.5) * box.width) / 8, y: box.y + ((7 - r + 0.5) * box.height) / 8 });
    await page.mouse.click(at(4, 1).x, at(4, 1).y);
    await page.mouse.click(at(4, 3).x, at(4, 3).y);
    await expect(page.locator('ol.moves')).toContainText('e4');
    await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
    await expect(page.locator('ol.moves li').first().locator('button')).toHaveCount(2);
  } finally {
    await context.setOffline(false);
  }
});
