/**
 * Persistence contract shared by the web build (IndexedDB) and the desktop build (SQLite via
 * tauri-plugin-sql). Everything is JSON; the ledger is append-only.
 */
import type { MoveRecord } from '../chess/game';
import type { Outcome } from '../chess/rules';
import type { Speed, TimeControl } from '../chess/timeControl';
import type { ModelFamily } from '../models/catalog';

export interface StoredGame {
  id: string;
  /** ISO timestamps. */
  startedAt: string;
  endedAt: string | null;
  persona: string;
  botName: string;
  family: ModelFamily;
  /** Model pack id and checksum the bot ran on. */
  pack: string;
  packSha256: string;
  /** Bot rating, Lichess rapid scale. */
  botLevel: number;
  humanColor: 'w' | 'b';
  timeControl: TimeControl;
  startFen: string;
  moves: MoveRecord[];
  outcome: Outcome | null;
  rated: boolean;
  takebacks: number;
  /** Seed of the bot's sampler, so a game can be replayed exactly. */
  seed: number;
  pgn: string;
  /** fastelo move-quality estimate of the human's moves, added after the game (rating/quality). */
  quality?: StoredQuality;
}

export interface StoredQuality {
  /** fastelo pack and checksum that scored the moves. */
  pack: string;
  packSha256: string;
  /** Corrected estimate, its 1-sigma statistical errors and systematic error, in Elo (Lichess rapid scale as fastelo). */
  mean: number;
  minus: number;
  plus: number;
  syst: number;
  resolution: number;
  userMoves: number;
  /** Estimate after each of the human's moves, rounded. */
  curve: number[];
}

/**
 * The rating ledger (rating/ledger.ts): append-only, replayed from the start to get every rating.
 * A row is a rated game, a change of the rating settings (which takes effect from that point), or
 * the player taking a game out of the rating (or putting it back).
 */
export type LedgerEntry = LedgerGame | LedgerSettings | LedgerExclusion;

interface LedgerBase {
  seq: number;
  /** ISO timestamp: the game's end, or when the setting changed. */
  at: string;
  /** IANA time zone at that moment; its local calendar month is the rating period. */
  timeZone: string;
}

export interface LedgerGame extends LedgerBase {
  kind: 'game';
  gameId: string;
  /** Rating pool; rows written before pools existed are rapid (the only rated speed then). */
  speed?: Speed;
  /** The bot's rating (Lichess rapid scale). */
  opponentRating: number;
  /** 1, 0.5 or 0 from the player's point of view. */
  score: 0 | 0.5 | 1;
  pgn: string;
  /** Rating state just before this game, recomputed and stored for audit. */
  snapshot: Record<string, unknown>;
}

export interface LedgerSettings extends LedgerBase {
  kind: 'settings';
  settings: RatingSettings;
}

/** Takes a rated game out of the rating, or (excluded: false) puts it back. The latest row wins. */
export interface LedgerExclusion extends LedgerBase {
  kind: 'exclusion';
  gameId: string;
  excluded: boolean;
}

/** The documented deviations from FIDE, as settings. */
export interface RatingSettings {
  /** Rating of the two hypothetical opponents in an initial rating (FIDE: 1800). */
  hypotheticalOpponent: number;
  /** FIDE's 1400 floor: below it a player is unrated again (FIDE: on; DITHER default: off). */
  floor1400: boolean;
  /** Birth year for FIDE's junior K-factor (K = 40 until the end of the year of the 18th birthday), or null. */
  juniorBirthYear: number | null;
}

/** A ledger row before storage gives it a sequence number. */
export type LedgerEntryInput = Omit<LedgerGame, 'seq'> | Omit<LedgerSettings, 'seq'> | Omit<LedgerExclusion, 'seq'>;

export interface Backup {
  format: 'dither-backup';
  version: 1;
  exportedAt: string;
  games: StoredGame[];
  ledger: LedgerEntry[];
  settings: Record<string, unknown>;
}

export interface AppStorage {
  readonly kind: 'indexeddb' | 'sqlite' | 'memory';
  init(): Promise<void>;

  putGame(game: StoredGame): Promise<void>;
  getGame(id: string): Promise<StoredGame | undefined>;
  /** Newest first. */
  listGames(): Promise<StoredGame[]>;

  /** Appends with the next sequence number and returns it. Existing entries never change. */
  appendLedger(entry: LedgerEntryInput): Promise<number>;
  /** Oldest first. */
  listLedger(): Promise<LedgerEntry[]>;

  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
  allSettings(): Promise<Record<string, unknown>>;

  /** Replace everything with the backup's contents (used by import). */
  replaceAll(backup: Backup): Promise<void>;
}
