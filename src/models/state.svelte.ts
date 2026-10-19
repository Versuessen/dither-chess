/**
 * Reactive view of the installed, verified model packs. The Model Manager is the only writer;
 * screens read it to grey out models and levels that cannot be played.
 */
import { MODELS, type ModelFamily } from './catalog';
import { defaultPack, packById } from './manifest';

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

  /**
   * The pack a family plays with: one with calibrated levels first, and among those the optional
   * high-quality download (Maia-3 23M) when the player has installed it.
   */
  packFor(family: ModelFamily): InstalledPack | undefined {
    const rank = (p: InstalledPack) => (p.levels.length ? 2 : 0) + (packById(p.id)?.optional ? 1 : 0);
    return this.installed.filter((p) => p.family === family).sort((a, b) => rank(b) - rank(a))[0];
  }

  /** Levels the family can play right now: calibrated, installed and verified. */
  playableLevels(family: ModelFamily): number[] {
    return this.packFor(family)?.levels ?? [];
  }

  /** Levels the family covers once installed (for coverage displays and greying out). */
  coveredLevels(family: ModelFamily): readonly number[] {
    const pack = this.packFor(family);
    if (pack) return pack.levels;
    const manifest = defaultPack(family);
    if (manifest) return manifest.calibration.levels;
    return MODELS.find((m) => m.family === family)?.defaultLevels ?? [];
  }
}

export const models = new ModelState();
