import { describe, expect, it } from 'vitest';
import { parseTypedMove, spokenSan } from '../../src/game/typedMove';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('typed moves', () => {
  it('reads SAN in either case and UCI', () => {
    expect(parseTypedMove(START, 'e4')).toBe('e2e4');
    expect(parseTypedMove(START, 'Nf3')).toBe('g1f3');
    expect(parseTypedMove(START, 'nf3')).toBe('g1f3');
    expect(parseTypedMove(START, 'g1f3')).toBe('g1f3');
    expect(parseTypedMove(START, ' E2E4 ')).toBe('e2e4');
    expect(parseTypedMove(START, 'e5')).toBeNull();
    expect(parseTypedMove(START, 'Ke2')).toBeNull();
    expect(parseTypedMove(START, '')).toBeNull();
  });

  it('reads castling with O or zero', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(parseTypedMove(fen, 'O-O')).toBe('e1g1');
    expect(parseTypedMove(fen, '0-0-0')).toBe('e1c1');
    expect(parseTypedMove(fen, 'o-o')).toBe('e1g1');
  });

  it('prefers the b-pawn for a lower-case b, as Lichess does', () => {
    // White pawn b2 and bishop d2 can both take on c3.
    const fen = '4k3/8/8/8/8/2n5/1P1B4/4K3 w - - 0 1';
    expect(parseTypedMove(fen, 'bxc3')).toBe('b2c3');
    expect(parseTypedMove(fen, 'Bxc3')).toBe('d2c3');
  });

  it('reads promotions with or without "=", defaulting UCI to a queen', () => {
    const fen = '8/4P2k/8/8/8/8/8/4K3 w - - 0 1';
    expect(parseTypedMove(fen, 'e8=Q')).toBe('e7e8q');
    expect(parseTypedMove(fen, 'e8q')).toBe('e7e8q');
    expect(parseTypedMove(fen, 'e8=N')).toBe('e7e8n');
    expect(parseTypedMove(fen, 'e7e8')).toBe('e7e8q');
    expect(parseTypedMove(fen, 'e7e8r')).toBe('e7e8r');
    expect(parseTypedMove(fen, 'e8')).toBeNull();
  });

  it('ignores check marks and annotations', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    expect(parseTypedMove(fen, 'Ra8+')).toBe('a1a8');
    expect(parseTypedMove(fen, 'Ra8#!?')).toBe('a1a8');
  });
});

describe('spoken moves', () => {
  it('reads SAN aloud', () => {
    expect(spokenSan('e4')).toBe('pawn to e4');
    expect(spokenSan('Nxf7+')).toBe('knight takes f7, check');
    expect(spokenSan('exd5')).toBe('pawn from e takes d5');
    expect(spokenSan('Rad1')).toBe('rook from a to d1');
    expect(spokenSan('e8=Q#')).toBe('pawn to e8, promotes to queen, checkmate');
    expect(spokenSan('O-O')).toBe('castles kingside');
    expect(spokenSan('O-O-O+')).toBe('castles queenside, check');
  });
});
