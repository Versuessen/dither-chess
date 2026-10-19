/**
 * ModelStore on the desktop: the Rust side (src-tauri/src/models.rs) downloads with resume,
 * hashes and stores packs in the app data directory. This file only forwards calls.
 */
import { invoke, Channel } from '@tauri-apps/api/core';
import type { DpkSource } from './dpk';
import type { ManifestPack } from './manifest';
import type { ModelStore, Progress, StoredPack } from './store';

interface RustProgress {
  phase: 'download' | 'verify' | 'import';
  done: number;
  total: number;
}

export class TauriStore implements ModelStore {
  readonly kind = 'tauri' as const;

  list(): Promise<StoredPack[]> {
    return invoke<StoredPack[]>('models_list');
  }

  async install(pack: ManifestPack, urls: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<StoredPack> {
    const channel = new Channel<RustProgress>();
    channel.onmessage = (p) => onProgress(p);
    const onAbort = () => void invoke('models_cancel', { id: pack.id });
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await invoke<StoredPack>('models_install', {
        pack: { id: pack.id, version: pack.version, file: pack.file, sha256: pack.sha256, size: pack.size },
        urls,
        progress: channel
      });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async importFile(file: File, pack: ManifestPack, onProgress: (p: Progress) => void): Promise<StoredPack> {
    // The webview hands us a File; stream it to Rust in chunks so nothing large crosses IPC at once.
    if (file.size !== pack.size) throw new Error(`This file is ${file.size} bytes; ${pack.title} should be ${pack.size} bytes.`);
    await invoke('models_import_begin', { file: pack.file });
    const step = 8 << 20;
    for (let o = 0; o < file.size; o += step) {
      const bytes = new Uint8Array(await file.slice(o, o + step).arrayBuffer());
      await invoke('models_import_chunk', bytes, { headers: { 'x-file': pack.file } });
      onProgress({ phase: 'import', done: Math.min(file.size, o + step), total: file.size });
    }
    const channel = new Channel<RustProgress>();
    channel.onmessage = (p) => onProgress(p);
    return invoke<StoredPack>('models_import_finish', {
      pack: { id: pack.id, version: pack.version, file: pack.file, sha256: pack.sha256, size: pack.size },
      progress: channel
    });
  }

  verify(pack: ManifestPack, onProgress?: (p: Progress) => void): Promise<boolean> {
    const channel = new Channel<RustProgress>();
    channel.onmessage = (p) => onProgress?.(p);
    return invoke<boolean>('models_verify', { id: pack.id, sha256: pack.sha256, size: pack.size, progress: channel });
  }

  async open(p: StoredPack): Promise<DpkSource> {
    return {
      size: p.size,
      read: async (offset, length) => {
        const buf = await invoke<ArrayBuffer>('models_read', { file: p.file, offset, length });
        return new Uint8Array(buf);
      }
    };
  }

  remove(id: string): Promise<void> {
    return invoke('models_remove', { id });
  }
}
