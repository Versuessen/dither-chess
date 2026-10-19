/**
 * Results under the FIDE Laws of Chess (Handbook E.01, in force since 1 January 2023) that
 * chess.js does not decide on its own.
 *
 *  - 5.2.2 / 9.6: the game is drawn automatically by insufficient material (no sequence of
 *    legal moves can mate), by fivefold repetition (9.6.1) and by 75 moves without a capture or
 *    pawn move (9.6.2, unless the last move mates).
 *  - 9.2 / 9.3: threefold repetition and the 50-move rule are claims, not automatic.
 *  - 6.9: a player whose flag falls loses, unless the opponent cannot checkmate them by any
 *    possible series of legal moves, in which case the game is drawn.
 *
 * "Can this side still mate?" uses the classification of Lichess (scalachess
 * InsufficientMatingMaterial, MIT), derived from e4ec.org's study of helpmate material:
 * a lone king cannot mate; king + knight cannot mate a king that has only queens beside it;
 * king + bishops cannot mate unless bishops stand on both colours or the opponent has a knight
 * or a pawn.
 */

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'w' | 'b';

export interface BoardPiece {
  type: PieceType;
  color: Color;
  /** Square index 0..63, a1 = 0, h8 = 63. */
  square: number;
}

const isLight = (sq: number) => ((sq >> 3) + (sq & 7)) % 2 === 1;

export function bishopsOnBothColours(pieces: readonly BoardPiece[]): boolean {
  let light = false;
  let dark = false;
  for (const p of pieces) {
    if (p.type !== 'b') continue;
    if (isLight(p.square)) light = true;
    else dark = true;
  }
  return light && dark;
}

/** True when `color` cannot checkmate by any sequence of legal moves (6.9 test). */
export function cannotMate(pieces: readonly BoardPiece[], color: Color): boolean {
  const own = pieces.filter((p) => p.color === color && p.type !== 'k');
  const opp = pieces.filter((p) => p.color !== color && p.type !== 'k');
  if (own.length === 0) return true;
  // King + one knight against king + queens only.
  if (own.length === 1 && own[0]!.type === 'n' && opp.every((p) => p.type === 'q')) return true;
  // King + bishop(s) only.
  if (own.every((p) => p.type === 'b')) {
    const helpers = opp.some((p) => p.type === 'n' || p.type === 'p');
    return !(bishopsOnBothColours(pieces) || helpers);
  }
  return false;
}

/** 5.2.2 dead position by material: neither side can mate. */
export function insufficientMaterial(pieces: readonly BoardPiece[]): boolean {
  const minors = pieces.filter((p) => p.type !== 'k');
  if (minors.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return false;
  if (minors.length <= 1) return true;
  return minors.every((p) => p.type === 'b') && !bishopsOnBothColours(pieces);
}

/**
 * Position identity for repetition (9.2.3): same player to move, same pieces on the same
 * squares, same castling rights and en-passant possibilities. The en-passant square counts only
 * when a capture there is actually legal.
 */
export function repetitionKey(fen: string, epCaptureLegal: boolean): string {
  const [placement, turn, castling, ep] = fen.split(' ');
  return `${placement} ${turn} ${castling} ${epCaptureLegal ? ep : '-'}`;
}

export function countRepetitions(keys: readonly string[]): number {
  if (!keys.length) return 0;
  const last = keys[keys.length - 1];
  let n = 0;
  for (const k of keys) if (k === last) n++;
  return n;
}

export type Termination =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient'
  | 'fivefold'
  | 'seventy-five-move'
  | 'threefold'
  | 'fifty-move'
  | 'timeout'
  | 'timeout-vs-insufficient'
  | 'resignation'
  | 'agreement'
  | 'abandoned'
  | 'aborted';

export type Result = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface Outcome {
  result: Result;
  termination: Termination;
  winner: Color | null;
}

export function decisive(winner: Color, termination: Termination): Outcome {
  return { result: winner === 'w' ? '1-0' : '0-1', termination, winner };
}

export function drawn(termination: Termination): Outcome {
  return { result: '1/2-1/2', termination, winner: null };
}

/** 6.9: the side whose flag fell loses unless the other side cannot mate. */
export function timeoutOutcome(pieces: readonly BoardPiece[], flagged: Color): Outcome {
  const opponent: Color = flagged === 'w' ? 'b' : 'w';
  return cannotMate(pieces, opponent) ? drawn('timeout-vs-insufficient') : decisive(opponent, 'timeout');
}

/** PGN Termination tag values (PGN standard 9.8.1). */
export function pgnTermination(t: Termination): string {
  switch (t) {
    case 'timeout':
      return 'time forfeit';
    case 'abandoned':
      return 'abandoned';
    case 'aborted':
      return 'unterminated';
    default:
      return 'normal';
  }
}

export function describeTermination(o: Outcome): string {
  const side = o.winner === 'w' ? 'White' : 'Black';
  switch (o.termination) {
    case 'checkmate':
      return `${side} wins by checkmate`;
    case 'resignation':
      return `${side} wins by resignation`;
    case 'abandoned':
      return `${side} wins: the game was left unfinished`;
    case 'timeout':
      return `${side} wins on time`;
    case 'timeout-vs-insufficient':
      return 'Draw: flag fell, but the opponent could not have mated';
    case 'stalemate':
      return 'Draw by stalemate';
    case 'insufficient':
      return 'Draw: neither side can mate';
    case 'fivefold':
      return 'Draw by fivefold repetition';
    case 'seventy-five-move':
      return 'Draw by the 75-move rule';
    case 'threefold':
      return 'Draw claimed: threefold repetition';
    case 'fifty-move':
      return 'Draw claimed: 50-move rule';
    case 'agreement':
      return 'Draw agreed';
    case 'aborted':
      return 'Game aborted';
  }
}
