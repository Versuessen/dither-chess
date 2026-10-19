/**
 * Position helpers shared by the model encoders. Square indices follow python-chess:
 * a1 = 0, b1 = 1, ..., h8 = 63. "Mirroring" is python-chess Board.mirror(): flip ranks,
 * swap colours, swap castling rights, mirror the en-passant square, swap the side to move.
 */
import { Chess } from 'chess.js';

export type PieceChar = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Position {
  /** pieces[sq] = FEN letter or '' for empty. */
  pieces: string[];
  turn: 'w' | 'b';
  castling: { K: boolean; Q: boolean; k: boolean; q: boolean };
  /** En-passant square index, or -1. Only set when a capture there is legal. */
  ep: number;
  halfmove: number;
  fullmove: number;
}

export const PIECE_ORDER = ['p', 'n', 'b', 'r', 'q', 'k'] as const;

export function squareIndex(name: string): number {
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
}

export function squareName(i: number): string {
  return String.fromCharCode(97 + (i & 7)) + String.fromCharCode(49 + (i >> 3));
}

/** Parse a FEN. The en-passant field is kept only if a pawn of the side to move can capture. */
export function parseFen(fen: string): Position {
  const [placement = '', turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const pieces = new Array<string>(64).fill('');
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    const rank = 7 - r;
    let file = 0;
    for (const ch of rows[r] ?? '') {
      if (ch >= '1' && ch <= '8') file += Number(ch);
      else {
        pieces[rank * 8 + file] = ch;
        file++;
      }
    }
  }
  const pos: Position = {
    pieces,
    turn: turn === 'b' ? 'b' : 'w',
    castling: { K: castling.includes('K'), Q: castling.includes('Q'), k: castling.includes('k'), q: castling.includes('q') },
    ep: ep === '-' ? -1 : squareIndex(ep),
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1
  };
  if (pos.ep >= 0 && !hasLegalEnPassant(fen, pos.ep)) pos.ep = -1;
  return pos;
}

/** python-chess has_legal_en_passant: some legal move captures en passant on that square. */
function hasLegalEnPassant(fen: string, ep: number): boolean {
  try {
    const c = new Chess(fen, { skipValidation: true });
    const sq = squareName(ep);
    return c.moves({ verbose: true }).some((m) => m.to === sq && m.isEnPassant());
  } catch {
    return false;
  }
}

/** python-chess Board.mirror(). */
export function mirror(p: Position): Position {
  const pieces = new Array<string>(64).fill('');
  for (let sq = 0; sq < 64; sq++) {
    const ch = p.pieces[sq]!;
    if (!ch) continue;
    pieces[sq ^ 56] = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
  }
  return {
    pieces,
    turn: p.turn === 'w' ? 'b' : 'w',
    castling: { K: p.castling.k, Q: p.castling.q, k: p.castling.K, q: p.castling.Q },
    ep: p.ep >= 0 ? p.ep ^ 56 : -1,
    halfmove: p.halfmove,
    fullmove: p.fullmove
  };
}

/** Mirror a UCI move vertically (e7e8q -> e2e1q). */
export function mirrorUci(uci: string): string {
  const flip = (sq: string) => sq[0]! + String(9 - Number(sq[1]));
  return flip(uci.slice(0, 2)) + flip(uci.slice(2, 4)) + uci.slice(4);
}

/** Legal moves in UCI as python-chess writes them (castling as king two squares). */
export function legalUci(fen: string): string[] {
  const c = new Chess(fen);
  return c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
}

export function softmax(logits: ArrayLike<number>, temperature = 1): Float64Array {
  const n = logits.length;
  const out = new Float64Array(n);
  let max = -Infinity;
  for (let i = 0; i < n; i++) max = Math.max(max, logits[i]! / temperature);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(logits[i]! / temperature - max);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < n; i++) out[i]! /= sum;
  return out;
}

export function logSoftmax(logits: ArrayLike<number>): Float64Array {
  const n = logits.length;
  let max = -Infinity;
  for (let i = 0; i < n; i++) max = Math.max(max, logits[i]!);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.exp(logits[i]! - max);
  const lse = max + Math.log(sum);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = logits[i]! - lse;
  return out;
}
