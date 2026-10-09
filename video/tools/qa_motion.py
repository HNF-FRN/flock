"""Motion QA: finds isolated frame-to-frame jumps (pops, glitches, stalls).

Decodes the film at 160x90 grayscale, measures the mean absolute difference
between consecutive frames, and lists frames whose change spikes far above
their neighbourhood (a pop) or drops to zero inside motion (a stall).

  python video/tools/qa_motion.py <ffmpeg.exe> <video.mp4> [fps]
"""
import subprocess
import sys

import numpy as np

ff, video = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 30.0
W, H = 160, 90
raw = subprocess.run([ff, "-v", "error", "-i", video, "-vf", f"scale={W}:{H}:flags=area,format=gray", "-f", "rawvideo", "-"],
                     capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)
d = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
print(f"{len(frames)} frames, {len(frames) / fps:.2f}s; median change {np.median(d):.3f}")
pops = []
for i in range(2, len(d) - 2):
    neigh = np.median(np.concatenate([d[i - 2:i], d[i + 1:i + 3]]))
    if d[i] > 4 and d[i] > 3.5 * max(neigh, 0.4):
        pops.append((i + 1, d[i], neigh))
print("spikes (frame, change, neighbourhood) — check each is an intended cut or flash:")
for f, v, n in pops:
    print(f"  f{f:5d}  t={f / fps:6.2f}s  {v:6.2f} vs {n:5.2f}")
stalls = []
for i in range(3, len(d) - 3):
    if d[i] < 0.02 and d[i - 1] > 0.6 and d[i + 1] > 0.6:
        stalls.append(i + 1)
print("stalls (a frozen frame inside motion):", ", ".join(f"f{f}@{f / fps:.2f}s" for f in stalls) or "none")
# energy curve per second, to read the film's rhythm
sec = int(len(d) / fps)
curve = [d[int(s * fps):int((s + 1) * fps)].mean() for s in range(sec)]
print("motion per second:")
for s in range(0, sec, 10):
    print(f"  {s:3d}s " + " ".join(f"{v:4.1f}" for v in curve[s:s + 10]))
