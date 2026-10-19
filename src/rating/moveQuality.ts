/**
 * Move-quality estimate: a port of fastelo's Rater (fastelo/likelihood.py, fastelo/response.py,
 * lite.Engine.rating), GPL-3.0, pinned in tools/models/sources.lock.json.
 *
 * For one player's moves in a game, the log-likelihood of those moves under the fastelo player
 * network, as a function of the rating input, is a measurement of the rating the moves look like.
 * The estimate is the flat-prior posterior mean on 400–2600, after limiting what a single move can
 * say (4 nats), then bias-corrected per number of plies seen with the published
 * rating_response.json, which also gives statistical (asymmetric) and systematic errors.
 *
 * This is not the player's rating. The FIDE rating comes only from results (rating/fide.ts);
 * this number says how the moves themselves look, and is quoted only between 600 and 2200.
 */
import { interp } from '../inference/calibration';

/** Rating inputs each move is scored under (likelihood.GRID). */
export const GRID: readonly number[] = Array.from({ length: 12 }, (_, i) => 400 + 200 * i);
/** Posterior grid the log-likelihood is interpolated onto (likelihood.FINE). */
const FINE: readonly number[] = Array.from({ length: 89 }, (_, i) => 400 + 25 * i);
/** At most this many nats separate any rating from the one that explains a move best. */
export const CLIP = 4;
/** Values are quoted inside this range; outside it only "below 600" / "2200+". */
export const REPORT_RANGE: readonly [number, number] = [600, 2200];
const BANDS_FIRST = 400;
const BANDS_LAST_START = 2400;

export interface RatingResponse {
  plies: number[];
  knots: number[];
  coef: number[][];
  resolution: number[];
  sigma_scale?: number[];
  systematic: Record<string, Record<string, number>>;
}

/** likelihood.robust for one move's row. */
export function robust(row: readonly number[], clip = CLIP): number[] {
  const max = Math.max(...row);
  return row.map((v) => Math.max(v, max - clip));
}

/** likelihood.posterior for one summed row on GRID: flat-prior posterior mean and sd. */
export function posterior(cum: readonly number[]): { mean: number; sd: number } {
  const fine = FINE.map((x) => interp(x, GRID, cum));
  const max = Math.max(...fine);
  const p = fine.map((v) => Math.exp(v - max));
  const z = p.reduce((a, b) => a + b, 0);
  let mean = 0;
  for (let i = 0; i < p.length; i++) mean += (p[i]! / z) * FINE[i]!;
  let v = 0;
  for (let i = 0; i < p.length; i++) v += (p[i]! / z) * (FINE[i]! - mean) ** 2;
  return { mean, sd: Math.sqrt(v) };
}

/** likelihood.curve: the estimate after each of the player's moves. */
export function likelihoodCurve(logp: readonly (readonly number[])[], clip = CLIP): { mean: number[]; sd: number[] } {
  const mean: number[] = [];
  const sd: number[] = [];
  const cum = new Array<number>(GRID.length).fill(0);
  for (const row of logp) {
    robust(row, clip).forEach((v, i) => (cum[i]! += v));
    const p = posterior(cum);
    mean.push(p.mean);
    sd.push(p.sd);
  }
  return { mean, sd };
}

/** numpy.searchsorted(xs, x, 'right'). */
function searchRight(xs: readonly number[], x: number): number {
  let i = 0;
  while (i < xs.length && xs[i]! <= x) i++;
  return i;
}

/** response.correct with n_sigma = (1, 2): [value, lo1, hi1, lo2, hi2]. */
export function correct(r: RatingResponse, est: number, sigma: number, pliesSeen: number): [number, number, number, number, number] {
  const plies = r.plies;
  const k = Math.min(Math.max(pliesSeen, plies[0]!), plies[plies.length - 1]!);
  const s = r.sigma_scale ? sigma * interp(k, plies, r.sigma_scale) : sigma;
  const j = Math.min(Math.max(searchRight(plies, k) - 1, 0), plies.length - 2);
  const t = (k - plies[j]!) / (plies[j + 1]! - plies[j]!);
  const map = (x: number) => (1 - t) * interp(x, r.knots, r.coef[j]!) + t * interp(x, r.knots, r.coef[j + 1]!);
  return [map(est), map(est - s), map(est + s), map(est - 2 * s), map(est + 2 * s)];
}

