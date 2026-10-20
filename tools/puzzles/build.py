"""
Build the puzzle set (public/puzzles/puzzles-<version>.tsv.gz) from the Lichess puzzle database
(CC0, https://database.lichess.org/#puzzles).

    curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
    python3 tools/puzzles/build.py lichess_db_puzzle.csv.zst

Only well-tested puzzles are kept (popularity >= 85, played >= 1000 times, rating deviation
<= 80). From those, a fixed-seed sample of PER_BAND puzzles per difficulty band, with every key
piece (the piece that makes the solver's first move) given at least PIECE_FLOOR puzzles where
the database has that many, so piece filters always have plenty to draw from.

One puzzle per line, tab-separated: id, FEN, moves (UCI, the first is the opponent's),
rating, theme bits (THEMES below; src/puzzles/data.ts reads them), key piece (PNBRQK).
The first line is a comment with the source's SHA-256 and the counts. Needs zstandard.
"""
import csv, gzip, hashlib, io, json, os, random, sys
import zstandard

VERSION = 1
PER_BAND = 12000
PIECE_FLOOR = 900
# Difficulty bands by Lichess puzzle rating; must match src/puzzles/data.ts.
BANDS = [(0, 1250), (1250, 1650), (1650, 2050), (2050, 9999)]
# Theme bits; the order must match src/puzzles/data.ts.
THEMES = [
    'mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'crushing', 'advantage', 'equality',
    'opening', 'middlegame', 'endgame', 'fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack',
    'discoveredCheck', 'deflection', 'attraction', 'promotion', 'defensiveMove', 'quietMove',
    'hangingPiece', 'trappedPiece', 'backRankMate', 'oneMove', 'short', 'long', 'veryLong', 'zugzwang',
]
BIT = {t: 1 << i for i, t in enumerate(THEMES)}
PIECES = 'PNBRQK'

src = sys.argv[1]
out_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'puzzles')


def rows():
    with open(src, 'rb') as f:
        reader = csv.reader(io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding='utf-8'))
        header = next(reader)
        for row in reader:
            yield dict(zip(header, row))


def board_piece(fen, square):
    """The piece letter (upper case) on a square of a FEN, or None."""
    ranks = fen.split()[0].split('/')
    file, rank = ord(square[0]) - 97, int(square[1])
    row = ranks[8 - rank]
    col = 0
    for ch in row:
        if ch.isdigit():
            col += int(ch)
        else:
            if col == file:
                return ch.upper()
            col += 1
    return None


def keep(d):
    return int(d['Popularity']) >= 85 and int(d['NbPlays']) >= 1000 and int(d['RatingDeviation']) <= 80


def band(rating):
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= rating < hi:
            return i
    return None


def key_piece(d):
    moves = d['Moves'].split()
    if len(moves) < 2:
        return None
    return board_piece(d['FEN'], moves[1][:2])


sha = hashlib.sha256()
with open(src, 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''):
        sha.update(chunk)

# Pass 1: how many good puzzles each (band, key piece) has.
avail = {(b, p): 0 for b in range(len(BANDS)) for p in PIECES}
for d in rows():
    if not keep(d):
        continue
    b, p = band(int(d['Rating'])), key_piece(d)
    if b is not None and p in PIECES:
        avail[(b, p)] += 1

# Quotas: a floor per piece, the rest of the band in proportion to what is left.
quota = {}
for b in range(len(BANDS)):
    base = {p: min(avail[(b, p)], PIECE_FLOOR) for p in PIECES}
    rest = PER_BAND - sum(base.values())
    spare = {p: avail[(b, p)] - base[p] for p in PIECES}
    total_spare = sum(spare.values()) or 1
    for p in PIECES:
        quota[(b, p)] = base[p] + min(spare[p], int(rest * spare[p] / total_spare))

# Pass 2: reservoir-sample each bucket with a fixed seed.
rng = random.Random(20261020)
seen = {k: 0 for k in quota}
picked = {k: [] for k in quota}
for d in rows():
    if not keep(d):
        continue
    b, p = band(int(d['Rating'])), key_piece(d)
    if b is None or p not in PIECES:
        continue
    k = (b, p)
    seen[k] += 1
    line = '\t'.join([
        d['PuzzleId'], d['FEN'], d['Moves'], d['Rating'],
        str(sum(BIT.get(t, 0) for t in d['Themes'].split())), p,
    ])
    if len(picked[k]) < quota[k]:
        picked[k].append(line)
    else:
        j = rng.randrange(seen[k])
        if j < quota[k]:
            picked[k][j] = line

lines = sorted(l for v in picked.values() for l in v)
counts = {f'{BANDS[b][0]}-{BANDS[b][1]}': {p: len(picked[(b, p)]) for p in PIECES} for b in range(len(BANDS))}
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, f'puzzles-{VERSION}.tsv.gz')
head = '# ' + json.dumps({'source': 'lichess_db_puzzle.csv.zst', 'sha256': sha.hexdigest(), 'count': len(lines), 'counts': counts})
with gzip.GzipFile(path, 'wb', compresslevel=9, mtime=0) as g:
    g.write(('\n'.join([head, *lines]) + '\n').encode())
print(path, len(lines), os.path.getsize(path), 'bytes')
print(json.dumps(counts))
