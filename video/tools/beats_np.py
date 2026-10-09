"""Beat grid + energy map for a music track, with numpy/scipy only.

Decodes with ffmpeg, builds a spectral-flux onset envelope, finds the tempo by
autocorrelation, the phase by comb scoring, then refines the grid by least
squares on the onset peaks (the music-beat-sync method). Also prints loudness
and kick strength per bar, to place the film's big hits on the strongest beats.

  python video/tools/beats_np.py <ffmpeg.exe> <track.mp3> [...]
"""
import subprocess
import sys

import numpy as np
from scipy.signal import butter, sosfiltfilt

SR = 22050
HOP = 256


def decode(ffmpeg, path):
    raw = subprocess.run([ffmpeg, "-v", "quiet", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def onset_env(y):
    n_fft = 2048
    win = np.hanning(n_fft).astype(np.float32)
    frames = 1 + (len(y) - n_fft) // HOP
    idx = np.arange(n_fft)[None, :] + HOP * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(y[idx] * win, axis=1))
    logs = np.log1p(100 * spec)
    flux = np.maximum(0, np.diff(logs, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    # remove slow trend, normalise
    k = 16
    trend = np.convolve(flux, np.ones(2 * k + 1) / (2 * k + 1), mode="same")
    env = np.maximum(0, flux - trend)
    return env / (env.max() + 1e-9)


def band_env(y, lo, hi):
    sos = butter(4, [lo, hi], btype="band", fs=SR, output="sos")
    b = sosfiltfilt(sos, y)
    frames = len(b) // HOP
    e = np.sqrt(np.mean(b[: frames * HOP].reshape(frames, HOP) ** 2, axis=1))
    d = np.maximum(0, np.diff(e, prepend=e[0]))
    return e, d / (d.max() + 1e-9)


def analyse(ffmpeg, path):
    y = decode(ffmpeg, path)
    dur = len(y) / SR
    env = onset_env(y)
    fps = SR / HOP
    # tempo by autocorrelation within 85..170 BPM, weighted toward ~120
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    lags = np.arange(len(ac))
    bpm_of = 60 * fps / np.maximum(lags, 1)
    ok = (bpm_of >= 85) & (bpm_of <= 170)
    weight = np.exp(-0.5 * (np.log2(bpm_of / 122) / 0.6) ** 2)
    score = np.where(ok, ac * weight, 0)
    lag = int(np.argmax(score))
    # parabolic refine
    if 1 <= lag < len(ac) - 1:
        a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
        lag_f = lag + 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
    else:
        lag_f = float(lag)
    T = lag_f / fps
    # phase: comb score
    phases = np.linspace(0, T, 200, endpoint=False)
    t_env = np.arange(len(env)) / fps
    best, best_p = -1, 0
    for p in phases:
        ts = np.arange(p, dur, T)
        ix = np.clip(np.round(ts * fps).astype(int), 0, len(env) - 1)
        sc = env[ix].sum()
        if sc > best:
            best, best_p = sc, p
    # refine: snap each predicted beat to the local onset max (±50ms), then least squares
    ts = np.arange(best_p, dur - 0.05, T)
    snapped = []
    for t in ts:
        lo, hi = int((t - 0.05) * fps), int((t + 0.05) * fps) + 1
        lo, hi = max(lo, 0), min(hi, len(env))
        if hi - lo < 2:
            continue
        seg = env[lo:hi]
        if seg.max() < 0.08:
            continue
        snapped.append((round((t - best_p) / T), (lo + int(np.argmax(seg))) / fps))
    n = np.array([s[0] for s in snapped], dtype=float)
    tt = np.array([s[1] for s in snapped])
    A = np.vstack([n, np.ones_like(n)]).T
    (T2, t02), *_ = np.linalg.lstsq(A, tt, rcond=None)
    res = tt - (t02 + n * T2)
    t0 = t02 - np.floor(t02 / T2) * T2
    print(f"\n=== {path.split('/')[-1]}")
    print(f"duration={dur:.2f}s  BPM={60 / T2:.3f}  t0={t0:.4f}s  T={T2:.5f}s  (fit on {len(n)} beats)")
    print(f"residual: median={np.median(np.abs(res)) * 1000:.1f}ms  p90={np.percentile(np.abs(res), 90) * 1000:.1f}ms")

    kick_e, kick_d = band_env(y, 40, 150)
    rms_frames = len(y) // HOP
    rms = np.sqrt(np.mean(y[: rms_frames * HOP].reshape(rms_frames, HOP) ** 2, axis=1))
    hi_e, _ = band_env(y, 4000, 10000)
    nb = int((dur - t0) / T2)
    kicks = []
    for k in range(nb):
        t = t0 + k * T2
        i = int(round(t * fps))
        kicks.append(kick_d[max(0, i - 2): i + 3].max() if i < len(kick_d) else 0)
    kicks = np.array(kicks)
    print("bar |  t(s)  | loud dB | hats dB | kick/beat")
    for b in range(nb // 4):
        a, z = t0 + b * 4 * T2, t0 + (b + 1) * 4 * T2
        i, j = int(a * fps), int(z * fps)
        loud = 20 * np.log10(rms[i:j].mean() + 1e-9)
        hats = 20 * np.log10(hi_e[i:j].mean() + 1e-9)
        ks = "".join(str(min(9, int(9.99 * kicks[b * 4 + q]))) for q in range(4))
        print(f"{b:3d} | {a:6.2f} | {loud:7.1f} | {hats:7.1f} | {ks}")
    top = np.argsort(-kicks)[:16]
    print("strongest kicks:", ", ".join(f"b{k}@{t0 + k * T2:.2f}" for k in sorted(top)))


if __name__ == "__main__":
    ff = sys.argv[1]
    for p in sys.argv[2:]:
        analyse(ff, p)
