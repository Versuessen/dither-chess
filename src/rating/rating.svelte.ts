/**
 * The player's ratings, one per speed (bullet, blitz, rapid, classical): the ledger, replayed
 * (ledger.ts). Every finished rated game is appended once; changing a rating setting appends a
 * settings row, and taking a game out of the rating (or back in) appends an exclusion row.
 * Nothing is ever changed or deleted.
 */
import type { AppStorage, LedgerEntry, RatingSettings, StoredGame } from '../storage/types';
import { excludedGames, replay, type RatingReplay } from './ledger';
import { SPEEDS, speedOf, type Speed } from '../chess/timeControl';

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The human's score in a finished game, or null for an aborted one. */
export function humanScore(g: StoredGame): 0 | 0.5 | 1 | null {
  if (!g.outcome || g.outcome.result === '*') return null;
  if (g.outcome.result === '1/2-1/2') return 0.5;
  return g.outcome.winner === g.humanColor ? 1 : 0;
}

type PerSpeed = Record<Speed, RatingReplay>;

class RatingStore {
  ledger = $state<LedgerEntry[]>([]);
  states = $state<PerSpeed | null>(null);
  /** Games the player took out of the rating. */
  excluded = $state<Set<string>>(new Set());
  private storage: AppStorage | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  async load(storage: AppStorage): Promise<void> {
    this.storage = storage;
    this.ledger = await storage.listLedger();
    this.refresh();
  }

  /** Recompute from the ledger (also when the month changes while the app is open). */
  refresh(now = new Date()): void {
    const tz = localTimeZone();
    this.states = Object.fromEntries(SPEEDS.map((s) => [s, replay(this.ledger, now, tz, s)])) as PerSpeed;
    this.excluded = excludedGames(this.ledger);
  }

  /** The rating of one pool. */
  of(speed: Speed): RatingReplay | null {
    return this.states?.[speed] ?? null;
  }

  /** Whether a game has a row in the ledger (it counted, or counts, for a rating). */
  isInLedger(gameId: string): boolean {
    return this.ledger.some((e) => e.kind === 'game' && e.gameId === gameId);
  }

  /** Append a finished rated game. Idempotent per game id; calls are serialised. */
  record(game: StoredGame): Promise<void> {
    return this.serial(() => this.append(game));
  }

  /** Take a rated game out of its rating, or put it back. */
  setExcluded(gameId: string, excluded: boolean): Promise<void> {
    return this.serial(async () => {
      const storage = this.storage;
      if (!storage || !this.isInLedger(gameId) || this.excluded.has(gameId) === excluded) return;
      await storage.appendLedger({ kind: 'exclusion', gameId, excluded, at: new Date().toISOString(), timeZone: localTimeZone() });
      this.ledger = await storage.listLedger();
      this.refresh();
    });
  }

  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async append(game: StoredGame): Promise<void> {
    const storage = this.storage;
    if (!storage || !game.rated) return;
    const score = humanScore(game);
    if (score === null || !game.endedAt) return;
    if (this.isInLedger(game.id)) return;
    const speed = speedOf(game.timeControl);
    const before = this.of(speed) ?? replay(this.ledger, new Date(game.endedAt), localTimeZone(), speed);
    await storage.appendLedger({
      kind: 'game',
      gameId: game.id,
      speed,
      at: game.endedAt,
      timeZone: localTimeZone(),
      opponentRating: game.botLevel,
      score,
      pgn: game.pgn,
      snapshot: { published: before.published, live: before.live, unrated: before.unrated, k: before.k, gamesTotal: before.gamesTotal }
    });
    this.ledger = await storage.listLedger();
    this.refresh();
  }

  /** The rating settings in force now (shared by every pool). */
  get settings(): RatingSettings {
    return this.of('rapid')?.settings ?? replay(this.ledger, new Date(), localTimeZone()).settings;
  }

  async changeSettings(patch: Partial<RatingSettings>): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    const current = this.settings;
    const next = { ...current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await storage.appendLedger({ kind: 'settings', at: new Date().toISOString(), timeZone: localTimeZone(), settings: next });
    this.ledger = await storage.listLedger();
    this.refresh();
  }

  /** What one pool's replay would give with different settings from now on (to show a setting's effect). */
  preview(speed: Speed, patch: Partial<RatingSettings>, now = new Date()): RatingReplay {
    const s = { ...this.settings, ...patch };
    const extra: LedgerEntry = { seq: Number.MAX_SAFE_INTEGER, kind: 'settings', at: now.toISOString(), timeZone: localTimeZone(), settings: s };
    return replay([...this.ledger, extra], now, localTimeZone(), speed);
  }
}

export const rating = new RatingStore();

/** "1464", or "UNRATED (3/5)". */
export function ratingLabel(r: RatingReplay | null, which: 'published' | 'live' = 'published'): string {
  if (!r) return '—';
  const v = which === 'live' ? r.live : r.published;
  if (v !== null && (which === 'live' || r.published !== null)) return String(v);
  const u = r.unrated ?? { counted: 0, needed: 5 };
  return `Unrated (${Math.min(u.counted, u.needed)}/${u.needed})`;
}
