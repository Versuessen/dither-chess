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
      ort.env.wasm.numThreads = req.threads;
      ort.env.wasm.simd = true;
      ort.env.logLevel = 'error';
      engine = new Engine(ort);
      const result: InitResult = {
        backend: preferWebGpu ? 'webgpu' : 'wasm',
        threads: req.threads,
        isolated: self.crossOriginIsolated === true
      };
      return result;
    }
    case 'load':
      await need().load(req.packId, req.family, new Uint8Array(req.model), req.vocab, preferWebGpu);
      return { backend: need().backend };
    case 'evaluate':
      return need().evaluate(req.packId, req.fens, req.eloSelf, req.eloOppo);
    case 'move-logp':
      return need().moveLogp(req.packId, req.items, req.elos);
    case 'unload':
      await need().unload(req.packId);
      return null;
  }
}

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
