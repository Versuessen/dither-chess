/**
 * The bot models the app knows about, and which levels each one may play.
 *
 * A level is playable with a model only if it has been calibrated for that model:
 *  - fastelo ships its own calibration (600-2400 on the Lichess rapid scale); the app range
 *    is 600-1900.
 *  - Maia-3 levels come from tools/calibrate; until a level appears in the installed pack's
 *    calibration table it stays greyed out.
 *  - Maia-2 is conditioned on rating buckets; it is offered only from 1100, where its
 *    buckets are populated.
 * The installed pack's manifest entry overrides these defaults (see models/manifest.ts).
 */

export type ModelFamily = 'fastelo' | 'maia3' | 'maia2';

export interface ModelInfo {
  family: ModelFamily;
  name: string;
  /** One line on how it plays, shown as STYLE. */
  style: string;
  /** Default pack id for this family. */
  pack: string;
  /** Levels with a known calibration before any pack is installed. */
  defaultLevels: readonly number[];
}

export const MIN_LEVEL = 600;
export const MAX_LEVEL = 1900;
export const LEVEL_STEP = 50;

export const ALL_LEVELS: readonly number[] = Array.from(
  { length: (MAX_LEVEL - MIN_LEVEL) / LEVEL_STEP + 1 },
  (_, i) => MIN_LEVEL + i * LEVEL_STEP
);

export const MODELS: readonly ModelInfo[] = [
  {
    family: 'fastelo',
    name: 'fastelo',
    style: 'Calibrated sampling: temperature and rating input fitted to human move-quality loss',
    pack: 'fastelo-7m',
    defaultLevels: ALL_LEVELS
  },
  {
    family: 'maia3',
    name: 'Maia-3',
    style: 'Human move prediction with eight positions of history; plays its most human-likely moves',
    pack: 'maia3-5m',
    defaultLevels: []
  },
  {
    family: 'maia2',
    name: 'Maia-2',
    style: 'Rating-bucketed human move prediction from the Maia-2 rapid model',
    pack: 'maia2-rapid',
    defaultLevels: ALL_LEVELS.filter((l) => l >= 1100)
  }
];

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
