/** Main-thread handle on the inference worker. */
import wasmGpuUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { isCrossOriginIsolated } from '../app/platform';
import type { EvaluateResult, InitResult, MoveLogpResult, ScoredMove, WorkerRequest, WorkerResponse } from './protocol';

class InferenceClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initResult: Promise<InitResult> | null = null;
  private loaded = new Set<string>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dither-inference' });
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || 'inference worker crashed'));
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private call<T>(req: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    const w = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, req }, transfer);
    });
  }

  /** Start the worker. Threads only when SharedArrayBuffer is available. */
  init(preferWebGpu = true): Promise<InitResult> {
    const isolated = isCrossOriginIsolated();
    const threads = isolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    this.initResult ??= this.call<InitResult>({ type: 'init', wasmUrl, wasmGpuUrl, threads, preferWebGpu });
    return this.initResult;
  }

  isLoaded(packId: string): boolean {
    return this.loaded.has(packId);
  }

  async load(packId: string, family: 'fastelo' | 'maia3' | 'maia2', model: Uint8Array, vocab: string[]): Promise<void> {
    await this.init();
    // Copy into a transferable buffer of exactly the model's size.
    const buf = model.byteOffset === 0 && model.byteLength === model.buffer.byteLength ? (model.buffer as ArrayBuffer) : model.slice().buffer;
    await this.call({ type: 'load', packId, family, model: buf, vocab }, [buf]);
    this.loaded.add(packId);
  }

  evaluate(packId: string, fens: string[], eloSelf: number, eloOppo: number): Promise<EvaluateResult> {
    return this.call<EvaluateResult>({ type: 'evaluate', packId, fens, eloSelf, eloOppo });
  }

  moveLogp(packId: string, items: ScoredMove[], elos: number[]): Promise<MoveLogpResult> {
    return this.call<MoveLogpResult>({ type: 'move-logp', packId, items, elos });
  }

  async unload(packId: string): Promise<void> {
    if (!this.loaded.has(packId)) return;
    await this.call({ type: 'unload', packId });
    this.loaded.delete(packId);
  }
}

export const inference = new InferenceClient();
