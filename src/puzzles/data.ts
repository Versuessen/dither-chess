/**
 * The puzzle set: a sample of the Lichess puzzle database (CC0), built by tools/puzzles/build.py
 * into public/puzzles. One puzzle per line, tab-separated: id, FEN, moves (UCI; the first is the
 * opponent's move that sets the puzzle), Lichess puzzle rating, theme bits, key piece (the piece
 * that makes the solver's first move).
 */

/** Theme bits, in the order tools/puzzles/build.py writes them. */
export const THEMES = [
  'mate',
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'mateIn4',
  'mateIn5',
  'crushing',
  'advantage',
  'equality',
  'opening',
  'middlegame',
  'endgame',
  'fork',
  'pin',
  'skewer',
  'sacrifice',
  'discoveredAttack',
  'discoveredCheck',
  'deflection',
  'attraction',
  'promotion',
  'defensiveMove',
  'quietMove',
  'hangingPiece',
  'trappedPiece',
  'backRankMate',
  'oneMove',
  'short',
  'long',
  'veryLong',
  'zugzwang'
] as const;
export type Theme = (typeof THEMES)[number];

/** How a theme reads once a puzzle is over. */
export const THEME_LABEL: Record<Theme, string> = {
  mate: 'Mate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  mateIn5: 'Mate in 5',
  crushing: 'Crushing',
  advantage: 'Advantage',
  equality: 'Equality',
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered attack',
  discoveredCheck: 'Discovered check',
  deflection: 'Deflection',
  attraction: 'Attraction',
  promotion: 'Promotion',
  defensiveMove: 'Defensive move',
  quietMove: 'Quiet move',
  hangingPiece: 'Hanging piece',
  trappedPiece: 'Trapped piece',
  backRankMate: 'Back-rank mate',
  oneMove: 'One move',
  short: 'Short',
  long: 'Long',
  veryLong: 'Very long',
  zugzwang: 'Zugzwang'
};

export type KeyPiece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';

export interface Puzzle {
  id: string;
  /** The position before the opponent's move. */
  fen: string;
  /** UCI moves: the opponent's, then the solver's and the replies in turn. */
  moves: string[];
  /** Lichess puzzle rating. */
  rating: number;
  themes: number;
  piece: KeyPiece;
}

export const PUZZLE_FILE = 'puzzles/puzzles-1.tsv.gz';

export function hasTheme(p: Pick<Puzzle, 'themes'>, t: Theme): boolean {
  return (p.themes & (1 << THEMES.indexOf(t))) !== 0;
}

export function themesOf(p: Pick<Puzzle, 'themes'>): Theme[] {
  return THEMES.filter((t) => hasTheme(p, t));
}

/** The puzzles in the file's text (comment lines skipped, malformed lines dropped). */
export function parsePuzzles(text: string): Puzzle[] {
  const out: Puzzle[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [id, fen, moves, rating, themes, piece] = line.split('\t');
    if (!id || !fen || !moves || !rating || !themes || !piece || !'PNBRQK'.includes(piece)) continue;
    const ms = moves.split(' ');
    if (ms.length < 2) continue;
    out.push({ id, fen, moves: ms, rating: Number(rating), themes: Number(themes), piece: piece as KeyPiece });
  }
  return out;
}

/** gzip's magic number: the file may arrive compressed or already inflated by the host. */
function gzipped(b: Uint8Array): boolean {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!gzipped(bytes)) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

let loading: Promise<Puzzle[]> | null = null;

/** Load the set once; the service worker keeps it for offline use. */
export function loadPuzzles(): Promise<Puzzle[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}${PUZZLE_FILE}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`puzzles: HTTP ${r.status}`))))
    .then((b) => inflate(new Uint8Array(b)))
    .then(parsePuzzles)
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
