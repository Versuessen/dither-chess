import { expect, test, type Page } from '@playwright/test';
import { Chess, type Move } from 'chess.js';
import manifest from '../../models/manifest.json' with { type: 'json' };

/**
 * A full rated game against every model pack that has calibrated levels: install the pack from
 * the same-origin mirror, play 15+10 as White by clicking squares until the game ends by the
 * rules, then find the game in History.
 */

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** A weak but purposeful human: mates in one, wins material, otherwise plays a seeded random move. */
function chooseMove(fen: string, rand: () => number): Move {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  const mate = moves.find((m) => m.san.endsWith('#'));
  if (mate) return mate;
  const gains = moves
    .filter((m) => m.captured)
    .map((m) => ({ m, gain: VALUE[m.captured!]! - (VALUE[m.piece]! * 0.5) }))
    .sort((a, b) => b.gain - a.gain);
  if (gains.length && gains[0]!.gain > 0) return gains[0]!.m;
  return moves[Math.floor(rand() * moves.length)]!;
}

function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function squareCentre(page: Page, square: string) {
  const box = (await page.locator('cg-board').boundingBox())!;
  const black = await page.locator('.cg-wrap.orientation-black').count();
  let f = square.charCodeAt(0) - 97;
  let r = Number(square[1]) - 1;
  if (black) {
    f = 7 - f;
    r = 7 - r;
  }
  return { x: box.x + ((f + 0.5) * box.width) / 8, y: box.y + ((7 - r + 0.5) * box.height) / 8 };
}

async function clickSquare(page: Page, square: string) {
  const p = await squareCentre(page, square);
  await page.mouse.click(p.x, p.y);
}

const packs = manifest.packs.filter((p) => p.calibration.levels.length > 0);

for (const pack of packs) {
  test(`plays a full rated game against ${pack.title}`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await page.goto('/#/models');
    await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });

    // Install from the same-origin mirror.
    const row = page.locator(`[data-pack="${pack.id}"]`);
    await row.getByRole('button', { name: 'Download' }).click();
    await expect(row).toContainText('verified', { timeout: 5 * 60_000 });

    // Bots move at once so the test is about rules and flow, not waiting.
    await page.goto('/#/settings');
    await page.locator('fieldset', { hasText: 'Instant bot' }).getByText('On', { exact: true }).click();

    await page.goto('/#/bot/grinder');
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
    await panel.locator('fieldset', { hasText: 'Clock' }).getByText('15+10', { exact: true }).click();
    await expect(panel.getByText('Clock · Rapid')).toBeVisible();
    await panel.locator('fieldset', { hasText: 'Game' }).getByText('Rated', { exact: true }).click();
    await panel.getByRole('button', { name: 'Play' }).click();

    const screen = page.locator('.screen-game');
    await expect(screen).toHaveAttribute('data-state', /human|bot/, { timeout: 60_000 });
    await expect(page.locator('.status')).toContainText('Rated Rapid');

    const rand = seeded(pack.id.length * 7919);
    for (let ply = 0; ply < 600; ply++) {
      await expect(screen).toHaveAttribute('data-state', /human|over/, { timeout: 60_000 });
      if ((await screen.getAttribute('data-state')) === 'over') break;
      const fen = (await screen.getAttribute('data-fen'))!;
      const move = chooseMove(fen, rand);
      await clickSquare(page, move.from);
      await clickSquare(page, move.to);
      if (move.promotion) await page.getByRole('dialog', { name: 'Promote to' }).getByRole('button', { name: 'queen' }).click();
      await expect(screen).not.toHaveAttribute('data-fen', fen);
    }

    await expect(screen).toHaveAttribute('data-state', 'over');
    const result = page.locator('section.result');
    await expect(result).toBeVisible();
    await expect(result.locator('.big')).toHaveText(/^(1-0|0-1|1\/2-1\/2)$/);
    await expect(result).toContainText('rated');

    // The finished game is stored with its PGN.
    await result.getByRole('link', { name: 'Roster' }).click();
    await page.goto('/#/history');
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr').first()).toContainText(pack.title.split(' ')[0]!);

    // The game is in the rating ledger, in this month's (live) period.
    await page.goto('/#/rating');
    await expect(page.getByTestId('rating-value')).toHaveText(/^(Unrated \([01]\/5\))$/i);
    const month = page.locator('table tbody tr').first();
    await expect(month).toContainText('live');
    await expect(month.locator('td').nth(1)).toHaveText('1');

    // History can take the game out of the rating, and put it back.
    await page.goto('/#/history');
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByTestId('dev-pgn')).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove from rating' }).click();
    await expect(page.getByText('Removed', { exact: true })).toBeVisible();
    await page.goto('/#/rating');
    await expect(page.getByText(/No rated rapid games yet/)).toBeVisible();
    await page.goto('/#/history');
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByRole('button', { name: 'Count for rating again' }).click();
    await page.goto('/#/rating');
    await expect(page.locator('table tbody tr').first().locator('td').nth(1)).toHaveText('1');
  });
}

test('an aborted game is not stored as played', async ({ page }) => {
  await page.goto('/#/models');
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
  test.skip(packs.length === 0, 'no calibrated model pack');
  const pack = packs[0]!;
  const row = page.locator(`[data-pack="${pack.id}"]`);
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(row).toContainText('verified', { timeout: 5 * 60_000 });
  await page.goto('/#/bot/grinder');
  const panel = page.getByRole('dialog');
  await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
  await panel.getByRole('button', { name: 'Play' }).click();
  const screen = page.locator('.screen-game');
  await expect(screen).toHaveAttribute('data-state', 'human', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Abort' }).click();
  await expect(page.locator('section.result .big')).toHaveText('Aborted');
  await page.goto('/#/history');
  await expect(page.getByText('No finished games yet.')).toBeVisible();
});
