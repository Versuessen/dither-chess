/**
 * The sentence that sets a puzzle: who moves, what was just played and what to aim for, taken
 * from the puzzle's Lichess themes. It names the goal (mate in n, winning, holding, promoting),
 * never the motif, which is shown once the puzzle is over.
 */
import { hasTheme, type Puzzle } from './data';

const COLOUR = { w: 'White', b: 'Black' } as const;
const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five'];

/** How many moves the solver has to find. */
export function solverMoves(p: Pick<Puzzle, 'moves'>): number {
  return Math.ceil((p.moves.length - 1) / 2);
}

/** "Mate in n" from the themes, or null. */
export function mateIn(p: Pick<Puzzle, 'themes' | 'moves'>): number | null {
  for (let n = 1; n <= 5; n++) if (hasTheme(p, `mateIn${n}` as 'mateIn1')) return n;
  return hasTheme(p, 'mate') ? solverMoves(p) : null;
}

/**
 * @param solver the side that solves
 * @param opening the SAN of the opponent's move that sets the puzzle
 */
export function introFor(p: Pick<Puzzle, 'themes' | 'moves'>, solver: 'w' | 'b', opening: string): string {
  const side = COLOUR[solver];
  const opp = COLOUR[solver === 'w' ? 'b' : 'w'];
  const n = solverMoves(p);
  const length = n > 1 ? ` It takes ${NUMBER[n] ?? n} moves.` : '';
  const mate = mateIn(p);
  if (mate !== null) {
    return mate === 1
      ? `${opp} just played ${opening}. ${side} can mate in one: find it.`
      : `After ${opening}, ${side} has mate in ${NUMBER[mate] ?? mate}. Can you find it?`;
  }
  if (hasTheme(p, 'defensiveMove')) return `${opp} just played ${opening} with a threat. Find ${side}'s best defence.${length}`;
  if (hasTheme(p, 'equality')) return `${side} looks lost after ${opening}. Find the move that holds the game.${length}`;
  if (hasTheme(p, 'promotion')) return `After ${opening}, ${side} can make a new queen. Find the way through.${length}`;
  if (hasTheme(p, 'endgame') && hasTheme(p, 'crushing')) return `${opp} just played ${opening}. ${side} to move: turn this endgame into a win.${length}`;
  if (hasTheme(p, 'crushing')) return `${opp} just played ${opening}, a mistake. ${side} to move and win decisively.${length}`;
  if (hasTheme(p, 'advantage')) return `After ${opening}, ${side} can take the upper hand. Find the best move.${length}`;
  return `${side} to move after ${opening}. Find the best continuation.${length}`;
}
