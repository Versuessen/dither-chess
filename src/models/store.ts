/**
 * Where verified model packs live: OPFS in the browser, the app data directory on the desktop
 * (handled by the Rust side, see src-tauri/src/models.rs). Both expose the same interface.
 */
import type { ManifestPack } from './manifest';
import type { DpkSource } from './dpk';

export interface StoredPack {
  id: string;
  version: string;
  file: string;
  sha256: string;
  size: number;
  /** ISO time of the last full checksum verification. */
  verifiedAt: string;
}

export interface Progress {
  phase: 'download' | 'verify' | 'import';
  done: number;
  total: number;
}

export interface ModelStore {
  readonly kind: 'opfs' | 'tauri' | 'memory';
  list(): Promise<StoredPack[]>;
  /** Download (resuming a partial file), verify and record. Rejects on checksum mismatch. */
  install(pack: ManifestPack, urls: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<StoredPack>;
  /** Copy a pack file the user picked, then verify it like a download. */
  importFile(file: File, pack: ManifestPack, onProgress: (p: Progress) => void): Promise<StoredPack>;
  /** Re-hash the stored file; true when it still matches. */
  verify(pack: ManifestPack, onProgress?: (p: Progress) => void): Promise<boolean>;
  /** Random access to the stored pack, for reading its files. */
  open(pack: StoredPack): Promise<DpkSource>;
  remove(id: string): Promise<void>;
}
