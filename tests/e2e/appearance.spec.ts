import { expect, test, type Page } from '@playwright/test';

async function booted(page: Page) {
  await page.goto('/');
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 15_000 });
}

const frames = (page: Page) =>
  page.evaluate(() => (document.querySelector('canvas.dither') as HTMLCanvasElement & { frames?: number }).frames ?? 0);

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe('themes', () => {
  test('follows the system, switches from Settings and by shortcut, and remembers the choice', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await booted(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await token(page, '--dither-light')).toBe('#3a3cf2');

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByText('Light', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await token(page, '--dither-light')).toBe('#f1de52');
    expect(await token(page, '--panel')).toBe('#f5f5f2');

    // The choice survives a reload even though the system is dark.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // T toggles anywhere outside a text field.
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 15_000 });
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Back to following the system.
    await page.getByText('System', { exact: true }).click();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('reduced motion', () => {
  test('the dither stays still and image swaps are instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await booted(page);
    await page.waitForTimeout(400);
    const before = await frames(page);
    await page.waitForTimeout(1500);
    expect(await frames(page)).toBe(before);

    // Hover swaps the subject with a single redraw, no dissolve animation.
    await page.locator('button[data-persona="grinder"]').hover();
    await expect(page.locator('canvas.dither')).toHaveAttribute('data-subject', 'kings-cross');
    await page.waitForTimeout(600);
    const afterSwap = await frames(page);
    expect(afterSwap - before).toBeLessThanOrEqual(3);

    // CSS motion is cut too.
    const duration = await page
      .locator('button[data-persona="grinder"]')
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(',').every((d) => parseFloat(d) < 0.01)).toBe(true);
  });

  test('with motion allowed the dither animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await booted(page);
    const a = await frames(page);
    await page.waitForTimeout(1500);
    // Software GL in CI renders slowly; any steady stream of frames proves the loop runs.
    expect((await frames(page)) - a).toBeGreaterThan(3);
  });

  test('the in-app setting reduces motion even when the system does not ask', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await booted(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByText('Reduce', { exact: true }).click();
    await page.waitForTimeout(400);
    const a = await frames(page);
    await page.waitForTimeout(1200);
    expect(await frames(page)).toBe(a);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  });
});

test.describe('home and bot profile', () => {
  test('the roster opens a focus-trapped profile panel that Esc closes', async ({ page }) => {
    await booted(page);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    const row = page.locator('button[data-persona="outpost"]');
    await row.hover();
    await expect(page.locator('canvas.dither')).toHaveAttribute('data-subject', 'outpost');
    await row.click();
    const dialog = page.getByRole('dialog', { name: 'Outpost' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Rating (Lichess rapid)')).toBeVisible();
    // Focus stays inside the dialog.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);
  });

  test('without an installed model PLAY leads to the model manager', async ({ page }) => {
    await page.goto('/#/bot/tempo');
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 15_000 });
    const play = page.getByRole('button', { name: 'Install model' });
    await play.hover();
    await expect(page.locator('canvas.dither')).toHaveAttribute('data-mode', 'live');
    await play.click();
    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  });
});
