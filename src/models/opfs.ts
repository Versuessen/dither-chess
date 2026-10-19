/**
 * ModelStore on the Origin Private File System (web build). Layout under models/:
 *   <file>.dpk        a verified pack
 *   <file>.dpk.part   a download in progress (resumed with an HTTP Range request)
 *   index.json        the verified packs
 */
import { blobSource, type DpkSource } from './dpk';
import { hashBlob } from './hash';
import type { ManifestPack } from './manifest';
import type { ModelStore, Progress, StoredPack } from './store';

const INDEX = 'index.json';

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create: true });
}

async function fileOrNull(d: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await d.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

async function readIndex(d: FileSystemDirectoryHandle): Promise<StoredPack[]> {
  const f = await fileOrNull(d, INDEX);
  if (!f) return [];
  try {
    return JSON.parse(await f.text()) as StoredPack[];
  } catch {
    return [];
  }
}

async function writeIndex(d: FileSystemDirectoryHandle, packs: StoredPack[]): Promise<void> {
  const w = await (await d.getFileHandle(INDEX, { create: true })).createWritable();
  await w.write(JSON.stringify(packs, null, 1));
  await w.close();
}

async function removeEntry(d: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await d.removeEntry(name);
  } catch {
    /* already gone */
  }
}

export class OpfsStore implements ModelStore {
  readonly kind = 'opfs' as const;

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
  }

  async list(): Promise<StoredPack[]> {
    const d = await dir();
    const index = await readIndex(d);
    // Drop index rows whose file vanished (cleared site data, quota eviction).
    const present: StoredPack[] = [];
    for (const p of index) {
      const f = await fileOrNull(d, p.file);
      if (f && f.size === p.size) present.push(p);
    }
    if (present.length !== index.length) await writeIndex(d, present);
    return present;
  }

  async install(pack: ManifestPack, urls: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<StoredPack> {
    const d = await dir();
    const partName = `${pack.file}.part`;
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        await this.downloadTo(d, partName, url, pack.size, onProgress, signal);
        lastError = null;
        break;
      } catch (err) {
        if (signal.aborted) throw err;
        lastError = err;
      }
    }
    if (lastError) throw new Error(`Download failed from every source: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return this.finish(d, partName, pack, onProgress);
  }

  async importFile(file: File, pack: ManifestPack, onProgress: (p: Progress) => void): Promise<StoredPack> {
    if (file.size !== pack.size) throw new Error(`This file is ${file.size} bytes; ${pack.title} should be ${pack.size} bytes.`);
    const d = await dir();
    const partName = `${pack.file}.part`;
    const w = await (await d.getFileHandle(partName, { create: true })).createWritable();
    const step = 8 << 20;
    for (let o = 0; o < file.size; o += step) {
      await w.write(await file.slice(o, o + step).arrayBuffer());
      onProgress({ phase: 'import', done: Math.min(file.size, o + step), total: file.size });
    }
    await w.close();
    return this.finish(d, partName, pack, onProgress);
  }

  async verify(pack: ManifestPack, onProgress?: (p: Progress) => void): Promise<boolean> {
    const d = await dir();
    const f = await fileOrNull(d, pack.file);
    if (!f || f.size !== pack.size) return false;
    const hex = await hashBlob(f, (n) => onProgress?.({ phase: 'verify', done: n, total: f.size }));
    if (hex !== pack.sha256) return false;
    const index = await readIndex(d);
    const row = index.find((p) => p.id === pack.id);
    if (row) {
      row.verifiedAt = new Date().toISOString();
      await writeIndex(d, index);
    }
    return true;
  }

  async open(p: StoredPack): Promise<DpkSource> {
    const d = await dir();
    const f = await fileOrNull(d, p.file);
    if (!f) throw new Error(`${p.id} is not installed`);
    return blobSource(f);
  }

  async remove(id: string): Promise<void> {
    const d = await dir();
    const index = await readIndex(d);
    const row = index.find((p) => p.id === id);
    if (row) {
      await removeEntry(d, row.file);
      await removeEntry(d, `${row.file}.part`);
    }
    await writeIndex(
      d,
      index.filter((p) => p.id !== id)
    );
  }

  private async downloadTo(
    d: FileSystemDirectoryHandle,
    partName: string,
    url: string,
    total: number,
    onProgress: (p: Progress) => void,
    signal: AbortSignal
  ): Promise<void> {
    const existing = await fileOrNull(d, partName);
    let offset = existing && existing.size < total ? existing.size : 0;
    if (existing && existing.size >= total) await removeEntry(d, partName);
    const res = await fetch(url, {
      signal,
      headers: offset ? { Range: `bytes=${offset}-` } : {},
      cache: 'no-store'
    });
    if (res.status === 200) offset = 0; // no range support: start over
    else if (res.status !== 206) throw new Error(`${url}: HTTP ${res.status}`);
    if (!res.body) throw new Error(`${url}: empty response`);
    const handle = await d.getFileHandle(partName, { create: true });
    const w = await handle.createWritable({ keepExistingData: offset > 0 });
    try {
      if (offset > 0) await w.seek(offset);
      else await w.truncate(0);
      const reader = res.body.getReader();
      let done = offset;
      onProgress({ phase: 'download', done, total });
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        await w.write(chunk.value);
        done += chunk.value.length;
        onProgress({ phase: 'download', done, total });
      }
      if (done !== total) throw new Error(`${url}: got ${done} of ${total} bytes`);
    } finally {
      // Closing keeps what was written, so a broken connection resumes from here next time.
      await w.close();
    }
  }

  private async finish(d: FileSystemDirectoryHandle, partName: string, pack: ManifestPack, onProgress: (p: Progress) => void): Promise<StoredPack> {
    const part = await fileOrNull(d, partName);
    if (!part) throw new Error('downloaded file is missing');
    const hex = await hashBlob(part, (n) => onProgress({ phase: 'verify', done: n, total: part.size }));
    if (hex !== pack.sha256) {
      await removeEntry(d, partName);
      throw new Error(`Checksum mismatch for ${pack.title}: got ${hex.slice(0, 16)}…, expected ${pack.sha256.slice(0, 16)}…. The file was deleted.`);
    }
    // Move into place: OPFS has no rename across all browsers, so copy then delete.
    const handle = await d.getFileHandle(pack.file, { create: true });
    if ('move' in handle && typeof (handle as unknown as { move: unknown }).move === 'function') {
      await removeEntry(d, pack.file);
      const partHandle = await d.getFileHandle(partName);
      await (partHandle as unknown as { move: (name: string) => Promise<void> }).move(pack.file);
    } else {
      const w = await handle.createWritable();
      await w.write(part);
      await w.close();
      await removeEntry(d, partName);
    }
    const stored: StoredPack = {
      id: pack.id,
      version: pack.version,
      file: pack.file,
      sha256: pack.sha256,
      size: pack.size,
      verifiedAt: new Date().toISOString()
    };
    const index = (await readIndex(d)).filter((p) => p.id !== pack.id);
    index.push(stored);
    await writeIndex(d, index);
    return stored;
  }
}
