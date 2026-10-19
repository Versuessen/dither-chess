import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { cannotMate, insufficientMaterial, timeoutOutcome, type BoardPiece } from './rules';

function piecesOf(fen: string): BoardPiece[] {
  const c = new Chess(fen, { skipValidation: true });
  const out: BoardPiece[] = [];
  c.board().forEach((row, r) =>
    row.forEach((p, f) => {
      if (p) out.push({ type: p.type, color: p.color, square: (7 - r) * 8 + f });
    })
  );
  return out;
}

const turnOf = (fen: string) => (fen.split(' ')[1] as 'w' | 'b');
const other = (c: 'w' | 'b') => (c === 'w' ? 'b' : 'w');

describe('cannotMate (FIDE 6.9), scalachess reference cases', () => {
  // Same FENs as scalachess InsufficientMatingMaterialTest: the side NOT to move is tested.
  const trues = [
    '8/6R1/K7/2NNN3/5NN1/4KN2/8/k7 w - - 0 1',
    '8/8/K7/8/1k6/8/8/8 w - - 0 1',
    '7k/8/8/8/3K4/8/8/8 w - - 0 1',
    '7k/5R2/5NQ1/8/3K4/8/8/8 w - - 0 1',
    'krq5/bqqq4/qqr5/1qq5/8/8/8/3qB2K b - - 0 1',
    '8/3k4/2q5/8/8/K1N5/8/8 b - - 0 1',
    '7k/8/6Q1/8/3K4/8/1n6/8 w - - 0 1'
  ];
  const falses = [
    'krq5/bqqq4/qqrp4/1qq5/8/8/8/3qB2K b - - 0 1',
    '8/7B/K7/2b5/1k6/8/8/8 b - - 0 1',
    '8/8/K7/2b5/1k6/5N2/8/8 b - - 0 1',
    '7k/5R2/5NQ1/8/3K4/8/1p6/8 w - - 0 1',
    '7k/5R2/5NQ1/8/3K4/8/2n5/8 w - - 0 1',
    '7k/5R2/5NQ1/8/3K4/1r6/8/8 w - - 0 1',
    '7k/8/8/5R2/3K4/8/1n6/8 w - - 0 1',
    '7k/8/6B1/8/3K4/8/1n6/8 w - - 0 1',
    '7k/5P2/8/8/3K4/8/1n6/8 w - - 0 1',
    '7k/6N1/8/8/3K4/8/1n6/8 w - - 0 1'
  ];
  it.each(trues)('cannot mate: %s', (fen) => {
    expect(cannotMate(piecesOf(fen), other(turnOf(fen)))).toBe(true);
  });
  it.each(falses)('can mate: %s', (fen) => {
    expect(cannotMate(piecesOf(fen), other(turnOf(fen)))).toBe(false);
  });
});

describe('insufficientMaterial (FIDE 5.2.2 by material)', () => {
  it.each([
    ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', true],
    ['4k3/8/8/8/8/8/8/4KN2 w - - 0 1', true],
    ['4k3/8/8/8/8/8/8/4KB2 w - - 0 1', true],
    ['4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1', true], // both bishops on light squares
    ['4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1', false], // opposite colours
    ['4kn2/8/8/8/8/8/8/4KN2 w - - 0 1', false], // helpmate possible
    ['4k3/8/8/8/8/8/8/3NKN2 w - - 0 1', false],
    ['4k3/4p3/8/8/8/8/8/4K3 w - - 0 1', false]
  ])('%s -> %s', (fen, expected) => {
    expect(insufficientMaterial(piecesOf(fen))).toBe(expected);
  });
});

describe('timeoutOutcome', () => {
  it('flag against a lone king is a draw', () => {
    const o = timeoutOutcome(piecesOf('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'w');
    expect(o).toEqual({ result: '1/2-1/2', termination: 'timeout-vs-insufficient', winner: null });
  });
  it('flag against a rook wins for the rook', () => {
    const o = timeoutOutcome(piecesOf('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'b');
    expect(o.result).toBe('1-0');
    expect(o.termination).toBe('timeout');
  });
  it('a lone knight beats a flag when the flagger has a pawn to help mate', () => {
    expect(timeoutOutcome(piecesOf('7k/7p/8/8/8/8/8/4KN2 w - - 0 1'), 'b').result).toBe('1-0');
  });
  it('a lone knight cannot win on time against king and queen', () => {
    expect(timeoutOutcome(piecesOf('7k/8/6q1/8/8/8/8/4KN2 w - - 0 1'), 'b').result).toBe('1/2-1/2');
  });
});
