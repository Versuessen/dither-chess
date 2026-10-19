/**
 * The inference engine proper: ONNX sessions plus the model encoders. Runs inside the worker
 * in the app, and directly in Node for the golden tests, so both use the same code path.
 */
import type * as Ort from 'onnxruntime-web';
import { maia3Encoder, type Encoder, type Feeds, type WDL } from './encoders';
import type { Backend, EvaluateResult } from './protocol';

const WARMUP_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface Loaded {
  session: Ort.InferenceSession;
  encoder: Encoder;
  vocab: Map<string, number>;
}

export class Engine {
  private sessions = new Map<string, Loaded>();
  backend: Backend = 'wasm';

  constructor(private readonly ort: typeof Ort) {}

  async load(packId: string, model: Uint8Array, vocab: string[], preferWebGpu: boolean): Promise<void> {
    const old = this.sessions.get(packId);
    if (old) await old.session.release();
    let session: Ort.InferenceSession;
    const base: Ort.InferenceSession.SessionOptions = { graphOptimizationLevel: 'all', executionMode: 'sequential' };
    if (preferWebGpu) {
      try {
        session = await this.ort.InferenceSession.create(model, { ...base, executionProviders: ['webgpu', 'wasm'] });
        this.backend = 'webgpu';
      } catch {
        session = await this.ort.InferenceSession.create(model, { ...base, executionProviders: ['wasm'] });
        this.backend = 'wasm';
      }
    } else {
      session = await this.ort.InferenceSession.create(model, { ...base, executionProviders: ['wasm'] });
      this.backend = 'wasm';
    }
    const encoder = maia3Encoder;
    this.sessions.set(packId, { session, encoder, vocab: new Map(vocab.map((m, i) => [m, i])) });
    // The first run of a session allocates its buffers and is several times slower than the rest
    // (measured: 300–760 ms against a 130 ms median). Pay that here, behind the preloader or the
    // game's loading state, not on the bot's first move.
    await this.runFeeds(packId, encoder.encode({ fens: [WARMUP_FEN], eloSelf: 1500, eloOppo: 1500 }));
  }

  async unload(packId: string): Promise<void> {
    const s = this.sessions.get(packId);
    if (s) {
      await s.session.release();
      this.sessions.delete(packId);
    }
  }

  private get(packId: string): Loaded {
    const s = this.sessions.get(packId);
    if (!s) throw new Error(`model ${packId} is not loaded`);
    return s;
  }

  private tensors(feeds: Feeds): Record<string, Ort.Tensor> {
    const out: Record<string, Ort.Tensor> = {};
    for (const [k, f] of Object.entries(feeds)) out[k] = new this.ort.Tensor(f.type, f.data, f.dims);
    return out;
  }

  /** Raw outputs for already-encoded feeds (golden tests use this). */
  async runFeeds(packId: string, feeds: Feeds): Promise<{ policy: Float32Array; value: Float32Array }> {
    const s = this.get(packId);
    const out = await s.session.run(this.tensors(feeds), [s.encoder.policyOutput, s.encoder.valueOutput]);
    return {
      policy: out[s.encoder.policyOutput]!.data as Float32Array,
      value: out[s.encoder.valueOutput]!.data as Float32Array
    };
  }

  async evaluate(packId: string, fens: string[], eloSelf: number, eloOppo: number): Promise<EvaluateResult> {
    const s = this.get(packId);
    const fen = fens[fens.length - 1]!;
    const { uci, index } = s.encoder.legal(fen, s.vocab);
    const t0 = performance.now();
    const { policy, value } = await this.runFeeds(packId, s.encoder.encode({ fens, eloSelf, eloOppo }));
    const inferenceMs = performance.now() - t0;
    const logits = new Float32Array(index.length);
    index.forEach((vi, i) => (logits[i] = policy[vi]!));
    const wdl: WDL | null = value && value.length ? s.encoder.wdl(value) : null;
    return { uci, logits, wdl, inferenceMs };
  }
}
