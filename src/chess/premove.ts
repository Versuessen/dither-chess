/**
 * Premoves, as on the big sites: while the bot thinks, the player may queue several moves. Each
 * queued move is shown on the board straight away (the queue is applied to a copy of the
 * position), and the next one is offered from where the pieces then stand. Destinations are the
 * moves that would be legal there if it were the player's turn: a piece stops at the first piece
 * in its way, captures only the first enemy piece on a line, never lands on its own side's piece,
 * and a king in check must be answered. When the bot has moved, the first queued move is played
 * if it is legal in the real position; otherwise the whole queue is dropped.
 */
import { Chess, type Square } from 'chess.js';

export interface Premove {
  from: Square;
  to: Square;
  /** Promotion piece; premoves promote to a queen. */
  promotion?: 'q';
}

type Side = 'w' | 'b';

/** The same position with `side` to move (en passant cleared: it belongs to the other side). */
function withTurn(fen: string, side: Side): string {
  const f = fen.split(' ');
  f[1] = side;
  f[3] = '-';
  return f.join(' ');
}

/** Legal destinations for `side` in `fen` as if it were that side's turn. */
export function premoveDests(fen: string, side: Side): Map<Square, Square[]> {
  const out = new Map<Square, Square[]>();
  let chess: Chess;
  try {
    chess = new Chess(withTurn(fen, side), { skipValidation: true });
  } catch {
    return out;
  }
  for (const m of chess.moves({ verbose: true })) {
    const list = out.get(m.from) ?? [];
    if (!list.includes(m.to)) list.push(m.to);
    out.set(m.from, list);
  }
  return out;
}

/**
 * The position after the queued moves, for display: pieces move as queued (a king's two-square
 * step brings its rook, a pawn reaching the last rank becomes a queen), side to move unchanged.
 */
export function applyPremoves(fen: string, side: Side, queue: readonly Premove[]): string {
  if (!queue.length) return fen;
  let cur = fen;
  for (const p of queue) {
    try {
      const c = new Chess(withTurn(cur, side), { skipValidation: true });
      c.move(p.promotion ? { from: p.from, to: p.to, promotion: p.promotion } : { from: p.from, to: p.to });
      cur = c.fen();
    } catch {
      break;
    }
  }
  const f = cur.split(' ');
  const real = fen.split(' ');
  f[1] = real[1]!;
  f[3] = '-';
  return f.join(' ');
}

/** Whether a move from `from` to `to` by `side` in `fen` would reach the last rank with a pawn. */
export function premovePromotes(fen: string, from: Square, to: Square): boolean {
  try {
    const p = new Chess(fen).get(from);
    return !!p && p.type === 'p' && (to[1] === '8' || to[1] === '1');
  } catch {
    return false;
  }
}
