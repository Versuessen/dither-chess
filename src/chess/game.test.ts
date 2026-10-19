import { describe, expect, it } from 'vitest';
import { Game } from './game';
import { formatClock, pgnClock } from './clock';

function fakeNow(start = 0) {
  let t = start;
  const now = () => t;
  return { now, advance: (ms: number) => (t += ms) };
}

const rapid = { base: 900, increment: 10 };
const blitz = { base: 300, increment: 3 };
const untimed = { base: 0, increment: 0 };

function play(g: Game, moves: string) {
  for (const m of moves.split(' ').filter(Boolean)) g.play(m);
}

describe('game endings', () => {
  it('checkmate (fool’s mate)', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w' });
    play(g, 'f2f3 e7e5 g2g4 d8h4');
    expect(g.outcome).toEqual({ result: '0-1', termination: 'checkmate', winner: 'b' });
    expect(g.rated).toBe(true);
    expect(() => g.play('a2a3')).toThrow();
  });

  it('stalemate', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w', fen: '8/5K1k/8/8/8/8/8/6Q1 b - - 0 1' });
    g.play('h7h8');
    g.play('g1g6');
    expect(g.outcome?.termination).toBe('stalemate');
    expect(g.outcome?.result).toBe('1/2-1/2');
  });

  it('insufficient material after the last capture', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w', fen: '4k3/8/8/8/8/8/3r4/3QK3 b - - 0 1' });
    g.play('e8e7');
    g.play('d1d2'); // only kings remain? no: white queen took the rook -> K+Q vs K
    expect(g.over).toBe(false);
    const h = new Game({ timeControl: rapid, humanColor: 'w', fen: '4k3/8/8/8/8/8/3q4/3NK3 w - - 0 1' });
    h.play('e1d2'); // king takes queen: K+N vs K
    expect(h.outcome?.termination).toBe('aborted'); // black never moved
    const i = new Game({ timeControl: rapid, humanColor: 'w', fen: '4k3/8/8/8/8/8/3q4/3NK3 b - - 0 1' });
    i.play('e8e7');
    i.play('e1d2');
    expect(i.outcome).toEqual({ result: '1/2-1/2', termination: 'insufficient', winner: null });
  });

  it('threefold repetition is a claim, fivefold is automatic', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w' });
    const shuffle = 'g1f3 g8f6 f3g1 f6g8';
    play(g, shuffle); // start position twice
    expect(g.claimable()).toBeNull();
    play(g, shuffle); // three times
    expect(g.claimable()).toBe('threefold');
    expect(g.over).toBe(false);
    play(g, shuffle); // four
    expect(g.over).toBe(false);
    play(g, shuffle); // five
    expect(g.outcome?.termination).toBe('fivefold');
  });

  it('a threefold claim ends the game as a draw', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w' });
    play(g, 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
    expect(g.claim()).toBe(true);
    expect(g.outcome).toEqual({ result: '1/2-1/2', termination: 'threefold', winner: null });
  });

  it('positions differing only in castling rights are not repetitions', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    // Rooks out and back lose castling rights: the first position never recurs.
    play(g, 'a1a2 a8a7 a2a1 a7a8 a1a2 a8a7 a2a1 a7a8');
    expect(g.claimable()).toBeNull();
    play(g, 'a1a2 a8a7 a2a1 a7a8');
    expect(g.claimable()).toBe('threefold');
  });

  it('50-move rule is a claim, 75-move rule is automatic', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 98 80' });
    g.play('a1a2');
    expect(g.claimable()).toBeNull();
    g.play('e8d8');
    expect(g.claimable()).toBe('fifty-move');
    const h = new Game({ timeControl: rapid, humanColor: 'w', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 148 80' });
    h.play('a1a2');
    expect(h.over).toBe(false);
    h.play('e8d8');
    expect(h.outcome?.termination).toBe('seventy-five-move');
  });

  it('checkmate takes precedence over the 75-move rule', () => {
    const h = new Game({ timeControl: rapid, humanColor: 'w', fen: '6k1/5ppp/8/8/8/8/1K6/R6n b - - 148 80' });
    h.play('h1g3');
    expect(h.over).toBe(false);
    h.play('a1a8'); // 150th half-move, and mate
    expect(h.outcome?.termination).toBe('checkmate');
  });
});

