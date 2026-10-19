import { expect, test, devices, type Page } from '@playwright/test';
import manifest from '../../models/manifest.json' with { type: 'json' };

/**
 * Phones (iPhone 13 size, touch): the home screen is a main menu, every screen fits the width
 * without sideways scrolling, and a game can be started and played by tapping.
 */
const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
test.use({ ...iphone });

async function noSidewaysScroll(page: Page) {
  const over = await page.evaluate(() => {
    const doc = document.scrollingElement!;
    const scrollers = [doc, ...document.querySelectorAll<HTMLElement>('.frame, .screen-game')];
    return scrollers.map((el) => el.scrollWidth - el.clientWidth).filter((d) => d > 1);
  });
  expect(over, 'nothing scrolls sideways').toEqual([]);
}

test('the home screen is a main menu on a phone', async ({ page }) => {
  await page.goto('/');
  const play = page.locator('button.play');
  await expect(play).toBeVisible({ timeout: 30_000 });
  for (const name of ['History', 'Rating', 'Models', 'Settings']) {
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })).toBeVisible();
  }
  // The opponents follow under Play, smaller.
  const first = page.locator('[data-persona="loose-ends"]');
  await expect(first).toBeVisible();
  const playSize = await play.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const rowSize = await first.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(rowSize / playSize).toBeGreaterThan(0.55);
  expect(rowSize / playSize).toBeLessThan(0.8);
  await noSidewaysScroll(page);

  for (const route of ['settings', 'models', 'rating', 'history']) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('main.panel')).toBeVisible();
    await noSidewaysScroll(page);
  }
});

const pack = manifest.packs.find((p) => p.calibration.levels.length > 0);

test('a game can be started from Play and played by tapping', async ({ page }) => {
  test.skip(!pack, 'no calibrated model pack');
  test.setTimeout(6 * 60_000);
  await page.goto('/#/models');
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
  const row = page.locator(`[data-pack="${pack!.id}"]`);
  await row.getByRole('button', { name: 'Download' }).tap();
  await expect(row).toContainText('verified', { timeout: 5 * 60_000 });

  await page.goto('/');
  await page.locator('button.play').tap();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.titlebar')).toContainText('Custom game');
  await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).tap();
  await panel.getByRole('button', { name: 'Play' }).tap();

  const screen = page.locator('.screen-game');
  await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
  const board = (await page.locator('cg-board').boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.x + board.width).toBeLessThanOrEqual(vw + 1);
  expect(board.width).toBeGreaterThan(vw * 0.8);
  await noSidewaysScroll(page);

  // e2-e4 by two taps.
  const sq = (f: number, r: number) => ({ x: board.x + ((f + 0.5) * board.width) / 8, y: board.y + ((7 - r + 0.5) * board.height) / 8 });
  await page.touchscreen.tap(sq(4, 1).x, sq(4, 1).y);
  await page.touchscreen.tap(sq(4, 3).x, sq(4, 3).y);
  await expect(screen).not.toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP/);
  await expect(page.locator('ol.moves')).toContainText('e4');
});
