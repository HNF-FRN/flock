// Synthesises the film's pointer clicks in code (no sample library): a crisp
// band-passed noise transient over a short low "thock", in two slightly
// different variants so repeated clicks never sound machine-gunned.
//   node video/tools/make-sfx.mjs   → public/audio/click-a.wav, click-b.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ band-pass biquad, applied in place. */
function bandpass(x, f0, q) {
  const w = (2 * Math.PI * f0) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

function click({ seed, f, q, thock, decay }) {
  const n = Math.round(0.12 * SR);
  const noise = new Float32Array(n);
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i++) noise[i] = rnd() * 2 - 1;
  bandpass(noise, f, q);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.0006);
    const tick = noise[i] * atk * Math.exp(-t / decay) * 3.2;
    const body = Math.sin(2 * Math.PI * thock * t) * Math.min(1, t / 0.001) * Math.exp(-t / 0.011) * 0.42;
    out[i] = tick + body;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.89;
  return out;
}

function wav(file, data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  fs.writeFileSync(file, buf);
}

const dir = path.join(ROOT, 'public', 'audio');
wav(path.join(dir, 'click-a.wav'), click({ seed: 11, f: 4200, q: 1.4, thock: 190, decay: 0.0042 }));
wav(path.join(dir, 'click-b.wav'), click({ seed: 29, f: 3700, q: 1.2, thock: 172, decay: 0.0048 }));
console.log('wrote click-a.wav, click-b.wav');
