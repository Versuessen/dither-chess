/**
 * Games left unfinished by a crash or a closed window are settled at the next start as aborted
 * and unrated, as leaving the game screen is: DITHER is a training tool, so walking away never
 * costs rating.
 */
import { toPgn } from '../chess/pgn';
import type { Outcome } from '../chess/rules';
import type { AppStorage, StoredGame } from '../storage/types';

export type FinishedHook = (game: StoredGame) => Promise<void> | void;

const hooks: FinishedHook[] = [];

/**
 * Work that follows every finished game, including games settled at start-up: the rating ledger
 * and the move-quality estimate register here. Hooks run in registration order.
 */
export function onGameFinished(fn: FinishedHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

async function runHooks(g: StoredGame): Promise<void> {
  for (const h of [...hooks]) {
    try {
      await h(g);
    } catch (err) {
      console.error('after-game step failed', err);
    }
  }
}

export function settle(g: StoredGame, now = new Date()): StoredGame {
  const outcome: Outcome = { result: '*', termination: 'aborted', winner: null };
  const rated = false;
  const human = 'You';
  const settled: StoredGame = { ...g, outcome, rated, endedAt: now.toISOString() };
  settled.pgn = toPgn({
    white: g.humanColor === 'w' ? human : g.botName,
    black: g.humanColor === 'b' ? human : g.botName,
    whiteElo: g.humanColor === 'b' ? g.botLevel : undefined,
    blackElo: g.humanColor === 'w' ? g.botLevel : undefined,
    startedAt: new Date(g.startedAt),
    timeControl: g.timeControl,
    outcome,
    moves: g.moves,
    startFen: g.startFen,
    rated,
    extra: { BotModel: g.family, BotRatingScale: 'Lichess rapid', BotPack: `${g.pack}@${g.packSha256.slice(0, 12)}`, BotSeed: String(g.seed) }
  });
  return settled;
}

export async function finishUnfinished(storage: AppStorage, now = new Date()): Promise<StoredGame[]> {
  const open = (await storage.listGames()).filter((g) => g.outcome === null);
  const done: StoredGame[] = [];
  for (const g of open) {
    const s = settle(g, now);
    await storage.putGame(s);
    await runHooks(s);
    done.push(s);
  }
  return done;
}

export async function notifyFinished(g: StoredGame): Promise<void> {
  await runHooks(g);
}
