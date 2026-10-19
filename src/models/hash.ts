/** SHA-256 of a Blob, in a worker when available. */
import { sha256Blob } from './sha256';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (hex: string) => void; reject: (e: Error) => void; progress?: (n: number) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./hashWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; hex?: string; progress?: number; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.progress !== undefined) p.progress?.(e.data.progress);
      else if (e.data.hex) {
        pending.delete(e.data.id);
        p.resolve(e.data.hex);
      } else {
        pending.delete(e.data.id);
        p.reject(new Error(e.data.error ?? 'hashing failed'));
      }
    };
  }
  return worker;
}

export function hashBlob(blob: Blob, progress?: (done: number) => void): Promise<string> {
  const w = getWorker();
  if (!w) return sha256Blob(blob, progress);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    w.postMessage({ id, blob });
  });
}
