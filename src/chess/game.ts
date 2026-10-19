/**
 * One game: rules (chess.js), FIDE result logic (rules.ts), clocks and the move record.
 * Pure TypeScript with an injectable time source, so every rule is unit-testable.
 */
import { Chess, type Move, type Square } from 'chess.js';
import { ChessClock, type Now } from './clock';
import {
  countRepetitions,
  decisive,
  drawn,
  insufficientMaterial,
  repetitionKey,
  timeoutOutcome,
  type BoardPiece,
  type Color,
  type Outcome
} from './rules';
import type { TimeControl } from './timeControl';

export interface MoveRecord {
  san: string;
  uci: string;
  color: Color;
  /** FEN after the move. */
  fen: string;
  /** Mover's clock after the move (increment included), ms; null when untimed. */
  clock: number | null;
  /** Time the move took, ms. */
  spent: number;
}

export interface GameOptions {
  timeControl: TimeControl;
  humanColor: Color;
  /** The player chose a rated game (any clock; each speed has its own rating). Default: rated. */
  rated?: boolean;
  /** Start position (FEN); standard start by default. */
  fen?: string;
  now?: Now;
}

export type Claim = 'threefold' | 'fifty-move';

export class Game {
  readonly chess: Chess;
  readonly clock: ChessClock;
  readonly humanColor: Color;
  readonly timeControl: TimeControl;
  readonly startFen: string;
  readonly records: MoveRecord[] = [];
  private keys: string[] = [];
  private _outcome: Outcome | null = null;
  private _takebacks = 0;
  private started = false;
  private readonly wantsRated: boolean;

  constructor(opts: GameOptions) {
    this.chess = new Chess(opts.fen);
    this.startFen = this.chess.fen();
    this.timeControl = opts.timeControl;
    this.humanColor = opts.humanColor;
    this.wantsRated = opts.rated ?? true;
    this.clock = new ChessClock(opts.timeControl, opts.now);
    this.keys.push(repetitionKey(this.chess.fen(), true));
  }

  // ------------------------------------------------------------------ state

  get turn(): Color {
    return this.chess.turn();
  }

  get fen(): string {
    return this.chess.fen();
  }

  get outcome(): Outcome | null {
    return this._outcome;
  }

  get over(): boolean {
    return this._outcome !== null;
  }

  get takebacks(): number {
    return this._takebacks;
  }

  /** Rated when the player chose so, with no takebacks, and not aborted. */
  get rated(): boolean {
    return this.wantsRated && this._takebacks === 0 && this._outcome?.termination !== 'aborted';
  }

  /** Both sides have made at least one move (R&B 4.1: only then is a game rated). */
  get bothMoved(): boolean {
    return this.records.some((r) => r.color === 'w') && this.records.some((r) => r.color === 'b');
  }

