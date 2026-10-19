/** Messages between the app and the inference worker. */
import type { WDL } from './encoders';

export type Backend = 'webgpu' | 'wasm';

export interface InitRequest {
  type: 'init';
  /** Plain WASM build, and the build with the WebGPU execution provider (asyncify). */
  wasmUrl: string;
  wasmGpuUrl: string;
  /** WASM threads; 1 when the page is not cross-origin isolated. */
  threads: number;
  preferWebGpu: boolean;
}

export interface LoadRequest {
  type: 'load';
  packId: string;
  model: ArrayBuffer;
  vocab: string[];
}

export interface EvaluateRequest {
  type: 'evaluate';
  packId: string;
  fens: string[];
  eloSelf: number;
  eloOppo: number;
}

export interface UnloadRequest {
  type: 'unload';
  packId: string;
}

export type WorkerRequest = InitRequest | LoadRequest | EvaluateRequest | UnloadRequest;

export interface InitResult {
  backend: Backend;
  threads: number;
  isolated: boolean;
  /** Why inference runs on one thread although the page could have more (see client.ts). */
  singleThreadReason?: string;
}

export interface EvaluateResult {
  uci: string[];
  logits: Float32Array;
  wdl: WDL | null;
  inferenceMs: number;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  /** Something failed outside any request (a WebAssembly thread worker, say): the worker is unusable. */
  | { crash: string };
