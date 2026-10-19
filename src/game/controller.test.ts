import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { GameController } from './controller.svelte';
import { MemoryStorage } from '../storage/memory';
import type { BotRequest, BotThought, Opponent } from '../bots/opponent';
import type { WDL } from '../bots/behaviour';
import type { StoredGame } from '../storage/types';

/** Test double: replays a fixed list of moves. Lives only in tests; never shipped. */
class ScriptedOpponent implements Opponent {
  family = 'maia3' as const;
  pack = { id: 'test-pack', sha256: '0'.repeat(64) };
  seed = 42;
  calls = 0;
  constructor(
    private script: string[],
    public level = 1200,
    public wdl: WDL | null = [0.3, 0.4, 0.3]
  ) {}
  async choose(req: BotRequest): Promise<BotThought> {
    this.calls++;
    const uci = this.script[Math.floor(req.moves.length / 2)] ?? this.script[this.script.length - 1]!;
    return { uci, chosenProb: 0.5, entropy: 1, legal: 20, wdl: this.wdl, inferenceMs: 5 };
  }
  async value(): Promise<WDL | null> {
    return this.wdl;
  }
  dispose() {}
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function make(script: string[], extra: Partial<ConstructorParameters<typeof GameController>[0]> = {}) {
  const storage = new MemoryStorage();
  const finished: StoredGame[] = [];
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const c = new GameController({
    id: 'g1',
    opponent: new ScriptedOpponent(script),
    botName: 'Grinder',
    persona: 'grinder',
    humanColor: 'w',
    timeControl: { base: 900, increment: 10 },
    instantBot: () => false,
    storage,
    onFinished: (g) => void finished.push(g),
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    ...extra
  });
  const advance = async (ms: number) => {
    t += ms;
    for (const tm of [...timers].sort((a, b) => a.at - b.at)) {
      if (tm.at <= t) {
        timers.splice(timers.indexOf(tm), 1);
        tm.fn();
      }
    }
    await tick();
  };
  return { c, storage, finished, advance, timers };
}

describe('GameController', () => {
  it('plays a game: human move, bot pause on its own clock, persistence, checkmate', async () => {
    const { c, storage, finished, advance, timers } = make(['e7e5', 'd8h4']);
    c.start();
    expect(c.humanToMove).toBe(true);
    expect(c.humanMove('f2f3')).toBe(true);
    await tick();
    expect(c.thinking).toBe(true);
    expect(timers.length).toBe(1);
    const pause = timers[0]!.at;
    expect(pause).toBeGreaterThan(0);
    await advance(pause);
    expect(c.moves.map((m) => m.san)).toEqual(['f3', 'e5']);
    // the bot's pause ran on the bot's clock
    expect(c.moves[1]!.spent).toBe(pause);
    expect(c.humanMove('g2g4')).toBe(true);
    await tick();
    await advance(60_000);
    expect(c.outcome?.termination).toBe('checkmate');
    flushSync();
    await tick();
    expect(finished).toHaveLength(1);
    expect(finished[0]!.pgn).toContain('[Result "0-1"]');
    expect((await storage.getGame('g1'))?.outcome?.result).toBe('0-1');
  });

  it('instant bot replies without a pause', async () => {
    const { c } = make(['e7e5'], { instantBot: () => true });
    c.start();
    c.humanMove('e2e4');
    await tick();
    expect(c.moves.length).toBe(2);
  });

  it('the bot moves first when it has White', async () => {
    const { c, advance } = make(['e2e4'], { humanColor: 'b' });
    c.start();
    await tick();
    await advance(60_000);
    expect(c.moves[0]!.san).toBe('e4');
    expect(c.humanToMove).toBe(true);
  });

  it('rejects moves out of turn and illegal moves', async () => {
    const { c } = make(['e7e5']);
    c.start();
    expect(c.humanMove('e2e5')).toBe(false);
    c.humanMove('e2e4');
    expect(c.humanMove('d2d4')).toBe(false);
  });

  const humanQuiet = ['a2a3', 'b2b3', 'c2c3', 'd2d3', 'e2e3', 'f2f3', 'g2g3', 'h2h3', 'a3a4', 'b3b4'];
  const botQuiet = ['a7a6', 'b7b6', 'c7c6', 'd7d6', 'e7e6', 'f7f6', 'g7g6', 'h7h6', 'a6a5', 'b6b5'];

  it('draw offers follow the value head; one offer per ten plies', async () => {
    const { c } = make(botQuiet, { instantBot: () => true });
    c.start();
    for (const m of humanQuiet) {
      c.humanMove(m);
      await tick();
    }
    const opp = c.opts.opponent as ScriptedOpponent;
    opp.wdl = [0.6, 0.3, 0.1];
    expect(await c.offerDraw()).toBe(false);
    expect(c.notice?.kind).toBe('draw-declined');
    expect(c.canOfferDraw()).toBe(false);
  });

  it('a draw is accepted when the bot is worse', async () => {
    const { c } = make(botQuiet, { instantBot: () => true });
    (c.opts.opponent as ScriptedOpponent).wdl = [0.1, 0.5, 0.4];
    c.start();
    for (const m of humanQuiet) {
      c.humanMove(m);
      await tick();
    }
    expect(await c.offerDraw()).toBe(true);
    expect(c.outcome?.termination).toBe('agreement');
  });

  it('the bot claims a threefold repetition when not better', async () => {
    const script = ['g8f6', 'f6g8', 'g8f6', 'f6g8', 'g8f6'];
    const { c } = make(script, { instantBot: () => true });
    c.start();
    for (const m of ['g1f3', 'f3g1', 'g1f3', 'f3g1']) {
      c.humanMove(m);
      await tick();
    }
    // The start position has occurred three times with White to move: the human may claim.
    expect(c.claimable).toBe('threefold');
    expect(c.claimDraw()).toBe(true);
    expect(c.outcome?.termination).toBe('threefold');
  });

  it('abort before both moved, resign after; takeback unrates', async () => {
    const a = make(['e7e5'], { humanColor: 'w' });
    a.c.start();
    expect(a.c.canAbort).toBe(true);
    a.c.abort();
    expect(a.c.outcome?.termination).toBe('aborted');

    const b = make(['e7e5', 'b8c6'], { instantBot: () => true });
    b.c.start();
    b.c.humanMove('e2e4');
    await tick();
    b.c.humanMove('g1f3');
    await tick();
    expect(b.c.rated).toBe(true);
    expect(b.c.takeback()).toBe(true);
    expect(b.c.rated).toBe(false);
    expect(b.c.moves.length).toBe(2);
    b.c.resign();
    expect(b.c.outcome?.result).toBe('0-1');
  });

  it('a fallen flag ends the game through tick()', async () => {
    const { c, advance } = make(['e7e5'], { instantBot: () => true, timeControl: { base: 600, increment: 0 } });
    c.start();
    c.humanMove('e2e4');
    await tick();
    await advance(601_000);
    c.tick();
    expect(c.outcome?.termination).toBe('timeout');
    expect(c.outcome?.winner).toBe('b');
  });

  it('queues several premoves and plays them after each bot move', async () => {
    const { c, advance } = make(['e7e5', 'b8c6', 'd7d6', 'c6d4']);
    c.start();
    expect(c.humanMove('e2e4')).toBe(true);
    // The bot is thinking: queue Nf3, then Bc4 from where the knight already stands.
    expect(c.queuePremove('g1', 'f3')).toBe(true);
    expect(c.queuePremove('f1', 'c4')).toBe(true);
    expect(c.queuePremove('f1', 'b5')).toBe(false); // the bishop is already queued to c4
    expect(c.shownFen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/2B1P3/5N2/PPPP1PPP/RNBQK2R');
    await tick();
    await advance(60_000);
    // ...e5, then Nf3 at once; then ...Nc6 and Bc4.
    expect(c.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(c.premoves).toHaveLength(1);
    await tick();
    await advance(60_000);
    expect(c.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    expect(c.premoves).toHaveLength(0);
    await tick();
    await advance(60_000);
    expect(c.humanMove('e1g1')).toBe(true);
    // Premoving the bishop to f7 with check, then queue more, then cancel them all.
    expect(c.queuePremove('c4', 'f7')).toBe(true);
    expect(c.queuePremove('f3', 'e5')).toBe(true);
    c.clearPremoves();
    expect(c.premoves).toHaveLength(0);
    expect(c.shownFen).toBe(c.fen);
  });

  it('drops the whole queue when the next premove is illegal after the bot moves', async () => {
    // The queued e4-e5 is blocked once the bot answers ...e5.
    const { c, advance } = make(['e7e5']);
    c.start();
    expect(c.humanMove('e2e4')).toBe(true);
    expect(c.queuePremove('e4', 'e5')).toBe(true);
    expect(c.queuePremove('d2', 'd4')).toBe(true);
    await tick();
    await advance(60_000);
    expect(c.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(c.premoves).toHaveLength(0);
    expect(c.humanToMove).toBe(true);
  });
});