  get lastMove(): [Square, Square] | undefined {
    const r = this.records[this.records.length - 1];
    return r ? [r.uci.slice(0, 2) as Square, r.uci.slice(2, 4) as Square] : undefined;
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  pieces(): BoardPiece[] {
    const out: BoardPiece[] = [];
    const rows = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = rows[r]![f];
        if (p) out.push({ type: p.type, color: p.color, square: (7 - r) * 8 + f });
      }
    }
    return out;
  }

  /** Legal destinations per origin square, for the board UI. */
  dests(): Map<Square, Square[]> {
    const m = new Map<Square, Square[]>();
    if (this.over) return m;
    for (const mv of this.chess.moves({ verbose: true })) {
      const list = m.get(mv.from);
      if (list) list.push(mv.to);
      else m.set(mv.from, [mv.to]);
    }
    return m;
  }

  isPromotion(from: Square, to: Square): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /** Draw claims available to the side to move (9.2 threefold, 9.3 fifty moves). */
  claimable(): Claim | null {
    if (this.over) return null;
    if (countRepetitions(this.keys) >= 3) return 'threefold';
    if (this.halfmoveClock() >= 100) return 'fifty-move';
    return null;
  }

  halfmoveClock(): number {
    return Number(this.chess.fen().split(' ')[4]);
  }

  // ------------------------------------------------------------------ actions

  /** Start White's clock (6.5). Called when the board is shown. */
  begin(): void {
    if (this.started) return;
    this.started = true;
    this.clock.start('w');
  }

  /**
   * Play a move given as UCI ("e2e4", "e7e8q") for the side to move.
   * Throws on an illegal move or after the game is over.
   */
  play(uci: string): MoveRecord {
    if (this.over) throw new Error('game is over');
    // A flag may have fallen before this move arrived.
    if (this.checkFlag()) throw new Error('flag fell');
    this.begin();
    const color = this.turn;
    let mv: Move;
    try {
      mv = this.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined
      });
    } catch {
      throw new Error(`illegal move ${uci} in ${this.fen}`);
    }
    const spent = this.clock.press(color);
    const record: MoveRecord = {
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion ?? ''),
      color,
      fen: this.chess.fen(),
      clock: this.clock.untimed ? null : this.clock.timeLeft(color),
      spent
    };
    this.records.push(record);
    this.keys.push(repetitionKey(record.fen, true));
    this.settle();
    return record;
  }

  /** Check the clocks; ends the game on a fallen flag. Returns true if it did. */
  checkFlag(): boolean {
    if (this.over) return false;
    const f = this.clock.flagged();
    if (!f) return false;
    this.finish(timeoutOutcome(this.pieces(), f));
    return true;
  }

  claim(): boolean {
    const c = this.claimable();
    if (!c) return false;
    this.finish(drawn(c));
    return true;
  }

  resign(color: Color): void {
    if (this.over) return;
    this.finish(decisive(color === 'w' ? 'b' : 'w', 'resignation'));
  }



  agreeDraw(): void {
    if (this.over) return;
    this.finish(drawn('agreement'));
  }

  /**
   * DITHER is a training tool: a game in progress can always be aborted. It ends without a
   * result and never touches a rating.
   */
  canAbort(): boolean {
    return !this.over;
  }

  abort(): boolean {
    if (!this.canAbort()) return false;
    this._outcome = { result: '*', termination: 'aborted', winner: null };
    this.clock.stop();
    return true;
  }

  /**
   * Take back the human's last move (and the bot's reply). A game with a takeback is unrated
   * for good, so the UI asks before the first one in a rapid game. Returns plies undone.
   */
  takeback(): number {
    if (this.over || !this.records.some((r) => r.color === this.humanColor)) return 0;
    let undone = 0;
    // Undo until it is the human's turn again and at least one human move was removed.
    while (this.records.length) {
      const last = this.records[this.records.length - 1]!;
      this.chess.undo();
      this.records.pop();
      this.keys.pop();
      undone++;
      if (last.color === this.humanColor) break;
    }
    if (!undone) return 0;
    this._takebacks++;
    // Restore clock readings from the last remaining records of each side.
    const lastOf = (c: Color) => [...this.records].reverse().find((r) => r.color === c)?.clock;
    const base = this.timeControl.base * 1000;
    this.clock.set(lastOf('w') ?? base, lastOf('b') ?? base);
    if (this.clock.active && this.clock.active !== this.turn) {
      this.clock.stop();
      this.clock.start(this.turn);
    }
    return undone;
  }

  private settle(): void {
    const c = this.chess;
    if (c.isCheckmate()) {
      this.finish(decisive(this.turn === 'w' ? 'b' : 'w', 'checkmate'));
    } else if (c.isStalemate()) {
      this.finish(drawn('stalemate'));
    } else if (insufficientMaterial(this.pieces())) {
      this.finish(drawn('insufficient'));
    } else if (countRepetitions(this.keys) >= 5) {
      this.finish(drawn('fivefold'));
    } else if (this.halfmoveClock() >= 150) {
      this.finish(drawn('seventy-five-move'));
    }
  }

  private finish(o: Outcome): void {
    // Until both sides have moved, any ending is an abort: no result, never rated.
    this._outcome = this.bothMoved ? o : { result: '*', termination: 'aborted', winner: null };
    this.clock.stop();
  }
}
