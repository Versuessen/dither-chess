import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLIP,
  GRID,
  REPORT_RANGE,
  combine,
  likelihoodCurve,
  measurement,
  qualityCurve,
  quote,
  robust,
  type QualityMeasurement,
  type RatingResponse
} from '../../src/rating/moveQuality';

/**
 * The fixture is fastelo's own Rater (likelihood.curve + response.apply, as lite.Engine.rating)
 * run on three games by tools/models (`dither-models rater-golden`), with every intermediate.
 */
const fixturePath = new URL('../golden/fastelo-rater.json', import.meta.url);

interface Case {
  game: string;
  side: number;
  moves: string[];
  logp: number[][];
  mean: number[];
  sd: number[];
  value: number[];
  lo: number[];
  hi: number[];
  lo2: number[];
  hi2: number[];
  syst: number[];
  resolution: number[];
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  grid: number[];
  clip: number;
  report_range: [number, number];
  /** fastelo's rating_response.json at the pinned revision. */
  response: RatingResponse;
  cases: Case[];
  combine: { measurements: { mean: number; minus: number; plus: number; syst: number; resolution: number }[]; expected: Record<string, number> };
};
const response = fixture.response;

const close = (a: readonly number[], b: readonly number[], tol: number) => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => expect(Math.abs(x - b[i]!), `index ${i}: ${x} vs ${b[i]}`).toBeLessThan(tol));
};

describe('fastelo move-quality estimate', () => {
  it('uses the same constants as fastelo', () => {
    expect([...GRID]).toEqual(fixture.grid);
    expect(CLIP).toBe(fixture.clip);
    expect([...REPORT_RANGE]).toEqual(fixture.report_range);
  });

  it('limits what one move can say', () => {
    expect(robust([-1, -9, -3, -20])).toEqual([-1, -5, -3, -5]);
  });

  for (const c of fixture.cases) {
    it(`reproduces the posterior for ${c.game}, ${c.side ? 'Black' : 'White'}`, () => {
      const { mean, sd } = likelihoodCurve(c.logp);
      close(mean, c.mean, 1e-6);
      close(sd, c.sd, 1e-6);
    });

    it(`reproduces the corrected estimate and errors for ${c.game}, ${c.side ? 'Black' : 'White'}`, () => {
      const curve = qualityCurve(c.logp, response);
      close(
        curve.map((p) => p.value),
        c.value,
        1e-6
      );
      close(
        curve.map((p) => p.lo),
        c.lo,
        1e-6
      );
      close(
        curve.map((p) => p.hi),
        c.hi,
        1e-6
      );
      close(
        curve.map((p) => p.lo2),
        c.lo2,
        1e-6
      );
      close(
        curve.map((p) => p.hi2),
        c.hi2,
        1e-6
      );
      close(
        curve.map((p) => p.syst),
        c.syst,
        1e-9
      );
      close(
        curve.map((p) => p.resolution),
        c.resolution,
        1e-6
      );
    });
  }

  it('combines games the way fastelo does', () => {
    const ms: QualityMeasurement[] = fixture.combine.measurements.map((m) => ({ ...m, userMoves: 10 }));
    const c = combine(ms)!;
    const e = fixture.combine.expected;
    expect(c.value).toBeCloseTo(e.value!, 6);
    expect(c.minus).toBeCloseTo(e.minus!, 6);
    expect(c.plus).toBeCloseTo(e.plus!, 6);
    expect(c.syst).toBeCloseTo(e.syst!, 6);
    expect(c.games).toBe(e.games);
  });

  it('keeps only the last 50 games when combining', () => {
    const old = Array.from({ length: 30 }, () => ({ mean: 400, minus: 50, plus: 50, syst: 10, resolution: 200, userMoves: 20 }));
    const recent = Array.from({ length: 50 }, () => ({ mean: 1500, minus: 50, plus: 50, syst: 10, resolution: 200, userMoves: 20 }));
    expect(combine([...old, ...recent])!.value).toBeCloseTo(1500, 9);
    expect(combine([])).toBeNull();
  });

  it('reports the last point as the game measurement', () => {
    expect(measurement([])).toBeNull();
    const m = measurement([{ value: 1400, lo: 1300, hi: 1520, lo2: 1200, hi2: 1650, syst: 40, resolution: 180 }])!;
    expect(m).toEqual({ mean: 1400, minus: 100, plus: 120, syst: 40, resolution: 180, userMoves: 1 });
  });

  it('quotes values only inside 600-2200', () => {
    expect(quote(599.4)).toBe('below 600');
    expect(quote(600)).toBe('600');
    expect(quote(1487.6)).toBe('1488');
    expect(quote(2199.4)).toBe('2199');
    expect(quote(2200)).toBe('2200+');
  });
});
