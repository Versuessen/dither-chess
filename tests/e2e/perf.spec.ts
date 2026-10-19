import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';

/**
 * Performance budgets (DECISIONS.md, Phase 7), measured on the production build:
 *  - start-up with everything cached (service worker): preloader gone within 3 s;
 *  - JavaScript on the first screen: at most 400 kB (transfer, uncompressed by the preview server);
 *  - one bot move (Maia-3 23M forward pass in the worker, WASM): median ≤ 150 ms, 95th percentile ≤ 400 ms,
 *    over 24 moves.
 * The numbers are printed so CI logs keep a record.
 */

const BUDGET = { warmStartMs: 3000, firstScreenJsKb: 400, inferenceMedianMs: 150, inferenceP95Ms: 400 };

const SAMPLES = 24;

/** Wait until the dither layer has stopped drawing (with reduced motion it draws once per change). */
async function settled(page: Page): Promise<void> {
  const frames = () =>
    page.evaluate(() => (document.querySelector('canvas.dither') as HTMLCanvasElement & { frames?: number }).frames ?? 0);
  await expect
    .poll(async () => {
      const a = await frames();
      await page.waitForTimeout(300);
      return (await frames()) - a;
    }, { timeout: 20_000 })
    .toBe(0);
}

async function bootTime(page: Page): Promise<number> {
  const t0 = Date.now();
  await page.goto('/#/');
  await expect(page.locator('.pre')).toHaveCount(0, { timeout: 30_000 });
  return Date.now() - t0;
}

test('meets the start-up and inference budgets', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  // The game backdrop drifts gently; test machines draw WebGL in software on the same cores as
  // the inference worker, so the budgets are measured with the backdrop still (reduced motion).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let js = 0;
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'script' || r.url().endsWith('.js')) {
      const len = Number(r.headers()['content-length'] ?? 0);
      js += len || (await r.body().catch(() => Buffer.alloc(0))).length;
    }
  });
  const cold = await bootTime(page);
  const firstJsKb = js / 1024;
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 60_000 });
  const warm = await bootTime(page);

  await page.goto('/#/models');
  const row = page.locator('[data-pack="maia3-23m"]');
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(row).toContainText('verified', { timeout: 5 * 60_000 });
  await page.goto('/#/settings');
  await page.locator('fieldset', { hasText: 'Instant bot' }).getByText('On', { exact: true }).click();
  await page.goto('/#/bot/grinder');
  const panel = page.getByRole('dialog');
  await panel.locator('fieldset', { hasText: 'Colour' }).getByText('White', { exact: true }).click();
  await panel.getByRole('button', { name: 'Play' }).click();

  // Answer each bot move with a legal reply typed in, and collect the bot's inference times until
  // there are SAMPLES of them, starting a new game when one ends. Each game starts once the
  // backdrop has settled: test machines draw WebGL in software (SwiftShader), on the same few
  // cores as the worker, which a GPU does not.
  const screen = page.locator('.screen-game');
  const input = page.getByLabel('Type a move');
  const times: number[] = [];
  let starting = true;
  for (let i = 0; times.length < SAMPLES; i++) {
    await expect(screen).toHaveAttribute('data-state', /human|over/, { timeout: 60_000 });
    if ((await screen.getAttribute('data-state')) === 'over') {
      await page.getByRole('button', { name: 'Play again' }).click();
      await expect(screen).not.toHaveAttribute('data-state', 'over');
      starting = true;
      continue;
    }
    if (starting) {
      await settled(page);
      starting = false;
    }
    const ms = Number(await screen.getAttribute('data-inference-ms'));
    if (ms > 0) times.push(ms);
    const fen = (await screen.getAttribute('data-fen'))!;
    const moves = new Chess(fen).moves({ verbose: true });
    const m = moves[(i * 7) % moves.length]!;
    await input.fill(m.from + m.to + (m.promotion ?? ''));
    await input.press('Enter');
    await expect(screen).not.toHaveAttribute('data-fen', fen);
  }
  const inOrder = times.map((t) => t.toFixed(0)).join(' ');
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]!;
  const isolated = await page.evaluate(() => crossOriginIsolated);
  console.log(
    `perf: cold start ${cold} ms, warm start ${warm} ms, first-screen JS ${firstJsKb.toFixed(0)} kB, ` +
      `inference median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms over ${times.length} moves (isolated: ${isolated}); ` +
      `per move: ${inOrder}`
  );
  expect(warm).toBeLessThanOrEqual(BUDGET.warmStartMs);
  expect(firstJsKb).toBeLessThanOrEqual(BUDGET.firstScreenJsKb);
  expect(median).toBeLessThanOrEqual(BUDGET.inferenceMedianMs);
  expect(p95).toBeLessThanOrEqual(BUDGET.inferenceP95Ms);
});
