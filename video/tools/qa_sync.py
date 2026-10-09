"""Beat-sync QA on a finished film: finds the kick onsets in its own audio track
near each bar-pinned visual cut and reports the offset (music − picture).

  python video/tools/qa_sync.py <ffmpeg.exe> <film.mp4>
"""
import subprocess
import sys

import numpy as np
from scipy.signal import butter, sosfilt

ff, film = sys.argv[1], sys.argv[2]
SR = 44100
raw = subprocess.run([ff, "-v", "quiet", "-i", film, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                     capture_output=True, check=True).stdout
y = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
low = sosfilt(butter(4, [30, 150], btype="band", fs=SR, output="sos"), y)
step = 0.004


def db(t):
    a, b = int(t * SR), int((t + step) * SR)
    seg = low[a:b]
    return 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9) if len(seg) else -120


B = lambda n: 0.1507 + n * 0.46171
cuts = {"beat comes in (bar 8)": B(32), "full / open all (bar 16)": B(64), "card 1 (bar 24)": B(96),
        "card 1 out (bar 25)": B(100), "breakdown (bar 32)": B(128), "build (bar 40)": B(160),
        "keys (bar 45)": B(180), "drop (bar 48)": B(192)}
worst = 0
for name, t in cuts.items():
    ts = np.arange(t - 0.12, t + 0.12, step)
    vals = np.array([db(x) for x in ts])
    found = None
    for i in range(10, len(vals)):
        if vals[i] - vals[i - 10:i].min() > 12 and vals[i] > -34:
            found = ts[i]
            break
    if found is None:
        print(f"{name:28s} cut {t:7.3f}  no kick within ±120 ms (no kick on this bar)")
        continue
    off = (found - t) * 1000
    worst = max(worst, abs(off))
    print(f"{name:28s} cut {t:7.3f}  kick {found:7.3f}  offset {off:+5.0f} ms  ({off / 16.67:+.1f} frames @60)")
print(f"worst offset: {worst:.0f} ms")
