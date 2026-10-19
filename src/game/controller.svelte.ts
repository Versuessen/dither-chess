/**
 * Runs one game against a bot: the rules model, the clocks, the bot's human-like timing and
 * decisions, and persistence. The game screen renders this state and forwards user actions.
 */
import { applyPremoves, premoveDests, premovePromotes, type Premove } from '../chess/premove';
import type { Square } from 'chess.js';
import { Game, type Claim, type MoveRecord } from '../chess/game';
import { insufficientMaterial, describeTermination, type Color, type Outcome } from '../chess/rules';
import { toPgn, STANDARD_START } from '../chess/pgn';
import type { TimeControl } from '../chess/timeControl';
import {
  acceptsDraw,
  claimsDraw,
  looksLost,
  materialBalance,
  resigns,
  thinkTime,
  type WDL
} from '../bots/behaviour';
import type { BotRequest, Opponent } from '../bots/opponent';
import { createRng, type Rng } from '../lib/rng';
import type { AppStorage, StoredGame } from '../storage/types';

export interface ControllerOptions {
  id: string;
  opponent: Opponent;
  botName: string;
  persona: string;
  humanColor: Color;
  timeControl: TimeControl;
  /** The player chose a rated game (it still becomes unrated on a takeback or an abort). */
  rated?: boolean;
  instantBot: () => boolean;
  storage: AppStorage | null;
  /** Called once when a game ends, after it has been saved. */
  onFinished?: (game: StoredGame) => void | Promise<void>;
  startFen?: string;
  now?: () => number;
  /** Timer functions, injectable for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export type Notice = { kind: 'draw-declined' | 'draw-accepted' | 'bot-claimed' | 'error'; text: string } | null;

export class GameController {
  readonly game: Game;
  readonly opts: ControllerOptions;
  readonly startedAt = new Date();

  fen = $state('');
  moves = $state<MoveRecord[]>([]);
  lastMove = $state<[Square, Square] | undefined>(undefined);
  turn = $state<Color>('w');
  check = $state(false);
  outcome = $state<Outcome | null>(null);
  thinking = $state(false);
  notice = $state<Notice>(null);
  claimable = $state<Claim | null>(null);
  clockWhite = $state(0);
  clockBlack = $state(0);
  clockRunning = $state<Color | null>(null);
  rated = $state(false);
  canAbort = $state(true);
  /** Moves the player queued while the bot was thinking, oldest first (chess/premove.ts). */
  premoves = $state<Premove[]>([]);
  /** Forward-pass time of the bot's last move, ms (shown as a diagnostic). */
  lastInferenceMs = $state<number | null>(null);

