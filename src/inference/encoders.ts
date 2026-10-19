/**
 * The port of Maia-3's input encoding, checked bit for bit against the published Python code by
 * tests/golden (see tools/models/parity.py): maia3/dataset.py tokenize_board +
 * get_historical_tokens (8 positions) and maia3/utils.py. The encoder turns the game's positions
 * (FENs from the start, current last) into ONNX feeds, maps legal moves onto the model's
 * vocabulary and reads the value head.
 */
import { legalUci, mirror, mirrorUci, parseFen, type Position } from './position';

export type FeedType = 'float32' | 'int64';

export interface Feed {
  type: FeedType;
  dims: number[];
  data: Float32Array | BigInt64Array;
}

export type Feeds = Record<string, Feed>;

export type WDL = [number, number, number];

export interface EncodeRequest {
  /** FENs from the start of the game to the current position. */
  fens: readonly string[];
  /** Model rating inputs. */
  eloSelf: number;
  eloOppo: number;
}

export interface Encoder {
  readonly family: 'maia3';
  readonly policyOutput: string;
  readonly valueOutput: string;
  encode(req: EncodeRequest): Feeds;
  /** Legal moves of the current position (real UCI) and their vocabulary indices. */
  legal(fen: string, vocabIndex: Map<string, number>): { uci: string[]; index: number[] };
  /** Value head from the side to move: [win, draw, loss]. */
  wdl(value: Float32Array): WDL;
}

const int64 = (values: number[]): BigInt64Array => BigInt64Array.from(values.map((v) => BigInt(Math.trunc(v))));

function legalFromVocab(fen: string, vocab: Map<string, number>): { uci: string[]; index: number[] } {
  const moves = legalUci(fen);
  const black = parseFen(fen).turn === 'b';
  const uci: string[] = [];
  const index: number[] = [];
  for (const m of moves) {
    const key = black ? mirrorUci(m) : m;
    const i = vocab.get(key);
    if (i === undefined) throw new Error(`move ${m} is not in the model vocabulary`);
    uci.push(m);
    index.push(i);
  }
  return { uci, index };
}

// --------------------------------------------------------------------------------------- maia3
export const MAIA3_HISTORY = 8;

/** maia3.dataset.tokenize_board: 64 x 12 one-hot, mirrored when Black is to move. */
export function maia3Tokens(p: Position): Uint8Array {
  const q = p.turn === 'b' ? mirror(p) : p;
  const t = new Uint8Array(64 * 12);
  for (let sq = 0; sq < 64; sq++) {
    const ch = q.pieces[sq]!;
    if (!ch) continue;
    const lower = ch.toLowerCase();
    const mapped = 'pnbrqk'.indexOf(lower) + 1 + (ch === lower ? 6 : 0);
    t[sq * 12 + mapped - 1] = 1;
  }
  return t;
}

export const maia3Encoder: Encoder = {
  family: 'maia3',
  policyOutput: 'logits_move',
  valueOutput: 'logits_value',
  encode(req) {
    const recent = req.fens.slice(-MAIA3_HISTORY).map((f) => maia3Tokens(parseFen(f)));
    // Pad at the front with the earliest kept position (get_historical_tokens).
    while (recent.length < MAIA3_HISTORY) recent.unshift(recent[0]!);
    const C = 12 * MAIA3_HISTORY;
    const data = new Float32Array(64 * C);
    recent.forEach((tok, h) => {
      for (let sq = 0; sq < 64; sq++) {
        for (let c = 0; c < 12; c++) if (tok[sq * 12 + c]) data[sq * C + h * 12 + c] = 1;
      }
    });
    return {
      tokens: { type: 'float32', dims: [1, 64, C], data },
      self_elo: { type: 'int64', dims: [1], data: int64([req.eloSelf]) },
      oppo_elo: { type: 'int64', dims: [1], data: int64([req.eloOppo]) }
    };
  },
  legal: legalFromVocab,
  // Value logits are loss, draw, win for the side to move (maia3/uci.py wdl_from_value_logits).
  wdl: (v) => {
    const p = softmax3(v);
    return [p[2]!, p[1]!, p[0]!];
  }
};

/** Softmax of the value logits. */
export function softmax3(v: Float32Array): Float32Array {
  const m = Math.max(v[0]!, v[1]!, v[2]!);
  const e = [Math.exp(v[0]! - m), Math.exp(v[1]! - m), Math.exp(v[2]! - m)];
  const s = e[0]! + e[1]! + e[2]!;
  return Float32Array.from(e.map((x) => x / s));
}
