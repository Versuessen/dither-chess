/**
 * Full backup: one JSON document with every game, the rating ledger and the settings, plus a
 * plain PGN file of all finished games for other chess tools.
 */
import type { AppStorage, Backup, LedgerEntry, StoredGame } from './types';

export async function exportBackup(storage: AppStorage, now = new Date()): Promise<Backup> {
  return {
    format: 'dither-backup',
    version: 1,
    exportedAt: now.toISOString(),
    games: (await storage.listGames()).reverse(),
    ledger: await storage.listLedger(),
    settings: await storage.allSettings()
  };
}

export function backupPgn(backup: Backup): string {
  return backup.games
    .filter((g) => g.outcome && g.pgn)
    .map((g) => g.pgn.trim())
    .join('\n\n')
    .concat('\n');
}

function isGame(v: unknown): v is StoredGame {
  const g = v as StoredGame;
  return (
    !!g &&
    typeof g.id === 'string' &&
    typeof g.startedAt === 'string' &&
    Array.isArray(g.moves) &&
    (g.humanColor === 'w' || g.humanColor === 'b') &&
    typeof g.botLevel === 'number'
  );
}

function isLedgerEntry(v: unknown): v is LedgerEntry {
  const e = v as LedgerEntry;
  if (!e || !Number.isInteger(e.seq) || typeof e.at !== 'string' || typeof e.timeZone !== 'string') return false;
  if (e.kind === 'game') {
    return typeof e.gameId === 'string' && Number.isFinite(e.opponentRating) && (e.score === 0 || e.score === 0.5 || e.score === 1);
  }
  if (e.kind === 'settings') {
    const s = e.settings;
    return (
      !!s &&
      Number.isFinite(s.hypotheticalOpponent) &&
      typeof s.floor1400 === 'boolean' &&
      (s.juniorBirthYear === null || Number.isInteger(s.juniorBirthYear))
    );
  }
  return false;
}

/** Validate a parsed backup file; throws with a message the UI can show. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a DITHER backup (not JSON).');
  }
  const b = raw as Backup;
  if (!b || b.format !== 'dither-backup') throw new Error('This file is not a DITHER backup.');
  if (b.version !== 1) throw new Error(`Backup version ${String(b.version)} is not supported.`);
  if (!Array.isArray(b.games) || !b.games.every(isGame)) throw new Error('The backup has damaged game records.');
  if (!Array.isArray(b.ledger) || !b.ledger.every(isLedgerEntry)) throw new Error('The backup has a damaged rating ledger.');
  const seqs = b.ledger.map((e) => e.seq);
  if (seqs.some((s, i) => i > 0 && s <= seqs[i - 1]!)) throw new Error('The rating ledger in the backup is out of order.');
  if (typeof b.settings !== 'object' || b.settings === null) throw new Error('The backup has no settings section.');
  return b;
}

export async function importBackup(storage: AppStorage, text: string): Promise<Backup> {
  const backup = parseBackup(text);
  await storage.replaceAll(backup);
  return backup;
}
