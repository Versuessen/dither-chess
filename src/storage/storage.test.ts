import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorage } from './indexeddb';
import { MemoryStorage } from './memory';
import { backupPgn, exportBackup, importBackup, parseBackup } from './backup';
import type { AppStorage, StoredGame } from './types';

function game(id: string, startedAt: string, over = true): StoredGame {
  return {
    id,
    startedAt,
    endedAt: over ? startedAt : null,
    persona: 'grinder',
    botName: 'Grinder',
    family: 'fastelo',
    pack: 'fastelo-7m',
    packSha256: 'ab'.repeat(32),
    botLevel: 1200,
    humanColor: 'w',
    timeControl: { base: 900, increment: 10 },
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [],
    outcome: over ? { result: '1-0', termination: 'resignation', winner: 'w' } : null,
    rated: true,
    takebacks: 0,
    seed: 1,
    pgn: over ? `[Event "x"]\n\n1-0\n` : ''
  };
}

const backends: [string, () => AppStorage][] = [
  ['indexeddb', () => new IndexedDbStorage(new IDBFactory(), `t-${Math.random()}`)],
  ['memory', () => new MemoryStorage()]
];

describe.each(backends)('%s storage', (_name, make) => {
  it('stores, updates and lists games newest first', async () => {
    const s = make();
    await s.init();
    await s.putGame(game('a', '2026-10-01T10:00:00Z'));
    await s.putGame(game('b', '2026-10-02T10:00:00Z', false));
    await s.putGame({ ...game('b', '2026-10-02T10:00:00Z'), takebacks: 0 });
    const list = await s.listGames();
    expect(list.map((g) => g.id)).toEqual(['b', 'a']);
    expect((await s.getGame('b'))?.outcome?.result).toBe('1-0');
    expect(await s.getGame('zzz')).toBeUndefined();
  });

  it('appends to the ledger with increasing sequence numbers', async () => {
    const s = make();
    await s.init();
    const base = { endedAt: '2026-10-01T10:00:00Z', timeZone: 'UTC', opponentRating: 1200, score: 1 as const, pgn: '', snapshot: {} };
    expect(await s.appendLedger({ ...base, gameId: 'a' })).toBe(1);
    expect(await s.appendLedger({ ...base, gameId: 'b' })).toBe(2);
    expect((await s.listLedger()).map((e) => [e.seq, e.gameId])).toEqual([
      [1, 'a'],
      [2, 'b']
    ]);
  });

  it('keeps settings', async () => {
    const s = make();
    await s.init();
    await s.setSetting('board', { colours: 'duotone' });
    expect(await s.getSetting('board')).toEqual({ colours: 'duotone' });
    expect(await s.allSettings()).toEqual({ board: { colours: 'duotone' } });
  });

  it('backs up and restores everything', async () => {
    const s = make();
    await s.init();
    await s.putGame(game('a', '2026-10-01T10:00:00Z'));
    await s.appendLedger({ gameId: 'a', endedAt: '2026-10-01T10:00:00Z', timeZone: 'UTC', opponentRating: 1200, score: 1, pgn: '', snapshot: {} });
    await s.setSetting('sound', true);
    const backup = await exportBackup(s, new Date('2026-10-19T00:00:00Z'));
    const text = JSON.stringify(backup);

    const t = make();
    await t.init();
    await t.putGame(game('stale', '2020-01-01T00:00:00Z'));
    await importBackup(t, text);
    expect((await t.listGames()).map((g) => g.id)).toEqual(['a']);
    expect((await t.listLedger()).length).toBe(1);
    expect(await t.getSetting('sound')).toBe(true);
    expect(backupPgn(backup)).toContain('1-0');
  });
});

describe('backup validation', () => {
  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow('not JSON');
    expect(() => parseBackup('{"format":"other"}')).toThrow('not a DITHER backup');
    expect(() => parseBackup('{"format":"dither-backup","version":2}')).toThrow('version 2');
    expect(() =>
      parseBackup(JSON.stringify({ format: 'dither-backup', version: 1, games: [{}], ledger: [], settings: {} }))
    ).toThrow('damaged game');
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: 'dither-backup',
          version: 1,
          games: [],
          ledger: [
            { seq: 2, gameId: 'a', endedAt: 'x', opponentRating: 1, score: 1 },
            { seq: 1, gameId: 'b', endedAt: 'x', opponentRating: 1, score: 0 }
          ],
          settings: {}
        })
      )
    ).toThrow('out of order');
  });
});
