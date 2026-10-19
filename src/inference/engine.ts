/**
 * The inference engine proper: ONNX sessions plus the model encoders. Runs inside the worker
 * in the app, and directly in Node for the golden tests, so both use the same code path.
 */
import type * as Ort from 'onnxruntime-web';
import { encoderFor, type Encoder, type Feeds, type WDL } from './encoders';
import { logSoftmax } from './position';
import type { Backend, EvaluateResult, MoveLogpResult, ScoredMove } from './protocol';

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

  async load(packId: string, family: 'fastelo' | 'maia3' | 'maia2', model: Uint8Array, vocab: string[], preferWebGpu: boolean): Promise<void> {
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
    const encoder = encoderFor(family);
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

  /**
   * log p(move | position, rating) over the legal moves, for every scored move and every rating
   * input (own = opponent input, as fastelo's Rater): a row-major [moves × elos] matrix. Rows are
   * batched up to the export's batch limit of 64.
   */
  async moveLogp(packId: string, items: readonly ScoredMove[], elos: readonly number[]): Promise<MoveLogpResult> {
    const s = this.get(packId);
    const E = elos.length;
    const out = new Float64Array(items.length * E);
    const rows: { item: number; elo: number; index: number[]; k: number; feeds: Feeds }[] = [];
    items.forEach((it, i) => {
      const fen = it.fens[it.fens.length - 1]!;
      const { uci, index } = s.encoder.legal(fen, s.vocab);
      const k = uci.indexOf(it.move);
      if (k < 0) throw new Error(`${it.move} is not legal in ${fen}`);
      elos.forEach((e, j) => rows.push({ item: i, elo: j, index, k, feeds: s.encoder.encode({ fens: it.fens, eloSelf: e, eloOppo: e }) }));
    });
    const t0 = performance.now();
    const per = Math.max(1, Math.floor(64 / E) * E);
    for (let a = 0; a < rows.length; a += per) {
      const chunk = rows.slice(a, a + per);
      const { policy } = await this.runFeeds(packId, stackFeeds(chunk.map((r) => r.feeds)));
      const width = policy.length / chunk.length;
      chunk.forEach((r, b) => {
        const legal = r.index.map((vi) => policy[b * width + vi]!);
        out[r.item * E + r.elo] = logSoftmax(legal)[r.k]!;
      });
    }
    return { logp: out, inferenceMs: performance.now() - t0 };
  }
}

/** Concatenate single-position feeds along the batch dimension. */
export function stackFeeds(list: readonly Feeds[]): Feeds {
  if (list.length === 1) return list[0]!;
  const out: Feeds = {};
  for (const name of Object.keys(list[0]!)) {
    const first = list[0]![name]!;
    const n = first.data.length;
    const data = first.data instanceof BigInt64Array ? new BigInt64Array(n * list.length) : new Float32Array(n * list.length);
    list.forEach((f, i) => (data as Float32Array).set(f[name]!.data as Float32Array, i * n));
    out[name] = { type: first.type, dims: [first.dims[0]! * list.length, ...first.dims.slice(1)], data };
  }
  return out;
}
