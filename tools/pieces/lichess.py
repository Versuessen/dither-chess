"""
Copy piece sets from a Lichess (lila) checkout into public/pieces/<set>/ and write the chessground
CSS for them (src/game/pieces-lichess.css).

    git clone --depth 1 --filter=blob:none --sparse https://github.com/lichess-org/lila.git
    git -C lila sparse-checkout set public/piece/merida public/piece/pixel ...
    python3 tools/pieces/lichess.py <lila checkout>

Only sets whose licence (lila COPYING.md) allows redistribution in an AGPL app are listed; their
authors and licences are in NOTICE. The SVGs are copied unchanged.
"""
import os, shutil, subprocess, sys

# id in the app -> (lila directory, author, licence)
SETS = {
    'merida': ('merida', 'Armando Hernandez Marroquin', 'GPL-2.0-or-later'),
    'pixel': ('pixel', 'therealqtpi', 'AGPL-3.0-or-later'),
    'letter': ('letter', 'usolando', 'AGPL-3.0-or-later'),
    'shapes': ('shapes', 'flugsio', 'CC BY-SA 4.0'),
    'kiwen-suwi': ('kiwen-suwi', 'neverRare', 'CC BY 4.0'),
}
PIECES = {'P': 'pawn', 'N': 'knight', 'B': 'bishop', 'R': 'rook', 'Q': 'queen', 'K': 'king'}

lila = sys.argv[1]
root = os.path.join(os.path.dirname(__file__), '..', '..')
commit = subprocess.run(['git', '-C', lila, 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
css = [f'/* Piece sets from Lichess (lila @ {commit[:12]}), copied by tools/pieces/lichess.py. Licences in NOTICE. */']
for app_id, (src, author, licence) in SETS.items():
    out = os.path.join(root, 'public', 'pieces', app_id)
    os.makedirs(out, exist_ok=True)
    css.append(f'/* {app_id}: {author}, {licence} */')
    for colour, cname in (('w', 'white'), ('b', 'black')):
        for code, name in PIECES.items():
            shutil.copyfile(os.path.join(lila, 'public', 'piece', src, f'{colour}{code}.svg'), os.path.join(out, f'{colour}{code}.svg'))
            css.append(f".cg-wrap.pieces-{app_id} piece.{name}.{cname} {{ background-image: url('/pieces/{app_id}/{colour}{code}.svg'); }}")
with open(os.path.join(root, 'src', 'game', 'pieces-lichess.css'), 'w') as f:
    f.write('\n'.join(css) + '\n')
print(commit, ', '.join(SETS))
