/** AppStorage kept in memory: used when neither IndexedDB nor SQLite is available. */
import type { AppStorage, Backup, LedgerEntry, LedgerEntryInput, StoredGame } from './types';

/** Records are JSON by contract; a JSON round trip also unwraps reactive proxies. */
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export class MemoryStorage implements AppStorage {
  readonly kind = 'memory' as const;
  private games = new Map<string, StoredGame>();
  private ledger: LedgerEntry[] = [];
  private settings = new Map<string, unknown>();

  async init(): Promise<void> {}

  async putGame(game: StoredGame): Promise<void> {
    this.games.set(game.id, clone(game));
  }
  async getGame(id: string): Promise<StoredGame | undefined> {
    const g = this.games.get(id);
    return g && clone(g);
  }
  async listGames(): Promise<StoredGame[]> {
    return [...this.games.values()].map((g) => clone(g)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async appendLedger(entry: LedgerEntryInput): Promise<number> {
    const seq = (this.ledger.at(-1)?.seq ?? 0) + 1;
    this.ledger.push({ ...clone(entry), seq } as LedgerEntry);
    return seq;
  }
  async listLedger(): Promise<LedgerEntry[]> {
    return clone(this.ledger);
  }
  async getSetting<T>(key: string): Promise<T | undefined> {
    return clone(this.settings.get(key)) as T | undefined;
  }
  async setSetting<T>(key: string, value: T): Promise<void> {
    this.settings.set(key, clone(value));
  }
  async allSettings(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.settings);
  }
  async replaceAll(backup: Backup): Promise<void> {
    this.games = new Map(backup.games.map((g) => [g.id, clone(g)]));
    this.ledger = clone(backup.ledger);
    this.settings = new Map(Object.entries(clone(backup.settings)));
  }
}
