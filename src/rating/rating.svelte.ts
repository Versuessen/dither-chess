/**
 * The player's rating: the ledger, replayed (ledger.ts). Every finished rated game is appended
 * once; changing a rating setting appends a settings row. Nothing else is ever written.
 */
import type { AppStorage, LedgerEntry, RatingSettings, StoredGame } from '../storage/types';
import { replay, type RatingReplay } from './ledger';

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

class RatingStore {
  ledger = $state<LedgerEntry[]>([]);
  state = $state<RatingReplay | null>(null);
  private storage: AppStorage | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  async load(storage: AppStorage): Promise<void> {
    this.storage = storage;
    this.ledger = await storage.listLedger();
    this.refresh();
  }

  /** Recompute from the ledger (also when the month changes while the app is open). */
  refresh(now = new Date()): void {
    this.state = replay(this.ledger, now, localTimeZone());
  }

  /** Append a finished rated game. Idempotent per game id; calls are serialised. */
  record(game: StoredGame): Promise<void> {
    const run = this.chain.then(() => this.append(game));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async append(game: StoredGame): Promise<void> {
    const storage = this.storage;
    if (!storage || !game.rated) return;
    const score = humanScore(game);
    if (score === null || !game.endedAt) return;
    if (this.ledger.some((e) => e.kind === 'game' && e.gameId === game.id)) return;
    const before = this.state ?? replay(this.ledger, new Date(game.endedAt), localTimeZone());
    await storage.appendLedger({
      kind: 'game',
      gameId: game.id,
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

  async changeSettings(patch: Partial<RatingSettings>): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    const current = this.state?.settings ?? replay(this.ledger, new Date(), localTimeZone()).settings;
    const next = { ...current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await storage.appendLedger({ kind: 'settings', at: new Date().toISOString(), timeZone: localTimeZone(), settings: next });
    this.ledger = await storage.listLedger();
    this.refresh();
  }

  /** What the replay would give with different settings from now on (to show a setting's effect). */
  preview(patch: Partial<RatingSettings>, now = new Date()): RatingReplay {
    const s = { ...(this.state?.settings ?? replay(this.ledger, now, localTimeZone()).settings), ...patch };
    const extra: LedgerEntry = { seq: Number.MAX_SAFE_INTEGER, kind: 'settings', at: now.toISOString(), timeZone: localTimeZone(), settings: s };
    return replay([...this.ledger, extra], now, localTimeZone());
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
