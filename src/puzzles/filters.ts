/**
 * Choosing puzzles: filters by difficulty, key piece, game phase and motif, and a random pick
 * that leaves out puzzles played recently.
 */
import { hasTheme, type KeyPiece, type Puzzle, type Theme } from './data';

/** Difficulty by Lichess puzzle rating (the bands of tools/puzzles/build.py). */
export const DIFFICULTIES = [
  { id: 'level', label: 'Your level' },
  { id: 'simple', label: 'Simple', range: [0, 1250] },
  { id: 'medium', label: 'Medium', range: [1250, 1650] },
  { id: 'hard', label: 'Hard', range: [1650, 2050] },
  { id: 'extreme', label: 'Extreme', range: [2050, 9999] },
  { id: 'any', label: 'Any' }
] as const;
export type Difficulty = (typeof DIFFICULTIES)[number]['id'];

export const PIECE_FILTERS = [
  { id: 'any', label: 'Any' },
  { id: 'P', label: 'Pawn' },
  { id: 'N', label: 'Knight' },
  { id: 'B', label: 'Bishop' },
  { id: 'R', label: 'Rook' },
  { id: 'Q', label: 'Queen' },
  { id: 'K', label: 'King' }
] as const;
export type PieceFilter = 'any' | KeyPiece;

export const PHASES = [
  { id: 'any', label: 'Any' },
  { id: 'opening', label: 'Opening' },
  { id: 'middlegame', label: 'Middlegame' },
  { id: 'endgame', label: 'Endgame' }
] as const;
export type Phase = (typeof PHASES)[number]['id'];

/** Motifs and the Lichess themes that count as each. */
export const MOTIFS = [
  { id: 'any', label: 'Any', themes: [] },
  { id: 'mate', label: 'Mate', themes: ['mate'] },
  { id: 'fork', label: 'Fork', themes: ['fork'] },
  { id: 'pin', label: 'Pin', themes: ['pin'] },
  { id: 'skewer', label: 'Skewer', themes: ['skewer'] },
  { id: 'sacrifice', label: 'Sacrifice', themes: ['sacrifice'] },
  { id: 'discovered', label: 'Discovered attack', themes: ['discoveredAttack', 'discoveredCheck'] },
  { id: 'deflection', label: 'Deflection', themes: ['deflection', 'attraction'] },
  { id: 'promotion', label: 'Promotion', themes: ['promotion'] },
  { id: 'defence', label: 'Defence', themes: ['defensiveMove'] },
  { id: 'quiet', label: 'Quiet move', themes: ['quietMove'] },
  { id: 'hanging', label: 'Hanging piece', themes: ['hangingPiece', 'trappedPiece'] }
] as const satisfies readonly { id: string; label: string; themes: readonly Theme[] }[];
export type Motif = (typeof MOTIFS)[number]['id'];

export interface Filters {
  difficulty: Difficulty;
  piece: PieceFilter;
  phase: Phase;
  motif: Motif;
}

export const DEFAULT_FILTERS: Filters = { difficulty: 'level', piece: 'any', phase: 'any', motif: 'any' };

/** "Your level": puzzles within this many points of your puzzle rating, widened if too few match. */
const LEVEL_WINDOWS = [150, 250, 400, 700];
const LEVEL_MIN = 40;

export function sanitizeFilters(v: unknown): Filters {
  const f = { ...DEFAULT_FILTERS };
  if (!v || typeof v !== 'object') return f;
  const o = v as Record<string, unknown>;
  if (DIFFICULTIES.some((d) => d.id === o.difficulty)) f.difficulty = o.difficulty as Difficulty;
  if (PIECE_FILTERS.some((d) => d.id === o.piece)) f.piece = o.piece as PieceFilter;
  if (PHASES.some((d) => d.id === o.phase)) f.phase = o.phase as Phase;
  if (MOTIFS.some((d) => d.id === o.motif)) f.motif = o.motif as Motif;
  return f;
}

function matchesExceptDifficulty(p: Puzzle, f: Filters): boolean {
  if (f.piece !== 'any' && p.piece !== f.piece) return false;
  if (f.phase !== 'any' && !hasTheme(p, f.phase)) return false;
  if (f.motif !== 'any') {
    const themes = MOTIFS.find((m) => m.id === f.motif)!.themes as readonly Theme[];
    if (!themes.some((t) => hasTheme(p, t))) return false;
  }
  return true;
}

/** Every puzzle the filters allow; "your level" widens its window until enough match. */
export function matching(all: readonly Puzzle[], f: Filters, rating: number): Puzzle[] {
  const base = all.filter((p) => matchesExceptDifficulty(p, f));
  if (f.difficulty === 'any') return base;
  if (f.difficulty === 'level') {
    let pool: Puzzle[] = [];
    for (const w of LEVEL_WINDOWS) {
      pool = base.filter((p) => Math.abs(p.rating - rating) <= w);
      if (pool.length >= LEVEL_MIN) return pool;
    }
    return pool.length ? pool : base;
  }
  const d = DIFFICULTIES.find((x) => x.id === f.difficulty);
  const [lo, hi] = d && 'range' in d ? d.range : [0, 9999];
  return base.filter((p) => p.rating >= lo && p.rating < hi);
}

/** Puzzles played less than this long ago are left out while others remain. */
export const RECENT_MS = 60 * 24 * 3600 * 1000;

/**
 * A random puzzle from the pool, leaving out those played in the last RECENT_MS; when every
 * one has been played recently, the one played longest ago. `random` returns [0, 1).
 */
export function pickPuzzle(pool: readonly Puzzle[], lastPlayed: ReadonlyMap<string, number>, now: number, random: () => number = Math.random, exclude?: string): Puzzle | null {
  const candidates = pool.filter((p) => p.id !== exclude);
  if (!candidates.length) return pool[0] ?? null;
  const fresh = candidates.filter((p) => {
    const t = lastPlayed.get(p.id);
    return t === undefined || now - t >= RECENT_MS;
  });
  if (fresh.length) return fresh[Math.floor(random() * fresh.length)]!;
  return candidates.reduce((a, b) => ((lastPlayed.get(a.id) ?? 0) <= (lastPlayed.get(b.id) ?? 0) ? a : b));
}
