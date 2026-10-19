/**
 * Opening names from the Lichess opening tables (CC0, vendor/chess-openings), looked up by
 * position so transpositions are named correctly. The table (about 60 kB compressed) loads on
 * first use.
 */
export interface Opening {
  eco: string;
  /** "Russian Game: Classical Attack". */
  name: string;
  /** Ply of the last named position in the game. */
  ply: number;
}

export type OpeningTable = ReadonlyMap<string, readonly [string, string]>;

let loading: Promise<OpeningTable> | null = null;

export function loadOpenings(): Promise<OpeningTable> {
  loading ??= import('./openings.json').then((m) => new Map(Object.entries(m.default.positions) as [string, [string, string]][]));
  return loading;
}

/** Placement, side to move, castling and en passant: the part of a FEN that identifies a position. */
export function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * The opening of a game: the deepest named position among `fens` (the start position followed by
 * the position after each move). Returns null when no position is in the tables.
 */
export function nameOpening(table: OpeningTable, fens: readonly string[]): Opening | null {
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = table.get(epd(fens[i]!));
    if (hit) return { eco: hit[0], name: hit[1], ply: i };
  }
  return null;
}

/** "Russian Game" from "Russian Game: Classical Attack, Chigorin Variation". */
export function family(name: string): string {
  return name.split(':')[0]!.trim();
}
