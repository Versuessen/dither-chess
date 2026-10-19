/** Typed moves (keyboard play) and spoken moves (screen readers). */
import { Chess } from 'chess.js';

/** SAN without check marks and without "=" before a promotion piece. */
const normSan = (s: string) => s.replace(/[+#!?]/g, '').replace('=', '');

/**
 * A move typed in SAN ("Nf3", "exd5", "O-O", "e8=Q", "0-0"; piece letters in either case) or
 * UCI ("e2e4", "e7e8q"), as UCI if it is legal in `fen`, else null. A lower-case "b" is read as
 * the b-pawn first and as a bishop second, as on Lichess.
 */
export function parseTypedMove(fen: string, text: string): string | null {
  const t = text.trim().replace(/[!?+#]+$/g, '').replace(/0/g, 'O');
  if (!t) return null;
  const legal = new Chess(fen).moves({ verbose: true });
  const asUci = (m: (typeof legal)[number]) => m.from + m.to + (m.promotion ?? '');

  const lower = t.toLowerCase();
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(lower)) {
    const promo = lower[4];
    const m = legal.find((x) => x.from === lower.slice(0, 2) && x.to === lower.slice(2, 4) && (x.promotion ? x.promotion === (promo ?? 'q') : !promo));
    return m ? asUci(m) : null;
  }

  const promoUpper = (s: string) => s.replace(/([a-h][18])=?([qrbnQRBN])$/, (_, sq: string, p: string) => `${sq}${p.toUpperCase()}`);
  const candidates = [t, /^[kqrbn]/.test(t) ? t[0]!.toUpperCase() + t.slice(1) : t].map((c) => normSan(promoUpper(c.replace(/^o-o/i, (x) => x.toUpperCase()))));
  for (const want of candidates) {
    const m = legal.find((x) => normSan(x.san) === want);
    if (m) return asUci(m);
  }
  return null;
}

const PIECES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };

/** "Nxf7+" → "knight takes f7, check". */
export function spokenSan(san: string): string {
  const suffix = san.endsWith('#') ? ', checkmate' : san.endsWith('+') ? ', check' : '';
  let s = san.replace(/[+#]$/, '');
  if (s === 'O-O-O') return `castles queenside${suffix}`;
  if (s === 'O-O') return `castles kingside${suffix}`;
  const promo = /=([QRBN])$/.exec(s);
  s = s.replace(/=[QRBN]$/, '');
  const named = PIECES[s[0]!];
  const piece = named ?? 'pawn';
  if (named) s = s.slice(1);
  const capture = s.includes('x');
  const target = s.slice(-2);
  const from = s.replace('x', '').slice(0, -2);
  return `${piece}${from ? ` from ${from}` : ''} ${capture ? 'takes' : 'to'} ${target}${promo ? `, promotes to ${PIECES[promo[1]!]}` : ''}${suffix}`;
}
