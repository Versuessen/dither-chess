/**
 * Reactive view of the installed, verified model packs. The Model Manager is the only writer;
 * screens read it to grey out models and levels that cannot be played.
 */
import { MODELS, type ModelFamily } from './catalog';

export interface InstalledPack {
  id: string;
  family: ModelFamily;
  version: string;
  sha256: string;
  /** Levels this pack is calibrated for, from its manifest entry. */
  levels: number[];
}

class ModelState {
  installed = $state<InstalledPack[]>([]);

  packFor(family: ModelFamily): InstalledPack | undefined {
    return this.installed.find((p) => p.family === family);
  }

  /** Levels the family can play right now: calibrated and installed. */
  playableLevels(family: ModelFamily): number[] {
    return this.packFor(family)?.levels ?? [];
  }

  /** Levels the family covers once installed (for the roster's coverage display). */
  coveredLevels(family: ModelFamily): readonly number[] {
    const pack = this.packFor(family);
    if (pack) return pack.levels;
    return MODELS.find((m) => m.family === family)?.defaultLevels ?? [];
  }
}

export const models = new ModelState();
