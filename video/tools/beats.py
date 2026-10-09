"""Beat-grid + energy analysis for BGM candidates (video-shotcraft music-beat-sync method).

Usage: uv run --with librosa --with scipy --python 3.11 tools/beats.py <file.mp3> [...]
Prints BPM / t0 / residual from a least-squares grid fit of beat_track's beats,
a per-bar loudness + kick-strength table, and the strongest kick beats.
"""
import sys
import numpy as np
import librosa
from scipy.signal import butter, sosfilt


def analyse(path):
    y, sr = librosa.load(path, sr=None, mono=True)
    dur = len(y) / sr
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, tightness=400, units="time")
    i = np.arange(len(beats))
    A = np.vstack([i, np.ones_like(i)]).T
    (T, t0), *_ = np.linalg.lstsq(A, beats, rcond=None)
    # pull t0 back to the first beat at or after 0
    k = int(np.floor(t0 / T))
    t0 = t0 - k * T
    res = beats - (t0 + (i + k) * T) if False else beats - (np.round((beats - t0) / T) * T + t0)
    print(f"\n=== {path}")
    print(f"duration={dur:.2f}s  BPM={60.0 / T:.3f}  t0={t0:.4f}s  T={T:.5f}s  beat_track_tempo={float(np.atleast_1d(tempo)[0]):.2f}")
    print(f"residual max={np.abs(res).max() * 1000:.1f}ms  median={np.median(np.abs(res)) * 1000:.1f}ms  n_beats={len(beats)}")

    sos = butter(4, [40, 160], btype="band", fs=sr, output="sos")
    kick = sosfilt(sos, y)
    env = librosa.onset.onset_strength(y=kick, sr=sr)
    times = librosa.times_like(env, sr=sr)
    rms = librosa.feature.rms(y=y)[0]
    rtimes = librosa.times_like(rms, sr=sr)
    hp = librosa.feature.rms(y=sosfilt(butter(4, 4000, btype="high", fs=sr, output="sos"), y))[0]

    nbeats = int((dur - t0) / T)
    kicks = []
    for n in range(nbeats):
        t = t0 + n * T
        e = env[np.argmin(np.abs(times - t))]
        kicks.append((n, t, e))
    kmax = max(e for _, _, e in kicks) or 1
    print("bar | t(s)   | loud(dB) | hi(dB) | kick per beat (0-9)")
    for b in range(0, nbeats // 4):
        ts, te = t0 + b * 4 * T, t0 + (b + 1) * 4 * T
        m = (rtimes >= ts) & (rtimes < te)
        loud = 20 * np.log10(np.mean(rms[m]) + 1e-9)
        hi = 20 * np.log10(np.mean(hp[m]) + 1e-9)
        ks = "".join(str(min(9, int(9 * kicks[b * 4 + j][2] / kmax))) for j in range(4) if b * 4 + j < len(kicks))
        print(f"{b:3d} | {ts:6.2f} | {loud:7.1f} | {hi:6.1f} | {ks}")
    top = sorted(kicks, key=lambda x: -x[2])[:12]
    print("strongest kick beats:", ", ".join(f"b{n}@{t:.2f}s" for n, t, _ in sorted(top)))


for p in sys.argv[1:]:
    analyse(p)
