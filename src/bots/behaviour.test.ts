import { describe, expect, it } from 'vitest';
import { createRng } from '../lib/rng';
import { acceptsDraw, claimsDraw, materialBalance, resigns, thinkTime, type ThinkInput } from './behaviour';

const base: ThinkInput = {
  ply: 30,
  legal: 30,
  entropy: 1.5,
  chosenProb: 0.3,
  remaining: 600_000,
  increment: 10_000,
  base: 900_000,
  inferenceMs: 0
};

const median = (f: (rng: ReturnType<typeof createRng>) => number) => {
  const rng = createRng(5);
  const xs = Array.from({ length: 301 }, () => f(rng)).sort((a, b) => a - b);
  return xs[150]!;
};

describe('thinkTime', () => {
  it('is quick for forced moves and openings, slower in complex positions', () => {
    const forced = median((r) => thinkTime({ ...base, legal: 1, entropy: 0, chosenProb: 1 }, r));
    const opening = median((r) => thinkTime({ ...base, ply: 2 }, r));
    const recapture = median((r) => thinkTime({ ...base, entropy: 0.3, chosenProb: 0.95 }, r));
    const complex = median((r) => thinkTime({ ...base, entropy: 3.2 }, r));
    const simple = median((r) => thinkTime({ ...base, entropy: 0.6 }, r));
    expect(forced).toBeLessThan(600);
    expect(opening).toBeLessThan(complex / 3);
    expect(recapture).toBeLessThan(simple);
    expect(complex).toBeGreaterThan(simple * 2);
  });

  it('never burns more than 6% of the clock or the last 2 seconds', () => {
    const rng = createRng(1);
    for (let i = 0; i < 2000; i++) {
      const remaining = 1000 + rng.next() * 600_000;
      const ms = thinkTime({ ...base, entropy: 3.4, remaining }, rng);
      expect(ms).toBeLessThanOrEqual(Math.max(320, remaining * 0.06));
      if (remaining < 4000) expect(ms).toBeLessThanOrEqual(150);
    }
  });

  it('subtracts inference time and scales with the clock', () => {
    const a = median((r) => thinkTime({ ...base, inferenceMs: 0 }, r));
    const b = median((r) => thinkTime({ ...base, inferenceMs: 200 }, r));
    expect(a - b).toBeGreaterThan(150);
    const fast = median((r) => thinkTime({ ...base, remaining: 120_000, increment: 0 }, r));
    expect(fast).toBeLessThan(a);
  });

  it('paces untimed games', () => {
    const t = median((r) => thinkTime({ ...base, remaining: Infinity, increment: 0, base: 0 }, r));
    expect(t).toBeGreaterThan(300);
    expect(t).toBeLessThan(60_000);
  });
});

describe('draws', () => {
  it('accepts dead draws, and offers only when worse off with a value head', () => {
    expect(acceptsDraw({ wdl: null, deadDrawn: true, ply: 4 })).toBe(true);
    expect(acceptsDraw({ wdl: null, deadDrawn: false, ply: 60 })).toBe(false);
    expect(acceptsDraw({ wdl: [0.1, 0.5, 0.4], deadDrawn: false, ply: 60 })).toBe(true);
    expect(acceptsDraw({ wdl: [0.6, 0.3, 0.1], deadDrawn: false, ply: 60 })).toBe(false);
    expect(acceptsDraw({ wdl: [0.1, 0.5, 0.4], deadDrawn: false, ply: 8 })).toBe(false);
  });
  it('claims a repetition when not better', () => {
    expect(claimsDraw([0.2, 0.5, 0.3])).toBe(true);
    expect(claimsDraw([0.7, 0.2, 0.1])).toBe(false);
  });
});

describe('resigning', () => {
  const lost = [0.0, 0.01, 0.99] as const;
  it('never resigns below 1000', () => {
    const rng = createRng(2);
    for (let i = 0; i < 500; i++) {
      expect(resigns({ level: 900, wdl: lost, materialBalance: -20, lostStreak: 20 }, rng)).toBe(false);
    }
  });
  it('mid levels resign rarely and only when hopeless for a while', () => {
    const rng = createRng(3);
    expect(resigns({ level: 1200, wdl: lost, materialBalance: -5, lostStreak: 9 }, rng)).toBe(false);
    expect(resigns({ level: 1200, wdl: lost, materialBalance: -12, lostStreak: 2 }, rng)).toBe(false);
    let n = 0;
    for (let i = 0; i < 1000; i++) if (resigns({ level: 1200, wdl: lost, materialBalance: -12, lostStreak: 6 }, rng)) n++;
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(350);
  });
  it('stronger bots resign sooner', () => {
    const rng = createRng(4);
    let n = 0;
    for (let i = 0; i < 1000; i++) if (resigns({ level: 1800, wdl: lost, materialBalance: -6, lostStreak: 3 }, rng)) n++;
    expect(n).toBeGreaterThan(400);
  });
  it('counts material', () => {
    expect(materialBalance('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'w')).toBe(0);
    expect(materialBalance('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'b')).toBe(-9);
  });
});
