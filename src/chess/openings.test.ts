import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { family, loadOpenings, nameOpening } from './openings';

function fens(moves: string): string[] {
  const c = new Chess();
  const out = [c.fen()];
  for (const m of moves.split(' ')) {
    c.move(m);
    out.push(c.fen());
  }
  return out;
}

describe('opening names', () => {
  it('names common openings by position', async () => {
    const t = await loadOpenings();
    expect(nameOpening(t, fens('e4 d5'))?.name).toBe('Scandinavian Defense');
    expect(nameOpening(t, fens('e4 e5 Nf3 Nf6'))?.name).toMatch(/^Petrov's Defense/);
    expect(nameOpening(t, fens('e4 e5 Nf3 Nf6'))?.eco).toBe('C42');
    expect(nameOpening(t, fens('e4 c5'))?.name).toBe('Sicilian Defense');
  });

  it('follows transpositions and keeps the last known name out of book', async () => {
    const t = await loadOpenings();
    // Queen's Gambit Declined reached from the English Opening.
    const a = nameOpening(t, fens('d4 d5 c4 e6 Nc3 Nf6'));
    const b = nameOpening(t, fens('c4 e6 Nc3 d5 d4 Nf6'));
    expect(a?.name).toMatch(/^Queen's Gambit Declined/);
    expect(b?.name).toBe(a?.name);
    const late = nameOpening(t, fens('e4 d5 exd5 Qxd5 Nc3 Qa5 h4 h5 a4 c6 Ra3'));
    expect(family(late!.name)).toBe('Scandinavian Defense');
    expect(late!.ply).toBeLessThan(10);
  });

  it('has no name for the start position', async () => {
    expect(nameOpening(await loadOpenings(), fens('e4').slice(0, 1))).toBeNull();
  });
});
