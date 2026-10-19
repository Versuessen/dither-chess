/**
 * Ports of each model's input encoding, checked bit for bit against the published Python code
 * by tests/golden (see tools/models/parity.py). An encoder turns the game's positions (FENs from
 * the start, current last) into ONNX feeds, maps legal moves onto the model's vocabulary and
 * reads the value head.
 *
 *  fastelo  fastelo/lite.py board_features + Policy.logits; vocabulary fastelo/vocab.py
 *  maia3    maia3/dataset.py tokenize_board + get_historical_tokens (8 positions); maia3/utils.py
 *  maia2    maia2/utils.py board_to_tensor + inference.py preprocessing; rating buckets
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
  readonly family: 'fastelo' | 'maia3' | 'maia2';
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

/** Piece code in the mover's perspective: 1-6 own P N B R Q K, 7-12 opponent. */
function moverCode(ch: string, turn: 'w' | 'b'): number {
  const lower = ch.toLowerCase();
  const pt = 'pnbrqk'.indexOf(lower) + 1;
  const white = ch !== lower;
  const own = (white && turn === 'w') || (!white && turn === 'b');
  return own ? pt : pt + 6;
}

// ------------------------------------------------------------------------------------- fastelo
export const FASTELO_RAPID = 3;

export function fasteloFeatures(p: Position) {
  const board = new Array<number>(64).fill(0);
  for (let sq = 0; sq < 64; sq++) {
    const ch = p.pieces[sq]!;
    if (!ch) continue;
    board[p.turn === 'b' ? sq ^ 56 : sq] = moverCode(ch, p.turn);
  }
  const own = p.turn === 'w' ? { k: p.castling.K, q: p.castling.Q } : { k: p.castling.k, q: p.castling.q };
  const opp = p.turn === 'w' ? { k: p.castling.k, q: p.castling.q } : { k: p.castling.K, q: p.castling.Q };
  return {
    board,
    castling: [own.k, own.q, opp.k, opp.q].map((b) => (b ? 1 : 0)),
    ep: p.ep >= 0 ? p.ep & 7 : 8,
    halfmove: Math.min(p.halfmove, 100)
  };
}

export const fasteloEncoder: Encoder = {
  family: 'fastelo',
  policyOutput: 'policy',
  valueOutput: 'value',
  encode(req) {
    const fen = req.fens[req.fens.length - 1]!;
    const f = fasteloFeatures(parseFen(fen));
    const ply = Math.min(req.fens.length - 1, 255);
    return {
      board: { type: 'int64', dims: [1, 64], data: int64(f.board) },
      castling: { type: 'float32', dims: [1, 4], data: Float32Array.from(f.castling) },
      ep: { type: 'int64', dims: [1], data: int64([f.ep]) },
      halfmove: { type: 'int64', dims: [1], data: int64([f.halfmove]) },
      ply: { type: 'int64', dims: [1], data: int64([ply]) },
      tc: { type: 'int64', dims: [1], data: int64([FASTELO_RAPID]) },
      self_elo: { type: 'float32', dims: [1], data: Float32Array.from([req.eloSelf]) },
      opp_elo: { type: 'float32', dims: [1], data: Float32Array.from([req.eloOppo]) }
    };
  },
  legal: legalFromVocab,
  // fastelo value head: logits of the mover's loss, draw, win (fastelo/features.py).
  wdl: (v) => {
    const p = softmax3(v);
    return [p[2]!, p[1]!, p[0]!];
  }
};

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

// --------------------------------------------------------------------------------------- maia2
/** maia2.utils.map_to_category: <1100 -> 0, 1100-1199 -> 1, ..., 1900-1999 -> 9, >=2000 -> 10. */
export function maia2Bucket(elo: number): number {
  if (elo < 1100) return 0;
  if (elo >= 2000) return 10;
  return Math.floor((elo - 1100) / 100) + 1;
}

/** maia2.utils.board_to_tensor on the (mirrored when Black to move) board: 18 x 8 x 8. */
export function maia2Board(p0: Position): Float32Array {
  const p = p0.turn === 'b' ? mirror(p0) : p0;
  const t = new Float32Array(18 * 64);
  for (let sq = 0; sq < 64; sq++) {
    const ch = p.pieces[sq]!;
    if (!ch) continue;
    const lower = ch.toLowerCase();
    const idx = 'pnbrqk'.indexOf(lower) + (ch === lower ? 6 : 0);
    t[idx * 64 + sq] = 1;
  }
  if (p.turn === 'w') t.fill(1, 12 * 64, 13 * 64);
  const rights = [p.castling.K, p.castling.Q, p.castling.k, p.castling.q];
  rights.forEach((r, i) => {
    if (r) t.fill(1, (13 + i) * 64, (14 + i) * 64);
  });
  if (p.ep >= 0) t[17 * 64 + p.ep] = 1;
  return t;
}

export const maia2Encoder: Encoder = {
  family: 'maia2',
  policyOutput: 'logits_maia',
  valueOutput: 'logits_value',
  encode(req) {
    const fen = req.fens[req.fens.length - 1]!;
    return {
      boards: { type: 'float32', dims: [1, 18, 8, 8], data: maia2Board(parseFen(fen)) },
      elo_self: { type: 'int64', dims: [1], data: int64([maia2Bucket(req.eloSelf)]) },
      elo_oppo: { type: 'int64', dims: [1], data: int64([maia2Bucket(req.eloOppo)]) }
    };
  },
  legal: legalFromVocab,
  // A single value in [-1, 1] for the side to move; expressed as win/loss with no draw mass.
  wdl: (v) => {
    const e = Math.min(1, Math.max(0, v[0]! / 2 + 0.5));
    return [e, 0, 1 - e];
  }
};

export function encoderFor(family: 'fastelo' | 'maia3' | 'maia2'): Encoder {
  return family === 'fastelo' ? fasteloEncoder : family === 'maia3' ? maia3Encoder : maia2Encoder;
}

/** Softmax of value logits when the head returns logits (fastelo, Maia-3). */
export function softmax3(v: Float32Array): Float32Array {
  const m = Math.max(v[0]!, v[1]!, v[2]!);
  const e = [Math.exp(v[0]! - m), Math.exp(v[1]! - m), Math.exp(v[2]! - m)];
  const s = e[0]! + e[1]! + e[2]!;
  return Float32Array.from(e.map((x) => x / s));
}
