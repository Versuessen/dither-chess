import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';

/**
 * The Stockfish game review: a finished game (seeded straight into IndexedDB, so no model pack
 * is needed) is analysed in the browser, judged per side and kept for next time.
 */

function finishedGame() {
  // Scholar's mate: Black's 3…Nf6?? allows Qxf7#.
  const c = new Chess();
  const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
  const moves = sans.map((san) => {
    const color = c.turn();
    const m = c.move(san);
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: c.fen(), color, clock: null, spent: 0 };
  });
  return {
    id: 'review-test-game',
    startedAt: '2026-10-19T10:00:00.000Z',
    endedAt: '2026-10-19T10:05:00.000Z',
    persona: 'grinder',
    botName: 'Grinder (Maia-3 1200)',
    family: 'maia3',
    pack: 'maia3-23m',
    packSha256: '0'.repeat(64),
    botLevel: 1200,
    humanColor: 'w',
    timeControl: { base: 900, increment: 10 },
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves,
    outcome: { result: '1-0', termination: 'checkmate', winner: 'w' },
    rated: false,
    takebacks: 0,
    seed: 1,
    pgn: '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'
  };
}

async function seed(page: Page, game: unknown) {
  await page.goto('/');
  await page.evaluate(
    (g) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('dither');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('games', 'readwrite');
          tx.objectStore('games').put(g);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    game
  );
}

test('reviews a finished game with Stockfish and keeps the review', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  // Wait for the app to create its database.
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => indexedDB.databases().then((d) => d.some((x) => x.name === 'dither')));
  await seed(page, finishedGame());

  await page.goto('/#/history');
  await page.getByRole('link', { name: 'Review' }).click();

  const review = page.locator('.review');
  await expect(review).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
  const summary = page.getByTestId('review-summary');
  await expect(summary).toContainText('Accuracy');
  // Best classes first; the side that did better on a line is marked.
  const labels = await summary.locator('tbody th').allInnerTexts();
  expect(labels.map((l) => l.replace(/[^A-Za-z]/g, '').toLowerCase())).toEqual([
    'accuracy', 'brilliant', 'excellent', 'best', 'good', 'book', 'neutral', 'inaccuracy', 'mistake', 'blunder'
  ]);
  await expect(summary.locator('.better').first()).toBeVisible();
  // The page fits the window: no scrolling.
  expect(await page.locator('.frame').evaluate((f) => f.scrollHeight <= f.clientHeight + 1)).toBe(true);
  // The finishing move is the best move; Black's last move (…Nf6??) allowed mate.
  await expect(page.locator('ol.moves button', { hasText: 'Nf6' })).toHaveClass(/note-blunder/);
  await expect(page.locator('ol.moves button', { hasText: 'Qxf7#' })).toHaveClass(/note-best/);
  await page.locator('ol.moves button', { hasText: 'Nf6' }).click();
  await expect(page.locator('.explain')).toContainText('Blunder');
  await expect(page.locator('.explain')).toContainText('Best was');
  // The explanation keeps its height whatever it says.
  const h1 = await page.locator('.explain').evaluate((e) => e.getBoundingClientRect().height);
  await page.locator('ol.moves button', { hasText: 'Qxf7#' }).click();
  expect(await page.locator('.explain').evaluate((e) => e.getBoundingClientRect().height)).toBe(h1);
  // The move's class sits on its square, and only the mated king is shown in check.
  await expect(page.locator('.board .badge')).toHaveClass(/note-best/);
  await expect(page.locator('.board .badge')).toHaveText('★');
  await expect(page.locator('cg-board square.check')).toHaveCount(1);
  await page.locator('ol.moves button', { hasText: 'Nf6' }).click();
  await expect(page.locator('.board .badge')).toHaveText('??');
  await expect(page.locator('cg-board square.check')).toHaveCount(0);
  // Book moves are marked; the timeline scrubs to a move.
  await expect(page.locator('ol.moves button', { hasText: /^e4/ }).first()).toHaveClass(/note-book/);
  const tl = page.getByRole('slider', { name: 'Timeline' });
  const box = (await tl.boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await expect(tl).toHaveAttribute('aria-valuenow', '0');

  // Opening the review again does not re-run the engine.
  await page.goto('/#/history');
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(review).toHaveAttribute('data-state', 'done', { timeout: 5_000 });
});
