/**
 * Level -> model settings.
 *
 * fastelo: a line-for-line port of fastelo/lite.py `settings()` on the published
 * calibration.json. The published calibration is not a lookup table: the rating input is the
 * target plus an offset interpolated linearly between knots (numpy.interp, so held constant
 * outside the knot range), the temperature follows a two-slope linear curve around a knot, and
 * a ramp mixes in the strong player from 2100 upward (never used in the 600-1900 range).
 *
 * Maia-2 and Maia-3: the rows measured by tools/calibrate, stored in the pack's calibration.
 * A level without a row is not playable with that model.
 */

export interface FasteloCalibration {
  strong_elo: number;
  strong_temperature: number;
  temperature_curve: { knot: number; value: number; slope_lo: number; slope_hi: number; t_min: number; t_max: number };
  mix_ramp: { elo: number[]; mix: number[] };
  knots: { elo: number; conditioning: number | null; temperature: number; mix: number }[];
}

export interface LevelSettings {
  /** Rating fed to the model for its own side. */
  eloSelf: number;
  /** Rating fed to the model for the opponent. */
  eloOppo: number;
  temperature: number;
  /** Nucleus threshold; 1 disables it. */
  topP: number;
  /** Share of the strong player (fastelo only; 0 below 2100). */
  mix: number;
}

export interface TableCalibration {
  /** One row per playable level. */
  levels: { level: number; eloSelf: number; eloOppo: number; temperature: number; topP: number }[];
}

/** numpy.interp: linear between points, constant beyond the ends. */
export function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n === 0) throw new Error('interp needs points');
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (xs[i]! < x) i++;
  const x0 = xs[i - 1]!;
  const x1 = xs[i]!;
  const t = (x - x0) / (x1 - x0);
  return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
}

export function fasteloSettings(cal: FasteloCalibration, elo: number): LevelSettings {
  const k = cal.knots.filter((x) => x.conditioning !== null);
  const c = cal.temperature_curve;
  const d = elo - c.knot;
  const T = Math.min(c.t_max, Math.max(c.t_min, c.value + (d < 0 ? c.slope_lo : c.slope_hi) * d));
  const mr = cal.mix_ramp;
  let m: number;
  if (!mr.elo.length || elo <= mr.elo[0]!) m = 0;
  else if (elo > mr.elo[mr.elo.length - 1]! && mr.elo.length >= 2) {
    const n = mr.elo.length;
    const s = (mr.mix[n - 1]! - mr.mix[n - 2]!) / (mr.elo[n - 1]! - mr.elo[n - 2]!);
    m = Math.min(1, mr.mix[n - 1]! + s * (elo - mr.elo[n - 1]!));
  } else m = interp(elo, mr.elo, mr.mix);
  const offset = interp(
    elo,
    k.map((x) => x.elo),
    k.map((x) => (x.conditioning as number) - x.elo)
  );
  const cond = elo + offset;
  return { eloSelf: cond, eloOppo: cond, temperature: T, topP: 1, mix: m };
}

export function tableSettings(cal: TableCalibration, level: number): LevelSettings | null {
  const row = cal.levels.find((r) => r.level === level);
  return row ? { eloSelf: row.eloSelf, eloOppo: row.eloOppo, temperature: row.temperature, topP: row.topP, mix: 0 } : null;
}
