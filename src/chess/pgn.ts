/**
 * PGN export (PGN Standard 1994, with Lichess-style [%clk] comments) and import.
 * Our own tags carry what the rating ledger and replay need; they are ignored by other tools.
 */
import { Chess } from 'chess.js';
import { pgnClock } from './clock';
import type { MoveRecord } from './game';
import { pgnTermination, type Outcome } from './rules';
import { pgnTimeControl, type TimeControl } from './timeControl';

export const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface PgnInput {
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  startedAt: Date;
  timeControl: TimeControl;
  outcome: Outcome | null;
  moves: readonly MoveRecord[];
  startFen?: string;
  rated: boolean;
  extra?: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, '0');

function escape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function toPgn(g: PgnInput): string {
  const d = g.startedAt;
  const tags: [string, string][] = [
    ['Event', g.rated ? 'DITHER rated rapid game' : 'DITHER casual game'],
    ['Site', 'DITHER (offline)'],
    ['Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`],
    ['Round', '-'],
    ['White', g.white],
    ['Black', g.black],
    ['Result', g.outcome?.result ?? '*']
  ];
  if (g.whiteElo !== undefined) tags.push(['WhiteElo', String(Math.round(g.whiteElo))]);
  if (g.blackElo !== undefined) tags.push(['BlackElo', String(Math.round(g.blackElo))]);
  tags.push(
    ['UTCDate', `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`],
    ['UTCTime', `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`],
    ['TimeControl', pgnTimeControl(g.timeControl)],
    ['Termination', g.outcome ? pgnTermination(g.outcome.termination) : 'unterminated']
  );
  if (g.startFen && g.startFen !== STANDARD_START) {
    tags.push(['SetUp', '1'], ['FEN', g.startFen]);
  }
  for (const [k, v] of Object.entries(g.extra ?? {})) tags.push([k, v]);

  const startFull = g.startFen ? Number(g.startFen.split(' ')[5] ?? 1) : 1;
  const blackFirst = g.startFen ? g.startFen.split(' ')[1] === 'b' : false;
  const tokens: string[] = [];
  g.moves.forEach((m, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    const moveNo = startFull + Math.floor(ply / 2);
    if (m.color === 'w') tokens.push(`${moveNo}.`);
    else if (i === 0) tokens.push(`${moveNo}...`);
    tokens.push(m.san);
    if (m.clock !== null) tokens.push(`{ [%clk ${pgnClock(m.clock)}] }`);
  });
  tokens.push(g.outcome?.result ?? '*');

  // Wrap movetext at 80 columns (PGN 8.2.2.2 recommends < 80).
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > 79) {
      lines.push(line);
      line = t;
    } else line = line ? `${line} ${t}` : t;
  }
  if (line) lines.push(line);
  return `${tags.map(([k, v]) => `[${k} "${escape(v)}"]`).join('\n')}\n\n${lines.join('\n')}\n`;
}

export interface ParsedPgn {
  headers: Record<string, string>;
  /** Moves in UCI. */
  moves: string[];
  /** Clock after each move in ms, or null when absent. */
  clocks: (number | null)[];
  startFen: string;
}

const CLK = /\[%clk\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/;

/** Parse one game. Throws on illegal moves. */
export function parsePgn(pgn: string): ParsedPgn {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const comments = new Map(chess.getComments().map((c) => [c.fen, c.comment]));
  const clocks = history.map((m) => {
    const c = comments.get(m.after);
    const hit = c ? CLK.exec(c) : null;
    return hit ? (Number(hit[1]) * 3600 + Number(hit[2]) * 60 + Number(hit[3])) * 1000 : null;
  });
  return {
    headers,
    moves: history.map((m) => m.from + m.to + (m.promotion ?? '')),
    clocks,
    startFen: headers.FEN ?? STANDARD_START
  };
}
