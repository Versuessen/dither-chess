/**
 * How a bot behaves around its moves: how long it pauses, when it accepts a draw, when it
 * resigns. Pure functions of the model's outputs and the game state, seeded for tests.
 *
 * None of this changes which move the bot plays; that is the model's sampled choice alone.
 */
import type { Rng } from '../lib/rng';

export type WDL = readonly [win: number, draw: number, loss: number];

/** Expected score for the side the WDL belongs to. */
export const expectedScore = (wdl: WDL): number => wdl[0] + 0.5 * wdl[1];

export interface ThinkInput {
  /** Ply count before the bot's move (0 = White's first move). */
  ply: number;
  /** Legal moves available. */
  legal: number;
  /** Shannon entropy of the sampled distribution over legal moves, in nats. */
  entropy: number;
  /** Probability of the move the bot chose. */
  chosenProb: number;
  /** Bot's remaining clock in ms (Infinity when untimed). */
  remaining: number;
  /** Increment in ms. */
  increment: number;
  /** Base time in ms (0 when untimed). */
  base: number;
  /** Time inference already took, ms. */
  inferenceMs: number;
  /** The bot's rating (Lichess rapid scale): weaker players move faster and think less. */
  level: number;
}

/** Longest human-like pause at the lowest and the highest levels, ms. */
export const THINK_CAP = { low: 3000, high: 12_000 } as const;

/**
 * Human-like pause before the move appears, in ms (inference time already subtracted).
 *
 * It follows the clock the way a player budgets time, but DITHER is a training partner, so the
 * pause is a fraction of a real player's and capped: from 3 s at the lowest levels to 12 s at the
 * top, with simple and forced moves far quicker. Untimed games pace themselves like 10+5.
 */
export function thinkTime(t: ThinkInput, rng: Rng): number {
  const timed = Number.isFinite(t.remaining);
  const remaining = timed ? t.remaining : 600_000;
  const increment = timed ? t.increment : 5_000;
  const moveNo = Math.floor(t.ply / 2) + 1;
  const movesLeft = Math.max(18, 42 - moveNo * 0.6);
  const budget = remaining / movesLeft + increment * 0.75;
  // 0 at 600, 1 at 2400 and above.
  const strength = Math.min(1, Math.max(0, (t.level - 600) / 1800));
  const pace = 0.3 + 0.4 * strength;
  const cap = THINK_CAP.low + (THINK_CAP.high - THINK_CAP.low) * strength;

  // Complexity: normalised entropy of the bot's own move distribution.
  const maxH = Math.log(Math.max(2, t.legal));
  const complexity = Math.min(1, Math.max(0, t.entropy / maxH));
  let factor = 0.12 + 1.6 * complexity ** 1.5;

  if (t.chosenProb > 0.92) factor = Math.min(factor, 0.22); // obvious, e.g. a recapture
  if (moveNo <= 6) factor *= 0.3; // book-like opening moves come fast
  else if (moveNo <= 12) factor *= 0.6;

  // Humans vary: log-normal noise around the plan (median 1, sigma 0.45).
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  let ms = Math.min(cap, budget * factor * pace * Math.exp(0.45 * z));

  // A forced move is played almost at once, whatever the clock.
  if (t.legal === 1) ms = 250 + 450 * rng.next();
  else if (t.chosenProb > 0.92) ms = Math.min(ms, 1800);

  // Never spend the bot's own time unfairly: at most 6% of what is left, keep 2 s spare.
  if (timed) ms = Math.min(ms, remaining * 0.06, Math.max(0, remaining - 2000));
  ms = Math.max(ms, t.legal === 1 ? 180 : 320);
  if (timed && remaining < 4000) ms = Math.min(ms, 150);
  return Math.max(0, Math.floor(ms - t.inferenceMs));
}

export interface DrawInput {
  /** Bot's win/draw/loss, or null when the model has no value head. */
  wdl: WDL | null;
  /** Neither side can mate (dead position by material). */
  deadDrawn: boolean;
  ply: number;
}

/** Accept a draw offer? */
export function acceptsDraw(d: DrawInput): boolean {
  if (d.deadDrawn) return true;
  if (!d.wdl) return false;
  if (d.ply < 20) return false; // nobody agrees a draw in the opening against a stranger
  return expectedScore(d.wdl) <= 0.47;
}

/** Claim an available threefold repetition or 50-move draw? */
export function claimsDraw(wdl: WDL | null): boolean {
  return wdl ? expectedScore(wdl) <= 0.5 : true;
}

export interface ResignInput {
  level: number;
  wdl: WDL | null;
  /** Bot's material minus the opponent's, in pawns (P1 N3 B3 R5 Q9). */
  materialBalance: number;
  /** Consecutive own moves, including this one, the position has looked lost. */
  lostStreak: number;
}

/**
 * Bots rarely resign, and low-rated ones almost never do, as with humans on Lichess rapid.
 * Returns whether to resign now; the caller tracks the lost streak.
 */
export function resigns(r: ResignInput, rng: Rng): boolean {
  if (r.level < 1000 || !r.wdl) return false;
  const e = expectedScore(r.wdl);
  if (r.level < 1500) {
    if (e > 0.02 || r.materialBalance > -9 || r.lostStreak < 5) return false;
    return rng.next() < 0.25;
  }
  if (e > 0.03 || r.materialBalance > -5 || r.lostStreak < 3) return false;
  return rng.next() < 0.5;
}

/** Whether the bot considers this position lost (feeds the lost streak). */
export function looksLost(wdl: WDL | null): boolean {
  return !!wdl && expectedScore(wdl) <= 0.03;
}

/** Material balance in pawns for `color` from a FEN placement field. */
export function materialBalance(fen: string, color: 'w' | 'b'): number {
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let white = 0;
  let black = 0;
  for (const ch of fen.split(' ')[0]!) {
    const v = values[ch.toLowerCase()];
    if (v === undefined) continue;
    if (ch === ch.toUpperCase()) white += v;
    else black += v;
  }
  return color === 'w' ? white - black : black - white;
}