/** response.systematic for one corrected value. */
export function systematic(r: RatingResponse, value: number, pliesSeen: number): number {
  const ks = Object.keys(r.systematic)
    .map(Number)
    .sort((a, b) => a - b);
  let best = ks[0]!;
  for (const k of ks) if (Math.abs(k - pliesSeen) < Math.abs(best - pliesSeen)) best = k;
  const table = r.systematic[String(best)]!;
  const b = Math.min(Math.max(Math.floor(value / 200) * 200, BANDS_FIRST), BANDS_LAST_START);
  return table[`${b}-${b + 200}`] ?? Math.max(...Object.values(table));
}

/** response.resolution: typical error of one corrected game of that many plies. */
export function resolution(r: RatingResponse, pliesSeen: number): number {
  const acc: number[] = [];
  for (const v of r.resolution) acc.push(Math.min(v, acc.length ? acc[acc.length - 1]! : Infinity));
  return interp(pliesSeen, r.plies, acc);
}

export interface QualityPoint {
  value: number;
  lo: number;
  hi: number;
  lo2: number;
  hi2: number;
  syst: number;
  resolution: number;
}

/** lite.Engine.rating: the corrected estimate after each own move, from the [moves × GRID] log-likelihoods. */
export function qualityCurve(logp: readonly (readonly number[])[], response: RatingResponse): QualityPoint[] {
  const { mean, sd } = likelihoodCurve(logp);
  return mean.map((m, i) => {
    const seen = 2 * (i + 1);
    const [value, lo, hi, lo2, hi2] = correct(response, m, sd[i]!, seen);
    return { value, lo, hi, lo2, hi2, syst: systematic(response, value, seen), resolution: resolution(response, seen) };
  });
}

/** One game's measurement (lite.turn's `measurement`). */
export interface QualityMeasurement {
  mean: number;
  minus: number;
  plus: number;
  syst: number;
  resolution: number;
  userMoves: number;
}

export function measurement(curve: readonly QualityPoint[]): QualityMeasurement | null {
  const last = curve[curve.length - 1];
  if (!last) return null;
  return {
    mean: last.value,
    minus: last.value - last.lo,
    plus: last.hi - last.value,
    syst: last.syst,
    resolution: last.resolution,
    userMoves: curve.length
  };
}

export interface CombinedQuality {
  value: number;
  minus: number;
  plus: number;
  syst: number;
  games: number;
}

/**
 * lite.combine_measurements over the most recent 50 games: weights from the resolution of a game
 * of that length; the systematic error is common to all games and does not average down.
 */
export function combine(ms: readonly QualityMeasurement[]): CombinedQuality | null {
  const recent = ms.slice(-50);
  if (!recent.length) return null;
  const w0 = recent.map((m) => 1 / Math.max(m.resolution, 1) ** 2);
  const total = w0.reduce((a, b) => a + b, 0);
  const w = w0.map((x) => x / total);
  const sum = (f: (m: QualityMeasurement, i: number) => number) => recent.reduce((a, m, i) => a + f(m, i), 0);
  return {
    value: sum((m, i) => w[i]! * m.mean),
    minus: Math.sqrt(sum((m, i) => w[i]! ** 2 * m.minus ** 2)),
    plus: Math.sqrt(sum((m, i) => w[i]! ** 2 * m.plus ** 2)),
    syst: sum((m, i) => w[i]! * m.syst),
    games: recent.length
  };
}

/** How a value is quoted: a number inside 600–2200, a bound outside it. */
export function quote(value: number): string {
  if (value < REPORT_RANGE[0]) return `below ${REPORT_RANGE[0]}`;
  if (value >= REPORT_RANGE[1]) return `${REPORT_RANGE[1]}+`;
  return String(Math.round(value));
}
