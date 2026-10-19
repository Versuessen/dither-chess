/// <reference lib="webworker" />
/** Hashes a File or Blob off the main thread; posts progress and the final hex digest. */
import { Sha256 } from './sha256';

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  try {
    const h = new Sha256();
    const step = 8 << 20;
    for (let o = 0; o < blob.size; o += step) {
      h.update(new Uint8Array(await blob.slice(o, o + step).arrayBuffer()));
      (self as unknown as Worker).postMessage({ id, progress: Math.min(blob.size, o + step) });
    }
    (self as unknown as Worker).postMessage({ id, hex: h.hex() });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