describe('clocks', () => {
  it('runs White from the start, adds the increment after each move', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: rapid, humanColor: 'w', now: t.now });
    g.begin();
    t.advance(5000);
    const r = g.play('e2e4');
    expect(r.spent).toBe(5000);
    expect(r.clock).toBe(900_000 - 5000 + 10_000);
    t.advance(2000);
    expect(g.clock.timeLeft('b')).toBe(898_000);
  });

  it('a fallen flag loses, unless the opponent cannot mate', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: blitz, humanColor: 'w', now: t.now });
    play(g, 'e2e4 e7e5');
    t.advance(400_000);
    expect(g.checkFlag()).toBe(true);
    expect(g.outcome).toEqual({ result: '0-1', termination: 'timeout', winner: 'b' });

    const u = fakeNow();
    const h = new Game({ timeControl: blitz, humanColor: 'w', fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', now: u.now });
    h.play('e8d8');
    h.play('e2e3');
    u.advance(400_000);
    h.checkFlag(); // black flags; white has a pawn and can mate
    expect(h.outcome?.result).toBe('1-0');

    const v = fakeNow();
    const k = new Game({ timeControl: blitz, humanColor: 'w', fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', now: v.now });
    k.play('e2e3');
    k.play('e8d8');
    v.advance(400_000);
    k.checkFlag(); // white flags; black has a lone king
    expect(k.outcome).toEqual({ result: '1/2-1/2', termination: 'timeout-vs-insufficient', winner: null });
  });

  it('a move cannot be played after the flag has fallen', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: blitz, humanColor: 'w', now: t.now });
    play(g, 'e2e4 e7e5');
    t.advance(310_000);
    expect(() => g.play('g1f3')).toThrow('flag fell');
    expect(g.outcome?.termination).toBe('timeout');
  });

  it('untimed games never flag', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: untimed, humanColor: 'w', now: t.now });
    g.play('e2e4');
    t.advance(1e9);
    expect(g.checkFlag()).toBe(false);
    expect(g.records[0]!.clock).toBeNull();
  });

  it('formats clocks', () => {
    expect(formatClock(900_000)).toBe('15:00');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(9_450)).toBe('0:09.4');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(Infinity)).toBe('∞');
    expect(pgnClock(893_999)).toBe('0:14:53');
  });
});

describe('rating eligibility', () => {
  it('only rapid games with both sides moving and no takeback are rated', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'w' });
    play(g, 'e2e4 e7e5');
    g.resign('w');
    expect(g.outcome?.result).toBe('0-1');
    expect(g.rated).toBe(true);
    const b = new Game({ timeControl: blitz, humanColor: 'w' });
    play(b, 'e2e4 e7e5');
    b.resign('w');
    expect(b.rated).toBe(false);
  });

  it('ending before both sides moved is an abort', () => {
    const g = new Game({ timeControl: rapid, humanColor: 'b' });
    g.play('e2e4');
    expect(g.canAbort()).toBe(true);
    g.resign('b');
    expect(g.outcome).toEqual({ result: '*', termination: 'aborted', winner: null });
    expect(g.rated).toBe(false);
  });

  it('a takeback unrates the game and restores the clocks', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: rapid, humanColor: 'w', now: t.now });
    g.begin();
    t.advance(3000);
    g.play('e2e4');
    t.advance(1000);
    g.play('e7e5');
    t.advance(7000);
    g.play('g1f3');
    t.advance(1000);
    g.play('b8c6');
    expect(g.takeback()).toBe(2);
    expect(g.turn).toBe('w');
    expect(g.records.length).toBe(2);
    expect(g.clock.timeLeft('w')).toBe(900_000 - 3000 + 10_000);
    expect(g.rated).toBe(false);
    expect(g.takebacks).toBe(1);
  });
});
