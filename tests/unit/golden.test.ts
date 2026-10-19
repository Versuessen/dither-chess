/**
 * Golden tests: the TypeScript encoders and the onnxruntime-web runtime against the published
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
import { encoderFor, maia2Bucket } from '../../src/inference/encoders';
import { fasteloSettings, type FasteloCalibration } from '../../src/inference/calibration';
import { Engine } from '../../src/inference/engine';
import { qualityCurve, type RatingResponse } from '../../src/rating/moveQuality';

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

const MODELS: { file: string; family: 'fastelo' | 'maia3' | 'maia2'; vocab: string }[] = [
  { file: 'fastelo', family: 'fastelo', vocab: 'fastelo.vocab.json' },
  { file: 'maia3-5m', family: 'maia3', vocab: 'maia3.vocab.json' },
  { file: 'maia3-23m', family: 'maia3', vocab: 'maia3.vocab.json' },
  { file: 'maia2-rapid', family: 'maia2', vocab: 'maia2.vocab.json' }
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

const calGolden = JSON.parse(readFileSync(join(GOLDEN, 'fastelo-calibration.json'), 'utf8')) as {
  calibration: FasteloCalibration;
  settings: { level: number; conditioning: number; temperature: number; mix: number }[];
};

describe('fastelo calibration port', () => {
  it('matches fastelo.lite.settings() at every level', () => {
    for (const row of calGolden.settings) {
      const s = fasteloSettings(calGolden.calibration, row.level);
      expect(s.eloSelf).toBeCloseTo(row.conditioning, 9);
      expect(s.temperature).toBeCloseTo(row.temperature, 12);
      expect(s.mix).toBe(row.mix);
    }
  });
});

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
  const enc = encoderFor(m.family);

  describe(`${m.file} encoding`, () => {
    it(`matches the Python reference on ${golden.cases.length} positions`, () => {
      for (const c of golden.cases) {
        const fens = fensOf(c);
        if (m.family === 'fastelo') {
          const e = c.encoded as { board: number[]; castling: number[]; ep: number; halfmove: number; ply: number; tc: number; elo: number };
          const feeds = enc.encode({ fens, eloSelf: e.elo, eloOppo: e.elo });
          expect(Array.from(feeds.board!.data as BigInt64Array, Number), c.fen).toEqual(e.board);
          expect(Array.from(feeds.castling!.data as Float32Array)).toEqual(e.castling);
          expect(Number((feeds.ep!.data as BigInt64Array)[0])).toBe(e.ep);
          expect(Number((feeds.halfmove!.data as BigInt64Array)[0])).toBe(e.halfmove);
          expect(Number((feeds.ply!.data as BigInt64Array)[0])).toBe(e.ply);
          expect(Number((feeds.tc!.data as BigInt64Array)[0])).toBe(e.tc);
          const settings = fasteloSettings(calGolden.calibration, c.level);
          expect(Math.fround(settings.eloSelf)).toBeCloseTo(e.elo, 3);
        } else if (m.family === 'maia3') {
          const e = c.encoded as { ones: number[]; self_elo: number; oppo_elo: number };
          const feeds = enc.encode({ fens, eloSelf: c.level, eloOppo: c.level });
          const data = feeds.tokens!.data as Float32Array;
          const ones: number[] = [];
          data.forEach((v, i) => v > 0.5 && ones.push(i));
          expect(ones, `${c.fen} ${c.moves.join(' ')}`).toEqual(e.ones);
          expect(Number((feeds.self_elo!.data as BigInt64Array)[0])).toBe(e.self_elo);
        } else {
          const e = c.encoded as { ones: number[]; elo_self: number; elo_oppo: number };
          const feeds = enc.encode({ fens, eloSelf: c.level, eloOppo: c.level });
          const data = feeds.boards!.data as Float32Array;
          const ones: number[] = [];
          data.forEach((v, i) => v > 0.5 && ones.push(i));
          expect(ones, fens.at(-1)).toEqual(e.ones);
          expect(maia2Bucket(c.level)).toBe(e.elo_self);
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
      await engine.load(m.file, m.family, new Uint8Array(readFileSync(onnxPath)), vocab, false);
      let maxDiff = 0;
      for (const c of golden.cases) {
        const fens = fensOf(c);
        const elo = m.family === 'fastelo' ? (c.encoded as { elo: number }).elo : c.level;
        const r = await engine.evaluate(m.file, fens, elo, elo);
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

describe.skipIf(!existsSync(join(MODEL_DIR, 'fastelo.onnx')))('fastelo Rater via onnxruntime-web', () => {
  it('scores played moves like fastelo.lite (batched) and gives the same estimate', async () => {
    const fixture = JSON.parse(readFileSync(join(GOLDEN, 'fastelo-rater.json'), 'utf8')) as {
      grid: number[];
      response: RatingResponse;
      cases: { game: string; side: number; moves: string[]; logp: number[][]; value: number[] }[];
    };
    ort.env.wasm.numThreads = 1;
    const engine = new Engine(ort);
    const vocab = JSON.parse(readFileSync(join(MODEL_DIR, 'fastelo.vocab.json'), 'utf8')) as string[];
    await engine.load('fastelo', 'fastelo', new Uint8Array(readFileSync(join(MODEL_DIR, 'fastelo.onnx'))), vocab, false);
    let maxDiff = 0;
    for (const c of fixture.cases) {
      const chess = new Chess();
      const fens = [chess.fen()];
      for (const m of c.moves) {
        chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
        fens.push(chess.fen());
      }
      const own = c.moves.map((_, p) => p).filter((p) => p % 2 === c.side);
      const items = own.map((p) => ({ fens: fens.slice(0, p + 1), move: c.moves[p]! }));
      const r = await engine.moveLogp('fastelo', items, fixture.grid);
      const rows = own.map((_, i) => Array.from(r.logp.subarray(i * fixture.grid.length, (i + 1) * fixture.grid.length)));
      rows.forEach((row, i) => row.forEach((v, j) => (maxDiff = Math.max(maxDiff, Math.abs(v - c.logp[i]![j]!)))));
      const curve = qualityCurve(rows, fixture.response);
      expect(Math.abs(curve.at(-1)!.value - c.value.at(-1)!), c.game).toBeLessThan(1);
    }
    expect(maxDiff).toBeLessThan(1e-3);
    await engine.unload('fastelo');
  }, 600_000);
});
