import { describe, expect, it } from 'vitest';
import { applyPremoves, premoveDests, premovePromotes } from './premove';

describe('premoves', () => {
  it('offers only moves legal from the shown position: blocked lines stop, own pieces never', () => {
    // After 1. e4, Black to move; White premoves. The bishop on f1 sees e2..a6, not through pieces.
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const d = premoveDests(fen, 'w');
    expect(d.get('f1')?.sort()).toEqual(['a6', 'b5', 'c4', 'd3', 'e2']);
    expect(d.get('d1')?.sort()).toEqual(['e2', 'f3', 'g4', 'h5']);
    expect(d.get('a1')).toBeUndefined(); // the rook is boxed in
    for (const [, to] of d) for (const sq of to) expect(['a2', 'b2', 'c2', 'd2', 'f2', 'g2', 'h2']).not.toContain(sq);
  });

  it('captures only the first enemy piece on a line', () => {
    // White rook a1, black pawn a5 and black rook a8: a5 can be taken, a8 cannot.
    const fen = '4k2r/8/8/p7/8/8/8/R3K3 b - - 0 1'.replace('4k2r', 'r3k3');
    const d = premoveDests(fen, 'w');
    expect(d.get('a1')).toContain('a5');
    expect(d.get('a1')).not.toContain('a6');
    expect(d.get('a1')).not.toContain('a8');
  });

  it('a king in check must be answered', () => {
    // White king e1 in check from the rook on e8; only king moves and blocks are offered.
    const fen = '4r1k1/8/8/8/8/8/3B4/4K3 b - - 0 1';
    const d = premoveDests(fen, 'w');
    expect(d.get('d2')).toEqual(['e3']);
    expect(d.get('e1')).not.toContain('e2');
  });

  it('shows queued moves on the board and promotes to a queen', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const shown = applyPremoves(fen, 'w', [
      { from: 'g1', to: 'f3' },
      { from: 'f1', to: 'c4' }
    ]);
    expect(shown.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/2B1P3/5N2/PPPP1PPP/RNBQK2R');
    expect(shown.split(' ')[1]).toBe('b');
    expect(premovePromotes('8/4P1k1/8/8/8/8/8/4K3 b - - 0 1', 'e7', 'e8')).toBe(true);
  });
});
