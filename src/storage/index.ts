/** The app's storage backend, chosen once per run. */
import { platform } from '../app/platform';
import { IndexedDbStorage } from './indexeddb';
import { MemoryStorage } from './memory';
import type { AppStorage } from './types';

let instance: AppStorage | null = null;
let ready: Promise<AppStorage> | null = null;

async function create(): Promise<AppStorage> {
  if (platform() === 'tauri') {
    // A database that cannot be opened (disk full, locked, corrupt) must not take the whole app
    // down: the session runs in memory and Settings and History say so.
    try {
      const { SqliteStorage } = await import('./sqlite');
      const s = new SqliteStorage();
      await s.init();
      return s;
    } catch (err) {
      console.error('SQLite unavailable, keeping data in memory for this session:', err);
      return new MemoryStorage();
    }
  }
  if (typeof indexedDB !== 'undefined') {
    try {
      const s = new IndexedDbStorage();
      await s.init();
      return s;
    } catch (err) {
      console.warn('IndexedDB unavailable, keeping data in memory for this session:', err);
    }
  }
  return new MemoryStorage();
}

export function openStorage(): Promise<AppStorage> {
  ready ??= create().then((s) => (instance = s));
  return ready;
}

/** The storage once boot has opened it. */
export function storage(): AppStorage {
  if (!instance) throw new Error('storage used before boot opened it');
  return instance;
}

export type { AppStorage, Backup, LedgerEntry, StoredGame } from './types';
