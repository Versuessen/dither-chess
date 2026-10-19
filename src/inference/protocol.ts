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
  family: 'fastelo' | 'maia3' | 'maia2';
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

/** One played move to score: the positions up to and including the one it was played in. */
export interface ScoredMove {
  fens: string[];
  move: string;
}

/** log p(move) of played moves under several rating inputs (fastelo Rater). */
export interface MoveLogpRequest {
  type: 'move-logp';
  packId: string;
  items: ScoredMove[];
  elos: number[];
}

export interface UnloadRequest {
  type: 'unload';
  packId: string;
}

export type WorkerRequest = InitRequest | LoadRequest | EvaluateRequest | MoveLogpRequest | UnloadRequest;

export interface InitResult {
  backend: Backend;
  threads: number;
  isolated: boolean;
}

export interface EvaluateResult {
  uci: string[];
  logits: Float32Array;
  wdl: WDL | null;
  inferenceMs: number;
}

export interface MoveLogpResult {
  /** Row-major [moves × elos]. */
  logp: Float64Array;
  inferenceMs: number;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
