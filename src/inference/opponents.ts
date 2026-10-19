/**
 * The neural bots. A bot is a verified model pack plus the calibrated settings for one level;
 * each move is one forward pass and one draw from the predicted human move distribution.
 */
import type { BotRequest, BotThought, Opponent } from '../bots/opponent';
import type { WDL } from '../bots/behaviour';
import type { GameSetup } from '../chess/setup';
import { createRng } from '../lib/rng';
import { manager } from '../models/manager.svelte';
import { defaultPack } from '../models/manifest';
import { models } from '../models/state.svelte';
import { tableSettings, type LevelSettings, type TableCalibration } from './calibration';
import { inference } from './client';
import { sample } from './sampler';

export interface LoadedPack {
  id: string;
  family: 'maia3';
  sha256: string;
  calibration: TableCalibration | null;
}

/** Loads in flight (generation null) or done, with the inference worker generation they went into. */
const loaded = new Map<string, { promise: Promise<LoadedPack>; generation: number | null }>();

/**
 * Open, verify and load a pack into the worker once per session, and again if the worker had to
 * be replaced since (inference.generation).
 */
export function loadPack(id: string): Promise<LoadedPack> {
  const cached = loaded.get(id);
  if (cached && (cached.generation === null || cached.generation === inference.generation)) return cached.promise;
  const entry: { promise: Promise<LoadedPack>; generation: number | null } = { promise: Promise.resolve(null as never), generation: null };
  entry.promise = (async () => {
    const dpk = await manager.openPack(id);
    if (dpk.header.family !== 'maia3') throw new Error(`${id} is not a Maia-3 pack`);
    const [model, vocab] = await Promise.all([dpk.file('model.onnx'), dpk.json<string[]>('vocab.json')]);
    const calibration = dpk.has('calibration.json') ? await dpk.json<TableCalibration>('calibration.json') : null;
    await inference.load(id, model, vocab);
    entry.generation = inference.generation;
    const pack = models.installed.find((x) => x.id === id);
    return { id, family: 'maia3' as const, sha256: pack?.sha256 ?? '', calibration };
  })();
  entry.promise.catch(() => {
    if (loaded.get(id) === entry) loaded.delete(id);
  });
  loaded.set(id, entry);
  return entry.promise;
}

export function settingsFor(pack: LoadedPack, level: number): LevelSettings {
  if (!pack.calibration) throw new Error(`${pack.id} has no calibration; no level is playable yet.`);
  const s = tableSettings(pack.calibration, level);
  if (!s) throw new Error(`${pack.id} is not calibrated for ${level}.`);
  return s;
}

class NeuralOpponent implements Opponent {
  readonly family;
  readonly level;
  readonly pack;
  readonly seed;
  private readonly rng;

  constructor(
    private readonly loadedPack: LoadedPack,
    level: number,
    private readonly settings: LevelSettings,
    seed: number
  ) {
    this.family = loadedPack.family;
    this.level = level;
    this.pack = { id: loadedPack.id, sha256: loadedPack.sha256 };
    this.seed = seed;
    this.rng = createRng(seed);
  }

  async choose(req: BotRequest): Promise<BotThought> {
    const r = await inference.evaluate(this.loadedPack.id, [...req.fens], this.settings.eloSelf, this.settings.eloOppo);
    if (!r.uci.length) throw new Error('no legal moves');
    const s = sample(r.logits, this.settings.temperature, this.settings.topP, this.rng);
    return {
      uci: r.uci[s.index]!,
      chosenProb: s.prob,
      entropy: s.entropy,
      legal: r.uci.length,
      wdl: r.wdl,
      inferenceMs: r.inferenceMs
    };
  }

  async value(req: BotRequest): Promise<WDL | null> {
    const r = await inference.evaluate(this.loadedPack.id, [...req.fens], this.settings.eloSelf, this.settings.eloOppo);
    return r.wdl;
  }

  dispose(): void {
    /* the session stays loaded for the next game */
  }
}

export async function createOpponent(setup: GameSetup, seed: number): Promise<Opponent> {
  const installed = models.packFor(setup.family);
  const id = installed?.id ?? defaultPack(setup.family)?.id;
  if (!id) throw new Error(`No ${setup.family} model is available.`);
  if (!installed) throw new Error('Install the model pack first (Models).');
  const pack = await loadPack(id);
  return new NeuralOpponent(pack, setup.level, settingsFor(pack, setup.level), seed);
}
