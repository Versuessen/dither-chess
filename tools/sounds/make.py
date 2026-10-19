"""
Make public/sounds/*.wav from the CC0 packs listed in NOTICE (Sounds and music).

    python3 tools/sounds/make.py <downloads-dir>

<downloads-dir> holds the packs as downloaded from itch.io:
  polar-material/wood.wav, polar-material/stone1.wav   (Polar_34, Material Sound Effects)
  obsx/Ogg/...                                          (ObsydianX, Interface SFX Pack 1, OGG zip unpacked)

Every sound is mono, 22.05 kHz, 16-bit WAV, trimmed to its audible part with short fades and peak
normalised; layered sounds are mixed here so the app plays one file per event. Needs ffmpeg and numpy.
"""
import os, subprocess, sys, wave
import numpy as np

SR = 22050
src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'sounds')
os.makedirs(out, exist_ok=True)


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(src, path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def env(x, ms=10):
    n = max(1, int(SR * ms / 1000))
    return np.sqrt(np.convolve(x ** 2, np.ones(n) / n, 'same'))


def knock(path, index):
    """The index-th separate knock in a recording of several (onsets 60 ms apart or more)."""
    x = load(path)
    e = env(x)
    pk = e.max()
    ons = np.where((e[1:] > pk * 0.25) & (e[:-1] <= pk * 0.25))[0]
    keep = []
    for o in ons:
        if not keep or o - keep[-1] > 0.06 * SR:
            keep.append(o)
    a = max(0, keep[index] - int(0.004 * SR))
    b = keep[index + 1] - int(0.005 * SR) if index + 1 < len(keep) else len(x)
    return trim(x[a:min(b, a + int(0.35 * SR))])


def trim(x, floor=0.03):
    e = env(x)
    act = np.where(e > e.max() * floor)[0]
    x = x[act[0]:act[-1] + 1].copy() if len(act) else x.copy()
    fi = int(0.002 * SR)
    x[:fi] *= np.linspace(0, 1, fi)
    fo = max(1, int(len(x) * 0.3))
    x[-fo:] *= np.linspace(1, 0, fo) ** 2
    return x


def tone(path):
    return trim(load(path), 0.01)


def mix(*parts):
    """(sound, start in seconds, gain) layers."""
    n = max(int(at * SR) + len(s) for s, at, _ in parts)
    y = np.zeros(n, np.float32)
    for s, at, g in parts:
        i = int(at * SR)
        y[i:i + len(s)] += s / np.abs(s).max() * g
    return y


def save(name, x, peak):
    x = x / np.abs(x).max() * peak
    with wave.open(os.path.join(out, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    print(f'{name}.wav {len(x) / SR * 1000:.0f} ms')


wood = 'polar-material/wood.wav'
stone = 'polar-material/stone1.wav'
ui = 'obsx/Ogg'
move = knock(wood, 1)

# Board.
save('move', move, 0.8)
save('capture', mix((knock(stone, 1), 0, 0.7), (knock(wood, 2), 0.035, 1.0)), 0.9)
save('castle', mix((knock(wood, 0), 0, 0.8), (move, 0.11, 1.0)), 0.8)
save('check', mix((move, 0, 1.0), (tone(f'{ui}/Cursor_tones/cursor_style_4.ogg'), 0.015, 0.45)), 0.85)
save('promote', mix((move, 0, 1.0), (tone(f'{ui}/Confirm_tones/style5/confirm_style_5_001.ogg'), 0.03, 0.5)), 0.85)
save('low-time', knock(stone, 2), 0.35)
save('illegal', tone(f'{ui}/Error_tones/style5/error_style_5_001.ogg'), 0.45)
save('start', tone(f'{ui}/Confirm_tones/style5/confirm_style_5_001.ogg'), 0.5)
save('end', tone(f'{ui}/Confirm_tones/style2/confirm_style_2_001.ogg'), 0.5)
# Interface.
save('select', tone(f'{ui}/Cursor_tones/cursor_style_5.ogg'), 0.35)
save('confirm', tone(f'{ui}/Confirm_tones/style5/confirm_style_5_001.ogg'), 0.4)
save('back', tone(f'{ui}/Back_tones/style5/back_style_5_001.ogg'), 0.35)
