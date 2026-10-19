import { describe, expect, it } from 'vitest';
import { KNIGHT_MOVES, KnightDrift, approach, coverFit, easeInOutCubic, shouldRender } from './motion';

describe('coverFit', () => {
  it('fills the viewport without distortion', () => {
    const [sx, sy] = coverFit({ width: 1280, height: 800 }, { width: 1440, height: 900 }, [0.5, 0.5], 1);
    // Same aspect: the whole texture is visible.
    expect(sx).toBeCloseTo(1, 6);
    expect(sy).toBeCloseTo(1, 6);
  });

  it('crops a landscape texture on a portrait screen around the focal point', () => {
    const tex = { width: 1280, height: 800 };
    const view = { width: 390, height: 844 };
    const [sx, sy, ox, oy] = coverFit(tex, view, [0.3, 0.5], 1);
    expect(sy).toBeCloseTo(1, 6);
    // visible width fraction keeps the screen aspect
    expect((sx * tex.width) / (sy * tex.height)).toBeCloseTo(view.width / view.height, 6);
    expect(ox + sx / 2).toBeCloseTo(0.3, 6);
    expect(oy).toBe(0);
  });

  it('never shows outside the texture, even with an edge focal point', () => {
    for (const f of [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0]
    ] as [number, number][]) {
      const [sx, sy, ox, oy] = coverFit({ width: 1280, height: 800 }, { width: 500, height: 900 }, f, 1.06);
      expect(ox).toBeGreaterThanOrEqual(0);
      expect(oy).toBeGreaterThanOrEqual(0);
      expect(ox + sx).toBeLessThanOrEqual(1 + 1e-9);
      expect(oy + sy).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('KnightDrift', () => {
  it('only ever lands on knight moves and stays on its board', () => {
    const d = new KnightDrift({ period: 1, duration: 0.5, bound: 2, seed: 7 });
    for (let n = 0; n < 200; n++) {
      const [x0, y0] = d.square(n);
      const [x1, y1] = d.square(n + 1);
      const move = [x1 - x0, y1 - y0];
      expect(KNIGHT_MOVES.some(([a, b]) => a === move[0] && b === move[1])).toBe(true);
      expect(Math.abs(x1)).toBeLessThanOrEqual(2);
      expect(Math.abs(y1)).toBeLessThanOrEqual(2);
    }
  });

  it('walks the long leg of the L before the short leg', () => {
    const d = new KnightDrift({ period: 10, duration: 1, bound: 2, seed: 3 });
    const [x0, y0] = d.square(0);
    const [x1, y1] = d.square(1);
    const longIsX = Math.abs(x1 - x0) === 2;
    // At 55% of the move the long leg is nearly done and the short leg has not started.
    const [x, y] = d.at(0.55);
    if (longIsX) {
      expect(y).toBeCloseTo(y0, 6);
      expect(Math.abs(x - x0)).toBeGreaterThan(1.8);
    } else {
      expect(x).toBeCloseTo(x0, 6);
      expect(Math.abs(y - y0)).toBeGreaterThan(1.8);
    }
    expect(d.at(1)).toEqual([x1, y1]);
    expect(d.at(5)).toEqual([x1, y1]);
  });

  it('is deterministic for a seed', () => {
    const a = new KnightDrift({ period: 2, duration: 1, bound: 2, seed: 11 });
    const b = new KnightDrift({ period: 2, duration: 1, bound: 2, seed: 11 });
    for (const t of [0, 0.3, 1.7, 9.2, 40]) expect(a.at(t)).toEqual(b.at(t));
  });
});

describe('easing and smoothing', () => {
  it('eases from 0 to 1 symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 9);
  });

  it('approach is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 4; i++) a = approach(a, 1, 0.025, 0.1);
    const b = approach(0, 1, 0.1, 0.1);
    expect(a).toBeCloseTo(b, 9);
    expect(b).toBeCloseTo(0.5, 9);
  });

  it('caps the frame rate at 60 fps', () => {
    // 120 Hz display: every other vsync renders.
    let last = 0;
    let frames = 0;
    for (let t = 1000 / 120; t <= 1000; t += 1000 / 120) {
      if (shouldRender(t, last)) {
        frames++;
        last = t;
      }
    }
    expect(frames).toBeGreaterThanOrEqual(58);
    expect(frames).toBeLessThanOrEqual(61);
  });
});
