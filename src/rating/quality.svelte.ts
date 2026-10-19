/**
 * Runs the move-quality estimate (moveQuality.ts) on finished games, in the inference worker,
 * after the game rather than during it so it never competes with the bot for the CPU. It needs
 * the fastelo pack, whichever model the bot used. The result is stored on the game record.
 */
import { inference } from '../inference/client';
import { loadPack } from '../inference/opponents';
import { models } from '../models/state.svelte';
import type { AppStorage, StoredGame, StoredQuality } from '../storage/types';
import { GRID, measurement, qualityCurve } from './moveQuality';

export type QualityStatus =
  | { kind: 'pending' }
  | { kind: 'done'; quality: StoredQuality }
  | { kind: 'unavailable'; reason: string };

/** Fewest own moves worth estimating (fastelo's correction starts at 6 plies seen). */
export const MIN_MOVES = 3;
/** Positions per worker call. */
const CHUNK = 16;

class QualityJobs {
  status = $state<Record<string, QualityStatus>>({});

  /** Score the human's moves of a finished game and store the estimate on the game. */
  async run(storage: AppStorage, game: StoredGame): Promise<StoredQuality | null> {
    if (!game.outcome || game.outcome.result === '*') return null;
    if (game.quality) {
      this.status[game.id] = { kind: 'done', quality: game.quality };
      return game.quality;
    }
    const side = game.humanColor === 'w' ? 0 : 1;
    const own = game.moves.map((_, p) => p).filter((p) => p % 2 === side);
    if (own.length < MIN_MOVES) {
      this.status[game.id] = { kind: 'unavailable', reason: `Needs at least ${MIN_MOVES} of your moves.` };
      return null;
    }
    const installed = models.packFor('fastelo');
    if (!installed) {
      this.status[game.id] = { kind: 'unavailable', reason: 'Install the fastelo pack to see the move-quality estimate.' };
      return null;
    }
    this.status[game.id] = { kind: 'pending' };
    try {
      const pack = await loadPack(installed.id);
      if (!pack.ratingResponse) throw new Error('The fastelo pack has no rating response.');
      const fens = [game.startFen, ...game.moves.map((m) => m.fen)];
      const items = own.map((p) => ({ fens: fens.slice(0, p + 1), move: game.moves[p]!.uci }));
      const logp: number[][] = [];
      for (let a = 0; a < items.length; a += CHUNK) {
        const r = await inference.moveLogp(pack.id, items.slice(a, a + CHUNK), [...GRID]);
        for (let i = 0; i < r.logp.length / GRID.length; i++) logp.push(Array.from(r.logp.subarray(i * GRID.length, (i + 1) * GRID.length)));
      }
      const curve = qualityCurve(logp, pack.ratingResponse);
      const m = measurement(curve)!;
      const quality: StoredQuality = {
        pack: pack.id,
        packSha256: pack.sha256,
        mean: m.mean,
        minus: m.minus,
        plus: m.plus,
        syst: m.syst,
        resolution: m.resolution,
        userMoves: m.userMoves,
        curve: curve.map((c) => Math.round(c.value))
      };
      const fresh = (await storage.getGame(game.id)) ?? game;
      await storage.putGame({ ...fresh, quality });
      this.status[game.id] = { kind: 'done', quality };
      return quality;
    } catch (err) {
      this.status[game.id] = { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
      return null;
    }
  }
}

export const quality = new QualityJobs();
