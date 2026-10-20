import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Chess } from 'chess.js';
import { PUZZLE_FILE, parsePuzzles } from '../../src/puzzles/data';

/**
 * Puzzles: the set loads, a puzzle is solved by clicking its moves (read from the same file the
 * app loads), a wrong move counts as a miss, filters narrow the pool, and progress survives a
 * reload. No model pack is needed.
 */
const all = new Map(parsePuzzles(gunzipSync(readFileSync(`public/${PUZZLE_FILE}`)).toString('utf8')).map((p) => [p.id, p]));

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

async function play(page: Page, uci: string) {
  for (const sq of [uci.slice(0, 2), uci.slice(2, 4)]) {
    const p = await squareCentre(page, sq);
    await page.mouse.click(p.x, p.y);
  }
}

const screen = (page: Page) => page.locator('.puzzles');

test('puzzles can be solved, missed, filtered, and the progress is kept', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('link', { name: 'Puzzles' }).click();
  await expect(screen(page)).toHaveAttribute('data-state', 'solving', { timeout: 30_000 });
  await expect(page.locator('.intro')).toContainText(/(White|Black)/);

  // Solve it with the moves from the set.
  const id = (await screen(page).getAttribute('data-puzzle'))!;
  const puzzle = all.get(id)!;
  expect(puzzle, id).toBeDefined();
  for (let i = 1; i < puzzle.moves.length; i += 2) {
    // Wait for the opponent's move before each of ours.
    await expect(screen(page)).toHaveAttribute('data-ply', String(i));
    await play(page, puzzle.moves[i]!);
  }
  await expect(screen(page)).toHaveAttribute('data-state', 'solved');
  await expect(page.locator('.status')).toHaveText('Solved.');
  await expect(page.locator('.stats')).toContainText(/Solved\s*1/);

  // The next one: a wrong first move is a miss, and the position stays.
  await page.getByRole('button', { name: 'Next puzzle' }).click();
  await expect(screen(page)).toHaveAttribute('data-state', 'solving', { timeout: 10_000 });
  const second = all.get((await screen(page).getAttribute('data-puzzle'))!)!;
  expect(second.id).not.toBe(id);
  const c = new Chess(second.fen);
  c.move({ from: second.moves[0]!.slice(0, 2), to: second.moves[0]!.slice(2, 4), promotion: second.moves[0]![4] });
  const wrong = c.moves({ verbose: true }).find((m) => m.lan !== second.moves[1] && !m.san.includes('#') && !m.promotion)!;
  await play(page, wrong.lan);
  await expect(screen(page)).toHaveAttribute('data-state', 'wrong');
  await expect(page.locator('.stats')).toContainText(/Missed\s*1/);
  await page.getByRole('button', { name: 'Solution' }).click();
  await expect(screen(page)).toHaveAttribute('data-state', 'shown');
  await expect(page.locator('.stats')).toContainText(/Missed\s*1/);
  await expect(page.locator('.themes .chip').first()).toBeVisible();

  // Filters: knight puzzles only.
  const before = Number((await page.locator('.filters .count').innerText()).replace(/\D/g, ''));
  await page.locator('fieldset', { hasText: 'Key piece' }).getByText('Knight', { exact: true }).click();
  await expect(screen(page)).toHaveAttribute('data-state', 'solving', { timeout: 10_000 });
  const after = Number((await page.locator('.filters .count').innerText()).replace(/\D/g, ''));
  expect(after).toBeGreaterThan(20);
  expect(after).toBeLessThan(before);
  const knight = all.get((await screen(page).getAttribute('data-puzzle'))!)!;
  expect(knight.piece).toBe('N');

  // Progress and filters survive a reload.
  await page.reload();
  await expect(screen(page)).toHaveAttribute('data-state', 'solving', { timeout: 30_000 });
  await expect(page.locator('.stats')).toContainText(/Solved\s*1/);
  await expect(page.locator('fieldset', { hasText: 'Key piece' }).locator('label.on')).toHaveText('Knight');
});
