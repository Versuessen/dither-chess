/// <reference lib="webworker" />
/**
 * Dedicated inference worker. onnxruntime-web runs here with WASM SIMD (+ threads when the
 * page is cross-origin isolated) and WebGPU when available, falling back silently.
 */
import type * as Ort from 'onnxruntime-web';
import { Engine } from './engine';
import type { InitResult, WorkerRequest, WorkerResponse } from './protocol';

// The WebGPU build (onnxruntime-web 1.30: the native WebGPU execution provider on an asyncify
// WASM) is only loaded when the device has a WebGPU adapter; otherwise the plain WASM build runs,
// which is half the size and has no GPU code paths to fail.
let ort: typeof Ort | null = null;
let engine: Engine | null = null;
let preferWebGpu = false;

/**
 * onnxruntime-web's WebAssembly threads are workers it starts from this worker. Where such a
 * worker cannot start (seen in WebView2 under the desktop app's own protocol on Windows), asking
 * for threads freezes the first model load: this worker blocks waiting for threads that never come,
 * so it never hears that they failed. So check first, with a worker started the same way.
 * Returns why threads cannot be used here, or null.
 */
function threadProblem(timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    let probe: Worker;
    try {
      probe = new Worker(new URL('./threadProbe.ts', import.meta.url), { type: 'module', name: 'dither-thread-probe' });
    } catch (err) {
      resolve(`a worker for WebAssembly threads cannot be created here (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    const done = (problem: string | null) => {
      clearTimeout(timer);
      probe.terminate();
      resolve(problem);
    };
    const timer = setTimeout(() => done('a worker for WebAssembly threads did not start within 10 s'), timeoutMs);
    probe.onmessage = (e: MessageEvent<{ sharedMemory: boolean }>) =>
      done(e.data.sharedMemory ? null : 'a worker for WebAssembly threads cannot share memory here');
    probe.onerror = (e) => {
      e.preventDefault();
      done(`a WebAssembly thread worker could not start${e.message ? `: ${e.message}` : ''}`);
    };
  });
}

function need(): Engine {
  if (!engine) throw new Error('inference worker not initialised');
  return engine;
}

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.type) {
    case 'init': {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      preferWebGpu = false;
      if (req.preferWebGpu && gpu) {
        try {
          preferWebGpu = !!(await gpu.requestAdapter());
        } catch {
          preferWebGpu = false;
        }
      }
      ort = preferWebGpu ? ((await import('onnxruntime-web/webgpu')) as typeof Ort) : await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = { wasm: preferWebGpu ? req.wasmGpuUrl : req.wasmUrl };
      const problem = req.threads > 1 ? await threadProblem() : null;
      const threads = problem ? 1 : req.threads;
      ort.env.wasm.numThreads = threads;
      ort.env.wasm.simd = true;
      ort.env.logLevel = 'error';
      engine = new Engine(ort);
      const result: InitResult = {
        backend: preferWebGpu ? 'webgpu' : 'wasm',
        threads,
        isolated: self.crossOriginIsolated === true,
        ...(problem ? { singleThreadReason: problem } : {})
      };
      return result;
    }
    case 'load':
      await need().load(req.packId, new Uint8Array(req.model), req.vocab, preferWebGpu);
      return { backend: need().backend };
    case 'evaluate':
      return need().evaluate(req.packId, req.fens, req.eloSelf, req.eloOppo);
    case 'unload':
      await need().unload(req.packId);
      return null;
  }
}

/**
 * Errors outside any request. onnxruntime-web's WebAssembly threads are workers it starts itself;
 * when one cannot start, Emscripten rethrows the bare error event, which would reach the app as
 * "Uncaught [object Event]". Describe it instead, and tell the app this worker is unusable.
 */
function describe(v: unknown): string {
  if (v instanceof Error) return v.message;
  if (typeof Event !== 'undefined' && v instanceof Event) {
    // The only workers started from here are onnxruntime-web's WebAssembly threads.
    const nested = typeof Worker !== 'undefined' && v.target instanceof Worker;
    const what = nested ? 'a WebAssembly thread worker' : `${v.target?.constructor?.name ?? 'an object'}`;
    const detail = v instanceof ErrorEvent && v.message ? `: ${v.message}` : ' (it could not start)';
    return `${what} reported an ${v.type} event${detail}`;
  }
  return String(v);
}

self.addEventListener('error', (e: ErrorEvent) => {
  e.preventDefault();
  (self as unknown as Worker).postMessage({ crash: describe(e.error ?? e.message) } satisfies WorkerResponse);
});
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  e.preventDefault();
  (self as unknown as Worker).postMessage({ crash: describe(e.reason) } satisfies WorkerResponse);
});

self.onmessage = async (e: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = e.data;
  try {
    const result = await handle(req);
    const transfer: Transferable[] = [];
    if (result && typeof result === 'object' && 'logits' in result) transfer.push((result as { logits: Float32Array }).logits.buffer);
    if (result && typeof result === 'object' && 'logp' in result) transfer.push((result as { logp: Float64Array }).logp.buffer);
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies WorkerResponse, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
