/**
 * Golden tests: the TypeScript Maia-3 encoder and the onnxruntime-web runtime against the published
 * Python reference code (fixtures written by `dither-models parity`).
 *
 * Encodings must match exactly. When the ONNX files are present (tools/models/work/onnx, or
 * DITHER_MODEL_DIR) the models are also run through onnxruntime-web and the legal-move logits
 * must match the Python reference within 1e-3 with the same top move. CI sets
 * DITHER_REQUIRE_MODELS=1 so a missing model fails instead of skipping.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { maia3Encoder } from '../../src/inference/encoders';
import { Engine } from '../../src/inference/engine';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GOLDEN = join(ROOT, 'tests/golden');
const MODEL_DIR = process.env.DITHER_MODEL_DIR ?? join(ROOT, 'tools/models/work/onnx');
const REQUIRE = process.env.DITHER_REQUIRE_MODELS === '1';

interface Case {
  fen: string;
  moves: string[];
  level: number;
  encoded: Record<string, unknown>;
  legal: number[];
  logits: number[];
  value: number[];
  top1: number;
}

/** Both Maia-3 sizes share the encoding; the app ships 23M, and 5M's fixtures still check the port. */
const MODELS: { file: string; vocab: string }[] = [
  { file: 'maia3-5m', vocab: 'maia3.vocab.json' },
  { file: 'maia3-23m', vocab: 'maia3.vocab.json' }
];

function fensOf(c: Case): string[] {
  const chess = new Chess(c.fen);
  const fens = [chess.fen()];
  for (const m of c.moves) {
    chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    fens.push(chess.fen());
  }
  return fens;
}

const vocabs = new Map<string, Map<string, number>>();
function vocabFor(name: string): Map<string, number> | null {
  if (vocabs.has(name)) return vocabs.get(name)!;
  const p = join(MODEL_DIR, name);
  if (!existsSync(p)) return null;
  const v = new Map((JSON.parse(readFileSync(p, 'utf8')) as string[]).map((m, i) => [m, i] as [string, number]));
  vocabs.set(name, v);
  return v;
}

for (const m of MODELS) {
  const path = join(GOLDEN, `${m.file}.json`);
  if (!existsSync(path)) continue;
  const golden = JSON.parse(readFileSync(path, 'utf8')) as { cases: Case[] };
  const enc = maia3Encoder;

  describe(`${m.file} encoding`, () => {
    it(`matches the Python reference on ${golden.cases.length} positions`, () => {
      for (const c of golden.cases) {
        const fens = fensOf(c);
        {
          const e = c.encoded as { ones: number[]; self_elo: number; oppo_elo: number };
          const feeds = enc.encode({ fens, eloSelf: c.level, eloOppo: c.level });
          const data = feeds.tokens!.data as Float32Array;
          const ones: number[] = [];
          data.forEach((v, i) => v > 0.5 && ones.push(i));
          expect(ones, `${c.fen} ${c.moves.join(' ')}`).toEqual(e.ones);
          expect(Number((feeds.self_elo!.data as BigInt64Array)[0])).toBe(e.self_elo);
        }
        const vocab = vocabFor(m.vocab);
        if (vocab) {
          const legal = enc.legal(fens.at(-1)!, vocab).index.slice().sort((a, b) => a - b);
          expect(legal).toEqual([...c.legal].sort((a, b) => a - b));
        }
      }
    });
  });

  const onnxPath = join(MODEL_DIR, `${m.file}.onnx`);
  const have = existsSync(onnxPath);
  if (!have && REQUIRE) {
    it(`${m.file}.onnx is present`, () => expect(have).toBe(true));
  }
  describe.skipIf(!have)(`${m.file} via onnxruntime-web`, () => {
    it('reproduces the reference logits within 1e-3 and the same top move', async () => {
      ort.env.wasm.numThreads = 1;
      const engine = new Engine(ort);
      const vocab = JSON.parse(readFileSync(join(MODEL_DIR, m.vocab), 'utf8')) as string[];
      await engine.load(m.file, new Uint8Array(readFileSync(onnxPath)), vocab, false);
      let maxDiff = 0;
      for (const c of golden.cases) {
        const fens = fensOf(c);
        const r = await engine.evaluate(m.file, fens, c.level, c.level);
        const vmap = new Map(vocab.map((mv, i) => [mv, i] as [string, number]));
        const idx = enc.legal(fens.at(-1)!, vmap).index;
        const ref = new Map(c.legal.map((vi, i) => [vi, c.logits[i]!] as [number, number]));
        let best = -1;
        let bestLogit = -Infinity;
        idx.forEach((vi, i) => {
          maxDiff = Math.max(maxDiff, Math.abs(r.logits[i]! - ref.get(vi)!));
          if (r.logits[i]! > bestLogit) {
            bestLogit = r.logits[i]!;
            best = vi;
          }
        });
        expect(best, `${c.fen} ${c.moves.join(' ')}`).toBe(c.top1);
      }
      expect(maxDiff).toBeLessThan(1e-3);
      await engine.unload(m.file);
    }, 600_000);
  });
}
