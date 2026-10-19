/**
 * Build src/chess/openings.json from the CC0 Lichess opening tables in vendor/chess-openings.
 * Each line's moves are played out and the final position (EPD: placement, side, castling,
 * en passant) is keyed to its ECO code and name, so a game is named by where it stands, whatever
 * the move order.
 *
 *   node tools/openings/build.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = join(root, 'vendor/chess-openings');
const positions: Record<string, [string, string]> = {};
let lines = 0;

for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    if (!eco || !name || !pgn) throw new Error(`${f}.tsv: bad row ${row}`);
    const chess = new Chess();
    for (const tok of pgn.split(/\s+/)) {
      if (!tok || /^\d+\.+$/.test(tok)) continue;
      chess.move(tok);
    }
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    // The longest line wins when two reach the same position (the tables list general names first).
    positions[epd] = [eco, name];
    lines++;
  }
}

const out = { source: 'lichess-org/chess-openings@a6189a30 (CC0 1.0)', positions };
writeFileSync(join(root, 'src/chess/openings.json'), JSON.stringify(out) + '\n');
console.log(`${lines} lines, ${Object.keys(positions).length} positions`);
