"""Mix QA: compares the SFX stem to the music stem around every cue.

For each SFX cue it reports the SFX peak level against the music's level at
that moment, so too-loud hits (> +6 dB over the music) and buried ones
(< -14 dB under it) stand out. Run after `MIX_ONLY=bgm` and `MIX_ONLY=sfx` mixes.

  python video/tools/qa_mix.py video/out
"""
import json
import struct
import sys
import wave

import numpy as np

out = sys.argv[1]


def load(p):
    with wave.open(p, "rb") as w:
        n = w.getnframes()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
    v = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
    v = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float32) / (1 << 23)
    return v.reshape(-1, 2).mean(axis=1), 48000


bgm, sr = load(f"{out}/stem-bgm.wav")
sfx, _ = load(f"{out}/stem-sfx.wav")
cues = json.load(open(f"{out}/cues.json"))["cues"]


def db(x):
    return 20 * np.log10(max(x, 1e-6))


print(" time   src                       sfx-peak  music-rms   diff")
for c in cues:
    if c.get("bgm"):
        continue
    a = int(max(0, c["t"]) * sr)
    b = a + int(0.6 * sr)
    seg = sfx[a:b]
    if not len(seg):
        continue
    w = 2048
    env = np.sqrt(np.convolve(seg ** 2, np.ones(w) / w, mode="valid")) if len(seg) > w else np.array([np.sqrt((seg ** 2).mean())])
    pk = db(env.max())
    m = db(np.sqrt((bgm[max(0, a - sr // 2):b] ** 2).mean()))
    flag = "  LOUD" if pk - m > 6 else ("  buried" if pk - m < -14 else "")
    print(f"{c['t']:6.2f}  {c['src']:26s} {pk:7.1f}   {m:7.1f}   {pk - m:+5.1f}{flag}")
