/**
 * Premove destinations: where a piece could go once the opponent has moved. Like chessground's
 * own premove geometry (blockers are ignored, since they may move), except that squares held by
 * the mover's own pieces are never offered: a piece cannot land on its own side's piece, and
 * marking those squares as capture targets only read as "you can take your own piece".
 */

type Color = 'white' | 'black';

const FILES = 'abcdefgh';

interface Placed {
  role: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  white: boolean;
}

/** Board of a FEN's piece placement, indexed [file][rank] (0-based, rank 0 = first rank). */
function parse(fen: string): (Placed | null)[][] {
  const board: (Placed | null)[][] = Array.from({ length: 8 }, () => Array<Placed | null>(8).fill(null));
  const rows = (fen.split(' ')[0] ?? '').split('/');
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        if (file < 8 && rank >= 0) board[file]![rank] = { role: ch.toLowerCase() as Placed['role'], white: ch === ch.toUpperCase() };
        file++;
      }
    }
  });
  return board;
}

const key = (f: number, r: number) => `${FILES[f]}${r + 1}`;
const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Premove destinations for every piece of `color` in `fen`, keyed by square. */
export function premoveDests(fen: string, color: Color): Map<string, string[]> {
  const board = parse(fen);
  const white = color === 'white';
  const own = (f: number, r: number) => board[f]![r]?.white === white;
  const out = new Map<string, string[]>();

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const p = board[f]![r];
      if (!p || p.white !== white) continue;
      const dests: string[] = [];
      const add = (tf: number, tr: number) => {
        if (onBoard(tf, tr) && !own(tf, tr)) dests.push(key(tf, tr));
      };
      const ray = (df: number, dr: number) => {
        for (let i = 1; i < 8; i++) add(f + df * i, r + dr * i);
      };
      switch (p.role) {
        case 'p': {
          const dir = white ? 1 : -1;
          add(f, r + dir);
          if (r === (white ? 1 : 6)) add(f, r + 2 * dir);
          add(f - 1, r + dir);
          add(f + 1, r + dir);
          break;
        }
        case 'n':
          for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const) add(f + df, r + dr);
          break;
        case 'b':
          for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) ray(df, dr);
          break;
        case 'r':
          for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) ray(df, dr);
          break;
        case 'q':
          for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) ray(df, dr);
          break;
        case 'k': {
          for (const [df, dr] of [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]] as const) add(f + df, r + dr);
          // Castling from the home square, as two-square king moves.
          const home = white ? 0 : 7;
          if (f === 4 && r === home) {
            const rook = (rf: number) => board[rf]![home]?.role === 'r' && board[rf]![home]?.white === white;
            if (rook(7) && !own(6, home)) dests.push(key(6, home));
            if (rook(0) && !own(2, home)) dests.push(key(2, home));
          }
          break;
        }
      }
      if (dests.length) out.set(key(f, r), [...new Set(dests)]);
    }
  }
  return out;
}
