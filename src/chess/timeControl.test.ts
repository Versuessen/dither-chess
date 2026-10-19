import { describe, expect, it } from 'vitest';
import {
  TIME_CONTROLS,
  classify,
  formatTimeControl,
  isRatable,
  parseTimeControl,
  pgnTimeControl,
  projectedMinutes
} from './timeControl';

const tc = (min: number, inc: number) => ({ base: min * 60, increment: inc });

describe('FIDE time classification (R&B 1.1)', () => {
  it('uses base + 60 x increment', () => {
    expect(projectedMinutes(tc(10, 5))).toBe(15);
    expect(projectedMinutes(tc(3, 2))).toBe(5);
  });
  it('rapid is more than 10 and less than 60 minutes', () => {
    expect(classify(tc(10, 0))).toBe('blitz');
    expect(classify(tc(10, 1))).toBe('rapid');
    expect(classify(tc(15, 10))).toBe('rapid');
    expect(classify(tc(59, 0))).toBe('rapid');
    expect(classify(tc(60, 0))).toBe('standard');
    expect(classify(tc(45, 15))).toBe('standard');
  });
  it('blitz is more than 3 and no more than 10 minutes', () => {
    expect(classify(tc(5, 3))).toBe('blitz');
    expect(classify(tc(3, 0))).toBe('bullet');
    expect(classify(tc(3, 1))).toBe('blitz');
  });
  it('untimed is never ratable', () => {
    expect(classify({ base: 0, increment: 0 })).toBe('untimed');
    expect(isRatable({ base: 0, increment: 0 })).toBe(false);
  });
  it('offers both rated and unrated clocks', () => {
    expect(TIME_CONTROLS.filter(isRatable).length).toBeGreaterThanOrEqual(3);
    expect(TIME_CONTROLS.some((t) => !isRatable(t))).toBe(true);
  });
});

describe('formatting', () => {
  it('round-trips', () => {
    for (const t of TIME_CONTROLS) expect(parseTimeControl(formatTimeControl(t))).toEqual(t);
  });
  it('writes the PGN tag in seconds', () => {
    expect(pgnTimeControl(tc(15, 10))).toBe('900+10');
    expect(pgnTimeControl({ base: 0, increment: 0 })).toBe('-');
  });
});
