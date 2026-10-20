/**
 * One attempt at a puzzle. The puzzle's first move is the opponent's; then the solver must find
 * each of their moves, and the opponent's replies follow. As on Lichess, any move that mates is
 * accepted in place of the expected one.
 */
import { Chess, type Square } from 'chess.js';
import type { Puzzle } from './data';

export type MoveResult = 'correct' | 'solved' | 'wrong';

export function uciOf(m: { from: string; to: string; promotion?: string }): string {
  return `${m.from}${m.to}${m.promotion ?? ''}`;
}

export class PuzzleRun {
  readonly chess: Chess;
  /** Index of the next move in puzzle.moves. */
  ply = 0;
  /** The side that solves: the side not making the puzzle's first move. */
  readonly solver: 'w' | 'b';
  lastMove: [string, string] | null = null;
  /** SANs played so far, in order. */
  readonly played: string[] = [];
  private solvedEarly = false;

  constructor(readonly puzzle: Puzzle) {
    this.chess = new Chess(puzzle.fen);
    this.solver = this.chess.turn() === 'w' ? 'b' : 'w';
  }

  get fen(): string {
    return this.chess.fen();
  }

  get done(): boolean {
    return this.solvedEarly || this.ply >= this.puzzle.moves.length;
  }

  /** The solver is to move (and the puzzle is not over). */
  get solverToMove(): boolean {
    return !this.done && this.chess.turn() === this.solver;
  }

  /** The move the solver should play next (UCI), or null when it is not their turn. */
  get expected(): string | null {
    return this.solverToMove ? this.puzzle.moves[this.ply]! : null;
  }

  /** The solver's legal moves, as chessground destinations. */
  dests(): Map<Square, Square[]> {
    const out = new Map<Square, Square[]>();
    if (!this.solverToMove) return out;
    for (const m of this.chess.moves({ verbose: true })) {
      const list = out.get(m.from) ?? [];
      list.push(m.to);
      out.set(m.from, list);
    }
    return out;
  }

  private apply(uci: string): string {
    const m = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    this.lastMove = [m.from, m.to];
    this.played.push(m.san);
    this.ply++;
    return m.san;
  }

  /** Play the opponent's next move (the opening move, or a reply); returns its SAN. */
  opponentMove(): string | null {
    if (this.done || this.chess.turn() === this.solver) return null;
    return this.apply(this.puzzle.moves[this.ply]!);
  }

  /** Whether a pawn move from `from` to `to` promotes (and to what the solution expects). */
  promotionFor(from: string, to: string): string | undefined {
    const piece = this.chess.get(from as Square);
    if (!piece || piece.type !== 'p' || (to[1] !== '8' && to[1] !== '1')) return undefined;
    const exp = this.expected;
    return exp && exp.slice(0, 4) === `${from}${to}` && exp.length > 4 ? exp[4] : 'q';
  }

  /**
   * The solver plays `uci`. Correct moves are played; a wrong one is not (the position stays as
   * it was). A mating move ends the puzzle as solved even if it is not the listed one.
   */
  tryMove(uci: string): MoveResult {
    const exp = this.expected;
    if (!exp) return 'wrong';
    if (uci === exp) {
      this.apply(uci);
      return this.done ? 'solved' : 'correct';
    }
    // Any mate wins the puzzle, as on Lichess.
    const probe = new Chess(this.chess.fen());
    try {
      probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    } catch {
      return 'wrong';
    }
    if (probe.isCheckmate()) {
      this.apply(uci);
      this.solvedEarly = true;
      return 'solved';
    }
    return 'wrong';
  }

  /** The SAN of a UCI move in the current position. */
  sanOf(uci: string): string {
    return new Chess(this.chess.fen()).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined }).san;
  }

  get inCheck(): boolean {
    return this.chess.inCheck();
  }

  get turn(): 'w' | 'b' {
    return this.chess.turn();
  }
}