  private rng: Rng;
  private pending: unknown = null;
  private pendingMove: (() => void) | null = null;
  private botToken = 0;
  private lostStreak = 0;
  private drawOfferedAtPly = -Infinity;
  private finished = false;
  private disposed = false;

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.game = new Game({
      timeControl: opts.timeControl,
      humanColor: opts.humanColor,
      fen: opts.startFen,
      now: opts.now,
      rated: opts.rated ?? true
    });
    this.rng = createRng(opts.opponent.seed ^ 0x5bd1e995);
    this.sync();
  }

  get humanColor(): Color {
    return this.game.humanColor;
  }

  get humanToMove(): boolean {
    return !this.outcome && this.turn === this.humanColor;
  }

  /** Show the board and start White's clock; the bot moves first when it has White. */
  start(): void {
    this.game.begin();
    this.sync();
    void this.persist();
    if (!this.humanToMove) void this.botTurn();
  }

  /** Called by the UI every frame or so: refresh clocks and catch a fallen flag. */
  tick(): void {
    if (this.outcome) return;
    if (this.game.checkFlag()) {
      this.cancelBot();
      this.sync();
      void this.end();
      return;
    }
    const snap = this.game.clock.snapshot();
    this.clockWhite = snap.white;
    this.clockBlack = snap.black;
    this.clockRunning = snap.running;
  }

  legalDests(): Map<Square, Square[]> {
    return this.humanToMove ? this.game.dests() : new Map();
  }

  /** The position shown while premoves are queued: the real one with the queue applied. */
  get shownFen(): string {
    return applyPremoves(this.fen, this.humanColor, this.premoves);
  }

  /** Where the player may premove from the shown position (empty when it is their turn). */
  premoveDests(): Map<Square, Square[]> {
    return this.outcome || this.humanToMove ? new Map() : premoveDests(this.shownFen, this.humanColor);
  }

  /** Queue a move to play after the bot's reply. Returns false if it is not a premove now. */
  queuePremove(from: Square, to: Square): boolean {
    if (this.outcome || this.humanToMove) return false;
    if (!premoveDests(this.shownFen, this.humanColor).get(from)?.includes(to)) return false;
    this.premoves = [...this.premoves, { from, to, ...(premovePromotes(this.shownFen, from, to) ? { promotion: 'q' as const } : {}) }];
    return true;
  }

  clearPremoves(): void {
    this.premoves = [];
  }

  /** After the bot's move: play the first queued premove if it is legal now, else drop them all. */
  private playQueuedPremove(): void {
    const [next, ...rest] = this.premoves;
    if (!next || !this.humanToMove) return;
    const uci = next.from + next.to + (next.promotion ?? '');
    const legal = this.game.dests().get(next.from)?.includes(next.to);
    if (!legal) {
      this.premoves = [];
      return;
    }
    this.premoves = rest;
    if (!this.humanMove(uci)) this.premoves = [];
  }

  needsPromotion(from: Square, to: Square): boolean {
    return this.game.isPromotion(from, to);
  }

  /** A move from the human. Returns false if it was illegal or not their turn. */
  humanMove(uci: string): boolean {
    if (!this.humanToMove) return false;
    try {
      this.game.play(uci);
    } catch {
      this.sync();
      if (this.game.over) void this.end();
      return false;
    }
    this.notice = null;
    this.sync();
    void this.persist();
    if (this.game.over) void this.end();
    else void this.botTurn();
    return true;
  }

  resign(): void {
    if (this.outcome) return;
    this.cancelBot();
    this.game.resign(this.humanColor);
    this.sync();
    void this.end();
  }

  abort(): void {
    if (!this.game.canAbort()) return;
    this.cancelBot();
    this.game.abort();
    this.sync();
    void this.end();
  }

  claimDraw(): boolean {
    if (!this.humanToMove || !this.game.claim()) return false;
    this.cancelBot();
    this.sync();
    void this.end();
    return true;
  }

  /** Offer a draw; the bot answers at once from its value head. One offer per 10 plies. */
  async offerDraw(): Promise<boolean> {
    if (this.outcome || !this.canOfferDraw()) return false;
    this.drawOfferedAtPly = this.game.records.length;
    const wdl = await this.opts.opponent.value(this.request()).catch(() => null);
    if (this.outcome || this.disposed) return false;
    const ok = acceptsDraw({ wdl, deadDrawn: insufficientMaterial(this.game.pieces()), ply: this.game.records.length });
    if (ok) {
      this.cancelBot();
      this.game.agreeDraw();
      this.notice = { kind: 'draw-accepted', text: 'Draw accepted' };
      this.sync();
      void this.end();
    } else {
      this.notice = { kind: 'draw-declined', text: 'Draw declined' };
    }
    return ok;
  }

  canOfferDraw(): boolean {
    return !this.outcome && this.game.records.length - this.drawOfferedAtPly >= 10;
  }

  /** Undo the human's last move (and the bot's reply). */
  takeback(): boolean {
    if (this.outcome) return false;
    this.cancelBot();
    const n = this.game.takeback();
    this.sync();
    void this.persist();
    if (n && !this.humanToMove) void this.botTurn();
    return n > 0;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelBot();
  }

  // ------------------------------------------------------------------ bot

  private request(): BotRequest {
    const fens = [this.game.startFen, ...this.game.records.map((r) => r.fen)];
    return { fens, moves: this.game.records.map((r) => r.uci) };
  }

  private cancelBot(): void {
    this.premoves = [];
    this.botToken++;
    if (this.pending !== null) (this.opts.clearTimeout ?? clearTimeout)(this.pending as ReturnType<typeof setTimeout>);
    this.pending = null;
    this.pendingMove = null;
    this.thinking = false;
  }

  private async botTurn(): Promise<void> {
    const token = ++this.botToken;
    this.thinking = true;
    const req = this.request();
    let thought;
    try {
      thought = await this.opts.opponent.choose(req);
    } catch (err) {
      if (token !== this.botToken) return;
      this.thinking = false;
      this.notice = { kind: 'error', text: `The bot could not move: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
    if (token !== this.botToken || this.disposed || this.outcome) return;
    this.lastInferenceMs = thought.inferenceMs;

    const botColor = this.game.turn;
    // Claim an available draw when not better.
    if (this.game.claimable() && claimsDraw(thought.wdl)) {
      this.game.claim();
      this.notice = { kind: 'bot-claimed', text: 'The bot claimed a draw' };
      this.thinking = false;
      this.sync();
      void this.end();
      return;
    }
    // Resign instead of moving, rarely.
    this.lostStreak = looksLost(thought.wdl) ? this.lostStreak + 1 : 0;
    if (
      resigns(
        {
          level: this.opts.opponent.level,
          wdl: thought.wdl,
          materialBalance: materialBalance(this.game.fen, botColor),
          lostStreak: this.lostStreak
        },
        this.rng
      )
    ) {
      this.thinking = false;
      this.game.resign(botColor);
      this.sync();
      void this.end();
      return;
    }

    const delay = this.opts.instantBot()
      ? 0
      : thinkTime(
          {
            ply: this.game.records.length,
            legal: thought.legal,
            entropy: thought.entropy,
            chosenProb: thought.chosenProb,
            remaining: this.game.clock.timeLeft(botColor),
            increment: this.opts.timeControl.increment * 1000,
            base: this.opts.timeControl.base * 1000,
            inferenceMs: thought.inferenceMs,
            level: this.opts.opponent.level
          },
          this.rng
        );
    const playIt = () => {
      this.pending = null;
      this.pendingMove = null;
      if (token !== this.botToken || this.disposed || this.outcome) return;
      this.thinking = false;
      try {
        this.game.play(thought.uci);
      } catch {
        // Flag fell during the pause, or (never expected) an illegal model move.
        this.sync();
        if (this.game.over) void this.end();
        else this.notice = { kind: 'error', text: `The bot proposed an illegal move (${thought.uci})` };
        return;
      }
      this.sync();
      void this.persist();
      if (this.game.over) {
        this.premoves = [];
        void this.end();
      } else this.playQueuedPremove();
      this.onBotMoved?.();
    };
    if (delay <= 0) playIt();
    else {
      this.pendingMove = playIt;
      this.pending = (this.opts.setTimeout ?? setTimeout)(playIt, delay);
    }
  }

  /** Play the bot's chosen move now instead of finishing its human-like pause (pace set to Instant). */
  hurry(): void {
    const fn = this.pendingMove;
    if (!fn || this.pending === null) return;
    (this.opts.clearTimeout ?? clearTimeout)(this.pending as ReturnType<typeof setTimeout>);
    fn();
  }

  /** Called after each bot move (and any premove it triggered). */
  onBotMoved: (() => void) | null = null;

  // ------------------------------------------------------------------ state & persistence

  private sync(): void {
    const g = this.game;
    this.fen = g.fen;
    this.moves = [...g.records];
    this.lastMove = g.lastMove;
    this.turn = g.turn;
    this.check = g.inCheck();
    this.outcome = g.outcome;
    this.claimable = g.claimable();
    this.rated = g.rated;
    this.canAbort = g.canAbort();
    const snap = g.clock.snapshot();
    this.clockWhite = snap.white;
    this.clockBlack = snap.black;
    this.clockRunning = snap.running;
  }

  get resultText(): string {
    return this.outcome ? describeTermination(this.outcome) : '';
  }

  pgn(): string {
    const human = 'You';
    const bot = this.opts.botName;
    return toPgn({
      white: this.humanColor === 'w' ? human : bot,
      black: this.humanColor === 'b' ? human : bot,
      whiteElo: this.humanColor === 'b' ? this.opts.opponent.level : undefined,
      blackElo: this.humanColor === 'w' ? this.opts.opponent.level : undefined,
      startedAt: this.startedAt,
      timeControl: this.opts.timeControl,
      outcome: this.game.outcome,
      moves: this.game.records,
      startFen: this.game.startFen === STANDARD_START ? undefined : this.game.startFen,
      rated: this.game.rated,
      extra: {
        BotModel: this.opts.opponent.family,
        BotRatingScale: 'Lichess rapid',
        BotPack: `${this.opts.opponent.pack.id}@${this.opts.opponent.pack.sha256.slice(0, 12)}`,
        BotSeed: String(this.opts.opponent.seed)
      }
    });
  }

  record(): StoredGame {
    const g = this.game;
    return {
      id: this.opts.id,
      startedAt: this.startedAt.toISOString(),
      endedAt: g.outcome ? new Date().toISOString() : null,
      persona: this.opts.persona,
      botName: this.opts.botName,
      family: this.opts.opponent.family,
      pack: this.opts.opponent.pack.id,
      packSha256: this.opts.opponent.pack.sha256,
      botLevel: this.opts.opponent.level,
      humanColor: this.humanColor,
      timeControl: this.opts.timeControl,
      startFen: g.startFen,
      moves: [...g.records],
      outcome: g.outcome,
      rated: g.rated,
      takebacks: g.takebacks,
      seed: this.opts.opponent.seed,
      pgn: g.outcome ? this.pgn() : ''
    };
  }

  private async persist(): Promise<void> {
    try {
      await this.opts.storage?.putGame(this.record());
    } catch (err) {
      console.error('Could not save the game:', err);
    }
  }

  private async end(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.cancelBot();
    const rec = this.record();
    try {
      await this.opts.storage?.putGame(rec);
      await this.opts.onFinished?.(rec);
    } catch (err) {
      this.notice = { kind: 'error', text: `The game could not be saved: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export type { WDL };
