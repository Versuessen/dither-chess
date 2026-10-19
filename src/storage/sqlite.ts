/**
 * AppStorage on SQLite through tauri-plugin-sql (desktop build). The database lives in the
 * app data directory; the schema mirrors the IndexedDB stores, one JSON column per record.
 */
import Database from '@tauri-apps/plugin-sql';
import type { AppStorage, Backup, LedgerEntry, LedgerEntryInput, StoredGame } from './types';

const URL = 'sqlite:dither.db';

export class SqliteStorage implements AppStorage {
  readonly kind = 'sqlite' as const;
  private db: Database | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await Database.load(URL);
    await this.db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    await this.db.execute(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, json TEXT NOT NULL)`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS games_started ON games(started_at)`);
    await this.db.execute(`CREATE TABLE IF NOT EXISTS ledger (seq INTEGER PRIMARY KEY, json TEXT NOT NULL)`);
    // Append-only: refuse updates and deletes of ledger rows at the database level.
    await this.db.execute(`CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
      BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END`);
    await this.db.execute(`CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
      WHEN (SELECT value FROM meta WHERE key = 'restoring') IS NOT '1'
      BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END`);
    await this.db.execute(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL)`);
  }

  private get conn(): Database {
    if (!this.db) throw new Error('storage not initialised');
    return this.db;
  }

  async putGame(game: StoredGame): Promise<void> {
    await this.conn.execute(
      `INSERT INTO games (id, started_at, json) VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, json = excluded.json`,
      [game.id, game.startedAt, JSON.stringify(game)]
    );
  }

  async getGame(id: string): Promise<StoredGame | undefined> {
    const rows = await this.conn.select<{ json: string }[]>('SELECT json FROM games WHERE id = $1', [id]);
    return rows[0] ? (JSON.parse(rows[0].json) as StoredGame) : undefined;
  }

  async listGames(): Promise<StoredGame[]> {
    const rows = await this.conn.select<{ json: string }[]>('SELECT json FROM games ORDER BY started_at DESC');
    return rows.map((r) => JSON.parse(r.json) as StoredGame);
  }

  async appendLedger(entry: LedgerEntryInput): Promise<number> {
    const rows = await this.conn.select<{ next: number }[]>('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ledger');
    const seq = rows[0]!.next;
    await this.conn.execute('INSERT INTO ledger (seq, json) VALUES ($1, $2)', [seq, JSON.stringify({ ...entry, seq })]);
    return seq;
  }

  async listLedger(): Promise<LedgerEntry[]> {
    const rows = await this.conn.select<{ json: string }[]>('SELECT json FROM ledger ORDER BY seq ASC');
    return rows.map((r) => JSON.parse(r.json) as LedgerEntry);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const rows = await this.conn.select<{ json: string }[]>('SELECT json FROM settings WHERE key = $1', [key]);
    return rows[0] ? (JSON.parse(rows[0].json) as T) : undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.conn.execute(
      `INSERT INTO settings (key, json) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET json = excluded.json`,
      [key, JSON.stringify(value)]
    );
  }

  async allSettings(): Promise<Record<string, unknown>> {
    const rows = await this.conn.select<{ key: string; json: string }[]>('SELECT key, json FROM settings');
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.json)]));
  }

  async replaceAll(backup: Backup): Promise<void> {
    const db = this.conn;
    await db.execute('BEGIN');
    try {
      await db.execute(`INSERT INTO meta (key, value) VALUES ('restoring', '1')
        ON CONFLICT(key) DO UPDATE SET value = '1'`);
      await db.execute('DELETE FROM games');
      await db.execute('DELETE FROM ledger');
      await db.execute('DELETE FROM settings');
      for (const g of backup.games) {
        await db.execute('INSERT INTO games (id, started_at, json) VALUES ($1, $2, $3)', [g.id, g.startedAt, JSON.stringify(g)]);
      }
      for (const e of backup.ledger) {
        await db.execute('INSERT INTO ledger (seq, json) VALUES ($1, $2)', [e.seq, JSON.stringify(e)]);
      }
      for (const [k, v] of Object.entries(backup.settings)) {
        await db.execute('INSERT INTO settings (key, json) VALUES ($1, $2)', [k, JSON.stringify(v)]);
      }
      await db.execute(`UPDATE meta SET value = '0' WHERE key = 'restoring'`);
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
  }
}
