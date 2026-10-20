import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG 2.1 A/AA checks (axe-core) on every screen in both themes, plus keyboard play.
 * Text over the WebGL dither cannot be measured by axe; tests/unit/contrast.test.ts checks those
 * token pairs against every ink they can sit on.
 */

async function boot(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
}

async function audit(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
  expect(r.passes.length, `${where}: axe evaluated no rules`).toBeGreaterThan(10);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every screen passes WCAG 2.1 AA checks (${scheme})`, async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await boot(page, scheme);
    await audit(page, 'home');
    for (const route of ['models', 'rating', 'history', 'settings']) {
      await page.goto(`/#/${route}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, route);
    }
    await page.goto('/#/puzzles');
    await expect(page.locator('.puzzles')).toHaveAttribute('data-state', 'solving', { timeout: 30_000 });
    await audit(page, 'puzzles');
    await page.goto('/');
    await page.getByRole('button', { name: 'Opponents' }).click();
    await audit(page, 'home with opponents');
    await page.goto('/#/bot/grinder');
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'bot profile');
  });
}

test('a game can be played from the keyboard', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await boot(page, 'dark');
  await page.goto('/#/models');
  const row = page.locator('[data-pack="maia3-23m"]');
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(row).toContainText('verified', { timeout: 5 * 60_000 });
  await page.goto('/#/bot/grinder');
  const panel = page.getByRole('dialog');
  await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
  await panel.getByRole('button', { name: 'Play' }).click();
  const screen = page.locator('.screen-game');
  await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
  await audit(page, 'game');

  const input = page.getByLabel('Type a move');
  await input.fill('e5');
  await input.press('Enter');
  await expect(page.locator('#typed-error')).toContainText('not a legal move');
  await input.fill('e4');
  await input.press('Enter');
  await expect(page.locator('ol.moves')).toContainText('e4');
  // The move is announced for screen readers, then the bot's reply.
  await expect(page.locator('.sr-only[aria-live]')).toContainText(/played/);
  await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
  await expect(page.locator('.sr-only[aria-live]')).toContainText('The bot played');
});
