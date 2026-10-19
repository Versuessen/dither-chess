import { describe, expect, it } from 'vitest';
import { Game } from './game';
import { parsePgn, toPgn } from './pgn';

function fakeNow() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('PGN', () => {
  it('exports the seven tag roster, clocks and result, and parses back', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: { base: 900, increment: 10 }, humanColor: 'w', now: t.now });
    g.begin();
    for (const m of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6', 'e1g1', 'f7f6']) {
      t.advance(4321);
      g.play(m);
    }
    g.resign('b');
    const pgn = toPgn({
      white: 'You',
      black: 'Grinder (Maia-3 1200)',
      blackElo: 1200,
      startedAt: new Date(Date.UTC(2026, 9, 19, 12, 30, 0)),
      timeControl: g.timeControl,
      outcome: g.outcome,
      moves: g.records,
      rated: g.rated,
      extra: { DitherModel: 'maia3', DitherLevel: '1200' }
    });
    for (const tag of ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result']) {
      expect(pgn).toMatch(new RegExp(`^\\[${tag} "`, 'm'));
    }
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[TimeControl "900+10"]');
    expect(pgn).toContain('[Termination "normal"]');
    expect(pgn).toContain('[Event "DITHER rated rapid game"]');
    // 900 s - 5 x 4.321 s + 5 x 10 s increment = 928.395 s on both clocks.
    expect(pgn.replace(/\s+/g, ' ')).toContain('5. O-O { [%clk 0:15:28] } f6 { [%clk 0:15:28] } 1-0');
    for (const line of pgn.split('\n')) expect(line.length).toBeLessThan(80);

    const back = parsePgn(pgn);
    expect(back.moves).toEqual(g.records.map((r) => r.uci));
    expect(back.headers.DitherLevel).toBe('1200');
    expect(back.clocks[0]).toBe(Math.floor(g.records[0]!.clock! / 1000) * 1000);
  });

  it('writes SetUp/FEN and a black first move from a custom start', () => {
    const g = new Game({ timeControl: { base: 0, increment: 0 }, humanColor: 'b', fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 30' });
    g.play('e8d7');
    g.play('e2e4');
    const pgn = toPgn({
      white: 'Bot',
      black: 'You',
      startedAt: new Date(),
      timeControl: g.timeControl,
      outcome: null,
      moves: g.records,
      startFen: g.startFen,
      rated: false
    });
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 30"]');
    expect(pgn).toContain('30... Kd7 31. e4 *');
    expect(pgn).not.toContain('%clk');
    expect(parsePgn(pgn).moves).toEqual(['e8d7', 'e2e4']);
  });

  it('marks timeouts as time forfeit', () => {
    const t = fakeNow();
    const g = new Game({ timeControl: { base: 600, increment: 0 }, humanColor: 'w', now: t.now });
    g.play('e2e4');
    g.play('e7e5');
    t.advance(700_000);
    g.checkFlag();
    const pgn = toPgn({ white: 'a', black: 'b', startedAt: new Date(), timeControl: g.timeControl, outcome: g.outcome, moves: g.records, rated: true });
    expect(pgn).toContain('[Termination "time forfeit"]');
    expect(pgn).toContain('[Result "0-1"]');
  });
});
