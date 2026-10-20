"""
Synthesise the interface tones (public/sounds/select.wav, confirm.wav, back.wav).

    python3 tools/sounds/synth.py

Soft, short "computer" blips to sit with the dither look: a sine whose brightness comes from a
fast-decaying frequency modulation (a brief "bloop" that settles into a pure tone), a gentle
attack instead of a click, and a touch of low-passed square wave for a retro, 8-bit warmth.
Mono, 22.05 kHz, 16-bit, like the other sounds. Made here, so no licence to track. Needs numpy.
"""
import os, wave
import numpy as np

SR = 22050
out = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'sounds')


def lowpass(x, cutoff):
    # One-pole low-pass, run forwards and backwards (no phase shift).
    a = np.exp(-2 * np.pi * cutoff / SR)
    for _ in range(2):
        y = np.empty_like(x)
        acc = 0.0
        for i, v in enumerate(x):
            acc = (1 - a) * v + a * acc
            y[i] = acc
        x = y[::-1]
    return x


def blip(freq, dur=0.12, glide=1.06, index=1.6, warmth=0.12):
    n = int(SR * dur)
    t = np.arange(n) / SR
    # Pitch settles from slightly above to the note.
    f = freq * (1 + (glide - 1) * np.exp(-t / 0.012))
    phase = 2 * np.pi * np.cumsum(f) / SR
    # FM brightness that dies away in ~15 ms.
    mod = index * np.exp(-t / 0.015) * np.sin(2 * phase)
    x = np.sin(phase + mod)
    square = lowpass(np.sign(np.sin(phase)), freq * 2.5)
    x = (1 - warmth) * x + warmth * square
    # Raised-cosine attack (6 ms), exponential decay, short fade to zero.
    att = int(SR * 0.006)
    envl = np.exp(-t / (dur * 0.38))
    envl[:att] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, att))
    fo = int(SR * 0.02)
    envl[-fo:] *= np.linspace(1, 0, fo) ** 2
    return x * envl


def seq(*parts):
    """(signal, start seconds) pairs mixed into one buffer."""
    n = max(int(s * SR) + len(x) for x, s in parts)
    y = np.zeros(n)
    for x, s in parts:
        i = int(s * SR)
        y[i:i + len(x)] += x
    return y


def save(name, x, peak):
    x = lowpass(x, 5200)
    x = x / np.max(np.abs(x)) * peak
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(out, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(name, f'{len(x) / SR * 1000:.0f} ms')


save('select', blip(880, 0.11), 0.32)
save('confirm', seq((blip(659.3, 0.1), 0.0), (blip(987.8, 0.13), 0.065)), 0.36)
save('back', seq((blip(784.0, 0.1), 0.0), (blip(523.3, 0.13), 0.065)), 0.32)
