// Mixes the film's soundtrack from its cue sheet, sample-accurately, in plain
// Node: ffmpeg only decodes each file once to float PCM; summing, gains,
// fades, normalising and the soft limiter happen here. Then it muxes.
//
//   node video/tools/mix.mjs                         → out/mix.wav (cues from out/cues.json)
//   node video/tools/mix.mjs out/flock-silent.mp4 out/flock.mp4   → also muxes
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG, run } from './capture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'public', 'audio');
const SR = 48000;

function decode(file) {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('exit', (code) => {
      if (code !== 0) return rej(new Error(`decode failed: ${file}`));
      const buf = Buffer.concat(chunks);
      res(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    });
  });
}

function writeWav(file, data) {
  // 24-bit PCM stereo
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 3);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 3, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2 * 3, 28);
  buf.writeUInt16LE(6, 32);
  buf.writeUInt16LE(24, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 3, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    buf.writeIntLE(Math.round(v * 8388607), 44 + i * 3, 3);
  }
  fs.writeFileSync(file, buf);
}

const sheet = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'cues.json'), 'utf8'));
const dur = sheet.duration;
const N = Math.ceil(dur * SR) * 2;
const mix = new Float32Array(N);
const cache = new Map();
const S = (t) => Math.round(t * SR);
/** Gain automation: [[t, gain], …], linear between points, held at the ends. */
function envAt(env, t) {
  if (t <= env[0][0]) return env[0][1];
  for (let i = 0; i < env.length - 1; i++) {
    const [t0, g0] = env[i];
    const [t1, g1] = env[i + 1];
    if (t < t1) return g0 + (g1 - g0) * ((t - t0) / (t1 - t0));
  }
  return env[env.length - 1][1];
}

// MIX_ONLY=bgm|sfx renders one stem (for checking the balance)
const only = process.env.MIX_ONLY;
for (const c of sheet.cues) {
  if (only === 'bgm' && !c.bgm) continue;
  if (only === 'sfx' && c.bgm) continue;
  if (!cache.has(c.src)) cache.set(c.src, await decode(path.join(AUDIO, c.src)));
  const src = cache.get(c.src);
  const frames = src.length / 2;
  const start = S(c.t);
  const off = S(c.offset || 0);
  let len = frames - off;
  if (c.dur) len = Math.min(len, S(c.dur));
  const fadeIn = S(c.fadeIn || 0.004);
  const fadeOutLen = c.dur ? S(0.03) : 0; // a cut sample ends without a click
  for (let i = 0; i < len; i++) {
    const at = start + i;
    if (at < 0) continue;
    if (at * 2 + 1 >= N) break;
    let g = c.vol;
    if (i < fadeIn) g *= i / fadeIn;
    if (fadeOutLen && i > len - fadeOutLen) g *= (len - i) / fadeOutLen;
    if (c.fadeOutAt != null) {
      const tt = at / SR;
      if (tt > c.fadeOutAt) g *= Math.max(0, 1 - (tt - c.fadeOutAt) / c.fadeOutDur);
    }
    if (c.env) g *= envAt(c.env, at / SR);
    mix[at * 2] += src[(off + i) * 2] * g;
    mix[at * 2 + 1] += src[(off + i) * 2 + 1] * g;
  }
}

// loudness: bring the mix to about −17 dBFS RMS, then a soft knee from −3 dBFS
// that never passes the −1 dBFS ceiling (headroom for the AAC encoder)
let sum = 0;
for (let i = 0; i < N; i++) sum += mix[i] * mix[i];
const rms = Math.sqrt(sum / N);
const gain = only ? 1 : Math.min(10 ** (-17 / 20) / rms, 4);
const knee = 10 ** (-4.5 / 20);
const ceil = 10 ** (-1.8 / 20); // sample ceiling; leaves room for AAC inter-sample peaks (target ≤ −1 dBTP)
let after = 0;
let limited = 0;
for (let i = 0; i < N; i++) {
  let v = mix[i] * gain;
  const a = Math.abs(v);
  if (a > knee) {
    v = Math.sign(v) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
    limited++;
  }
  mix[i] = v;
  after = Math.max(after, Math.abs(v));
}
console.log(`limiter touched ${((100 * limited) / N).toFixed(3)}% of samples`);
const wav = path.join(ROOT, 'out', only ? `stem-${only}.wav` : 'mix.wav');
writeWav(wav, mix);
console.log(`mix: ${sheet.cues.length} cues, ${dur.toFixed(2)}s, rms ${(20 * Math.log10(rms)).toFixed(1)} dB → gain ${(20 * Math.log10(gain)).toFixed(1)} dB, peak ${(20 * Math.log10(after)).toFixed(2)} dBFS`);

const [video, out] = process.argv.slice(2);
if (video && out) {
  await run(FFMPEG, ['-y', '-v', 'error', '-i', path.resolve(video), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', path.resolve(out)]);
  console.log('muxed', out);
}
