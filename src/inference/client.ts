/** Main-thread handle on the inference worker. */
import wasmGpuUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { isCrossOriginIsolated } from '../app/platform';
import type { EvaluateResult, InitResult, WorkerRequest, WorkerResponse } from './protocol';

/** The worker became unusable (not a failed request): it is replaced on the next call. */
class InferenceCrash extends Error {}

class InferenceClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initResult: Promise<InitResult> | null = null;
  private loaded = new Set<string>();
  /** Set once multi-threaded inference failed on this device: from then on, one thread. */
  private singleThreadReason: string | null = null;
  /** Counts worker replacements; models loaded into an earlier worker are gone. */
  generation = 0;

  private ensureWorker(): Worker {
    if (!this.worker) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dither-inference' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const d = e.data;
        if ('crash' in d) return this.discard(w, d.crash);
        const p = this.pending.get(d.id);
        if (!p) return;
        this.pending.delete(d.id);
        if (d.ok) p.resolve(d.result);
        else p.reject(new Error(d.error));
      };
      w.onerror = (e) => this.discard(w, e.message || 'the inference worker crashed');
      this.worker = w;
    }
    return this.worker;
  }

  /** Drop an unusable worker: everything waiting on it fails, the next call starts a new one. */
  private discard(w: Worker, reason: string): void {
    if (this.worker !== w) return;
    w.terminate();
    this.worker = null;
    this.initResult = null;
    this.loaded.clear();
    this.generation++;
    for (const p of this.pending.values()) p.reject(new InferenceCrash(reason));
    this.pending.clear();
  }

  private call<T>(req: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    const w = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, req }, transfer);
    });
  }

  /** Start the worker. Threads only when SharedArrayBuffer is available and threads worked. */
  init(preferWebGpu = true): Promise<InitResult> {
    const isolated = isCrossOriginIsolated();
    const threads = isolated && !this.singleThreadReason ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    const reason = this.singleThreadReason;
    // The worker may still decide on one thread (worker.ts, threadProblem) and says why.
    this.initResult ??= this.call<InitResult>({ type: 'init', wasmUrl, wasmGpuUrl, threads, preferWebGpu }).then((r) =>
      reason ? { ...r, singleThreadReason: reason } : r
    );
    return this.initResult;
  }

  isLoaded(packId: string): boolean {
    return this.loaded.has(packId);
  }

  async load(packId: string, model: Uint8Array, vocab: string[]): Promise<void> {
    const init = await this.init();
    try {
      await this.loadOnce(packId, model, vocab);
    } catch (err) {
      // onnxruntime-web runs WebAssembly threads in workers it starts itself. The worker checks
      // that such workers can start before asking for threads (worker.ts, threadProblem); if a
      // threaded load still takes the worker down, start over on one thread, as on pages that
      // are not cross-origin isolated, and keep to it for this session.
      if (!(err instanceof InferenceCrash) || init.threads <= 1) throw err;
      this.singleThreadReason = err.message;
      console.warn(`Inference continues on one thread: ${err.message}`);
      await this.init();
      await this.loadOnce(packId, model, vocab);
    }
  }

  private async loadOnce(packId: string, model: Uint8Array, vocab: string[]): Promise<void> {
    // A copy goes to the worker (transferred), so the bytes stay here for a retry.
    const buf = model.slice().buffer;
    await this.call({ type: 'load', packId, model: buf, vocab }, [buf]);
    this.loaded.add(packId);
  }

  evaluate(packId: string, fens: string[], eloSelf: number, eloOppo: number): Promise<EvaluateResult> {
    return this.call<EvaluateResult>({ type: 'evaluate', packId, fens, eloSelf, eloOppo });
  }


  async unload(packId: string): Promise<void> {
    if (!this.loaded.has(packId)) return;
    await this.call({ type: 'unload', packId });
    this.loaded.delete(packId);
  }
}

export const inference = new InferenceClient();
