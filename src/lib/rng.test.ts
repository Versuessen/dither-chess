import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from './rng';

describe('createRng', () => {
  it('reproduces the same stream for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBe(0);
  });

  it('resumes from a saved state', () => {
    const a = createRng(9);
    for (let i = 0; i < 17; i++) a.next();
    const b = createRng(a.state());
    for (let i = 0; i < 50; i++) expect(b.next()).toBe(a.next());
  });

  it('is roughly uniform', () => {
    const r = createRng(123);
    const bins = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) bins[r.int(10)]++;
    // chi-square with 9 degrees of freedom; 27.9 is the 0.999 quantile
    const chi = bins.reduce((s, c) => s + (c - n / 10) ** 2 / (n / 10), 0);
    expect(chi).toBeLessThan(27.9);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashes strings to stable seeds', () => {
    expect(seedFrom('game-1')).toBe(seedFrom('game-1'));
    expect(seedFrom('game-1')).not.toBe(seedFrom('game-2'));
  });
});
