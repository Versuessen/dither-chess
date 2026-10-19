/**
 * Stockfish 19 (lite, single-threaded WebAssembly; vendor/stockfish) in a Web Worker, for
 * reviewing finished games. It is only ever asked to evaluate positions; it never plays.
 */
import jsUrl from '../../vendor/stockfish/stockfish-19-lite-single.js?url';
import wasmUrl from '../../vendor/stockfish/stockfish-19-lite-single.wasm?url';

export const ENGINE_NAME = 'Stockfish 19 lite';

export interface EngineEval {
  /** From the side to move's point of view. */
  cp: number | null;
  mate: number | null;
  best: string | null;
  pv: string[];
  depth: number;
}

export interface SearchLimits {
  depth: number;
  /** Upper bound per position, ms. */
  movetime: number;
}

export class Engine {
  private worker: Worker;
  private listener: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private dead: Error | null = null;

  private constructor() {
    // The script finds its .wasm from the URL fragment.
    this.worker = new Worker(`${new URL(jsUrl, location.href).href}#${encodeURIComponent(new URL(wasmUrl, location.href).href)}`);
    this.worker.onmessage = (e: MessageEvent) => {
      const text = typeof e.data === 'string' ? e.data : String(e.data);
      for (const line of text.split('\n')) if (line) this.listener?.(line);
    };
    this.worker.onerror = (e) => {
      this.dead = new Error(e.message || 'The analysis engine failed to start.');
      this.listener?.('__error__');
    };
  }

  static async create(): Promise<Engine> {
    const engine = new Engine();
    await engine.exchange(['uci'], (l) => l === 'uciok');
    await engine.exchange(['setoption name Hash value 32', 'isready'], (l) => l === 'readyok');
    return engine;
  }

  /** Send commands and collect lines until `done` says so; one exchange at a time. */
  private exchange(commands: string[], done: (line: string) => boolean, onLine?: (line: string) => void): Promise<void> {
    const run = this.queue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.dead) return reject(this.dead);
          this.listener = (line) => {
            if (line === '__error__') {
              this.listener = null;
              reject(this.dead ?? new Error('engine error'));
              return;
            }
            onLine?.(line);
            if (done(line)) {
              this.listener = null;
              resolve();
            }
          };
          for (const c of commands) this.worker.postMessage(c);
        })
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  async newGame(): Promise<void> {
    await this.exchange(['ucinewgame', 'isready'], (l) => l === 'readyok');
  }

  /** Evaluate one position (FEN). */
  async evaluate(fen: string, limits: SearchLimits): Promise<EngineEval> {
    const result: EngineEval = { cp: null, mate: null, best: null, pv: [], depth: 0 };
    await this.exchange(
      [`position fen ${fen}`, `go depth ${limits.depth} movetime ${limits.movetime}`],
      (l) => l.startsWith('bestmove'),
      (l) => {
        if (l.startsWith('info ') && l.includes(' score ') && !/ multipv [2-9]/.test(l) && !l.includes(' bound ')) {
          const depth = /\bdepth (\d+)/.exec(l);
          const cp = / score cp (-?\d+)/.exec(l);
          const mate = / score mate (-?\d+)/.exec(l);
          const pv = / pv (.+)$/.exec(l);
          if (depth) result.depth = Number(depth[1]);
          result.cp = cp ? Number(cp[1]) : null;
          result.mate = mate ? Number(mate[1]) : null;
          if (pv) result.pv = pv[1]!.trim().split(/\s+/);
        } else if (l.startsWith('bestmove')) {
          const m = /^bestmove (\S+)/.exec(l)?.[1];
          result.best = m && m !== '(none)' ? m : null;
        }
      }
    );
    return result;
  }

  dispose(): void {
    this.worker.terminate();
    this.dead ??= new Error('engine closed');
  }
}
