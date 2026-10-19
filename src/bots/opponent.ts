/** What the game needs from a bot. The neural implementations live in src/inference. */
import type { ModelFamily } from '../models/catalog';
import type { WDL } from './behaviour';

export interface BotRequest {
  /** FEN of every position from the start of the game, the current one last. */
  fens: readonly string[];
  /** Moves so far, in UCI. */
  moves: readonly string[];
}

export interface BotThought {
  /** Chosen move in UCI. */
  uci: string;
  /** Probability the sampled distribution gave the chosen move. */
  chosenProb: number;
  /** Entropy of the sampled distribution over legal moves, nats. */
  entropy: number;
  legal: number;
  /** Value head before the move, from the bot's side; null when the model has none. */
  wdl: WDL | null;
  inferenceMs: number;
}

export interface Opponent {
  readonly family: ModelFamily;
  /** Calibrated level, Lichess rapid scale. */
  readonly level: number;
  readonly pack: { id: string; sha256: string };
  /** Seed of the sampler, stored with the game. */
  readonly seed: number;
  choose(req: BotRequest): Promise<BotThought>;
  /** Value of the current position from the bot's side, or null without a value head. */
  value(req: BotRequest): Promise<WDL | null>;
  dispose(): void;
}
