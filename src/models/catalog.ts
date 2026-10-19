/**
 * The bot model: Maia-3 23M (CSSLab, AGPL-3.0), the most human-like of the models DITHER has
 * measured and the widest calibrated range. Its levels come from tools/calibrate and travel in
 * the pack's calibration table; a level is playable only once that table lists it.
 */

export type ModelFamily = 'maia3';

export interface ModelInfo {
  family: ModelFamily;
  name: string;
  /** Pack id. */
  pack: string;
  /** Levels with a known calibration before the pack is installed. */
  defaultLevels: readonly number[];
}

export const MIN_LEVEL = 600;
export const MAX_LEVEL = 2050;
export const LEVEL_STEP = 50;

export const ALL_LEVELS: readonly number[] = Array.from(
  { length: (MAX_LEVEL - MIN_LEVEL) / LEVEL_STEP + 1 },
  (_, i) => MIN_LEVEL + i * LEVEL_STEP
);

export const MODELS: readonly ModelInfo[] = [{ family: 'maia3', name: 'Maia-3', pack: 'maia3-23m', defaultLevels: [] }];

export function modelInfo(family: ModelFamily): ModelInfo {
  const m = MODELS.find((x) => x.family === family);
  if (!m) throw new Error(`unknown model ${family}`);
  return m;
}

/** Nearest playable level to `wanted`, or null when the model has none. */
export function nearestLevel(levels: readonly number[], wanted: number): number | null {
  if (!levels.length) return null;
  let best = levels[0]!;
  for (const l of levels) if (Math.abs(l - wanted) < Math.abs(best - wanted)) best = l;
  return best;
}
