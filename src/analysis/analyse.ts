/** Run the engine over every position of a stored game. */
import { Chess } from 'chess.js';
import type { StoredAnalysis, StoredEval, StoredGame } from '../storage/types';
import { ENGINE_NAME, type Engine, type SearchLimits } from './engine';

export const REVIEW_LIMITS: SearchLimits = { depth: 14, movetime: 1500 };

/** The start position followed by the position after each move. */
export function positions(g: Pick<StoredGame, 'startFen' | 'moves'>): string[] {
  return [g.startFen, ...g.moves.map((m) => m.fen)];
}

/** A finished position needs no search. */
export function terminal(fen: string): StoredEval | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) {
    const whiteMated = c.turn() === 'w';
    return { cp: null, mate: null, best: null, pv: [], depth: 0, result: whiteMated ? '0-1' : '1-0' };
  }
  if (c.isStalemate() || c.isInsufficientMaterial()) return { cp: 0, mate: null, best: null, pv: [], depth: 0, result: '1/2-1/2' };
  return null;
}

export async function analyseGame(
  g: Pick<StoredGame, 'startFen' | 'moves'>,
  engine: Engine,
  onProgress: (done: number, total: number) => void = () => undefined,
  signal?: AbortSignal,
  limits: SearchLimits = REVIEW_LIMITS
): Promise<StoredAnalysis> {
  const fens = positions(g);
  const evals: StoredEval[] = [];
  await engine.newGame();
  for (const [i, fen] of fens.entries()) {
    if (signal?.aborted) throw new DOMException('Analysis stopped', 'AbortError');
    const end = terminal(fen);
    if (end) evals.push(end);
    else {
      const e = await engine.evaluate(fen, limits);
      // The engine scores for the side to move; reviews use White's point of view.
      const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
      evals.push({
        cp: e.cp === null ? null : sign * e.cp,
        mate: e.mate === null ? null : sign * e.mate,
        best: e.best,
        pv: e.pv.slice(0, 8),
        depth: e.depth
      });
    }
    onProgress(i + 1, fens.length);
  }
  return { engine: ENGINE_NAME, depth: limits.depth, at: new Date().toISOString(), evals };
}

/** SAN of a UCI move in a position, or null when it is not legal there. */
export function sanIn(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined }).san;
  } catch {
    return null;
  }
}

/** A line of UCI moves from a position, as SAN ("Nf3 Nc6 Bb5"); stops at the first illegal move. */
export function lineSan(fen: string, uci: readonly string[], max = 6): string {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined }).san);
    } catch {
      break;
    }
  }
  return out.join(' ');
}
