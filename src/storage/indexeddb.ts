/** AppStorage on IndexedDB (web build). */
import type { AppStorage, Backup, LedgerEntry, StoredGame } from './types';

/** Records are JSON by contract; a JSON round trip also unwraps reactive proxies. */
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const DB_NAME = 'dither';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export class IndexedDbStorage implements AppStorage {
  readonly kind = 'indexeddb' as const;
  private db: IDBDatabase | null = null;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly name = DB_NAME
  ) {}

  async init(): Promise<void> {
    if (this.db) return;
    const open = this.factory.open(this.name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('games')) {
        const games = db.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('ledger')) db.createObjectStore('ledger', { keyPath: 'seq' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    this.db = await req(open);
  }

  private store(name: 'games' | 'ledger' | 'settings', mode: IDBTransactionMode) {
    if (!this.db) throw new Error('storage not initialised');
    const tx = this.db.transaction(name, mode);
    return { tx, store: tx.objectStore(name) };
  }

  async putGame(game: StoredGame): Promise<void> {
    const { tx, store } = this.store('games', 'readwrite');
    store.put(clone(game));
    await done(tx);
  }

  async getGame(id: string): Promise<StoredGame | undefined> {
    const { store } = this.store('games', 'readonly');
    return (await req(store.get(id))) as StoredGame | undefined;
  }

  async listGames(): Promise<StoredGame[]> {
    const { store } = this.store('games', 'readonly');
    const all = (await req(store.getAll())) as StoredGame[];
    return all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  }

  async appendLedger(entry: Omit<LedgerEntry, 'seq'>): Promise<number> {
    const { tx, store } = this.store('ledger', 'readwrite');
    // Sequence = last key + 1, inside the same transaction so concurrent appends cannot collide.
    const cursor = await req(store.openCursor(null, 'prev'));
    const seq = cursor ? Number(cursor.key) + 1 : 1;
    store.add({ ...clone(entry), seq });
    await done(tx);
    return seq;
  }

  async listLedger(): Promise<LedgerEntry[]> {
    const { store } = this.store('ledger', 'readonly');
    return (await req(store.getAll())) as LedgerEntry[];
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const { store } = this.store('settings', 'readonly');
    return (await req(store.get(key))) as T | undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const { tx, store } = this.store('settings', 'readwrite');
    store.put(clone(value), key);
    await done(tx);
  }

  async allSettings(): Promise<Record<string, unknown>> {
    const { store } = this.store('settings', 'readonly');
    const keys = (await req(store.getAllKeys())) as string[];
    const values = await req(store.getAll());
    return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  }

  async replaceAll(backup: Backup): Promise<void> {
    if (!this.db) throw new Error('storage not initialised');
    const tx = this.db.transaction(['games', 'ledger', 'settings'], 'readwrite');
    const games = tx.objectStore('games');
    const ledger = tx.objectStore('ledger');
    const settings = tx.objectStore('settings');
    games.clear();
    ledger.clear();
    settings.clear();
    for (const g of backup.games) games.put(g);
    for (const e of backup.ledger) ledger.put(e);
    for (const [k, v] of Object.entries(backup.settings)) settings.put(v, k);
    await done(tx);
  }
}
